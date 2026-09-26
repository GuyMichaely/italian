import type { CardType, Flashcard } from "../cards/types";

export type PromptLanguage = "english" | "italian";
export type PromptMode = PromptLanguage | "both";
export type ScopeMode = "all" | "only" | "exclude";

export type StudySetup = {
  scopeMode: ScopeMode;
  /** Scope keys shaped like `type:noun`, `set:Basics`, or `tag:tricky`. */
  selectedScopes: string[];
  promptMode: PromptMode;
  typeToVerify: boolean;
  oneDirectionPerWord: boolean;
  englishFirstWhenBoth: boolean;
};

export type AnswerKeywords = {
  masculine: string;
  feminine: string;
  singularOnly: string;
  pluralOnly: string;
};

export const defaultStudySetup: StudySetup = {
  scopeMode: "all",
  selectedScopes: [],
  promptMode: "english",
  typeToVerify: false,
  oneDirectionPerWord: false,
  englishFirstWhenBoth: false,
};

export const defaultAnswerKeywords: AnswerKeywords = {
  masculine: "m",
  feminine: "f",
  singularOnly: "s",
  pluralOnly: "p",
};

const studySetupKey = "parola:study-setup";
const answerKeywordsKey = "parola:answer-keywords";

export function readStudySetup(): StudySetup {
  if (typeof window === "undefined") return defaultStudySetup;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(studySetupKey) ?? "{}") as Partial<StudySetup>;
    return {
      scopeMode: parsed.scopeMode === "only" || parsed.scopeMode === "exclude" ? parsed.scopeMode : "all",
      selectedScopes: Array.isArray(parsed.selectedScopes) ? parsed.selectedScopes.filter((item): item is string => typeof item === "string") : [],
      promptMode: parsed.promptMode === "italian" || parsed.promptMode === "both" ? parsed.promptMode : "english",
      typeToVerify: parsed.typeToVerify === true,
      oneDirectionPerWord: parsed.oneDirectionPerWord === true,
      englishFirstWhenBoth: parsed.englishFirstWhenBoth === true,
    };
  } catch {
    return defaultStudySetup;
  }
}

export function writeStudySetup(setup: StudySetup) {
  try {
    window.localStorage.setItem(studySetupKey, JSON.stringify(setup));
  } catch {
    // Remembering the study setup is a convenience only.
  }
}

export function readAnswerKeywords(): AnswerKeywords {
  if (typeof window === "undefined") return defaultAnswerKeywords;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(answerKeywordsKey) ?? "{}") as Partial<AnswerKeywords>;
    return Object.fromEntries(Object.entries(defaultAnswerKeywords).map(([key, fallback]) => {
      const stored = parsed[key as keyof AnswerKeywords];
      return [key, typeof stored === "string" && stored.trim() ? stored.trim() : fallback];
    })) as AnswerKeywords;
  } catch {
    return defaultAnswerKeywords;
  }
}

export function writeAnswerKeywords(keywords: AnswerKeywords) {
  try {
    window.localStorage.setItem(answerKeywordsKey, JSON.stringify(keywords));
  } catch {
    // Keyword customization is optional; verification still works with the current in-memory values.
  }
}

export function cardScopeKeys(card: Flashcard) {
  return [`type:${card.type}`, ...(card.setName ? [`set:${card.setName}`] : []), ...card.tags.map((tag) => `tag:${tag}`)];
}

export function cardsInScope(cards: Flashcard[], setup: Pick<StudySetup, "scopeMode" | "selectedScopes">) {
  if (setup.scopeMode === "all") return cards;
  const selected = new Set(setup.selectedScopes);
  return cards.filter((card) => {
    const belongs = cardScopeKeys(card).some((key) => selected.has(key));
    return setup.scopeMode === "only" ? belongs : !belongs;
  });
}

export function studyItemCount(cards: Flashcard[], setup: StudySetup) {
  const scoped = cardsInScope(cards, setup).length;
  return setup.promptMode === "both" && !setup.oneDirectionPerWord ? scoped * 2 : scoped;
}

export function scopeKeyLabel(key: string, typeLabels: Record<CardType, string>) {
  const [kind, ...rest] = key.split(":");
  const value = rest.join(":");
  if (kind === "type") return `${typeLabels[value as CardType] ?? value}s`;
  if (kind === "tag") return `#${value}`;
  return value;
}
