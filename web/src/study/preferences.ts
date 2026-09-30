import type { AdjectiveCard, Flashcard, NounCard } from "../cards/types";
import {
  pluralIsPredictable,
  resolvedNounForms,
  singularIsPredictable,
  type NounMorphology,
  type NounFormNumber,
  type NounGender,
} from "../cards/nounMorphology";
import { determiningAdjectiveForms, resolvedAdjectiveForms, type AdjectiveMorphology } from "../cards/adjectiveMorphology";

/** Words typed before or among a noun answer to state its gender or that it has only one number. */
export type AnswerKeywords = {
  masculine: string;
  feminine: string;
  singularOnly: string;
  pluralOnly: string;
};

/**
 * Study settings that belong to the inventory rather than to one device, so they sync with it.
 * `nounFullDeclensionRules` and `adjectiveFullDeclensionRules` are declension rules still being
 * drilled; `fullDeclensionCards` are noun and adjective ids that always need every form. None of
 * them changes what a word is, only what a word answer asks for.
 */
export type StudyPreferences = {
  answerKeywords: AnswerKeywords;
  nounFullDeclensionRules: string[];
  adjectiveFullDeclensionRules: string[];
  fullDeclensionCards: number[];
};

export const defaultAnswerKeywords: AnswerKeywords = {
  masculine: "m",
  feminine: "f",
  singularOnly: "s",
  pluralOnly: "p",
};

export const defaultStudyPreferences: StudyPreferences = {
  answerKeywords: defaultAnswerKeywords,
  nounFullDeclensionRules: [],
  adjectiveFullDeclensionRules: [],
  fullDeclensionCards: [],
};

export function cloneStudyPreferences(value: StudyPreferences): StudyPreferences {
  return {
    answerKeywords: { ...value.answerKeywords },
    nounFullDeclensionRules: [...value.nounFullDeclensionRules],
    adjectiveFullDeclensionRules: [...value.adjectiveFullDeclensionRules],
    fullDeclensionCards: [...value.fullDeclensionCards],
  };
}

function objectValue(value: unknown, label: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function assertExactKeys(value: Record<string, unknown>, label: string, expected: string[]) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`${label} must contain exactly: ${wanted.join(", ")}.`);
  }
}

export type AnswerMarker = { genders: NounGender[]; tantum: NounFormNumber | null };

/**
 * Every marker token the keywords make: a gender (or both genders, one per typed form, as in “mf”),
 * a singular-/plural-only keyword, or a gender and a singular-/plural-only keyword typed together
 * in either order (“fs”, “sf”). Throws when one token would read two ways.
 */
export function answerMarkers(keywords: AnswerKeywords) {
  const genders: [string, NounGender[]][] = [
    [keywords.masculine, ["masculine"]],
    [keywords.feminine, ["feminine"]],
    [keywords.masculine + keywords.feminine, ["masculine", "feminine"]],
    [keywords.feminine + keywords.masculine, ["feminine", "masculine"]],
  ];
  const tantums: [string, NounFormNumber][] = [[keywords.singularOnly, "singular"], [keywords.pluralOnly, "plural"]];
  const entries: [string, AnswerMarker][] = [
    ...genders.map(([token, value]): [string, AnswerMarker] => [token, { genders: value, tantum: null }]),
    ...tantums.map(([token, value]): [string, AnswerMarker] => [token, { genders: [], tantum: value }]),
    ...genders.flatMap(([gender, value]) => tantums.flatMap(([tantum, number]): [string, AnswerMarker][] => [
      [gender + tantum, { genders: value, tantum: number }],
      [tantum + gender, { genders: value, tantum: number }],
    ])),
  ];
  const markers = new Map<string, AnswerMarker>();
  for (const [token, marker] of entries) {
    const key = token.normalize("NFC").toLocaleLowerCase("it-IT");
    const existing = markers.get(key);
    if (existing && JSON.stringify(existing) !== JSON.stringify(marker)) throw new Error(`These answer keywords make “${key}” mean two different things; choose keywords that don’t combine into one another.`);
    markers.set(key, marker);
  }
  return markers;
}

/** Keywords are single lowercase tokens, all different, so they can be told apart from articles and nouns. */
export function normalizeAnswerKeywords(value: unknown): AnswerKeywords {
  const raw = objectValue(value, "Answer keywords");
  assertExactKeys(raw, "Answer keywords", ["masculine", "feminine", "singularOnly", "pluralOnly"]);
  const keywords = Object.fromEntries((Object.keys(defaultAnswerKeywords) as (keyof AnswerKeywords)[]).map((key) => {
    const keyword = String(raw[key] ?? "").normalize("NFC").trim().toLocaleLowerCase("it-IT");
    if (!keyword || /\s|[|:"'’]/u.test(keyword)) throw new Error("Each answer keyword must be one token without spaces, quotes, or apostrophes.");
    return [key, keyword];
  })) as AnswerKeywords;
  if (new Set(Object.values(keywords)).size !== Object.keys(keywords).length) throw new Error("Each answer keyword must be different.");
  answerMarkers(keywords);
  return keywords;
}

function ruleNameList(value: unknown, label: string) {
  if (!Array.isArray(value)) throw new Error(`Study preferences need a ${label} array.`);
  return [...new Set(value.map((name) => {
    const rule = String(name ?? "").trim();
    if (!rule) throw new Error("Full-declension rule names must be non-empty.");
    return rule;
  }))];
}

export function normalizeStudyPreferences(value: unknown): StudyPreferences {
  const raw = objectValue(value, "Study preferences");
  assertExactKeys(raw, "Study preferences", ["answerKeywords", "nounFullDeclensionRules", "adjectiveFullDeclensionRules", "fullDeclensionCards"]);
  if (!Array.isArray(raw.fullDeclensionCards)) throw new Error("Study preferences need a fullDeclensionCards array.");
  const cards = raw.fullDeclensionCards.map((id) => {
    if (!Number.isSafeInteger(id)) throw new Error("Full-declension card ids must be integers.");
    return id as number;
  });
  return {
    answerKeywords: normalizeAnswerKeywords(raw.answerKeywords),
    nounFullDeclensionRules: ruleNameList(raw.nounFullDeclensionRules, "nounFullDeclensionRules"),
    adjectiveFullDeclensionRules: ruleNameList(raw.adjectiveFullDeclensionRules, "adjectiveFullDeclensionRules"),
    fullDeclensionCards: [...new Set(cards)],
  };
}

function declinedCardIds(cards: Flashcard[]) {
  return new Set(cards.filter((card) => card.type === "noun" || card.type === "adjective").map((card) => card.id));
}

/** Throws when a preference names a declension rule, noun, or adjective that does not exist. */
export function assertStudyPreferenceReferences(preferences: StudyPreferences, cards: Flashcard[], morphology: NounMorphology, adjectiveMorphology: AdjectiveMorphology) {
  const nounRules = new Set(morphology.declensionRules.map((rule) => rule.name));
  for (const name of preferences.nounFullDeclensionRules) {
    if (!nounRules.has(name)) throw new Error(`Study preferences name unknown declension rule ${name}.`);
  }
  const adjectiveRules = new Set(adjectiveMorphology.declensionRules.map((rule) => rule.name));
  for (const name of preferences.adjectiveFullDeclensionRules) {
    if (!adjectiveRules.has(name)) throw new Error(`Study preferences name unknown adjective rule ${name}.`);
  }
  const ids = declinedCardIds(cards);
  for (const id of preferences.fullDeclensionCards) {
    if (!ids.has(id)) throw new Error(`Study preferences name unknown noun or adjective card ${id}.`);
  }
}

/** Drops references to rules and words that no longer exist, e.g. after a delete. */
export function prunedStudyPreferences(preferences: StudyPreferences, cards: Flashcard[], morphology: NounMorphology, adjectiveMorphology: AdjectiveMorphology): StudyPreferences {
  const nounRules = new Set(morphology.declensionRules.map((rule) => rule.name));
  const adjectiveRules = new Set(adjectiveMorphology.declensionRules.map((rule) => rule.name));
  const ids = declinedCardIds(cards);
  return {
    answerKeywords: { ...preferences.answerKeywords },
    nounFullDeclensionRules: preferences.nounFullDeclensionRules.filter((name) => nounRules.has(name)),
    adjectiveFullDeclensionRules: preferences.adjectiveFullDeclensionRules.filter((name) => adjectiveRules.has(name)),
    fullDeclensionCards: preferences.fullDeclensionCards.filter((id) => ids.has(id)),
  };
}

export type FullDeclensionReason = "gender" | "irregular" | "unpredictable" | "rule" | "card";

/**
 * Why word mode needs every form of this noun, most intrinsic reason first; empty when one form
 * can be enough (it still has to be a form the rules work the other from; see checkNounAnswer).
 * Nouns with a single form never need more than that form.
 */
export function fullDeclensionReasons(card: NounCard, morphology: NounMorphology, preferences: StudyPreferences): FullDeclensionReason[] {
  const forms = resolvedNounForms(card, morphology);
  if (!forms.singular || !forms.plural) return [];
  const declension = card.details.declension;
  const reasons: FullDeclensionReason[] = [];
  if (card.details.genderDiffersWithPlurality) reasons.push("gender");
  if (declension.kind === "irregular") reasons.push("irregular");
  else if (!pluralIsPredictable(forms, morphology) && !singularIsPredictable(forms, morphology)) reasons.push("unpredictable");
  if (declension.kind === "rule" && preferences.nounFullDeclensionRules.includes(declension.rule)) reasons.push("rule");
  if (preferences.fullDeclensionCards.includes(card.id)) reasons.push("card");
  return reasons;
}

export type AdjectiveFullFormsReason = Exclude<FullDeclensionReason, "gender">;

/** Why a typed answer needs all four forms of this adjective; empty when some single form is enough (see checkAdjectiveAnswer). */
export function adjectiveFullFormsReasons(card: AdjectiveCard, morphology: AdjectiveMorphology, preferences: StudyPreferences): AdjectiveFullFormsReason[] {
  const { forms } = resolvedAdjectiveForms(card, morphology);
  const declension = card.details.declension;
  const reasons: AdjectiveFullFormsReason[] = [];
  if (declension.kind === "irregular") reasons.push("irregular");
  else if (!determiningAdjectiveForms(forms, morphology).length) reasons.push("unpredictable");
  if (declension.kind === "rule" && preferences.adjectiveFullDeclensionRules.includes(declension.rule)) reasons.push("rule");
  if (preferences.fullDeclensionCards.includes(card.id)) reasons.push("card");
  return reasons;
}

export const adjectiveFullFormsReasonLabels: Record<AdjectiveFullFormsReason, string> = {
  irregular: "its forms are irregular",
  unpredictable: "no single form lets the adjective rules work out the others",
  rule: "you’re drilling its adjective rule",
  card: "you marked this word",
};

export const fullDeclensionReasonLabels: Record<FullDeclensionReason, string> = {
  gender: "its gender differs with plurality",
  irregular: "its declension is irregular",
  unpredictable: "the declension rules can’t work out either form from the other",
  rule: "you’re drilling its declension rule",
  card: "you marked this word",
};
