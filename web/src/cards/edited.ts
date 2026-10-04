import type { Flashcard } from "./types";
import { normalizeCard } from "../storage/cardCodec";

export function editedNow() {
  return new Date().toISOString();
}

const epoch = new Date(0).toISOString();
const content = (card: Flashcard) => JSON.stringify(normalizeCard({ ...card, editedAt: epoch }));

/**
 * Stamps the cards that are new, or changed from `previous`, as edited at `now`; an unchanged
 * card keeps the time it had, whatever time it carries in `next`.
 */
export function withEditTimes(previous: Flashcard[], next: Flashcard[], now = editedNow()): Flashcard[] {
  const before = new Map(previous.map((card) => [card.id, { content: content(card), editedAt: card.editedAt }]));
  return next.map((card) => {
    const earlier = before.get(card.id);
    const editedAt = earlier?.content === content(card) ? earlier.editedAt : now;
    return card.editedAt === editedAt ? card : { ...card, editedAt };
  });
}
