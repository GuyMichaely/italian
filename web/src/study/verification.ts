import type { Flashcard } from "../cards/types";
import type { NounMorphology } from "../cards/nounMorphology";
import { checkArticleAnswer, checkWordAnswer, type AnswerCheck } from "./nounAnswers";
import type { StudyItem } from "./order";
import type { StudyPreferences } from "./preferences";

export type VerificationField = {
  key: string;
  label: string;
  expected: string;
};

export function normalizeAnswer(value: string) {
  return value
    .normalize("NFC")
    .trim()
    .toLocaleLowerCase("it-IT")
    .replace(/[’`]/g, "'")
    .replace(/\s+/g, " ");
}

export function standardAdjectivePattern(masculineSingular: string) {
  const word = masculineSingular.trim();
  const lower = word.toLocaleLowerCase("it-IT");
  if (lower.endsWith("o")) {
    const stem = word.slice(0, -1);
    return { masculineSingular: word, feminineSingular: `${stem}a`, masculinePlural: `${stem}i`, femininePlural: `${stem}e` };
  }
  if (lower.endsWith("e")) {
    const plural = `${word.slice(0, -1)}i`;
    return { masculineSingular: word, feminineSingular: word, masculinePlural: plural, femininePlural: plural };
  }
  return null;
}

export function cardSupportsStandardAdjectivePattern(card: Flashcard) {
  if (card.type !== "adjective") return false;
  const pattern = standardAdjectivePattern(card.details.masculineSingular || card.italian);
  return Boolean(pattern && verificationFields(card).every((field) => normalizeAnswer(pattern[field.key as keyof typeof pattern] ?? "") === normalizeAnswer(field.expected)));
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

/** Checks a typed answer for a study prompt; nouns explain what was wrong. */
export function checkTypedAnswer(item: StudyItem, rawValue: string, morphology: NounMorphology, preferences: StudyPreferences): AnswerCheck {
  const { card } = item;
  if (card.type === "noun") {
    return item.mode === "article"
      ? checkArticleAnswer(card, rawValue, morphology)
      : checkWordAnswer(card, rawValue, { morphology, preferences, genderGiven: item.promptGender !== null });
  }
  return { correct: verifyPowerAnswer(card, rawValue), problems: [] };
}

export function verifyPowerAnswer(card: Exclude<Flashcard, { type: "noun" }>, rawValue: string) {
  const answer = rawValue.trim();

  if (card.type === "verb") {
    const d = card.details;
    return matchesExpected(whitespaceParts(answer), [card.italian, d.io, d.tu, d.luiLei, d.noi, d.voi, d.loro, d.auxiliary, d.participle]);
  }

  if (card.type === "adverb") return normalizeAnswer(answer) === normalizeAnswer(card.italian);

  const d = card.details;
  const adjectiveParts = whitespaceParts(answer);
  if (adjectiveParts.length === 1 && cardSupportsStandardAdjectivePattern(card)) {
    const pattern = standardAdjectivePattern(adjectiveParts[0]);
    return Boolean(pattern && verificationFields(card).every((field) => normalizeAnswer(pattern[field.key as keyof typeof pattern] ?? "") === normalizeAnswer(field.expected)));
  }
  return matchesExpected(adjectiveParts, [d.masculineSingular || card.italian, d.feminineSingular, d.masculinePlural, d.femininePlural]);
}

export function verificationFields(card: Exclude<Flashcard, { type: "noun" }>): VerificationField[] {
  if (card.type === "verb") {
    const d = card.details;
    return [
      { key: "infinitive", label: "Infinitive", expected: card.italian },
      { key: "io", label: "io", expected: d.io },
      { key: "tu", label: "tu", expected: d.tu },
      { key: "luiLei", label: "lui / lei", expected: d.luiLei },
      { key: "noi", label: "noi", expected: d.noi },
      { key: "voi", label: "voi", expected: d.voi },
      { key: "loro", label: "loro", expected: d.loro },
      { key: "auxiliary", label: "Auxiliary", expected: d.auxiliary },
      { key: "participle", label: "Past participle", expected: d.participle },
    ];
  }
  if (card.type === "adverb") return [{ key: "form", label: "Adverb", expected: card.italian }];
  const d = card.details;
  return [
    { key: "masculineSingular", label: "Masculine singular", expected: d.masculineSingular || card.italian },
    { key: "feminineSingular", label: "Feminine singular", expected: d.feminineSingular },
    { key: "masculinePlural", label: "Masculine plural", expected: d.masculinePlural },
    { key: "femininePlural", label: "Feminine plural", expected: d.femininePlural },
  ];
}
