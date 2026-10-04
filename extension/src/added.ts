import type { Flashcard } from "../../web/src/cards/types";
import type { LexiconReading } from "../../web/src/lexicon/lookup";
import { describeSuggestion, shortSuggestionLabel, type LexiconSuggestion } from "../../web/src/lexicon/suggestions";
import { suggestionsOf } from "./dictionary";
import type { WordEntry, WriteOp, WriteResult } from "./words";
import type { WordView } from "./messages";

/**
 * A word added with the extension: every reading of it, which suggestion is picked, and the card
 * it was saved as. The extension can change or remove that card until it's edited in the app.
 */
export type AddedWord = {
  id: string;
  word: string;
  readings: LexiconReading[];
  reading: number;
  choice: number;
  english: string;
  context?: string;
  url?: string;
  addedAt: number;
  /** The id its card gets, chosen up front so saving it twice can't add it twice. */
  cardId: number;
  /**
   * pending: a change isn't saved yet. saved: the stored card matches. failed: it couldn't be
   * added, with the reason. detached: it was changed or deleted in the app, which owns it now.
   */
  status: "pending" | "saved" | "failed" | "detached";
  /** Undo was pressed: the card is to be removed. */
  removing?: boolean;
  /** For a word the app owns now: its card as last seen there. */
  stored?: { english: string; summary: string };
  /** The card as stored, and the choices it was made from. */
  saved?: { card: Flashcard; reading: number; choice: number; english: string };
  reason?: string;
  /** Goes up with every change, so a save's result only settles the version it saved. */
  revision: number;
};

/** Newest first. */
export type AddedWords = { words: AddedWord[]; lastError?: string };

export const noWords: AddedWords = { words: [] };

/** How many finished words the popup keeps listing. */
const keptLimit = 15;

export type WordOption = { reading: number; choice: number; suggestion: LexiconSuggestion };

/** Every suggestion across a word's readings, in order: what the learner can switch between. */
export function wordOptions(word: Pick<AddedWord, "readings">): WordOption[] {
  return word.readings.flatMap((reading, readingIndex) => suggestionsOf(reading).map((suggestion, choice) => ({ reading: readingIndex, choice, suggestion })));
}

export function chosenSuggestion(word: Pick<AddedWord, "readings" | "reading" | "choice">): LexiconSuggestion | undefined {
  const reading = word.readings[word.reading];
  return reading ? suggestionsOf(reading)[word.choice] : undefined;
}

export function newAddedWord(input: { id: string; cardId: number; word: string; readings: LexiconReading[]; reading?: number; choice?: number; context?: string; url?: string; now: number }): AddedWord {
  const word: AddedWord = {
    id: input.id,
    word: input.word,
    readings: input.readings,
    reading: input.reading ?? 0,
    choice: input.choice ?? 0,
    english: "",
    context: input.context,
    url: input.url,
    addedAt: input.now,
    cardId: input.cardId,
    status: "pending",
    revision: 0,
  };
  return { ...word, english: chosenSuggestion(word)?.fields.english ?? "" };
}

export function canEdit(word: AddedWord) {
  return word.status !== "detached" && !word.removing;
}

function changed(word: AddedWord, change: Partial<AddedWord>): AddedWord {
  return { ...word, ...change, status: "pending", reason: undefined, revision: word.revision + 1 };
}

/** Switches a word to another reading; its English becomes that reading's first meaning. */
export function withChoice(word: AddedWord, reading: number, choice: number): AddedWord {
  const english = chosenSuggestion({ readings: word.readings, reading, choice })?.fields.english ?? word.english;
  return changed(word, { reading, choice, english });
}

export function withEnglish(word: AddedWord, english: string): AddedWord {
  return changed(word, { english });
}

/** Undo: a saved card is to be removed. A word never saved has nothing to remove. */
export function withRemoval(word: AddedWord): AddedWord {
  return changed(word, { removing: true });
}

export function wordLabel(word: AddedWord) {
  const suggestion = chosenSuggestion(word);
  return suggestion ? shortSuggestionLabel(suggestion) : word.word;
}

export function wordDescription(word: AddedWord) {
  const suggestion = chosenSuggestion(word);
  return suggestion ? describeSuggestion(suggestion) : word.word;
}

function toEntry(word: AddedWord): WordEntry {
  return { word: word.word, reading: word.readings[word.reading]!, choice: word.choice, english: word.english, context: word.context, url: word.url };
}

/** A change waiting to be saved, with the version of the word it saves. */
export type PendingOp = { op: WriteOp; revision: number; choices: { reading: number; choice: number; english: string } };

export function pendingOps(state: AddedWords): PendingOp[] {
  return state.words.filter((word) => word.status === "pending" && (word.saved || !word.removing)).map((word) => ({
    revision: word.revision,
    choices: { reading: word.reading, choice: word.choice, english: word.english },
    op: word.removing ? { kind: "remove", id: word.id, card: word.saved!.card }
      : word.saved ? { kind: "change", id: word.id, card: word.saved.card, entry: toEntry(word) }
      : { kind: "add", id: word.id, cardId: word.cardId, entry: toEntry(word) },
  }));
}

/**
 * The words after a save. What's stored is always recorded; the outcome only settles a word that
 * hasn't changed since, and one that has stays pending for the next save.
 */
export function withWriteResult(state: AddedWords, ops: PendingOp[], result: WriteResult): AddedWords {
  if (!result.ok) return { ...state, lastError: result.error };
  const outcomes = new Map(result.results.map((outcome) => [outcome.id, outcome]));
  const saving = new Map(ops.map((pending) => [pending.op.id, pending]));
  const words: AddedWord[] = [];
  for (const word of state.words) {
    const outcome = outcomes.get(word.id);
    const pending = saving.get(word.id);
    if (!outcome || !pending) {
      words.push(word);
      continue;
    }
    const current = pending.revision === word.revision;
    switch (outcome.outcome) {
      case "removed":
        break;
      case "detached":
        words.push({ ...word, status: "detached", removing: undefined, reason: outcome.reason });
        break;
      case "saved": {
        const saved = { card: outcome.card, ...pending.choices };
        words.push(current ? { ...word, status: "saved", saved, reason: undefined } : { ...word, saved });
        break;
      }
      case "skipped":
        // Undone while it was being added, and it wasn't added.
        if (word.removing && !word.saved) break;
        if (!current) words.push(word);
        // A change that couldn't be made goes back to what's stored.
        else if (word.saved) words.push({ ...word, ...pick(word.saved), status: "saved", reason: `Not changed. ${outcome.reason}` });
        else words.push({ ...word, status: "failed", reason: outcome.reason });
        break;
    }
  }
  return { words: trimmed(words), lastError: undefined };
}

function pick({ reading, choice, english }: { reading: number; choice: number; english: string }) {
  return { reading, choice, english };
}

/** Reads back the cards of the words saved or detached, to see whether they changed in the app. */
export function lookOps(state: AddedWords): PendingOp[] {
  return state.words.filter((word) => (word.status === "saved" || word.status === "detached") && !word.removing).map((word) => ({
    revision: word.revision,
    choices: { reading: word.reading, choice: word.choice, english: word.english },
    op: { kind: "look", id: word.id, cardId: word.saved?.card.id ?? word.cardId },
  }));
}

/** The words after a look: one changed or deleted in the app is the app's from now on, shown as it is there. */
export function withLookResults(state: AddedWords, looks: PendingOp[], result: WriteResult): AddedWords {
  if (!result.ok) return state;
  const outcomes = new Map(result.results.map((outcome) => [outcome.id, outcome]));
  const revisions = new Map(looks.map((look) => [look.op.id, look.revision]));
  return {
    ...state,
    words: state.words.map((word) => {
      const outcome = outcomes.get(word.id);
      if (!outcome || revisions.get(word.id) !== word.revision || (word.status !== "saved" && word.status !== "detached")) return word;
      if (outcome.outcome === "missing") return { ...word, status: "detached", stored: undefined, reason: "It's no longer in your words." };
      if (outcome.outcome !== "found") return word;
      if (word.status === "saved" && JSON.stringify(outcome.card) === JSON.stringify(word.saved?.card)) return word;
      return { ...word, status: "detached", stored: { english: outcome.card.english, summary: outcome.summary }, reason: "It was changed on the Words page. Change it there." };
    }),
  };
}

/** Keeps every word with something left to do, and the latest finished ones. */
export function trimmed(words: AddedWord[]): AddedWord[] {
  let finished = 0;
  return words.filter((word) => word.status === "pending" || word.status === "failed" || ++finished <= keptLimit);
}

/** What the toast and the popup show for a word; `lastError` is why the last save didn't happen. */
export function wordView(word: AddedWord, lastError?: string): WordView {
  const editable = canEdit(word);
  const suggestion = chosenSuggestion(word);
  const view: WordView = {
    id: word.id,
    heading: word.removing ? `Removing “${word.word}”…`
      : word.status === "failed" ? `Couldn't add “${word.word}”`
      : word.status === "detached" ? `“${word.word}” is in your words`
      : word.saved ? `Added “${word.word}” to Italian`
      : `Adding “${word.word}” to Italian…`,
    description: word.status === "detached" && word.stored ? `“${word.stored.english}”: ${word.stored.summary}.`
      : word.english ? `“${word.english}”: ${wordDescription(word)}` : wordDescription(word),
    english: word.english,
    meanings: editable ? suggestion?.glosses ?? [] : [],
    options: editable ? wordOptions(word).map((option) => ({
      reading: option.reading,
      choice: option.choice,
      label: shortSuggestionLabel(option.suggestion),
      selected: option.reading === word.reading && option.choice === word.choice,
    })) : [],
    undo: word.removing || word.status === "detached" ? null : word.status === "failed" ? "Dismiss" : "Undo",
    note: word.status === "pending" ? lastError ?? "Saving…" : word.reason ?? (word.status === "saved" ? "Saved to your words." : undefined),
    tone: word.status === "failed" || (word.status === "pending" && lastError) ? "error" : "normal",
  };
  return view;
}
