import type { Flashcard } from "../../web/src/cards/types";
import type { NounMorphology } from "../../web/src/cards/nounMorphology";
import type { AdjectiveMorphology } from "../../web/src/cards/adjectiveMorphology";
import { nounCardFromDraft } from "../../web/src/cards/nounDraft";
import { adjectiveCardFromDraft } from "../../web/src/cards/adjectiveDraft";
import { adverbCard, verbCard } from "../../web/src/cards/editorModel";
import { cardDuplicateKey, normalizeCard } from "../../web/src/storage/cardCodec";
import { assertCardsFitMorphology } from "../../web/src/storage/inventoryState";
import { readLocalSnapshot, readLocalSnapshotJson, storedSnapshot, writeLocalSnapshot } from "../../web/src/storage/browser";
import { suggestionsForReading } from "../../web/src/lexicon/suggestions";
import { editedNow, withEditTimes } from "../../web/src/cards/edited";
import { resolvedNounForms } from "../../web/src/cards/nounMorphology";
import { resolvedAdjectiveForms } from "../../web/src/cards/adjectiveMorphology";
import type { LexiconHeadword } from "../../web/src/lexicon/format";
import type { LexiconReading } from "../../web/src/lexicon/lookup";

/** Every word the extension adds gets this tag, and one with something to check also gets the review tag. */
export const extensionTag = "from-extension";
export const reviewTag = "needs-review";

/** A word on its way into the inventory: a dictionary reading and which of its suggestions to add. */
export type WordEntry = {
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

/**
 * A change to the stored inventory. `card` is the card as the extension last wrote it: a change
 * or removal only goes ahead while the stored card is still exactly that.
 */
export type WriteOp =
  | { kind: "add"; id: string; cardId: number; entry: WordEntry }
  | { kind: "change"; id: string; card: Flashcard; entry: WordEntry }
  | { kind: "remove"; id: string; card: Flashcard }
  /** Reads the card back, to show what it is now. */
  | { kind: "look"; id: string; cardId: number };

export type OpResult =
  /** The card is stored as given. */
  | { id: string; outcome: "saved"; card: Flashcard }
  | { id: string; outcome: "removed" }
  /** Nothing changed, with why: a word already there, or one that can't be made into a card. */
  | { id: string; outcome: "skipped"; reason: string }
  /** The card was changed or deleted in the app, so the extension leaves it alone from now on. */
  | { id: string; outcome: "detached"; reason: string }
  /** What a look found: the card, and its Italian as the learner's rules make it. */
  | { id: string; outcome: "found"; card: Flashcard; summary: string }
  | { id: string; outcome: "missing" };

/** What happened to a write: each change's outcome, or why nothing was written. */
export type WriteResult =
  | { ok: true; results: OpResult[] }
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

export function entryCard(entry: WordEntry, cardId: number, morphology: NounMorphology, adjectiveMorphology: AdjectiveMorphology): Flashcard {
  const headword = readingHeadword(entry);
  const suggestions = suggestionsForReading({ headword, via: entry.reading.via ?? null }, { noun: morphology, adjective: adjectiveMorphology });
  const suggestion = suggestions[Number.isInteger(entry.choice) ? entry.choice : 0] ?? suggestions[0];
  if (!suggestion) throw new Error("The dictionary entry has nothing to add.");
  const english = text(entry.english) || suggestion.fields.english;
  if (!english) throw new Error("The dictionary gives no English for it.");
  const common = { id: cardId, setName: null, tags: suggestion.review ? [extensionTag, reviewTag] : [extensionTag], editedAt: editedNow() };
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

/** “cane / cani, masculine noun”, as the learner's own rules make the forms. */
export function cardSummary(card: Flashcard, morphology: NounMorphology, adjectiveMorphology: AdjectiveMorphology) {
  try {
    switch (card.type) {
      case "noun": {
        const forms = resolvedNounForms(card, morphology);
        return `${[forms.singular, forms.plural].filter(Boolean).join(" / ")}, ${card.details.gender} noun`;
      }
      case "adjective":
        return `${resolvedAdjectiveForms(card, adjectiveMorphology).forms.masculineSingular}, adjective`;
      case "verb":
        return `${card.italian}, verb with ${card.details.auxiliary}`;
      case "adverb":
        return `${card.italian}, adverb`;
    }
  } catch {
    return `a ${card.type}`;
  }
}

const sameCard = (left: Flashcard, right: Flashcard) => JSON.stringify(normalizeCard(left)) === JSON.stringify(normalizeCard(right));
const failure = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback;

/**
 * Applies the changes to the cards, with the learner's own rules. A change that can't be made is
 * skipped with the reason rather than failing the rest. New cards go first.
 */
export function applyOps(ops: WriteOp[], existing: Flashcard[], morphology: NounMorphology, adjectiveMorphology: AdjectiveMorphology) {
  let cards = [...existing];
  const added: Flashcard[] = [];
  const results: OpResult[] = [];
  const index = (id: number) => cards.findIndex((card) => card.id === id);
  for (const op of ops) {
    if (op.kind === "look") {
      const card = cards[index(op.cardId)];
      results.push(card ? { id: op.id, outcome: "found", card, summary: cardSummary(card, morphology, adjectiveMorphology) } : { id: op.id, outcome: "missing" });
      continue;
    }
    if (op.kind === "add") {
      // Already written, by a save whose result didn't come back.
      const stored = cards[index(op.cardId)] ?? added.find((card) => card.id === op.cardId);
      if (stored) {
        results.push({ id: op.id, outcome: "saved", card: stored });
        continue;
      }
    } else {
      const at = index(op.card.id);
      if (at < 0) {
        results.push(op.kind === "remove" ? { id: op.id, outcome: "removed" } : { id: op.id, outcome: "detached", reason: "It's no longer in your words." });
        continue;
      }
      if (!sameCard(cards[at]!, op.card)) {
        results.push({ id: op.id, outcome: "detached", reason: "It was changed on the Words page. Change it there." });
        continue;
      }
      if (op.kind === "remove") {
        cards = cards.filter((card) => card.id !== op.card.id);
        results.push({ id: op.id, outcome: "removed" });
        continue;
      }
    }
    try {
      // A change back to what's stored keeps the card, and the time it was edited, as they are.
      const [card] = withEditTimes(cards, [entryCard(op.entry, op.kind === "add" ? op.cardId : op.card.id, morphology, adjectiveMorphology)]) as [Flashcard];
      const others = [...added, ...cards].filter((other) => other.id !== card.id);
      if (others.some((other) => cardDuplicateKey(other) === cardDuplicateKey(card))) {
        results.push({ id: op.id, outcome: "skipped", reason: "It's already in your words." });
        continue;
      }
      assertCardsFitMorphology([card], morphology, adjectiveMorphology);
      if (op.kind === "add") added.push(card);
      else cards = cards.map((other) => other.id === card.id ? card : other);
      results.push({ id: op.id, outcome: "saved", card });
    } catch (error) {
      results.push({ id: op.id, outcome: "skipped", reason: failure(error, "It couldn't be made into a card.") });
    }
  }
  return { cards: [...added, ...cards], results };
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
 * Makes the changes to the inventory in this page's local storage: read, change, write, all in one
 * go so nothing else on the page can write in between. Windows of the app that are open keep
 * these changes when they next save, because the app merges its saves with what is stored.
 */
export function writeChanges(ops: WriteOp[]): WriteResult {
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
    const { cards, results } = applyOps(ops, snapshot.cards, snapshot.nounMorphology, snapshot.adjectiveMorphology);
    if (JSON.stringify(cards) !== JSON.stringify(snapshot.cards)) writeLocalSnapshot({ ...snapshot, cards, updatedAt: new Date().toISOString() });
    return { ok: true, results };
  } catch (error) {
    return { ok: false, error: failure(error, "The words couldn't be saved.") };
  }
}
