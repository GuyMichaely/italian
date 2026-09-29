import type { Flashcard } from "../cards/types";
import type { NounMorphology } from "../cards/nounMorphology";
import type { AdjectiveMorphology } from "../cards/adjectiveMorphology";
import type { StudyPreferences } from "../study/preferences";

export type InventoryState = {
  cards: Flashcard[];
  nounMorphology: NounMorphology;
  adjectiveMorphology: AdjectiveMorphology;
  studyPreferences: StudyPreferences;
};

export interface CardStorage {
  readonly label: string;
  readInventory(): Promise<InventoryState>;
  createCards(cards: Flashcard[]): Promise<Flashcard[]>;
  updateCard(card: Flashcard): Promise<Flashcard>;
  deleteCard(id: number): Promise<void>;
  replaceInventory(state: InventoryState): Promise<InventoryState>;
  syncNow?(): Promise<InventoryState>;
}
