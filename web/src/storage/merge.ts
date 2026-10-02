import type { Flashcard } from "../cards/types";
import { resolvedNounForms } from "../cards/nounMorphology";
import { resolvedAdjectiveForms } from "../cards/adjectiveMorphology";
import { assertNoDuplicateCards, normalizeCard } from "./cardCodec";
import { assertInventoryState, consistentInventoryState } from "./inventoryState";
import type { InventoryState } from "./types";

/** The words changed both here and somewhere else, so neither version can be kept without losing the other. */
export class InventoryConflictError extends Error {
  constructor(message: string, readonly words: string[] = []) {
    super(message);
    this.name = "InventoryConflictError";
  }
}

function cardText(card: Flashcard) {
  return JSON.stringify(normalizeCard(card));
}

function cardLabel(card: Flashcard, state: InventoryState) {
  try {
    if (card.type === "noun") {
      const forms = resolvedNounForms(card, state.nounMorphology);
      return forms.singular || forms.plural;
    }
    if (card.type === "adjective") return resolvedAdjectiveForms(card, state.adjectiveMorphology).forms.masculineSingular;
    return card.italian;
  } catch {
    return card.english;
  }
}

/**
 * Three-way merge of a whole inventory.
 *
 * - `base` is the inventory as this copy last read or wrote it.
 * - `mine` is what this copy wants to save.
 * - `theirs` is what is stored now, which may have been changed elsewhere since `base`.
 *
 * Cards are matched by id. A card added on either side is kept, and a card changed (or deleted)
 * on only one side takes that side's version. A card changed on both sides to different
 * versions, or deleted on one side and changed on the other, is a conflict. The noun rules,
 * adjective rules and study preferences are each merged as one piece by the same rule. The merged
 * inventory must still be valid: every card fits the rules and no word is in it twice.
 *
 * Throws InventoryConflictError rather than return an inventory that loses anyone's change.
 */
export function mergeInventory(base: InventoryState, mine: InventoryState, theirs: InventoryState): InventoryState {
  const baseCards = new Map(base.cards.map((card) => [card.id, cardText(card)]));
  const mineCards = new Map(mine.cards.map((card) => [card.id, card]));
  const theirCards = new Map(theirs.cards.map((card) => [card.id, card]));
  const conflicts: Flashcard[] = [];

  // Mine is unchanged: take theirs. Theirs is unchanged, or both made the same change: take mine.
  function pick(id: number): Flashcard | null {
    const original = baseCards.get(id) ?? null;
    const mineCard = mineCards.get(id) ?? null;
    const theirCard = theirCards.get(id) ?? null;
    const mineText = mineCard && cardText(mineCard);
    const theirText = theirCard && cardText(theirCard);
    if (mineText === original) return theirCard;
    if (theirText === original || theirText === mineText) return mineCard;
    conflicts.push((mineCard ?? theirCard)!);
    return mineCard;
  }

  const cards: Flashcard[] = [];
  const seen = new Set<number>();
  // New cards from this side go first, as they would have; then everything in the stored order.
  for (const card of mine.cards) {
    if (baseCards.has(card.id) || theirCards.has(card.id)) continue;
    seen.add(card.id);
    cards.push(card);
  }
  for (const card of [...theirs.cards, ...mine.cards]) {
    if (seen.has(card.id)) continue;
    seen.add(card.id);
    const picked = pick(card.id);
    if (picked) cards.push(picked);
  }

  const partConflicts: string[] = [];
  function pickPart<Part>(name: string, of: (state: InventoryState) => Part) {
    const original = JSON.stringify(of(base));
    const mineText = JSON.stringify(of(mine));
    const theirText = JSON.stringify(of(theirs));
    if (mineText === original) return of(theirs);
    if (theirText === original || theirText === mineText) return of(mine);
    partConflicts.push(name);
    return of(mine);
  }
  const nounMorphology = pickPart("the noun rules", (state) => state.nounMorphology);
  const adjectiveMorphology = pickPart("the adjective rules", (state) => state.adjectiveMorphology);
  const studyPreferences = pickPart("the study preferences", (state) => state.studyPreferences);

  if (conflicts.length || partConflicts.length) {
    const words = conflicts.map((card) => cardLabel(card, mine));
    const named = [...words.map((word) => `“${word}”`), ...partConflicts];
    throw new InventoryConflictError(`Your words were changed in another window too, so this change wasn't saved: ${named.join(", ")} changed in both places. Reload to see the latest, then make your change again.`, words);
  }

  const merged = consistentInventoryState({ cards, nounMorphology, adjectiveMorphology, studyPreferences });
  try {
    assertNoDuplicateCards([], merged.cards);
    return assertInventoryState(merged);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "The two versions don't fit together.";
    throw new InventoryConflictError(`Your words were changed in another window too, and this change no longer fits with them, so it wasn't saved. ${reason} Reload to see the latest, then make your change again.`);
  }
}
