import type { AdjectiveCard, Flashcard } from "../cards/types";
import type { NounMorphology } from "../cards/nounMorphology";
import { adjectiveFormLabels, adjectiveForms, adjectiveFormsArePredictable, resolvedAdjectiveForms, type AdjectiveMorphology } from "../cards/adjectiveMorphology";
import { answerTokenPattern, checkNounAnswer, type AnswerCheck } from "./nounAnswers";
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
  return (value.match(answerTokenPattern) ?? []).map((part) => {
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
  return { correct: verifyPowerAnswer(card, rawValue), problems: [], wrongTokens: [] };
}

const allFormsHint = `Type one form, or all four: ${adjectiveForms.map((form) => adjectiveFormLabels[form]).join(", ")}.`;

/**
 * An adjective answer is any one of its forms, when the rules work out the other three from it and
 * the adjective isn't irregular, drilled, or marked, or all four forms in order.
 */
export function checkAdjectiveAnswer(card: AdjectiveCard, rawValue: string, morphology: AdjectiveMorphology, preferences: StudyPreferences): AnswerCheck {
  const { forms } = resolvedAdjectiveForms(card, morphology);
  const parts = whitespaceParts(rawValue.trim());
  if (parts.length === 1) {
    const typed = parts[0]!;
    const matching = adjectiveForms.filter((form) => normalizeAnswer(forms[form]) === normalizeAnswer(typed));
    if (!matching.length) return { correct: false, problems: [`“${typed}” isn’t a form of this adjective.`], wrongTokens: [0] };
    const reasons = adjectiveFullFormsReasons(card, morphology, preferences);
    if (reasons.length) return { correct: false, problems: [`Give all four forms: ${adjectiveFullFormsReasonLabels[reasons[0]!]}.`], wrongTokens: [] };
    return matching.some((form) => adjectiveFormsArePredictable(forms, morphology, form))
      ? { correct: true, problems: [], wrongTokens: [] }
      : { correct: false, problems: [`“${typed}” could come from more than one adjective rule; type a form that fits only one, or all four forms.`], wrongTokens: [] };
  }
  if (parts.length !== adjectiveForms.length) return { correct: false, problems: [allFormsHint], wrongTokens: [] };
  const wrongTokens = adjectiveForms.flatMap((form, index) => normalizeAnswer(parts[index]!) === normalizeAnswer(forms[form]) ? [] : [index]);
  const problems = wrongTokens.map((index) => `The ${adjectiveFormLabels[adjectiveForms[index]!]} isn’t “${parts[index]}”.`);
  return { correct: !problems.length, problems, wrongTokens };
}

export function verifyPowerAnswer(card: Extract<Flashcard, { type: "verb" | "adverb" }>, rawValue: string) {
  const answer = rawValue.trim();
  if (card.type === "verb") {
    const d = card.details;
    return matchesExpected(whitespaceParts(answer), [card.italian, d.io, d.tu, d.luiLei, d.noi, d.voi, d.loro, d.auxiliary, d.participle]);
  }
  return normalizeAnswer(answer) === normalizeAnswer(card.italian);
}
