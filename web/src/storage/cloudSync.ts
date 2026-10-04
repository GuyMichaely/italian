import { BrowserStorage } from "./browser";
import { emptyInventoryState, inventoryStatesEqual, parseInventoryState } from "./inventoryState";
import { InventoryConflictError, mergeInventory, type MergeChoices } from "./merge";
import { storageKey } from "./keys";
import type { InventoryState } from "./types";

/**
 * Sync with the server at sync.guymichaely.com (sync/ in this repo), which keeps one copy of the
 * inventory and a version number that goes up with every change.
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

const tokenKey = storageKey("sync-token");
const baseKey = storageKey("sync-base");

export type SyncStatus =
  | { state: "signed-out" }
  | { state: "syncing" }
  | { state: "synced"; at: string }
  | { state: "offline"; message: string }
  | { state: "conflict"; error: InventoryConflictError }
  | { state: "error"; message: string };

type Base = { version: number; inventory: InventoryState };

export class SyncSignedOutError extends Error {
  constructor() {
    super("Sign in again to sync.");
  }
}

export function readSyncToken() {
  try {
    return window.localStorage.getItem(tokenKey);
  } catch {
    return null;
  }
}

/** Keeps the token the server gave after signing in; a new sign-in starts from a fresh merge. */
export function saveSyncToken(token: string) {
  window.localStorage.setItem(tokenKey, token);
  window.localStorage.removeItem(baseKey);
}

export function forgetSyncToken() {
  window.localStorage.removeItem(tokenKey);
  window.localStorage.removeItem(baseKey);
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

type Remote = { version: number; inventory: InventoryState | null };

class CloudClient {
  constructor(private readonly url: string, private readonly token: string) {}

  private async request(init?: RequestInit) {
    let response: Response;
    try {
      response = await fetch(`${this.url}/inventory`, {
        ...init,
        headers: { authorization: `Bearer ${this.token}`, ...(init?.body ? { "content-type": "application/json" } : {}) },
      });
    } catch {
      throw new SyncOfflineError();
    }
    if (response.status === 401) throw new SyncSignedOutError();
    if (!response.ok && response.status !== 409) throw new Error(`The sync server answered ${response.status}.`);
    return { status: response.status, body: await response.json() as { version: number; inventory: unknown } };
  }

  private remote(body: { version: number; inventory: unknown }): Remote {
    return { version: body.version, inventory: body.inventory ? parseInventoryState(body.inventory, "The synced inventory") : null };
  }

  async get(): Promise<Remote> {
    return this.remote((await this.request()).body);
  }

  /** Uploads unless the server has moved past `baseVersion`; then returns what it has instead. */
  async put(inventory: InventoryState, baseVersion: number): Promise<{ ok: true; version: number } | { ok: false; remote: Remote }> {
    const { status, body } = await this.request({ method: "PUT", body: JSON.stringify({ baseVersion, inventory }) });
    return status === 409 ? { ok: false, remote: this.remote(body) } : { ok: true, version: body.version };
  }
}

export class SyncOfflineError extends Error {
  constructor() {
    super("The sync server can't be reached. Your words are kept here and sync when it can.");
  }
}

const isEmpty = (state: InventoryState) => !state.cards.length;

/**
 * One sync: merges the server's changes in here and uploads this browser's. Returns the inventory
 * as stored here afterwards. `choices` settles conflicts from an earlier attempt.
 */
export async function syncOnce(url: string, token: string, choices: MergeChoices = {}): Promise<InventoryState> {
  const client = new CloudClient(url, token);
  const local = new BrowserStorage();
  let remote = await client.get();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const base = readBase();
    const here = await local.readInventory();
    const there = remote.inventory ?? emptyInventoryState();
    let merged: InventoryState;
    if (base?.version === remote.version) merged = here;
    else if (!base && (isEmpty(here) || !remote.inventory)) merged = isEmpty(here) ? there : here;
    else merged = mergeInventory(base?.inventory ?? emptyInventoryState(), here, there, choices);

    // Keep the merge here first. Saving merges again with anything changed here meanwhile.
    const saved = inventoryStatesEqual(merged, here) ? here : await local.saveInventory(merged, choices);
    // What's here now has everything the server had.
    writeBase({ version: remote.version, inventory: there });
    if (remote.inventory && inventoryStatesEqual(saved, there)) {
      writeBase({ version: remote.version, inventory: saved });
      return saved;
    }
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
    this.status = readSyncToken() ? { state: "syncing" } : { state: "signed-out" };
  }

  get current() {
    return this.status;
  }

  subscribe(listener: (status: SyncStatus) => void) {
    this.listeners.add(listener);
    listener(this.status);
    return () => this.listeners.delete(listener);
  }

  private set(status: SyncStatus) {
    this.status = status;
    for (const listener of this.listeners) listener(status);
  }

  signOut() {
    forgetSyncToken();
    this.set({ state: "signed-out" });
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
    const token = readSyncToken();
    if (!token) {
      this.set({ state: "signed-out" });
      return null;
    }
    // Settling a conflict keeps showing it, with its screen, until the sync is done.
    if (!choices) this.set({ state: "syncing" });
    try {
      const work = () => syncOnce(this.url, token, choices);
      // One window at a time, so two don't merge against the same base.
      const synced = navigator.locks ? await navigator.locks.request("italian-sync", work) : await work();
      this.set({ state: "synced", at: new Date().toISOString() });
      this.onSynced(synced);
      return synced;
    } catch (error) {
      if (error instanceof InventoryConflictError) this.set({ state: "conflict", error });
      else if (error instanceof SyncSignedOutError) this.signOut();
      else if (error instanceof SyncOfflineError) this.set({ state: "offline", message: error.message });
      else this.set({ state: "error", message: error instanceof Error ? error.message : "Sync failed." });
      return null;
    }
  }
}
