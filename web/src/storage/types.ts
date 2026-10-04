import type { Flashcard } from "../cards/types";
import type { NounMorphology } from "../cards/nounMorphology";
import type { AdjectiveMorphology } from "../cards/adjectiveMorphology";
import type { StudyPreferences } from "../study/preferences";
import type { MergeChoices } from "./merge";

export type InventoryState = {
  cards: Flashcard[];
  nounMorphology: NounMorphology;
  adjectiveMorphology: AdjectiveMorphology;
  studyPreferences: StudyPreferences;
};

export interface CardStorage {
  readonly label: string;
  /** Reads the inventory, and remembers it as what this window's next save is based on. */
  readInventory(): Promise<InventoryState>;
  /**
   * Saves this window's inventory, keeping changes made elsewhere since it was read, and returns
   * what was saved. Throws InventoryConflictError when the two can't both be kept; `choices`
   * settles those conflicts.
   */
  saveInventory(state: InventoryState, choices?: MergeChoices): Promise<InventoryState>;
  /** Writes the inventory as given, over whatever is stored (importing). */
  replaceInventory(state: InventoryState): Promise<InventoryState>;
}
