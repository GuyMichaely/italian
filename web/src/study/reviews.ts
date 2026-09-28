import type { Flashcard } from "../cards/types";
import type { StudyItem } from "./order";

export type MistakeReviewSet = {
  id: number;
  sourceSetId: number | null;
  items: StudyItem[];
};

/** A completed round adds a snapshot; replaying a set never replaces its contents. */
export function appendMistakeReviewSet(sets: MistakeReviewSet[], items: StudyItem[], sourceSetId: number | null): MistakeReviewSet[] {
  if (!items.length) return sets;
  return [...sets, { id: sets.length + 1, sourceSetId, items: [...items] }];
}

/** Keep the failed directions, while reflecting edits and excluding deleted words. */
export function availableReviewItems(set: MistakeReviewSet, cards: Flashcard[]): StudyItem[] {
  const byId = new Map(cards.map((card) => [card.id, card]));
  return set.items.flatMap((item) => {
    const card = byId.get(item.card.id);
    return card ? [{ ...item, card }] : [];
  });
}
