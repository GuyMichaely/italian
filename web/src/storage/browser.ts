import {
  assertInventoryState,
  cloneInventoryState,
  consistentInventoryState,
  emptyInventoryState,
  parseInventoryState,
} from "./inventoryState";
import { mergeInventory, type MergeChoices } from "./merge";
import type { CardStorage, InventoryState } from "./types";
import { storageKey } from "./keys";

const inventoryKey = storageKey("inventory");

export interface InventorySnapshot extends InventoryState {
  updatedAt: string | null;
}

export function readLocalSnapshot(): InventorySnapshot {
  const stored = window.localStorage.getItem(inventoryKey);
  if (!stored) return { ...emptyInventoryState(), updatedAt: null };

  const parsed = JSON.parse(stored) as { updatedAt?: unknown };
  return {
    ...parseInventoryState(parsed, "Local inventory"),
    updatedAt: typeof parsed.updatedAt === "string" && parsed.updatedAt.trim() ? parsed.updatedAt : null,
  };
}

/** The stored inventory as it was written, unparsed; null when there is none. */
export function readLocalSnapshotJson(): unknown {
  const stored = window.localStorage.getItem(inventoryKey);
  return stored ? JSON.parse(stored) : null;
}

/** The JSON written for a snapshot. */
export function storedSnapshot(snapshot: InventorySnapshot) {
  return {
    cards: snapshot.cards,
    nounMorphology: snapshot.nounMorphology,
    adjectiveMorphology: snapshot.adjectiveMorphology,
    studyPreferences: snapshot.studyPreferences,
    updatedAt: snapshot.updatedAt,
  };
}

export function writeLocalSnapshot(snapshot: InventorySnapshot) {
  assertInventoryState(snapshot);
  window.localStorage.setItem(inventoryKey, JSON.stringify(storedSnapshot(snapshot)));
}

export function clearLocalSnapshot() {
  window.localStorage.removeItem(inventoryKey);
}

/**
 * The inventory in this browser's local storage. Other windows of the app, and anything else on
 * this site, may change it while this one is open, so every save is merged with what is stored
 * now (see mergeInventory) instead of writing over it.
 */
export class BrowserStorage implements CardStorage {
  readonly label = "This browser";
  /** The inventory as this window last read or wrote it: the base of the next merge. */
  private base: InventorySnapshot | null = null;

  async readInventory() {
    this.base = readLocalSnapshot();
    return cloneInventoryState(this.base);
  }

  async saveInventory(state: InventoryState, choices?: MergeChoices) {
    const mine = parseInventoryState(consistentInventoryState(state), "Inventory");
    const stored = readLocalSnapshot();
    const base = this.base ?? stored;
    const merged = stored.updatedAt === base.updatedAt ? mine : mergeInventory(base, mine, stored, choices);
    return this.write(merged);
  }

  async replaceInventory(state: InventoryState) {
    return this.write(parseInventoryState(consistentInventoryState(state), "Inventory"));
  }

  private write(state: InventoryState) {
    const snapshot = { ...cloneInventoryState(state), updatedAt: new Date().toISOString() };
    writeLocalSnapshot(snapshot);
    this.base = snapshot;
    return cloneInventoryState(snapshot);
  }
}
