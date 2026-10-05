import type { Flashcard } from "../cards/types";
import {
  cloneNounMorphology,
  defaultNounMorphology,
  normalizeNounMorphology,
  resolvedNounForms,
  type NounMorphology,
} from "../cards/nounMorphology";
import {
  cloneAdjectiveMorphology,
  defaultAdjectiveMorphology,
  normalizeAdjectiveMorphology,
  resolvedAdjectiveForms,
  type AdjectiveMorphology,
} from "../cards/adjectiveMorphology";
import {
  assertStudyPreferenceReferences,
  cloneStudyPreferences,
  defaultStudyPreferences,
  normalizeStudyPreferences,
  prunedStudyPreferences,
} from "../study/preferences";
import { assertNoDuplicateCards, cloneCards, normalizeCard } from "./cardCodec";
import type { InventoryState } from "./types";

/** Throws when a noun or adjective cannot be generated from the morphology (unknown rule, wrong gender, …). */
export function assertCardsFitMorphology(cards: Flashcard[], morphology: NounMorphology, adjectiveMorphology: AdjectiveMorphology) {
  for (const card of cards) {
    if (card.type === "noun") resolvedNounForms(card, morphology);
    if (card.type === "adjective") resolvedAdjectiveForms(card, adjectiveMorphology);
  }
}

export function assertInventoryState<State extends InventoryState>(state: State) {
  assertCardsFitMorphology(state.cards, state.nounMorphology, state.adjectiveMorphology);
  assertStudyPreferenceReferences(state.studyPreferences, state.cards, state.nounMorphology, state.adjectiveMorphology);
  return state;
}

export function emptyInventoryState(): InventoryState {
  return {
    cards: [],
    nounMorphology: cloneNounMorphology(defaultNounMorphology),
    adjectiveMorphology: cloneAdjectiveMorphology(defaultAdjectiveMorphology),
    studyPreferences: cloneStudyPreferences(defaultStudyPreferences),
  };
}

export function cloneInventoryState(state: InventoryState): InventoryState {
  return {
    cards: cloneCards(state.cards),
    nounMorphology: cloneNounMorphology(state.nounMorphology),
    adjectiveMorphology: cloneAdjectiveMorphology(state.adjectiveMorphology),
    studyPreferences: cloneStudyPreferences(state.studyPreferences),
  };
}

/** A copy whose study preferences no longer name deleted nouns or rules. */
export function consistentInventoryState(state: InventoryState): InventoryState {
  const clone = cloneInventoryState(state);
  return { ...clone, studyPreferences: prunedStudyPreferences(clone.studyPreferences, clone.cards, clone.nounMorphology, clone.adjectiveMorphology) };
}

/** Validates stored or received inventory JSON (cards, nounMorphology, adjectiveMorphology, studyPreferences). */
export function parseInventoryState(value: unknown, label: string): InventoryState {
  const payload = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  if (!payload || !Array.isArray(payload.cards)) throw new Error(`${label} does not contain a cards array.`);
  if (!payload.nounMorphology) throw new Error(`${label} does not contain nounMorphology.`);
  if (!payload.adjectiveMorphology) throw new Error(`${label} does not contain adjectiveMorphology.`);
  if (!payload.studyPreferences) throw new Error(`${label} does not contain studyPreferences.`);
  const cards = payload.cards.map(normalizeCard);
  if (new Set(cards.map((card) => card.id)).size !== cards.length) throw new Error(`${label} has two cards with the same id.`);
  assertNoDuplicateCards([], cards);
  return assertInventoryState({
    cards,
    nounMorphology: normalizeNounMorphology(payload.nounMorphology),
    adjectiveMorphology: normalizeAdjectiveMorphology(payload.adjectiveMorphology),
    studyPreferences: normalizeStudyPreferences(payload.studyPreferences),
  });
}

export function inventoryStatesEqual(left: InventoryState, right: InventoryState) {
  return JSON.stringify(left.cards) === JSON.stringify(right.cards)
    && JSON.stringify(left.nounMorphology) === JSON.stringify(right.nounMorphology)
    && JSON.stringify(left.adjectiveMorphology) === JSON.stringify(right.adjectiveMorphology)
    && JSON.stringify(left.studyPreferences) === JSON.stringify(right.studyPreferences);
}
