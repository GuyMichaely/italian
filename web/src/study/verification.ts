import type { AdjectiveCard, Flashcard } from "../cards/types";
import type { NounMorphology } from "../cards/nounMorphology";
import { adjectiveFormLabels, adjectiveForms, resolvedAdjectiveForms, type AdjectiveMorphology } from "../cards/adjectiveMorphology";
import { checkNounAnswer, type AnswerCheck } from "./nounAnswers";
import type { StudyItem } from "./order";
import { adjectiveFullFormsReasonLabels, adjectiveFullFormsReasons, type StudyPreferences } from "./preferences";

export function normalizeAnswer(value: string) {
  return value
    .normalize("NFC")
    .trim()
    .toLocaleLowerCase("it-IT")
    .replace(/[’`]/g, "'")
    .replace(/\s+/g, " ");
}

export function whitespaceParts(value: string) {
  return (value.match(/"[^"]*"|\S+/g) ?? []).map((part) => {
    const unquoted = part.startsWith('"') && part.endsWith('"') ? part.slice(1, -1) : part;
    return unquoted === "-" || unquoted === "—" ? "" : unquoted;
  });
}

export function matchesExpected(actual: string[], expected: string[]) {
  return actual.length === expected.length && actual.every((value, index) => normalizeAnswer(value) === normalizeAnswer(expected[index] ?? ""));
}

/** Checks a typed answer for a study prompt; nouns and adjectives explain what was wrong. */
export function checkTypedAnswer(item: StudyItem, rawValue: string, morphology: NounMorphology, adjectiveMorphology: AdjectiveMorphology, preferences: StudyPreferences): AnswerCheck {
  const { card } = item;
  if (card.type === "noun") {
    return checkNounAnswer(card, rawValue, { mode: item.mode, morphology, preferences, genderGiven: item.promptGender !== null });
  }
  if (card.type === "adjective") return checkAdjectiveAnswer(card, rawValue, adjectiveMorphology, preferences);
  return { correct: verifyPowerAnswer(card, rawValue), problems: [] };
}

const allFormsHint = `Type the masculine singular, or all four forms: ${adjectiveForms.map((form) => adjectiveFormLabels[form]).join(", ")}.`;

/**
 * An adjective answer is its masculine singular alone, when the rules predict the rest and it isn't
 * being drilled, or its four forms in order.
 */
export function checkAdjectiveAnswer(card: AdjectiveCard, rawValue: string, morphology: AdjectiveMorphology, preferences: StudyPreferences): AnswerCheck {
  const { forms } = resolvedAdjectiveForms(card, morphology);
  const parts = whitespaceParts(rawValue.trim());
  if (parts.length === 1) {
    if (normalizeAnswer(parts[0]!) !== normalizeAnswer(forms.masculineSingular)) return { correct: false, problems: [`The masculine singular isn’t “${parts[0]}”.`] };
    const reasons = adjectiveFullFormsReasons(card, morphology, preferences);
    return reasons.length
      ? { correct: false, problems: [`Give all four forms: ${adjectiveFullFormsReasonLabels[reasons[0]!]}.`] }
      : { correct: true, problems: [] };
  }
  if (parts.length !== adjectiveForms.length) return { correct: false, problems: [allFormsHint] };
  const problems = adjectiveForms.flatMap((form, index) => normalizeAnswer(parts[index]!) === normalizeAnswer(forms[form])
    ? []
    : [`The ${adjectiveFormLabels[form]} isn’t “${parts[index]}”.`]);
  return { correct: !problems.length, problems };
}

export function verifyPowerAnswer(card: Extract<Flashcard, { type: "verb" | "adverb" }>, rawValue: string) {
  const answer = rawValue.trim();
  if (card.type === "verb") {
    const d = card.details;
    return matchesExpected(whitespaceParts(answer), [card.italian, d.io, d.tu, d.luiLei, d.noi, d.voi, d.loro, d.auxiliary, d.participle]);
  }
  return normalizeAnswer(answer) === normalizeAnswer(card.italian);
}
