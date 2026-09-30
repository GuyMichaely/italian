import { fetchedLexiconSource, Lexicon, type LexiconReading } from "../../web/src/lexicon/lookup";
import { suggestionsForReading, type LexiconSuggestion } from "../../web/src/lexicon/suggestions";
import { defaultNounMorphology } from "../../web/src/cards/nounMorphology";
import { defaultAdjectiveMorphology } from "../../web/src/cards/adjectiveMorphology";
import { lexiconUrl } from "./config";

export const lexicon = new Lexicon(fetchedLexiconSource(lexiconUrl));

/**
 * Suggestions as the extension shows them. It uses the default rules; the app turns the chosen
 * one into a card with the learner's own rules, so only the choice of reading matters here.
 */
export function suggestionsOf(reading: LexiconReading): LexiconSuggestion[] {
  return suggestionsForReading(reading, { noun: defaultNounMorphology, adjective: defaultAdjectiveMorphology });
}

/** A selection without the punctuation and spacing around it: “ Libri, ” → “Libri”. */
export function cleanSelection(text: string) {
  return text.normalize("NFC").replace(/\s+/g, " ").trim().replace(/^[^\p{L}]+|[^\p{L}]+$/gu, "");
}

/** Looks a selection up; “l’uovo” or “dell’arte” that isn't a word itself is looked up after the apostrophe. */
export async function lookUpSelection(text: string): Promise<{ word: string; readings: LexiconReading[] }> {
  const word = cleanSelection(text);
  if (!word) return { word, readings: [] };
  const readings = await lexicon.lookup(word);
  if (readings.length) return { word, readings };
  const afterApostrophe = word.split(/['’]/).at(-1)?.trim() ?? "";
  if (afterApostrophe && afterApostrophe !== word) {
    const elided = await lexicon.lookup(afterApostrophe);
    if (elided.length) return { word: afterApostrophe, readings: elided };
  }
  return { word, readings: [] };
}
