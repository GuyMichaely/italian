import type { Flashcard } from "../cards/types";
import type { NounGender, NounMorphology } from "../cards/nounMorphology";
import { takesArticles, type NounAnswerMode } from "./nounAnswers";
import { promptGender } from "./prompts";
import type { PromptLanguage, StudySetup } from "./setup";

export type StudyItem = {
  /** Starts with the card id; unique within a round. */
  key: string;
  card: Flashcard;
  /** How a noun is answered (see NounAnswerMode); other words are always "word". Article prompts are Italian. */
  mode: NounAnswerMode;
  promptLanguage: PromptLanguage;
  /** Shown beside the prompt when another noun of the other gender shares it. */
  promptGender: NounGender | null;
};

export function shuffled<T>(items: T[], seed: number) {
  const result = [...items];
  let state = seed >>> 0 || 1;
  for (let index = result.length - 1; index > 0; index -= 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const swapIndex = state % (index + 1);
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

export function withEnglishPromptFirst(items: StudyItem[]) {
  const result = [...items];
  const positions = new Map<number, Partial<Record<PromptLanguage, number>>>();
  result.forEach((item, index) => {
    positions.set(item.card.id, { ...positions.get(item.card.id), [item.promptLanguage]: index });
  });
  positions.forEach(({ english, italian }) => {
    if (english !== undefined && italian !== undefined && english > italian) {
      [result[english], result[italian]] = [result[italian], result[english]];
    }
  });
  return result;
}

/**
 * The prompts of one round, before shuffling. Words asks for each word in the chosen directions;
 * Articles alone asks every noun that takes an article for its articles, from an Italian prompt;
 * both together ask English-prompted nouns for every article along with the word.
 */
export function buildStudyItems(scopedCards: Flashcard[], allCards: Flashcard[], setup: StudySetup, morphology: NounMorphology, directionSeed: number): StudyItem[] {
  const { studyWords, studyArticles, promptMode, oneDirectionPerWord } = setup;
  return scopedCards.flatMap((card): StudyItem[] => {
    const withArticles = studyArticles && takesArticles(card, morphology);
    if (!studyWords) {
      return withArticles
        ? [{ key: `${card.id}:articles`, card, mode: "article", promptLanguage: "italian", promptGender: promptGender(card, allCards, "italian", morphology) }]
        : [];
    }
    const item = (promptLanguage: PromptLanguage): StudyItem => ({
      key: `${card.id}:${promptLanguage}`,
      card,
      mode: withArticles && promptLanguage === "english" ? "wordWithArticles" : "word",
      promptLanguage,
      promptGender: promptGender(card, allCards, promptLanguage, morphology),
    });
    if (promptMode === "english" || promptMode === "italian") return [item(promptMode)];
    if (oneDirectionPerWord) return [item(Math.abs((card.id * 31) + directionSeed) % 2 === 0 ? "english" : "italian")];
    return [item("english"), item("italian")];
  });
}
