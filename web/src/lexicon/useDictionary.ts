import { useRef, useState, useSyncExternalStore } from "react";
import type { CardType } from "../cards/types";
import { storageKey } from "../storage/keys";
import { typeLabels } from "../cardTypes";
import { fetchedLexiconSource, Lexicon } from "./lookup";
import { cardTypeForPos, suggestionsForReading, type LexiconSuggestion, type SuggestionMorphology } from "./suggestions";
import { rowAcceptsSuggestion, rowHeadwordField, rowWithSuggestion, type RowFor, type SuggestionFor } from "./rows";

const autofillKey = storageKey("dictionary-autofill");
const listeners = new Set<() => void>();

function readAutofill() {
  try {
    return window.localStorage.getItem(autofillKey) !== "off";
  } catch {
    return true;
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** “Fill in words from the dictionary”, a per-device setting that's on unless turned off. */
export function useDictionaryAutofill(): [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore(subscribe, readAutofill, () => true);
  const set = (value: boolean) => {
    try {
      window.localStorage.setItem(autofillKey, value ? "on" : "off");
    } catch {
      // The setting stays on for this page when storage is unavailable.
    }
    listeners.forEach((listener) => listener());
  };
  return [on, set];
}

let sharedLexicon: Lexicon | null = null;

/** The lexicon published beside the app (lexicon/ next to index.html). */
export function appLexicon() {
  sharedLexicon ??= new Lexicon(fetchedLexiconSource(new URL("lexicon/", document.baseURI).href));
  return sharedLexicon;
}

/** What the dictionary said about the word typed in one row. */
export type DictionaryNote =
  | { word: string; state: "loading" }
  | { word: string; state: "missing"; otherTypes: CardType[] }
  | { word: string; state: "failed"; message: string }
  | { word: string; state: "found"; suggestions: LexiconSuggestion[]; chosen: number; applied: boolean };

export type DictionaryRows = {
  enabled: boolean;
  notes: Record<string, DictionaryNote>;
  /** Looks up a row's typed headword and, unless the learner typed the other fields, fills the row in. */
  lookUp: (rowId: string, word: string) => void;
  /** Switches a row to another of the dictionary's readings. */
  choose: (rowId: string, index: number) => void;
  setEnglish: (rowId: string, english: string) => void;
  dismiss: (rowId: string) => void;
};

/**
 * Dictionary lookups for rows of one part of speech. `replace` changes one row; the hook fills
 * rows in with it.
 */
export function useDictionaryRows<T extends CardType>(
  type: T,
  morphology: SuggestionMorphology,
  rows: RowFor[T][],
  replace: (rowId: string, change: (row: RowFor[T]) => RowFor[T]) => void,
): DictionaryRows {
  const [enabled] = useDictionaryAutofill();
  const [notes, setNotes] = useState<Record<string, DictionaryNote>>({});
  const notesRef = useRef(notes);
  notesRef.current = notes;
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  const setNote = (rowId: string, note: DictionaryNote | null) => {
    const { [rowId]: _previous, ...rest } = notesRef.current;
    notesRef.current = note ? { ...rest, [rowId]: note } : rest;
    setNotes(notesRef.current);
  };

  const appliedSuggestion = (note: DictionaryNote | undefined) =>
    note?.state === "found" && note.applied ? note.suggestions[note.chosen]! as SuggestionFor<T> : null;

  /** Fills a row in; with `typed`, only if the row still holds that word and nothing else the learner typed. */
  function fill(rowId: string, suggestion: SuggestionFor<T>, previous: SuggestionFor<T> | null, typed: string | null) {
    const row = rowsRef.current.find((item) => item.id === rowId);
    if (!row) return false;
    const headword = String(row[rowHeadwordField(type) as keyof RowFor[T]] ?? "").normalize("NFC").trim();
    if (typed !== null && (headword !== typed || !rowAcceptsSuggestion(type, row, previous))) return false;
    replace(rowId, (current) => rowWithSuggestion(type, current, suggestion, previous));
    return true;
  }

  async function lookUp(rowId: string, typed: string) {
    const word = typed.normalize("NFC").trim();
    const current = notesRef.current[rowId];
    if (!enabled || current?.word === word) return;
    if (!word) {
      if (current) setNote(rowId, null);
      return;
    }
    const previous = appliedSuggestion(current);
    setNote(rowId, { word, state: "loading" });
    let readings;
    try {
      readings = await appLexicon().lookup(word);
    } catch (caught) {
      if (notesRef.current[rowId]?.word === word) setNote(rowId, { word, state: "failed", message: caught instanceof Error ? caught.message : "The dictionary couldn't be loaded." });
      return;
    }
    if (notesRef.current[rowId]?.word !== word) return;
    const suggestions = readings.filter((reading) => cardTypeForPos[reading.headword.pos] === type).flatMap((reading) => suggestionsForReading(reading, morphology));
    if (!suggestions.length) {
      setNote(rowId, { word, state: "missing", otherTypes: Array.from(new Set(readings.map((reading) => cardTypeForPos[reading.headword.pos]))) });
      return;
    }
    const applied = fill(rowId, suggestions[0] as SuggestionFor<T>, previous, word);
    // A form fills in its dictionary word (libri → libro); that's now the looked-up word.
    setNote(rowId, { word: applied ? suggestionHeadword(suggestions[0]!) : word, state: "found", suggestions, chosen: 0, applied });
  }

  function choose(rowId: string, index: number) {
    const note = notesRef.current[rowId];
    const suggestion = note?.state === "found" ? note.suggestions[index] : undefined;
    if (note?.state !== "found" || !suggestion) return;
    fill(rowId, suggestion as SuggestionFor<T>, appliedSuggestion(note), null);
    setNote(rowId, { ...note, word: suggestionHeadword(suggestion), chosen: index, applied: true });
  }

  return {
    enabled,
    notes,
    lookUp: (rowId, word) => void lookUp(rowId, word),
    choose,
    setEnglish: (rowId, english) => replace(rowId, (row) => ({ ...row, english })),
    dismiss: (rowId) => setNote(rowId, null),
  };
}

export function suggestionHeadword(suggestion: LexiconSuggestion) {
  switch (suggestion.type) {
    case "noun": return suggestion.fields.singular || suggestion.fields.plural;
    case "verb": return suggestion.fields.infinitive;
    case "adjective": return suggestion.fields.masculineSingular;
    case "adverb": return suggestion.fields.form;
  }
}

export function missingMessage(note: Extract<DictionaryNote, { state: "missing" }>) {
  if (!note.otherTypes.length) return `“${note.word}” isn’t in the dictionary.`;
  const types = note.otherTypes.map((type) => `${/^[aeiou]/i.test(typeLabels[type]) ? "an" : "a"} ${typeLabels[type].toLowerCase()}`);
  return `The dictionary has “${note.word}” only as ${types.join(" or ")}.`;
}
