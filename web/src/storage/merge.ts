import type { Flashcard } from "../cards/types";
import { assertNoDuplicateCards, cardDuplicateKey, normalizeCard } from "./cardCodec";
import { assertCardsFitMorphology, assertInventoryState, consistentInventoryState } from "./inventoryState";
import type { InventoryState } from "./types";

/** Which copy's version to keep: this one's, or the other's (another window, or the sync server). */
export type Side = "mine" | "theirs";

/** The learner's choice for each conflict, by its key. */
export type MergeChoices = Record<string, Side>;

/** A part of the inventory that merges as one piece. */
export type InventoryPart = "nounMorphology" | "adjectiveMorphology" | "studyPreferences";

export const partLabels: Record<InventoryPart, string> = {
  nounMorphology: "Noun rules",
  adjectiveMorphology: "Adjective rules",
  studyPreferences: "Study preferences",
};

/**
 * Something changed in both copies that can't be kept both ways.
 *
 * - card: a word changed differently in each, or changed in one and deleted (null) in the other.
 * - duplicate: the same word added in each, under different ids.
 * - part: rules or preferences changed in each, or rules changed in one so that words in the
 *   merge no longer fit. `removes` lists, for each choice, the words that don't fit it and so
 *   are dropped if it's chosen.
 */
export type InventoryConflict =
  | { key: string; kind: "card"; mine: Flashcard | null; theirs: Flashcard | null }
  | { key: string; kind: "duplicate"; mine: Flashcard; theirs: Flashcard }
  | { key: string; kind: "part"; part: InventoryPart; changedInBoth: boolean; removes: Record<Side, Flashcard[]> };

/** The conflicts a merge found, with both copies so they can be shown. Nothing was saved. */
export class InventoryConflictError extends Error {
  constructor(readonly conflicts: InventoryConflict[], readonly mine: InventoryState, readonly theirs: InventoryState) {
    super(`${conflicts.length} ${conflicts.length === 1 ? "change clashes" : "changes clash"} with changes made elsewhere.`);
    this.name = "InventoryConflictError";
  }
}

function cardText(card: Flashcard) {
  return JSON.stringify(normalizeCard(card));
}

function fits(card: Flashcard, state: Pick<InventoryState, "nounMorphology" | "adjectiveMorphology">) {
  try {
    assertCardsFitMorphology([card], state.nounMorphology, state.adjectiveMorphology);
    return true;
  } catch {
    return false;
  }
}

const rulesPart = (card: Flashcard): InventoryPart | null => card.type === "noun" ? "nounMorphology" : card.type === "adjective" ? "adjectiveMorphology" : null;

/**
 * Three-way merge of a whole inventory.
 *
 * - `base` is the inventory as this copy last read or wrote it (or last synced it).
 * - `mine` is what this copy has now.
 * - `theirs` is the other copy now, which may have changed since `base`.
 *
 * Cards are matched by id. A card added on either side is kept, and a card changed (or deleted)
 * on only one side takes that side's version. The noun rules, adjective rules and study
 * preferences are each merged as one piece the same way. Where both sides changed something
 * differently, `choices` says which side to keep; without a choice it's a conflict. The merge
 * must also still be valid: no word twice, and every word fits the rules.
 *
 * Throws InventoryConflictError, listing every conflict still without a choice, rather than return
 * an inventory that loses anyone's change.
 */
export function mergeInventory(base: InventoryState, mine: InventoryState, theirs: InventoryState, choices: MergeChoices = {}): InventoryState {
  const baseCards = new Map(base.cards.map((card) => [card.id, cardText(card)]));
  const mineCards = new Map(mine.cards.map((card) => [card.id, card]));
  const theirCards = new Map(theirs.cards.map((card) => [card.id, card]));
  const conflicts: InventoryConflict[] = [];

  // Mine is unchanged: take theirs. Theirs is unchanged, or both made the same change: take mine.
  function pick(id: number): Flashcard | null {
    const original = baseCards.get(id) ?? null;
    const mineCard = mineCards.get(id) ?? null;
    const theirCard = theirCards.get(id) ?? null;
    const mineText = mineCard && cardText(mineCard);
    const theirText = theirCard && cardText(theirCard);
    if (mineText === original) return theirCard;
    if (theirText === original || theirText === mineText) return mineCard;
    const key = `card:${id}`;
    const choice = choices[key];
    if (!choice) conflicts.push({ key, kind: "card", mine: mineCard, theirs: theirCard });
    return choice === "theirs" ? theirCard : mineCard;
  }

  let cards: Flashcard[] = [];
  const seen = new Set<number>();
  // New cards from this side go first, as they would have; then everything in the other's order.
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

  // The same word added on both sides: keep the chosen one.
  const byKey = new Map<string, Flashcard>();
  const dropped = new Set<number>();
  for (const card of cards) {
    const key = cardDuplicateKey(card);
    const other = byKey.get(key);
    if (!other) {
      byKey.set(key, card);
      continue;
    }
    const [mineCard, theirCard] = mineCards.has(card.id) && !mineCards.has(other.id) ? [card, other] : [other, card];
    const conflictKey = `duplicate:${Math.min(card.id, other.id)}:${Math.max(card.id, other.id)}`;
    const choice = choices[conflictKey];
    if (!choice) {
      conflicts.push({ key: conflictKey, kind: "duplicate", mine: mineCard, theirs: theirCard });
      continue;
    }
    const keep = choice === "mine" ? mineCard : theirCard;
    dropped.add(keep === card ? other.id : card.id);
    byKey.set(key, keep);
  }
  cards = cards.filter((card) => !dropped.has(card.id));

  // Rules and preferences, each as one piece.
  const parts = {} as Pick<InventoryState, InventoryPart>;
  const changedInBoth = new Set<InventoryPart>();
  for (const part of ["nounMorphology", "adjectiveMorphology", "studyPreferences"] as const) {
    const original = JSON.stringify(base[part]);
    const mineText = JSON.stringify(mine[part]);
    const theirText = JSON.stringify(theirs[part]);
    const choice = choices[`part:${part}`];
    // A choice also settles rules changed on one side only, when words from the other don't fit them.
    if (choice && mineText !== theirText) (parts as Record<InventoryPart, unknown>)[part] = (choice === "theirs" ? theirs : mine)[part];
    else if (mineText === original) (parts as Record<InventoryPart, unknown>)[part] = theirs[part];
    else if (theirText === original || theirText === mineText) (parts as Record<InventoryPart, unknown>)[part] = mine[part];
    else {
      if (!choice) changedInBoth.add(part);
      (parts as Record<InventoryPart, unknown>)[part] = (choice === "theirs" ? theirs : mine)[part];
    }
  }

  // Words that don't fit the merged rules: the rules are a conflict, and the words that don't
  // fit the chosen rules are dropped.
  const rulesWith = (part: InventoryPart, side: Side) => ({ ...parts, [part]: (side === "mine" ? mine : theirs)[part] });
  const unfit = cards.filter((card) => !fits(card, parts));
  const troubled = new Set<InventoryPart>([...changedInBoth].filter((part) => part !== "studyPreferences"));
  for (const card of unfit) {
    const part = rulesPart(card);
    if (part && !choices[`part:${part}`]) troubled.add(part);
  }
  for (const part of changedInBoth.has("studyPreferences") ? ["studyPreferences" as const, ...troubled] : troubled) {
    const removes = { mine: [] as Flashcard[], theirs: [] as Flashcard[] };
    if (part !== "studyPreferences") {
      for (const side of ["mine", "theirs"] as const) removes[side] = cards.filter((card) => rulesPart(card) === part && !fits(card, rulesWith(part, side)));
    }
    conflicts.push({ key: `part:${part}`, kind: "part", part, changedInBoth: changedInBoth.has(part), removes });
  }

  if (conflicts.length) throw new InventoryConflictError(conflicts, mine, theirs);

  const merged = consistentInventoryState({ ...parts, cards: cards.filter((card) => fits(card, parts)) });
  assertNoDuplicateCards([], merged.cards);
  return assertInventoryState(merged);
}
