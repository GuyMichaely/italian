import type { Flashcard } from "./cards/types";
import type { NounMorphology } from "./cards/nounMorphology";
import type { AdjectiveMorphology } from "./cards/adjectiveMorphology";
import { nounCardFromDraft } from "./cards/nounDraft";
import { adjectiveCardFromDraft } from "./cards/adjectiveDraft";
import { adverbCard, verbCard } from "./cards/editorModel";
import { cardDuplicateKey, normalizeCard } from "./storage/cardCodec";
import { assertCardsFitMorphology } from "./storage/inventoryState";
import { suggestionsForReading } from "./lexicon/suggestions";
import type { LexiconHeadword } from "./lexicon/format";
import {
  extensionImportRequestType,
  extensionRequestSource,
  extensionReviewTag,
  extensionTag,
  type ExtensionImportRequest,
  type ExtensionWordEntry,
} from "./extensionProtocol";

export { extensionImportRequestType, extensionImportResultType, type ExtensionImportRequest, type ExtensionImportResult } from "./extensionProtocol";

function text(value: unknown) {
  return String(value ?? "").normalize("NFC").trim();
}

export function parseExtensionImportRequest(value: unknown): ExtensionImportRequest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const request = value as Partial<ExtensionImportRequest>;
  if (request.source !== extensionRequestSource || request.type !== extensionImportRequestType) return null;
  const requestId = text(request.requestId);
  const candidates = Array.isArray(request.candidates) && request.candidates.length ? request.candidates : null;
  const entries = Array.isArray(request.entries) && request.entries.length ? request.entries : null;
  if (!requestId || (!candidates && !entries)) {
    throw new Error("Extension import request is incomplete.");
  }
  return { source: extensionRequestSource, type: extensionImportRequestType, requestId, ...(candidates ? { candidates } : {}), ...(entries ? { entries } : {}) };
}

export function extensionCandidatesToCards(values: unknown[], morphology: NounMorphology, adjectiveMorphology: AdjectiveMorphology): Flashcard[] {
  const cards = values.map(normalizeCard);
  assertCardsFitMorphology(cards, morphology, adjectiveMorphology);
  return cards;
}

const headwordPos = new Set(["noun", "verb", "adj", "adv"]);

function readingHeadword(entry: ExtensionWordEntry): LexiconHeadword {
  const headword = entry?.reading?.headword as Partial<LexiconHeadword> | undefined;
  if (!headword || !headwordPos.has(String(headword.pos)) || typeof headword.word !== "string" || !Array.isArray(headword.glosses)) {
    throw new Error("The extension sent a word without its dictionary entry.");
  }
  return headword as LexiconHeadword;
}

function entryCard(entry: ExtensionWordEntry, id: number, morphology: NounMorphology, adjectiveMorphology: AdjectiveMorphology): Flashcard {
  const headword = readingHeadword(entry);
  const suggestions = suggestionsForReading({ headword, via: entry.reading.via ?? null }, { noun: morphology, adjective: adjectiveMorphology });
  const suggestion = suggestions[Number.isInteger(entry.choice) ? entry.choice : 0] ?? suggestions[0];
  if (!suggestion) throw new Error("The dictionary entry has nothing to add.");
  const english = text(entry.english) || suggestion.fields.english;
  if (!english) throw new Error("The dictionary gives no English for it.");
  const common = { id, setName: null, tags: suggestion.review ? [extensionTag, extensionReviewTag] : [extensionTag] };
  switch (suggestion.type) {
    case "noun":
      return nounCardFromDraft({ ...suggestion.fields, english }, common, morphology);
    case "adjective":
      return adjectiveCardFromDraft({ ...suggestion.fields, english }, common, adjectiveMorphology);
    case "verb":
      return normalizeCard(verbCard({ ...suggestion.fields, english, ...common }));
    case "adverb":
      return normalizeCard(adverbCard({ ...suggestion.fields, english, ...common }));
  }
}

/**
 * Turns the extension's words into cards with the learner's rules. A word that can't be made
 * into a card, or that the learner already has, is skipped with the reason rather than failing
 * the rest.
 */
export function extensionEntriesToCards(entries: ExtensionWordEntry[], existing: Flashcard[], morphology: NounMorphology, adjectiveMorphology: AdjectiveMorphology) {
  const keys = new Set(existing.map(cardDuplicateKey));
  const cards: Flashcard[] = [];
  const added: string[] = [];
  const skipped: { id: string; reason: string }[] = [];
  entries.forEach((entry, index) => {
    const id = text(entry?.id) || `entry-${index}`;
    try {
      const card = entryCard(entry, Date.now() + index, morphology, adjectiveMorphology);
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
