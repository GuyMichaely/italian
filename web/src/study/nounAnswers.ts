import type { Flashcard, NounCard } from "../cards/types";
import {
  articleReadings,
  elidedArticles,
  normalizeText,
  pluralIsPredictable,
  resolvedNounForms,
  singularIsPredictable,
  type NounFormNumber,
  type NounGender,
  type NounMorphology,
  type ResolvedNounForms,
} from "../cards/nounMorphology";
import { answerMarkers, fullDeclensionReasonLabels, fullDeclensionReasons, type AnswerKeywords, type StudyPreferences } from "./preferences";

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
  /** One gender (the singular's), two from a compound marker like “mf” (one per typed form, in order), or none. */
  genders: NounGender[];
  tantum: NounFormNumber | null;
  entries: NounAnswerEntry[];
};

/**
 * Reads a noun answer without looking at the card: gender and singular/plural-only keywords
 * anywhere, then articles and forms in any order, each form going with the article before it.
 */
export function parseNounAnswer(rawValue: string, morphology: NounMorphology, keywords: AnswerKeywords, mode: NounAnswerMode): ParsedNounAnswer {
  const result: ParsedNounAnswer = { status: "complete", message: "", pieces: [], genders: [], tantum: null, entries: [] };
  const fail = (status: "incomplete" | "invalid", message: string) => ({ ...result, status, message });
  if (!rawValue.trim()) return { ...result, status: "empty" };

  const markers = answerMarkers(keywords);
  const words: string[] = [];
  for (const token of answerTokens(rawValue, morphology)) {
    const marker = markers.get(normalizeText(token));
    if (!marker) {
      words.push(token);
      continue;
    }
    if (marker.genders.length) {
      if (result.genders.length) return fail("invalid", "Type one gender marker at most.");
      result.genders = marker.genders;
      result.pieces.push({ label: marker.genders.length === 1 ? "Gender" : "Genders", value: marker.genders.join(", then ") });
    }
    if (marker.tantum) {
      if (result.tantum) return fail("invalid", "Type one singular-only or plural-only marker at most.");
      result.tantum = marker.tantum;
      result.pieces.push({ label: "Only", value: marker.tantum });
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
  /** Numbers whose form was typed correctly, in the order they first appear. */
  const given: NounFormNumber[] = [];
  const give = (number: NounFormNumber) => { if (!given.includes(number)) given.push(number); };
  /** The genders each typed article allows, and the number it was read for (null when unknown). */
  const shownGenders: { number: NounFormNumber | null; genders: Set<NounGender> }[] = [];

  for (const { article, noun } of parsed.entries) {
    if (!article) {
      const numbers = formNumbers(noun!);
      if (!numbers.length) {
        problems.push(`“${noun}” isn’t a form of this word.`);
        continue;
      }
      // A noun whose forms are spelled alike (la città, le città) fills whichever number is still missing.
      give(numbers.find((number) => !given.includes(number)) ?? numbers[0]!);
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
      shownGenders.push({ number: slotNumber(slot), genders: articleGenders(article, slotNumber(slot), morphology) });
      if (!noun) continue;
      if (sameText(slot.noun, noun)) {
        give(slotNumber(slot));
      } else if (formNumbers(noun).length) {
        formNumbers(noun).forEach(give);
        problems.push(`“${noun}” doesn’t go with “${article}”.`);
      } else {
        problems.push(`“${noun}” isn’t a form of this word.`);
      }
      continue;
    }

    const numbers = noun ? formNumbers(noun) : [];
    const number = numbers.length === 1 ? numbers[0]! : null;
    shownGenders.push({ number, genders: articleGenders(article, number, morphology) });
    if (!numbers.length) {
      problems.push(`“${article}” isn’t one of this word’s articles.`);
      if (noun) problems.push(`“${noun}” isn’t a form of this word.`);
    } else {
      numbers.forEach(give);
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
    if (reasons.length && existing.some((number) => !given.includes(number))) {
      problems.push(`Give both the singular and the plural: ${fullDeclensionReasonLabels[reasons[0]!]}.`);
    } else if (existing.length === 2 && given.length === 1) {
      // One form is enough only when the rules work the other one out from it.
      const typed = given[0]!;
      const determines = typed === "singular" ? pluralIsPredictable(forms, morphology) : singularIsPredictable(forms, morphology);
      if (!determines) problems.push(`“${forms[typed]}” could come from more than one declension rule; give the ${typed === "singular" ? "plural" : "singular"} too.`);
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

  problems.push(...genderProblems(card, forms, parsed.genders, given, shownGenders, context));
  return { correct: !problems.length, problems };
}

/**
 * A typed gender marker must be right: a single one names the singular's gender (the only gender of
 * most nouns); a compound one like “mf” names each typed form's gender in the order typed, and only
 * fits a noun whose gender differs with plurality. In word mode each typed form's gender must also
 * be shown, by a marker, the prompt, or an article that allows only one gender. With every article
 * typed (the other modes) the articles show it.
 */
function genderProblems(
  card: NounCard,
  forms: ResolvedNounForms,
  markers: NounGender[],
  given: NounFormNumber[],
  shownGenders: { number: NounFormNumber | null; genders: Set<NounGender> }[],
  context: NounCheckContext,
) {
  const keywords = context.preferences.answerKeywords;
  const genderOf = (number: NounFormNumber) => number === "plural" ? forms.pluralGender : forms.gender;
  const differs = card.details.genderDiffersWithPlurality;
  const compounds = `“${keywords.masculine}${keywords.feminine}” or “${keywords.feminine}${keywords.masculine}”`;
  const problems: string[] = [];
  /** Numbers whose gender a marker states. */
  const marked = new Set<NounFormNumber>();

  if (markers.length === 1) {
    if (markers[0] !== forms.gender) problems.push(differs ? `The singular is ${forms.gender}; a single gender marker gives the singular’s gender.` : `This word is ${forms.gender}.`);
    marked.add(forms.numberMode === "plural" ? "plural" : "singular");
  } else if (markers.length === 2) {
    const typed = markers.map((gender) => keywords[gender]).join("");
    if (!differs) {
      problems.push(`This word’s gender doesn’t differ with plurality, so “${typed}” doesn’t fit; use “${keywords[forms.gender]}”.`);
    } else if (given.length !== 2) {
      problems.push(`“${typed}” gives two genders, one for each form; type both the singular and the plural.`);
    } else {
      given.forEach((number, index) => {
        if (markers[index] !== genderOf(number)) problems.push(`“${forms[number]}” is ${genderOf(number)}, not ${markers[index]}.`);
        marked.add(number);
      });
    }
  }

  if (context.mode !== "word") return problems;
  const shows = (number: NounFormNumber | null) => {
    const sets = shownGenders.filter((entry) => number === null || entry.number === null || entry.number === number).map((entry) => entry.genders);
    if (!sets.length) return false;
    return (["masculine", "feminine"] as const).filter((gender) => sets.every((set) => set.has(gender))).length === 1;
  };

  if (!differs) {
    if (!markers.length && !context.genderGiven && !shows(null)) {
      problems.push(`Add “${keywords.masculine}” or “${keywords.feminine}”: ${shownGenders.length ? "the article doesn’t show the gender" : "without an article nothing shows the gender"}.`);
    }
    return problems;
  }
  if (given.includes("singular") && !marked.has("singular") && !context.genderGiven && !shows("singular")) {
    problems.push(`Show the singular’s gender: add “${keywords.masculine}”, “${keywords.feminine}”, ${compounds}, or use an article that shows it.`);
  }
  if (given.includes("plural") && !marked.has("plural") && !shows("plural")) {
    problems.push(`Show the plural’s gender: type its article, or add ${compounds}.`);
  }
  return problems;
}
