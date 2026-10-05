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
 * browser and sync the next time it can.
 */

const signedInKey = storageKey("sync-signed-in");
const baseKey = storageKey("sync-base");
const modeKey = storageKey("sync-mode");
const syncedAtKey = storageKey("sync-at");

/**
 * When this device syncs. automatic: after edits, and as other devices change things (a live
 * connection). on-edit: after edits, on opening, and on coming back. manual: only when asked.
 */
export type SyncMode = "automatic" | "on-edit" | "manual";

export type SyncStatus =
  | { state: "signed-out" }
  | { state: "expired" }
  | { state: "idle" }
  | { state: "syncing" }
  | { state: "synced"; at: string }
  | { state: "offline"; message: string }
  | { state: "conflict"; error: InventoryConflictError }
  | { state: "error"; message: string };

type Base = { version: number; inventory: InventoryState };

/** The server turned the request away: the Access sign-in is missing or has expired. */
export class SyncSignedOutError extends Error {
  constructor() {
    super("Your sign-in has expired. Sign in again to sync.");
  }
}

export class SyncOfflineError extends Error {
  constructor() {
    super("The sync server can't be reached. Your words are kept here and sync when it can.");
  }
}

export function readSyncSignedIn() {
  return window.localStorage.getItem(signedInKey) === "true";
}

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

/** When this device last finished a sync, as an ISO time; null if it hasn't. */
export function readLastSynced() {
  return window.localStorage.getItem(syncedAtKey);
}

/** The device's sync mode: Automatically until one is chosen. Throws on a value it doesn't know. */
export function readSyncMode(): SyncMode {
  const stored = window.localStorage.getItem(modeKey);
  if (stored === null) return "automatic";
  if (stored === "automatic" || stored === "on-edit" || stored === "manual") return stored;
  throw new Error(`This device's sync setting is “${stored}”, which isn't one this version knows. Choose when to sync.`);
}

export function saveSyncMode(mode: SyncMode) {
  window.localStorage.setItem(modeKey, mode);
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
  constructor(private readonly url: string) {}

  private async request(path: string, init?: RequestInit) {
    let response: Response;
    try {
      response = await fetch(`${this.url}${path}`, {
        ...init,
        // Without Access's sign-in cookie, Access redirects to its login page.
        redirect: "manual",
        headers: init?.body ? { "content-type": "application/json" } : undefined,
      });
    } catch {
      throw new SyncOfflineError();
    }
    if (response.type === "opaqueredirect" || response.status === 401 || response.status === 403) throw new SyncSignedOutError();
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
export async function syncOnce(url: string, choices: MergeChoices = {}): Promise<InventoryState> {
  const client = new CloudClient(url);
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

/** Runs syncs one at a time across this browser's windows, and reports how they went. */
export class CloudSync {
  private status: SyncStatus;
  private listeners = new Set<(status: SyncStatus) => void>();
  /** Syncs run one after another; a plain sync waiting to start is shared by whoever asks next. */
  private chain: Promise<InventoryState | null> = Promise.resolve(null);
  private waiting: Promise<InventoryState | null> | null = null;

  constructor(private readonly url: string, private readonly onSynced: (inventory: InventoryState) => void) {
    this.status = readSyncSignedIn() ? { state: "idle" } : { state: "signed-out" };
  }

  get current() {
    return this.status;
  }

  get signedIn() {
    return this.status.state !== "signed-out";
  }

  subscribe(listener: (status: SyncStatus) => void) {
    this.listeners.add(listener);
    listener(this.status);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private set(status: SyncStatus) {
    this.status = status;
    for (const listener of this.listeners) listener(status);
  }

  /** Stops syncing on this device, and ends the Access sign-in here (best effort). */
  signOut() {
    forgetSync();
    this.set({ state: "signed-out" });
    // Offline, the sign-in simply stays until it expires.
    void fetch(new URL("/cdn-cgi/access/logout", this.url), { redirect: "manual" }).catch(() => undefined);
  }

  /**
   * Syncs after any sync already running. Without choices it does nothing while a conflict waits;
   * with them it settles the conflict.
   */
  sync(choices?: MergeChoices): Promise<InventoryState | null> {
    if (choices) return this.chain = this.chain.then(() => this.run(choices));
    if (this.waiting) return this.waiting;
    const next = this.chain.then(() => {
      this.waiting = null;
      return this.status.state === "conflict" ? null : this.run();
    });
    this.waiting = next;
    return this.chain = next;
  }

  private async run(choices?: MergeChoices): Promise<InventoryState | null> {
    if (!readSyncSignedIn()) {
      this.set({ state: "signed-out" });
      return null;
    }
    // Settling a conflict keeps showing it, with its screen, until the sync is done.
    if (!choices) this.set({ state: "syncing" });
    try {
      const work = () => syncOnce(this.url, choices);
      // One window at a time, so two don't merge against the same base.
      const synced = navigator.locks ? await navigator.locks.request("italian-sync", work) : await work();
      const at = new Date().toISOString();
      window.localStorage.setItem(syncedAtKey, at);
      this.set({ state: "synced", at });
      this.onSynced(synced);
      return synced;
    } catch (error) {
      if (error instanceof InventoryConflictError) this.set({ state: "conflict", error });
      else if (error instanceof SyncSignedOutError) this.set({ state: "expired" });
      else if (error instanceof SyncOfflineError) this.set({ state: "offline", message: error.message });
      else this.set({ state: "error", message: error instanceof Error ? error.message : "Sync failed." });
      return null;
    }
  }

  /** The live connection is down, or the network is: says so until a sync gets through. */
  unreachable() {
    if (this.status.state === "idle" || this.status.state === "synced" || this.status.state === "syncing") this.set({ state: "offline", message: new SyncOfflineError().message });
  }

  /** The version this browser last synced, to tell whether a live update is news. */
  syncedVersion() {
    return readBase()?.version ?? null;
  }
}

const reconnectDelaysMs = [1_000, 2_000, 5_000, 15_000, 30_000];
const pingEveryMs = 60_000;
const pongWithinMs = 10_000;

/**
 * A live connection to the server, which says { version } whenever the inventory changes (and
 * once on connecting). `onVersion` hears each, and `onConnected` whether the connection is up.
 * Reconnects after a drop, more slowly each time. A connection that stops answering pings counts
 * as dropped, since a lost network can leave it open for minutes.
 */
export class LiveUpdates {
  private socket: WebSocket | null = null;
  private running = false;
  private attempts = 0;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private ping: ReturnType<typeof setInterval> | undefined;
  private pong: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly url: string,
    private readonly onVersion: (version: number) => void,
    private readonly onConnected: (connected: boolean) => void,
  ) {}

  start() {
    this.running = true;
    this.connect();
  }

  stop() {
    this.running = false;
    clearTimeout(this.retry);
    if (this.socket) this.drop(this.socket);
  }

  /** Reconnects now if the connection dropped (phones close it in the background). */
  wake() {
    if (this.running && !this.socket) {
      clearTimeout(this.retry);
      this.connect();
    }
  }

  /** The network went away: drops the connection without waiting for it to notice. */
  lost() {
    if (this.socket) this.drop(this.socket, true);
  }

  private connect() {
    if (!this.running || this.socket) return;
    const socket = new WebSocket(`${this.url.replace(/^http/, "ws")}/live`);
    let opened = false;
    this.socket = socket;
    socket.onopen = () => {
      opened = true;
      this.attempts = 0;
      this.onConnected(true);
      this.ping = setInterval(() => {
        socket.send("ping");
        this.pong = setTimeout(() => this.drop(socket, true), pongWithinMs);
      }, pingEveryMs);
    };
    socket.onmessage = (event) => {
      if (event.data === "pong") return clearTimeout(this.pong);
      this.onVersion((JSON.parse(event.data as string) as { version: number }).version);
    };
    // A connection that closes after opening (a deploy, a phone in the background) just
    // reconnects; one that can't open says the server is unreachable.
    socket.onclose = () => this.drop(socket, !opened);
  }

  private drop(socket: WebSocket, unreachable = false) {
    if (this.socket !== socket) return;
    this.socket = null;
    socket.onclose = null;
    socket.onmessage = null;
    socket.close();
    clearInterval(this.ping);
    clearTimeout(this.pong);
    if (!this.running) return;
    if (unreachable) this.onConnected(false);
    this.retry = setTimeout(() => this.connect(), reconnectDelaysMs[Math.min(this.attempts, reconnectDelaysMs.length - 1)]);
    this.attempts += 1;
  }
}
