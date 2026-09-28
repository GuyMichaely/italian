import type { CardType, Flashcard } from "../cards/types";
import type { NounMorphology } from "../cards/nounMorphology";
import { storageKey } from "../storage/keys";
import { takesArticles } from "./nounAnswers";

export type PromptLanguage = "english" | "italian";
export type PromptMode = PromptLanguage | "both";
export type ScopeMode = "all" | "only" | "exclude";
/** Words: recall each word from a prompt. Articles: an endless drill of noun articles. */
export type StudyMode = "words" | "articles";

export type StudySetup = {
  studyMode: StudyMode;
  scopeMode: ScopeMode;
  /** Scope keys shaped like `type:noun`, `set:Basics`, or `tag:tricky`. */
  selectedScopes: string[];
  promptMode: PromptMode;
  typeToVerify: boolean;
  oneDirectionPerWord: boolean;
  englishFirstWhenBoth: boolean;
};

export const defaultStudySetup: StudySetup = {
  studyMode: "words",
  scopeMode: "all",
  selectedScopes: [],
  promptMode: "english",
  typeToVerify: false,
  oneDirectionPerWord: false,
  englishFirstWhenBoth: false,
};

const studySetupKey = storageKey("study-setup");

export function readStudySetup(): StudySetup {
  if (typeof window === "undefined") return defaultStudySetup;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(studySetupKey) ?? "{}") as Partial<StudySetup>;
    return {
      studyMode: parsed.studyMode === "articles" ? "articles" : "words",
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

/** Prompts in one words round, or the nouns the endless articles drill draws from. */
export function studyItemCount(cards: Flashcard[], setup: StudySetup, morphology: NounMorphology) {
  const scoped = cardsInScope(cards, setup);
  if (setup.studyMode === "articles") return scoped.filter((card) => takesArticles(card, morphology)).length;
  return setup.promptMode === "both" && !setup.oneDirectionPerWord ? scoped.length * 2 : scoped.length;
}

export function scopeKeyLabel(key: string, typeLabels: Record<CardType, string>) {
  const [kind, ...rest] = key.split(":");
  const value = rest.join(":");
  if (kind === "type") return `${typeLabels[value as CardType] ?? value}s`;
  if (kind === "tag") return `#${value}`;
  return value;
}
