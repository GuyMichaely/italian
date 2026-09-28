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

/* ---------- Word mode: English prompt, type the noun with an article ---------- */

export type WordPhrase = { article: string | null; noun: string };

export type ParsedWordAnswer = ParseResult & {
  gender: NounGender | null;
  tantum: NounFormNumber | null;
  phrases: WordPhrase[];
};

/**
 * Reads a word-mode answer without looking at the card: gender and singular/plural-only keywords
 * anywhere, and up to two phrases of an optional article followed by a noun form.
 */
export function parseWordAnswer(rawValue: string, morphology: NounMorphology, keywords: AnswerKeywords): ParsedWordAnswer {
  const result: ParsedWordAnswer = { status: "complete", message: "", pieces: [], gender: null, tantum: null, phrases: [] };
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
      result.phrases.push({ article: null, noun: word });
      result.pieces.push({ label: "Noun", value: word });
      continue;
    }
    const next = words[index + 1];
    result.pieces.push({ label: "Article", value: word });
    if (next === undefined) return fail("incomplete", "Type the noun after the article.");
    if (isArticle(next, morphology)) return fail("invalid", "Two articles in a row; each article goes before a noun.");
    result.phrases.push({ article: word, noun: next });
    result.pieces.push({ label: "Noun", value: next });
    index += 1;
  }

  if (unclosedQuote(rawValue)) return fail("incomplete", "Close the quoted form.");
  if (!result.phrases.length) return fail("incomplete", "Type the noun.");
  if (result.phrases.length > 2) return fail("invalid", "Give at most a singular and a plural.");
  return result;
}

export type AnswerCheck = { correct: boolean; problems: string[] };

/** The articles this noun takes with each form, per its article profile. */
function allowedArticles(forms: ResolvedNounForms, number: NounFormNumber) {
  const articles = number === "singular" ? [forms.definiteSingularArticle, forms.indefiniteArticle] : [forms.definitePluralArticle];
  return articles.filter(Boolean);
}

/** Genders the typed article allows for a form of this number; null when the phrase has no article. */
function phraseGenders(phrase: WordPhrase, number: NounFormNumber, morphology: NounMorphology) {
  if (!phrase.article) return null;
  return new Set(articleReadings(phrase.article, morphology).filter((reading) => reading.number === number).map((reading) => reading.gender));
}

export type WordCheckContext = {
  morphology: NounMorphology;
  preferences: StudyPreferences;
  /** The prompt already named the gender, e.g. “colleague (m)”, so no gender marker is needed. */
  genderGiven: boolean;
};

export function checkWordAnswer(card: NounCard, rawValue: string, context: WordCheckContext): AnswerCheck {
  const { morphology, preferences } = context;
  const keywords = preferences.answerKeywords;
  const parsed = parseWordAnswer(rawValue, morphology, keywords);
  if (parsed.status !== "complete") return { correct: false, problems: [parsed.message || "Type an answer."] };

  const forms = resolvedNounForms(card, morphology);
  const existing = (["singular", "plural"] as const).filter((number) => forms[number]);
  const problems: string[] = [];
  const given = new Map<NounFormNumber, WordPhrase>();

  for (const phrase of parsed.phrases) {
    let numbers = existing.filter((number) => sameText(forms[number], phrase.noun));
    if (!numbers.length) {
      problems.push(`“${phrase.noun}” isn’t a form of this word.`);
      continue;
    }
    // A noun whose forms are spelled alike (la città, le città) is placed by its article, then by what is still missing.
    if (numbers.length > 1) {
      const byArticle = numbers.filter((number) => phrase.article && allowedArticles(forms, number).some((article) => sameText(article, phrase.article!)));
      numbers = byArticle.length === 1 ? byArticle : numbers.filter((number) => !given.has(number));
      if (!numbers.length) numbers = existing;
    }
    const number = numbers[0]!;
    if (given.has(number)) {
      problems.push(`You gave the ${number} twice.`);
      continue;
    }
    given.set(number, phrase);

    const allowed = allowedArticles(forms, number);
    if (!allowed.length) {
      if (phrase.article) problems.push(`The ${number} “${phrase.noun}” doesn’t take an article.`);
    } else if (!phrase.article) {
      problems.push(`Put an article before “${phrase.noun}”.`);
    } else if (!allowed.some((article) => sameText(article, phrase.article!))) {
      problems.push(`“${phrase.article}” isn’t the article for “${phrase.noun}”.`);
    }
  }

  const reasons = fullDeclensionReasons(card, morphology, preferences);
  if (reasons.length) {
    const missing = existing.filter((number) => !given.has(number));
    if (missing.length) problems.push(`Give both the singular and the plural: ${fullDeclensionReasonLabels[reasons[0]!]}.`);
  }

  if (existing.length === 1) {
    const only = existing[0]!;
    const keyword = only === "singular" ? keywords.singularOnly : keywords.pluralOnly;
    if (parsed.tantum !== only) problems.push(parsed.tantum ? `This word only has a ${only}; mark it with “${keyword}”.` : `Add “${keyword}”: this word only has a ${only}.`);
  } else if (parsed.tantum) {
    problems.push(`This word has both a singular and a plural, so it takes no “${parsed.tantum === "singular" ? keywords.singularOnly : keywords.pluralOnly}”.`);
  }

  if (parsed.gender) {
    if (parsed.gender !== card.details.gender) problems.push(`This word is ${card.details.gender}.`);
  } else if (!context.genderGiven) {
    const articleGenders = [...given].map(([number, phrase]) => phraseGenders(phrase, number, morphology)).filter((set): set is Set<NounGender> => set !== null);
    const genders = articleGenders.length
      ? (["masculine", "feminine"] as const).filter((gender) => articleGenders.every((set) => set.has(gender)))
      : null;
    if (!genders || genders.length !== 1) {
      problems.push(`Add “${keywords.masculine}” or “${keywords.feminine}”: ${genders ? "the article doesn’t show the gender" : "without an article nothing shows the gender"}.`);
    }
  }

  return { correct: !problems.length, problems };
}

/* ---------- Article mode: Italian prompt, type the articles ---------- */

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

/** The articles article mode asks for, in answer order: definite singular, definite plural, indefinite. */
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

export type ArticleEntry = { article: string; noun: string | null };

export type ParsedArticleAnswer = ParseResult & { entries: ArticleEntry[] };

/** Reads an article-mode answer: articles in order, each optionally followed by its noun form. */
export function parseArticleAnswer(rawValue: string, morphology: NounMorphology): ParsedArticleAnswer {
  const result: ParsedArticleAnswer = { status: "complete", message: "", pieces: [], entries: [] };
  if (!rawValue.trim()) return { ...result, status: "empty" };
  const tokens = answerTokens(rawValue, morphology);
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (!isArticle(token, morphology)) return { ...result, status: "invalid", message: `“${token}” isn’t an article; start each part with one.` };
    const next = tokens[index + 1];
    const noun = next !== undefined && !isArticle(next, morphology) ? next : null;
    result.entries.push({ article: token, noun });
    result.pieces.push({ label: `Article ${result.entries.length}`, value: token });
    if (noun !== null) {
      result.pieces.push({ label: "Noun", value: noun });
      index += 1;
    }
  }
  if (unclosedQuote(rawValue)) return { ...result, status: "incomplete", message: "Close the quoted form." };
  if (result.entries.length > 3) return { ...result, status: "invalid", message: "A noun takes at most three articles." };
  return result;
}

export function checkArticleAnswer(card: NounCard, rawValue: string, morphology: NounMorphology): AnswerCheck {
  const parsed = parseArticleAnswer(rawValue, morphology);
  if (parsed.status !== "complete") return { correct: false, problems: [parsed.message || "Type the articles."] };
  const slots = articleSlots(card, morphology);
  const problems: string[] = [];
  if (parsed.entries.length !== slots.length) {
    problems.push(`This word takes ${slots.length === 1 ? "one article" : `${slots.length} articles`}: ${slots.map((slot) => slot.label).join(", ")}.`);
  }
  slots.forEach((slot, index) => {
    const entry = parsed.entries[index];
    if (!entry) return;
    if (!sameText(entry.article, slot.article)) problems.push(`The ${slot.label} article isn’t “${entry.article}”.`);
    if (entry.noun !== null && !sameText(entry.noun, slot.noun)) problems.push(`“${entry.noun}” isn’t the form that goes with the ${slot.label} article.`);
  });
  return { correct: !problems.length, problems };
}
