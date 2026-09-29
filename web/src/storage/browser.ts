import type { Flashcard } from "../cards/types";
import { assertNoDuplicateCards, cloneCards } from "./cardCodec";
import {
  assertInventoryState,
  cloneInventoryState,
  consistentInventoryState,
  emptyInventoryState,
  parseInventoryState,
} from "./inventoryState";
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

export function writeLocalSnapshot(snapshot: InventorySnapshot) {
  assertInventoryState(snapshot);
  window.localStorage.setItem(inventoryKey, JSON.stringify({
    cards: snapshot.cards,
    nounMorphology: snapshot.nounMorphology,
    adjectiveMorphology: snapshot.adjectiveMorphology,
    studyPreferences: snapshot.studyPreferences,
    updatedAt: snapshot.updatedAt,
  }));
}

export function clearLocalSnapshot() {
  window.localStorage.removeItem(inventoryKey);
}

function timestamped(state: InventoryState): InventorySnapshot {
  return { ...consistentInventoryState(state), updatedAt: new Date().toISOString() };
}

export class BrowserStorage implements CardStorage {
  readonly label = "This browser";

  async readInventory() {
    return cloneInventoryState(readLocalSnapshot());
  }

  async createCards(cards: Flashcard[]) {
    const snapshot = readLocalSnapshot();
    const existing = snapshot.cards;
    assertNoDuplicateCards(existing, cards);
    let nextId = existing.reduce((max, card) => Math.max(max, card.id), 0) + 1;
    const inserted = cards.map((card) => ({ ...card, id: nextId++ }));
    writeLocalSnapshot(timestamped({ ...snapshot, cards: [...inserted, ...existing] }));
    return cloneCards(inserted);
  }

  async updateCard(card: Flashcard) {
    const snapshot = readLocalSnapshot();
    const index = snapshot.cards.findIndex((item) => item.id === card.id);
    if (index < 0) throw new Error("Card not found in local storage.");
    const updated = [...snapshot.cards];
    updated[index] = cloneCards([card])[0];
    writeLocalSnapshot(timestamped({ ...snapshot, cards: updated }));
    return cloneCards([card])[0];
  }

  async deleteCard(id: number) {
    const snapshot = readLocalSnapshot();
    const updated = snapshot.cards.filter((card) => card.id !== id);
    if (updated.length === snapshot.cards.length) throw new Error("Card not found in local storage.");
    writeLocalSnapshot(timestamped({ ...snapshot, cards: updated }));
  }

  async replaceInventory(state: InventoryState) {
    const replacement = { ...parseInventoryState(consistentInventoryState(state), "Inventory"), updatedAt: new Date().toISOString() };
    writeLocalSnapshot(replacement);
    return cloneInventoryState(replacement);
  }
}
