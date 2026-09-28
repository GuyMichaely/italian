import type { Flashcard } from "../cards/types";
import {
  cloneNounMorphology,
  defaultNounMorphology,
  normalizeNounMorphology,
  resolvedNounForms,
  type NounMorphology,
} from "../cards/nounMorphology";
import {
  assertStudyPreferenceReferences,
  cloneStudyPreferences,
  defaultStudyPreferences,
  normalizeStudyPreferences,
  prunedStudyPreferences,
} from "../study/preferences";
import { cloneCards, normalizeCard } from "./cardCodec";
import type { InventoryState } from "./types";

/** Throws when a noun cannot be generated from the morphology (unknown rule, wrong gender, …). */
export function assertCardsFitMorphology(cards: Flashcard[], morphology: NounMorphology) {
  for (const card of cards) {
    if (card.type === "noun") resolvedNounForms(card, morphology);
  }
}

export function assertInventoryState<State extends InventoryState>(state: State) {
  assertCardsFitMorphology(state.cards, state.nounMorphology);
  assertStudyPreferenceReferences(state.studyPreferences, state.cards, state.nounMorphology);
  return state;
}

export function emptyInventoryState(): InventoryState {
  return {
    cards: [],
    nounMorphology: cloneNounMorphology(defaultNounMorphology),
    studyPreferences: cloneStudyPreferences(defaultStudyPreferences),
  };
}

export function cloneInventoryState(state: InventoryState): InventoryState {
  return {
    cards: cloneCards(state.cards),
    nounMorphology: cloneNounMorphology(state.nounMorphology),
    studyPreferences: cloneStudyPreferences(state.studyPreferences),
  };
}

/** A copy whose study preferences no longer name deleted nouns or rules. */
export function consistentInventoryState(state: InventoryState): InventoryState {
  const clone = cloneInventoryState(state);
  return { ...clone, studyPreferences: prunedStudyPreferences(clone.studyPreferences, clone.cards, clone.nounMorphology) };
}

/** Validates stored or received inventory JSON (cards, nounMorphology, studyPreferences). */
export function parseInventoryState(value: unknown, label: string): InventoryState {
  const payload = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  if (!payload || !Array.isArray(payload.cards)) throw new Error(`${label} does not contain a cards array.`);
  if (!payload.nounMorphology) throw new Error(`${label} does not contain nounMorphology.`);
  if (!payload.studyPreferences) throw new Error(`${label} does not contain studyPreferences.`);
  return assertInventoryState({
    cards: payload.cards.map(normalizeCard),
    nounMorphology: normalizeNounMorphology(payload.nounMorphology),
    studyPreferences: normalizeStudyPreferences(payload.studyPreferences),
  });
}

export function inventoryStatesEqual(left: InventoryState, right: InventoryState) {
  return JSON.stringify(left.cards) === JSON.stringify(right.cards)
    && JSON.stringify(left.nounMorphology) === JSON.stringify(right.nounMorphology)
    && JSON.stringify(left.studyPreferences) === JSON.stringify(right.studyPreferences);
}
