import type { Flashcard, NounCard } from "../cards/types";
import {
  pluralIsPredictable,
  resolvedNounForms,
  type NounMorphology,
} from "../cards/nounMorphology";

/** Words typed before or among a noun answer to state its gender or that it has only one number. */
export type AnswerKeywords = {
  masculine: string;
  feminine: string;
  singularOnly: string;
  pluralOnly: string;
};

/**
 * Study settings that belong to the inventory rather than to one device, so they sync with it.
 * `fullDeclensionRules` are declension rules still being drilled; `fullDeclensionCards` are noun ids
 * that always need every form. Neither changes what a word is, only what word mode asks for.
 */
export type StudyPreferences = {
  answerKeywords: AnswerKeywords;
  fullDeclensionRules: string[];
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
  fullDeclensionRules: [],
  fullDeclensionCards: [],
};

export function cloneStudyPreferences(value: StudyPreferences): StudyPreferences {
  return {
    answerKeywords: { ...value.answerKeywords },
    fullDeclensionRules: [...value.fullDeclensionRules],
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
  return keywords;
}

export function normalizeStudyPreferences(value: unknown): StudyPreferences {
  const raw = objectValue(value, "Study preferences");
  assertExactKeys(raw, "Study preferences", ["answerKeywords", "fullDeclensionRules", "fullDeclensionCards"]);
  if (!Array.isArray(raw.fullDeclensionRules) || !Array.isArray(raw.fullDeclensionCards)) {
    throw new Error("Study preferences need fullDeclensionRules and fullDeclensionCards arrays.");
  }
  const rules = raw.fullDeclensionRules.map((name) => {
    const rule = String(name ?? "").trim();
    if (!rule) throw new Error("Full-declension rule names must be non-empty.");
    return rule;
  });
  const cards = raw.fullDeclensionCards.map((id) => {
    if (!Number.isSafeInteger(id)) throw new Error("Full-declension card ids must be integers.");
    return id as number;
  });
  return {
    answerKeywords: normalizeAnswerKeywords(raw.answerKeywords),
    fullDeclensionRules: [...new Set(rules)],
    fullDeclensionCards: [...new Set(cards)],
  };
}

/** Throws when a preference names a declension rule or noun that does not exist. */
export function assertStudyPreferenceReferences(preferences: StudyPreferences, cards: Flashcard[], morphology: NounMorphology) {
  const ruleNames = new Set(morphology.declensionRules.map((rule) => rule.name));
  for (const name of preferences.fullDeclensionRules) {
    if (!ruleNames.has(name)) throw new Error(`Study preferences name unknown declension rule ${name}.`);
  }
  const nounIds = new Set(cards.filter((card) => card.type === "noun").map((card) => card.id));
  for (const id of preferences.fullDeclensionCards) {
    if (!nounIds.has(id)) throw new Error(`Study preferences name unknown noun card ${id}.`);
  }
}

/** Drops references to rules and nouns that no longer exist, e.g. after a delete. */
export function prunedStudyPreferences(preferences: StudyPreferences, cards: Flashcard[], morphology: NounMorphology): StudyPreferences {
  const ruleNames = new Set(morphology.declensionRules.map((rule) => rule.name));
  const nounIds = new Set(cards.filter((card) => card.type === "noun").map((card) => card.id));
  return {
    answerKeywords: { ...preferences.answerKeywords },
    fullDeclensionRules: preferences.fullDeclensionRules.filter((name) => ruleNames.has(name)),
    fullDeclensionCards: preferences.fullDeclensionCards.filter((id) => nounIds.has(id)),
  };
}

export type FullDeclensionReason = "irregular" | "unpredictable" | "rule" | "card";

/**
 * Why word mode needs every form of this noun, most intrinsic reason first; empty when one form
 * is enough. Nouns with a single form never need more than that form.
 */
export function fullDeclensionReasons(card: NounCard, morphology: NounMorphology, preferences: StudyPreferences): FullDeclensionReason[] {
  const forms = resolvedNounForms(card, morphology);
  if (!forms.singular || !forms.plural) return [];
  const declension = card.details.declension;
  const reasons: FullDeclensionReason[] = [];
  if (declension.kind === "irregular") reasons.push("irregular");
  else if (!pluralIsPredictable(forms, morphology)) reasons.push("unpredictable");
  if (declension.kind === "rule" && preferences.fullDeclensionRules.includes(declension.rule)) reasons.push("rule");
  if (preferences.fullDeclensionCards.includes(card.id)) reasons.push("card");
  return reasons;
}

export const fullDeclensionReasonLabels: Record<FullDeclensionReason, string> = {
  irregular: "its declension is irregular",
  unpredictable: "the declension rules don’t predict its plural",
  rule: "you’re drilling its declension rule",
  card: "you marked this word",
};
