import type { LexiconReading } from "../../web/src/lexicon/lookup";
import { describeSuggestion, shortSuggestionLabel, type LexiconSuggestion } from "../../web/src/lexicon/suggestions";
import type { ExtensionImportResult, ExtensionWordEntry } from "../../web/src/extensionProtocol";
import { suggestionsOf } from "./dictionary";

/** A word waiting to be saved in the app: every reading of it, and which suggestion was picked. */
export type QueuedWord = {
  id: string;
  word: string;
  readings: LexiconReading[];
  reading: number;
  choice: number;
  english: string;
  context?: string;
  url?: string;
  addedAt: number;
  /** "failed" words stay until removed, with why the app didn't take them. */
  status: "pending" | "failed";
  reason?: string;
};

export type RecentWord = { id: string; label: string; outcome: "added" | "skipped"; reason?: string; at: number };

export type QueueState = { words: QueuedWord[]; recent: RecentWord[]; lastError?: string };

export const emptyQueue: QueueState = { words: [], recent: [] };

const recentLimit = 15;

export type WordOption = { reading: number; choice: number; suggestion: LexiconSuggestion };

/** Every suggestion across a word's readings, in order: what the learner can switch between. */
export function wordOptions(word: Pick<QueuedWord, "readings">): WordOption[] {
  return word.readings.flatMap((reading, readingIndex) => suggestionsOf(reading).map((suggestion, choice) => ({ reading: readingIndex, choice, suggestion })));
}

export function chosenSuggestion(word: QueuedWord): LexiconSuggestion | undefined {
  const reading = word.readings[word.reading];
  return reading ? suggestionsOf(reading)[word.choice] : undefined;
}

export function newQueuedWord(input: { id: string; word: string; readings: LexiconReading[]; reading?: number; choice?: number; context?: string; url?: string; now: number }): QueuedWord {
  const word: QueuedWord = {
    id: input.id,
    word: input.word,
    readings: input.readings,
    reading: input.reading ?? 0,
    choice: input.choice ?? 0,
    english: "",
    context: input.context,
    url: input.url,
    addedAt: input.now,
    status: "pending",
  };
  return { ...word, english: chosenSuggestion(word)?.fields.english ?? "" };
}

/** Switches a word to another reading; its English follows unless the learner picked one of the old meanings. */
export function withChoice(word: QueuedWord, reading: number, choice: number): QueuedWord {
  const next = { ...word, reading, choice, status: "pending" as const, reason: undefined };
  const english = chosenSuggestion(next)?.fields.english ?? word.english;
  return { ...next, english };
}

export function wordLabel(word: QueuedWord) {
  const suggestion = chosenSuggestion(word);
  return suggestion ? shortSuggestionLabel(suggestion) : word.word;
}

export function wordDescription(word: QueuedWord) {
  const suggestion = chosenSuggestion(word);
  return suggestion ? describeSuggestion(suggestion) : word.word;
}

export function toEntry(word: QueuedWord): ExtensionWordEntry {
  return { id: word.id, word: word.word, reading: word.readings[word.reading]!, choice: word.choice, english: word.english, context: word.context, url: word.url };
}

/**
 * The queue after the app answered a delivery: added words and duplicates leave it (and show
 * under Recent); words the app couldn't make into cards stay, marked failed, with the reason.
 */
export function withDeliveryResult(state: QueueState, delivered: QueuedWord[], result: ExtensionImportResult, now: number): QueueState {
  if (!result.ok) return { ...state, lastError: result.error || "The app didn't take the words." };
  const added = new Set(result.added ?? delivered.map((word) => word.id));
  const skipped = new Map((result.skipped ?? []).map((item) => [item.id, item.reason]));
  const recent: RecentWord[] = [];
  const words: QueuedWord[] = [];
  for (const word of state.words) {
    const wasDelivered = delivered.some((item) => item.id === word.id);
    if (!wasDelivered) {
      words.push(word);
    } else if (added.has(word.id)) {
      recent.push({ id: word.id, label: wordLabel(word), outcome: "added", at: now });
    } else if (skipped.has(word.id) && /already/i.test(skipped.get(word.id)!)) {
      recent.push({ id: word.id, label: wordLabel(word), outcome: "skipped", reason: skipped.get(word.id), at: now });
    } else {
      words.push({ ...word, status: "failed", reason: skipped.get(word.id) ?? "The app didn't say what happened to it." });
    }
  }
  return { words, recent: [...recent, ...state.recent].slice(0, recentLimit), lastError: undefined };
}
