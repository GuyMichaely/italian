import { cloneInventoryState, parseInventoryState } from "./inventoryState";
import type { CardStorage, InventoryState } from "./types";

export type InventoryTransferState = InventoryState;

export function serializeInventory(state: InventoryState) {
  return JSON.stringify(cloneInventoryState(state), null, 2);
}

export function parseInventory(text: string): InventoryTransferState {
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    throw new Error("That inventory is not valid JSON.");
  }
  return parseInventoryState(value, "The inventory JSON");
}

export async function replaceInventory(
  storage: CardStorage,
  imported: InventoryTransferState,
) {
  return storage.replaceInventory(imported);
}
