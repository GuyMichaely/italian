import type { CardType } from "../cards/types";
import type { AdjectiveBatchRow, AdverbBatchRow, NounBatchRow, VerbBatchRow } from "../cards/editorModel";
import type { LexiconSuggestion } from "./suggestions";

export type RowFor = { noun: NounBatchRow; verb: VerbBatchRow; adjective: AdjectiveBatchRow; adverb: AdverbBatchRow };
export type SuggestionFor<T extends CardType> = Extract<LexiconSuggestion, { type: T }>;

type RowKind<T extends CardType> = {
  /** The field whose word is looked up. */
  headword: keyof RowFor[T] & string;
  /** The row with the suggestion's fields; `english` is decided by the caller. */
  fill: (row: RowFor[T], suggestion: SuggestionFor<T>) => RowFor[T];
  /** True when only the headword and English have been typed. */
  blank: (row: RowFor[T]) => boolean;
};

const rowKinds: { [T in CardType]: RowKind<T> } = {
  noun: {
    headword: "singular",
    fill: (row, { fields }) => ({ ...row, ...fields, english: row.english, pluralSuggested: false }),
    blank: (row) => (!row.plural.trim() || row.pluralSuggested) && !row.rule && row.articles === "all" && !row.singularGroup && !row.pluralGroup,
  },
  verb: {
    headword: "infinitive",
    fill: (row, { fields }) => ({ ...row, ...fields, english: row.english }),
    blank: (row) => [row.io, row.tu, row.luiLei, row.noi, row.voi, row.loro, row.participle].every((form) => !form.trim()),
  },
  adjective: {
    headword: "masculineSingular",
    fill: (row, { fields }) => ({ ...row, ...fields, english: row.english, suggested: false }),
    blank: (row) => !row.rule && (row.suggested || [row.feminineSingular, row.masculinePlural, row.femininePlural].every((form) => !form.trim())),
  },
  adverb: {
    headword: "form",
    fill: (row, { fields }) => ({ ...row, ...fields, english: row.english }),
    blank: () => true,
  },
};

export function rowHeadwordField(type: CardType) {
  return rowKinds[type].headword;
}

function kindFor<T extends CardType>(type: T) {
  return rowKinds[type] as unknown as RowKind<CardType> & { fill: (row: RowFor[T], suggestion: SuggestionFor<T>) => RowFor[T]; blank: (row: RowFor[T]) => boolean };
}

function sameFields(left: object, right: object, ignore: string[]) {
  const a = left as Record<string, unknown>;
  const b = right as Record<string, unknown>;
  return Object.keys(a).every((key) => ignore.includes(key) || a[key] === b[key]);
}

/**
 * Whether a row can be filled in from the dictionary without overwriting the learner's typing:
 * only its headword and English are typed, or everything else still holds what the dictionary
 * filled in for the previous word.
 */
export function rowAcceptsSuggestion<T extends CardType>(type: T, row: RowFor[T], previous: SuggestionFor<T> | null) {
  const kind = kindFor(type);
  if (kind.blank(row)) return true;
  return Boolean(previous && sameFields(row, kind.fill(row, previous), [kind.headword, "english", "id"]));
}

/**
 * The row filled in from a suggestion. English is kept when the learner typed it, and replaced
 * when it's still the previous suggestion's English.
 */
export function rowWithSuggestion<T extends CardType>(type: T, row: RowFor[T], suggestion: SuggestionFor<T>, previous: SuggestionFor<T> | null): RowFor[T] {
  const filled = kindFor(type).fill(row, suggestion) as RowFor[T] & { english: string };
  const english = !row.english.trim() || (previous && row.english === previous.fields.english) ? suggestion.fields.english : row.english;
  return { ...filled, english };
}
