import type { Flashcard, NounCard } from "../cards/types";
import {
  articleReadings,
  elidedArticles,
  normalizeText,
  resolvedNounForms,
  type NounFormNumber,
  type NounGender,
  type NounMorphology,
  type ResolvedNounForms,
} from "../cards/nounMorphology";
import { fullDeclensionReasonLabels, fullDeclensionReasons, type AnswerKeywords, type StudyPreferences } from "./preferences";

/** One piece of a typed answer as the live preview labels it, without knowing the card. */
export type AnswerPiece = { label: string; value: string };

export type ParsedAnswerStatus = "empty" | "incomplete" | "invalid" | "complete";

type ParseResult = {
  status: ParsedAnswerStatus;
  /** Why the answer is incomplete or invalid. */
  message: string;
  pieces: AnswerPiece[];
};

/** Splits on whitespace; "double quotes" keep a multi-word form together. */
function tokenize(value: string) {
  return (value.normalize("NFC").match(/"[^"]*"|\S+/g) ?? []).map((part) => part.startsWith('"') && part.endsWith('"') && part.length > 1 ? part.slice(1, -1) : part);
}

/** Splits “l'amica” into “l'” + “amica” for every elided article in the article table. */
function expandElidedArticleTokens(parts: string[], morphology: NounMorphology) {
  const elided = elidedArticles(morphology).sort((left, right) => right.length - left.length);
  return parts.flatMap((part) => {
    const normalized = normalizeText(part);
    const article = elided.find((candidate) => normalized.startsWith(candidate) && normalized.length > candidate.length);
    return article ? [part.slice(0, article.length), part.slice(article.length)] : [part];
  });
}

function answerTokens(value: string, morphology: NounMorphology) {
  return expandElidedArticleTokens(tokenize(value), morphology);
}

function isArticle(token: string, morphology: NounMorphology) {
  return articleReadings(token, morphology).length > 0;
}

function sameText(left: string, right: string) {
  return normalizeText(left) === normalizeText(right);
}

function unclosedQuote(value: string) {
  return (value.match(/"/g)?.length ?? 0) % 2 === 1;
}

/* ---------- Articles ---------- */

export type ArticleSlotKey = "definiteSingular" | "definitePlural" | "indefiniteSingular";

export type ArticleSlot = {
  key: ArticleSlotKey;
  label: string;
  article: string;
  /** The noun form this article goes with. */
  noun: string;
};

export const articleSlotLabels: Record<ArticleSlotKey, string> = {
  definiteSingular: "definite singular",
  definitePlural: "definite plural",
  indefiniteSingular: "indefinite",
};

/** The articles a noun takes: definite singular, definite plural, indefinite (answers may give them in any order). */
export function articleSlots(card: NounCard, morphology: NounMorphology): ArticleSlot[] {
  const forms = resolvedNounForms(card, morphology);
  const slots: ArticleSlot[] = [
    { key: "definiteSingular", label: articleSlotLabels.definiteSingular, article: forms.definiteSingularArticle, noun: forms.singular },
    { key: "definitePlural", label: articleSlotLabels.definitePlural, article: forms.definitePluralArticle, noun: forms.plural },
    { key: "indefiniteSingular", label: articleSlotLabels.indefiniteSingular, article: forms.indefiniteArticle, noun: forms.singular },
  ];
  return slots.filter((slot) => slot.article && slot.noun);
}

export function takesArticles(card: Flashcard, morphology: NounMorphology) {
  if (card.type !== "noun") return false;
  try {
    return articleSlots(card, morphology).length > 0;
  } catch {
    return false;
  }
}

/* ---------- Noun answers: the same format in every mode ---------- */

/**
 * word: English prompt; the noun with or without an article, plus markers the article doesn't cover.
 * article: Italian prompt; every article the noun takes, each optionally followed by its form.
 * wordWithArticles: English prompt; every article plus the forms word mode asks for.
 */
export type NounAnswerMode = "word" | "article" | "wordWithArticles";

/** An article with the form after it, an article alone, or a form alone. */
export type NounAnswerEntry = { article: string | null; noun: string | null };

export type ParsedNounAnswer = ParseResult & {
  gender: NounGender | null;
  tantum: NounFormNumber | null;
  entries: NounAnswerEntry[];
};

/**
 * Reads a noun answer without looking at the card: gender and singular/plural-only keywords
 * anywhere, then articles and forms in any order, each form going with the article before it.
 */
export function parseNounAnswer(rawValue: string, morphology: NounMorphology, keywords: AnswerKeywords, mode: NounAnswerMode): ParsedNounAnswer {
  const result: ParsedNounAnswer = { status: "complete", message: "", pieces: [], gender: null, tantum: null, entries: [] };
  const fail = (status: "incomplete" | "invalid", message: string) => ({ ...result, status, message });
  if (!rawValue.trim()) return { ...result, status: "empty" };

  const markers: Record<string, { kind: "gender"; value: NounGender } | { kind: "tantum"; value: NounFormNumber }> = {
    [normalizeText(keywords.masculine)]: { kind: "gender", value: "masculine" },
    [normalizeText(keywords.feminine)]: { kind: "gender", value: "feminine" },
    [normalizeText(keywords.singularOnly)]: { kind: "tantum", value: "singular" },
    [normalizeText(keywords.pluralOnly)]: { kind: "tantum", value: "plural" },
  };
  const words: string[] = [];
  for (const token of answerTokens(rawValue, morphology)) {
    const marker = markers[normalizeText(token)];
    if (!marker) {
      words.push(token);
      continue;
    }
    if (marker.kind === "gender") {
      if (result.gender) return fail("invalid", "Type one gender marker at most.");
      result.gender = marker.value;
      result.pieces.push({ label: "Gender", value: marker.value });
    } else {
      if (result.tantum) return fail("invalid", "Type one singular-only or plural-only marker at most.");
      result.tantum = marker.value;
      result.pieces.push({ label: "Only", value: marker.value });
    }
  }

  for (let index = 0; index < words.length; index += 1) {
    const word = words[index]!;
    if (!isArticle(word, morphology)) {
      if (mode === "article") return fail("invalid", `“${word}” isn’t an article; a form goes after its article.`);
      result.entries.push({ article: null, noun: word });
      result.pieces.push({ label: "Noun", value: word });
      continue;
    }
    const next = words[index + 1];
    const noun = next !== undefined && !isArticle(next, morphology) ? next : null;
    result.entries.push({ article: word, noun });
    result.pieces.push({ label: "Article", value: word });
    if (noun !== null) {
      result.pieces.push({ label: "Noun", value: noun });
      index += 1;
    }
  }

  if (unclosedQuote(rawValue)) return fail("incomplete", "Close the quoted form.");
  if (result.entries.filter((entry) => entry.article).length > 3) return fail("invalid", "A noun takes at most three articles.");
  if (result.entries.filter((entry) => !entry.article).length > 2) return fail("invalid", "Give at most a singular and a plural.");
  if (mode === "article") {
    if (!result.entries.length) return fail("incomplete", "Type the articles.");
  } else if (!result.entries.some((entry) => entry.noun)) {
    return fail("incomplete", result.entries.length ? "Type the noun after its article." : "Type the noun.");
  }
  return result;
}

export type AnswerCheck = { correct: boolean; problems: string[] };

export type NounCheckContext = {
  mode: NounAnswerMode;
  morphology: NounMorphology;
  preferences: StudyPreferences;
  /** The prompt already named the gender, e.g. “colleague (m)”, so no gender marker is needed. */
  genderGiven: boolean;
};

function listed(items: string[]) {
  return items.length < 3 ? items.join(" and ") : `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`;
}

function slotNumber(slot: ArticleSlot): NounFormNumber {
  return slot.key === "definitePlural" ? "plural" : "singular";
}

/** Genders an article allows, read as an article for a form of the given number when that's known. */
function articleGenders(article: string, number: NounFormNumber | null, morphology: NounMorphology) {
  return new Set(articleReadings(article, morphology).filter((reading) => !number || reading.number === number).map((reading) => reading.gender));
}

export function checkNounAnswer(card: NounCard, rawValue: string, context: NounCheckContext): AnswerCheck {
  const { mode, morphology, preferences } = context;
  const keywords = preferences.answerKeywords;
  const parsed = parseNounAnswer(rawValue, morphology, keywords, mode);
  if (parsed.status !== "complete") return { correct: false, problems: [parsed.message || "Type an answer."] };

  const forms = resolvedNounForms(card, morphology);
  const slots = articleSlots(card, morphology);
  const existing = (["singular", "plural"] as const).filter((number) => forms[number]);
  const formNumbers = (noun: string) => existing.filter((number) => sameText(forms[number], noun));
  const problems: string[] = [];
  const filled = new Set<ArticleSlotKey>();
  /** Numbers whose form was typed correctly. */
  const given = new Set<NounFormNumber>();
  const shownGenders: Set<NounGender>[] = [];

  for (const { article, noun } of parsed.entries) {
    if (!article) {
      const numbers = formNumbers(noun!);
      if (!numbers.length) {
        problems.push(`“${noun}” isn’t a form of this word.`);
        continue;
      }
      // A noun whose forms are spelled alike (la città, le città) fills whichever number is still missing.
      given.add(numbers.find((number) => !given.has(number)) ?? numbers[0]!);
      continue;
    }

    const matching = slots.filter((slot) => sameText(slot.article, article));
    if (matching.length) {
      const open = matching.filter((slot) => !filled.has(slot.key));
      const slot = (noun ? open.find((candidate) => sameText(candidate.noun, noun)) : undefined) ?? open[0];
      if (!slot) {
        problems.push(`You typed “${article}” twice.`);
        continue;
      }
      filled.add(slot.key);
      shownGenders.push(articleGenders(article, slotNumber(slot), morphology));
      if (!noun) continue;
      if (sameText(slot.noun, noun)) {
        given.add(slotNumber(slot));
      } else if (formNumbers(noun).length) {
        formNumbers(noun).forEach((number) => given.add(number));
        problems.push(`“${noun}” doesn’t go with “${article}”.`);
      } else {
        problems.push(`“${noun}” isn’t a form of this word.`);
      }
      continue;
    }

    const numbers = noun ? formNumbers(noun) : [];
    shownGenders.push(articleGenders(article, numbers.length === 1 ? numbers[0]! : null, morphology));
    if (!numbers.length) {
      problems.push(`“${article}” isn’t one of this word’s articles.`);
      if (noun) problems.push(`“${noun}” isn’t a form of this word.`);
    } else {
      numbers.forEach((number) => given.add(number));
      problems.push(slots.some((slot) => numbers.includes(slotNumber(slot)))
        ? `“${article}” isn’t the article for “${noun}”.`
        : `“${noun}” doesn’t take an article.`);
    }
  }

  if (mode !== "word") {
    const missing = slots.filter((slot) => !filled.has(slot.key));
    if (missing.length) problems.push(`Missing the ${listed(missing.map((slot) => slot.label))} article${missing.length === 1 ? "" : "s"}.`);
  }

  if (mode !== "article") {
    const reasons = fullDeclensionReasons(card, morphology, preferences);
    if (reasons.length && existing.some((number) => !given.has(number))) {
      problems.push(`Give both the singular and the plural: ${fullDeclensionReasonLabels[reasons[0]!]}.`);
    }
  }

  // With every article typed, the articles show which numbers exist; word mode needs the marker.
  if (existing.length === 1) {
    const only = existing[0]!;
    const keyword = only === "singular" ? keywords.singularOnly : keywords.pluralOnly;
    if (parsed.tantum && parsed.tantum !== only) problems.push(`This word only has a ${only}; mark it with “${keyword}”.`);
    else if (!parsed.tantum && mode === "word") problems.push(`Add “${keyword}”: this word only has a ${only}.`);
  } else if (parsed.tantum) {
    problems.push(`This word has both a singular and a plural, so it takes no “${parsed.tantum === "singular" ? keywords.singularOnly : keywords.pluralOnly}”.`);
  }

  // Likewise every article together shows the gender; in word mode an article or a marker must.
  if (parsed.gender) {
    if (parsed.gender !== card.details.gender) problems.push(`This word is ${card.details.gender}.`);
  } else if (mode === "word" && !context.genderGiven) {
    const genders = shownGenders.length
      ? (["masculine", "feminine"] as const).filter((gender) => shownGenders.every((set) => set.has(gender)))
      : null;
    if (!genders || genders.length !== 1) {
      problems.push(`Add “${keywords.masculine}” or “${keywords.feminine}”: ${genders ? "the article doesn’t show the gender" : "without an article nothing shows the gender"}.`);
    }
  }

  return { correct: !problems.length, problems };
}

