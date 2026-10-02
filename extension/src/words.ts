import type { Flashcard } from "../../web/src/cards/types";
import type { NounMorphology } from "../../web/src/cards/nounMorphology";
import type { AdjectiveMorphology } from "../../web/src/cards/adjectiveMorphology";
import { newCardId } from "../../web/src/cards/ids";
import { nounCardFromDraft } from "../../web/src/cards/nounDraft";
import { adjectiveCardFromDraft } from "../../web/src/cards/adjectiveDraft";
import { adverbCard, verbCard } from "../../web/src/cards/editorModel";
import { cardDuplicateKey, normalizeCard } from "../../web/src/storage/cardCodec";
import { assertCardsFitMorphology } from "../../web/src/storage/inventoryState";
import { readLocalSnapshot, readLocalSnapshotJson, storedSnapshot, writeLocalSnapshot } from "../../web/src/storage/browser";
import { suggestionsForReading } from "../../web/src/lexicon/suggestions";
import type { LexiconHeadword } from "../../web/src/lexicon/format";
import type { LexiconReading } from "../../web/src/lexicon/lookup";

/** Every word the extension adds gets this tag, and one with something to check also gets the review tag. */
export const extensionTag = "from-extension";
export const reviewTag = "needs-review";

/** A queued word on its way into the inventory: a dictionary reading and which of its suggestions to add. */
export type WordEntry = {
  id: string;
  /** The text that was selected or searched. */
  word: string;
  reading: LexiconReading;
  /** Index into suggestionsForReading(reading): a gender, plural, or auxiliary. */
  choice: number;
  english: string;
  /** The sentence the word was found in, and the page. */
  context?: string;
  url?: string;
};

/** What happened to a delivery: which entries became cards, and which didn't, with why. */
export type WriteResult =
  | { ok: true; added: string[]; skipped: { id: string; reason: string }[] }
  | { ok: false; error: string };

function text(value: unknown) {
  return String(value ?? "").normalize("NFC").trim();
}

const headwordPos = new Set(["noun", "verb", "adj", "adv"]);

function readingHeadword(entry: WordEntry): LexiconHeadword {
  const headword = entry?.reading?.headword as Partial<LexiconHeadword> | undefined;
  if (!headword || !headwordPos.has(String(headword.pos)) || typeof headword.word !== "string" || !Array.isArray(headword.glosses)) {
    throw new Error("The word arrived without its dictionary entry.");
  }
  return headword as LexiconHeadword;
}

function entryCard(entry: WordEntry, morphology: NounMorphology, adjectiveMorphology: AdjectiveMorphology): Flashcard {
  const headword = readingHeadword(entry);
  const suggestions = suggestionsForReading({ headword, via: entry.reading.via ?? null }, { noun: morphology, adjective: adjectiveMorphology });
  const suggestion = suggestions[Number.isInteger(entry.choice) ? entry.choice : 0] ?? suggestions[0];
  if (!suggestion) throw new Error("The dictionary entry has nothing to add.");
  const english = text(entry.english) || suggestion.fields.english;
  if (!english) throw new Error("The dictionary gives no English for it.");
  const common = { id: newCardId(), setName: null, tags: suggestion.review ? [extensionTag, reviewTag] : [extensionTag] };
  switch (suggestion.type) {
    case "noun":
      return normalizeCard(nounCardFromDraft({ ...suggestion.fields, english }, common, morphology));
    case "adjective":
      return normalizeCard(adjectiveCardFromDraft({ ...suggestion.fields, english }, common, adjectiveMorphology));
    case "verb":
      return normalizeCard(verbCard({ ...suggestion.fields, english, ...common }));
    case "adverb":
      return normalizeCard(adverbCard({ ...suggestion.fields, english, ...common }));
  }
}

/**
 * Turns words into cards with the learner's own rules. A word that can't be made into a card, or
 * that the learner already has, is skipped with the reason rather than failing the rest.
 */
export function entriesToCards(entries: WordEntry[], existing: Flashcard[], morphology: NounMorphology, adjectiveMorphology: AdjectiveMorphology) {
  const keys = new Set(existing.map(cardDuplicateKey));
  const cards: Flashcard[] = [];
  const added: string[] = [];
  const skipped: { id: string; reason: string }[] = [];
  entries.forEach((entry, index) => {
    const id = text(entry?.id) || `entry-${index}`;
    try {
      const card = entryCard(entry, morphology, adjectiveMorphology);
      const key = cardDuplicateKey(card);
      if (keys.has(key)) {
        skipped.push({ id, reason: "It's already in your words." });
        return;
      }
      keys.add(key);
      cards.push(card);
      added.push(id);
    } catch (error) {
      skipped.push({ id, reason: error instanceof Error ? error.message : "It couldn't be made into a card." });
    }
  });
  assertCardsFitMorphology(cards, morphology, adjectiveMorphology);
  return { cards, added, skipped };
}

/** Whether writing `written` back keeps every field and list item of `original`; values may be tidied. */
function keepsEverything(original: unknown, written: unknown): boolean {
  if (Array.isArray(original)) {
    return Array.isArray(written) && written.length === original.length && original.every((item, index) => keepsEverything(item, written[index]));
  }
  if (original && typeof original === "object") {
    if (!written || typeof written !== "object" || Array.isArray(written)) return false;
    return Object.entries(original).every(([key, value]) => key in written && keepsEverything(value, (written as Record<string, unknown>)[key]));
  }
  return true;
}

/**
 * Adds words to the inventory in this page's local storage: read, add, write, all in one go so
 * nothing else on the page can write in between. Windows of the app that are open keep these
 * words when they next save, because the app merges its saves with what is stored.
 */
export function writeWords(entries: WordEntry[]): WriteResult {
  let snapshot;
  try {
    snapshot = readLocalSnapshot();
    // Writing back must not drop anything a newer app stores that this version doesn't know about.
    const stored = readLocalSnapshotJson();
    if (stored && !keepsEverything(stored, storedSnapshot(snapshot))) throw new Error("Unknown fields.");
  } catch {
    return { ok: false, error: "Your words are stored in a way this version of the extension doesn't understand. Update the extension." };
  }
  try {
    const { cards, added, skipped } = entriesToCards(entries, snapshot.cards, snapshot.nounMorphology, snapshot.adjectiveMorphology);
    if (cards.length) writeLocalSnapshot({ ...snapshot, cards: [...cards, ...snapshot.cards], updatedAt: new Date().toISOString() });
    return { ok: true, added, skipped };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "The words couldn't be saved." };
  }
}
