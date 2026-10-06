import { SyncConflict, syncFetch, type SyncEngine, type SyncMode, type SyncSettings } from "@guymichaely/app-sync";
import { BrowserStorage } from "./browser";
import { emptyInventoryState, inventoryStatesEqual, parseInventoryState } from "./inventoryState";
import { InventoryConflictError, mergeInventory, type MergeChoices } from "./merge";
import { storageKey } from "./keys";
import type { InventoryState } from "./types";

/**
 * Sync with the server at /sync on the app's own origin (worker/ in this repo), which keeps one copy
 * of the inventory and a version number that goes up with every change. Cloudflare Access guards
 * it: signing in sets its cookie, which every request sends, and which expires after a while.
 *
 * A sync is a three-way merge, the same one windows use: the inventory as this browser last
 * synced it (the base), the inventory here now, and the server's. The merge is checked as a whole
 * and uploaded "only if the server is still on the version merged with"; if another device synced
 * in between, it merges again. A real clash stops the sync with InventoryConflictError, and syncing
 * again with the learner's choices settles it.
 *
 * The app works without it: signed out, or with the server unreachable, words are kept in this
 * browser and sync the next time it can. When it syncs is @guymichaely/app-sync's SyncController (App.tsx).
 */

const signedInKey = storageKey("sync-signed-in");
const baseKey = storageKey("sync-base");
const modeKey = storageKey("sync-mode");
const syncedAtKey = storageKey("sync-at");

type Base = { version: number; inventory: InventoryState };

/** After signing in: sync from a fresh merge. */
export function markSyncSignedIn() {
  window.localStorage.setItem(signedInKey, "true");
  window.localStorage.removeItem(baseKey);
}

export function forgetSync() {
  window.localStorage.removeItem(signedInKey);
  window.localStorage.removeItem(baseKey);
  window.localStorage.removeItem(syncedAtKey);
}

/**
 * This device's sync settings: Automatically until a mode is chosen. Only saveSyncSettings writes
 * the mode, so it's taken as it is; were it ever something else, choosing a mode would replace it.
 */
export function readSyncSettings(): SyncSettings {
  return {
    enabled: window.localStorage.getItem(signedInKey) === "true",
    mode: (window.localStorage.getItem(modeKey) ?? "automatic") as SyncMode,
  };
}

/** Turning sync off forgets what this device kept only for syncing; its words stay. */
export function saveSyncSettings({ enabled, mode }: SyncSettings) {
  window.localStorage.setItem(modeKey, mode);
  if (enabled) window.localStorage.setItem(signedInKey, "true");
  else forgetSync();
}

/**
 * How many changes `inventory` has that this device hasn't synced, against the inventory as it
 * last synced (or an empty one before its first sync): each word added, changed, or removed, and
 * each of grammar and study preferences if changed.
 */
export function countUnsyncedChanges(inventory: InventoryState) {
  const base = readBase()?.inventory ?? emptyInventoryState();
  const synced = new Map(base.cards.map((card) => [card.id, JSON.stringify(card)]));
  const here = new Set(inventory.cards.map((card) => card.id));
  const sections = (["nounMorphology", "adjectiveMorphology", "studyPreferences"] as const)
    .filter((key) => JSON.stringify(base[key]) !== JSON.stringify(inventory[key]));
  return inventory.cards.filter((card) => synced.get(card.id) !== JSON.stringify(card)).length
    + base.cards.filter((card) => !here.has(card.id)).length
    + sections.length;
}

function readBase(): Base | null {
  const stored = window.localStorage.getItem(baseKey);
  if (!stored) return null;
  const parsed = JSON.parse(stored) as { version: number; inventory: unknown };
  return { version: parsed.version, inventory: parseInventoryState(parsed.inventory, "The last synced inventory") };
}

function writeBase(base: Base) {
  window.localStorage.setItem(baseKey, JSON.stringify(base));
}

/** What the server has: its inventory, or that it's still on the version asked about. */
type Remote = { version: number; inventory: InventoryState | null; unchanged?: boolean };

class CloudClient {
  constructor(private readonly url: string, private readonly signal?: AbortSignal) {}

  private async request(path: string, init?: RequestInit) {
    const response = await syncFetch(`${this.url}${path}`, {
      ...init,
      signal: this.signal,
      headers: init?.body ? { "content-type": "application/json" } : undefined,
    });
    if (!response.ok && response.status !== 409) throw new Error(`The sync server answered ${response.status}.`);
    return { status: response.status, body: await response.json() as { version: number; inventory?: unknown; unchanged?: boolean } };
  }

  private remote(body: { version: number; inventory?: unknown; unchanged?: boolean }): Remote {
    if (body.unchanged) return { version: body.version, inventory: null, unchanged: true };
    return { version: body.version, inventory: body.inventory ? parseInventoryState(body.inventory, "The synced inventory") : null };
  }

  /** The server's inventory, or just "unchanged" if it's still on version `since`. */
  async get(since?: number): Promise<Remote> {
    return this.remote((await this.request(`/inventory${since === undefined ? "" : `?since=${since}`}`)).body);
  }

  /** Uploads unless the server has moved past `baseVersion`; then returns what it has instead. */
  async put(inventory: InventoryState, baseVersion: number): Promise<{ ok: true; version: number } | { ok: false; remote: Remote }> {
    const { status, body } = await this.request("/inventory", { method: "PUT", body: JSON.stringify({ baseVersion, inventory }) });
    return status === 409 ? { ok: false, remote: this.remote(body) } : { ok: true, version: body.version };
  }
}

const isEmpty = (state: InventoryState) => !state.cards.length;

/**
 * One sync: merges the server's changes in here and uploads this browser's. Returns the inventory
 * as stored here afterwards. `choices` settles conflicts from an earlier attempt.
 */
export async function syncOnce(url: string, choices: MergeChoices = {}, signal?: AbortSignal): Promise<InventoryState> {
  const client = new CloudClient(url, signal);
  const local = new BrowserStorage();
  let remote = await client.get(readBase()?.version);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const base = readBase();
    const here = await local.readInventory();
    // "Unchanged" means the server still has what was last synced.
    const there = remote.unchanged && base ? base.inventory : remote.inventory ?? emptyInventoryState();
    const serverHasOne = Boolean(remote.unchanged || remote.inventory);
    let merged: InventoryState;
    if (base?.version === remote.version) merged = here;
    else if (!base && (isEmpty(here) || !serverHasOne)) merged = isEmpty(here) ? there : here;
    else merged = mergeInventory(base?.inventory ?? emptyInventoryState(), here, there, choices);

    // Keep the merge here first. Saving merges again with anything changed here meanwhile.
    const saved = inventoryStatesEqual(merged, here) ? here : await local.saveInventory(merged, choices);
    // What's here now has everything the server had.
    writeBase({ version: remote.version, inventory: there });
    if (serverHasOne && inventoryStatesEqual(saved, there)) return saved;
    const put = await client.put(saved, remote.version);
    if (put.ok) {
      writeBase({ version: put.version, inventory: saved });
      return saved;
    }
    remote = put.remote;
  }
  throw new Error("Other devices kept syncing at the same time. Try again in a moment.");
}

/** The version this browser last synced, to tell whether a live update is news. */
export function syncedVersion() {
  return readBase()?.version ?? null;
}

/** One sync for the SyncController; `onSynced` shows the inventory it leaves here. */
export function cloudEngine(url: string, onSynced: (inventory: InventoryState) => void): SyncEngine<MergeChoices> {
  return {
    async sync({ choices, signal }) {
      let synced: InventoryState;
      try {
        synced = await syncOnce(url, choices, signal);
      } catch (error) {
        throw error instanceof InventoryConflictError ? new SyncConflict(error, error.message) : error;
      }
      window.localStorage.setItem(syncedAtKey, new Date().toISOString());
      onSynced(synced);
    },
    lastSyncedAt: () => window.localStorage.getItem(syncedAtKey),
  };
}
