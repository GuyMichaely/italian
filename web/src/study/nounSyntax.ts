import type { Flashcard, NounCard } from "../cards/types";
import {
  articleGroupForWord,
  articleKey,
  articleProfileAllows,
  articleProfilesEqual,
  articleReadings,
  articleSetFor,
  elidedArticles,
  irregularDeclensionName,
  nounArticleGroup,
  nounArticleProfiles,
  normalizeText,
  recognizeNounForm,
  resolvedNounForms,
  ruleNumberMode,
  type ArticleReading,
  type NounArticleCapability,
  type NounFormNumber,
  type NounGender,
  type NounMorphology,
  type NounSyntaxField,
  type NounSyntaxRule,
} from "../cards/nounMorphology";
import type { AnswerKeywords } from "./setup";

export type NounSyntaxAttemptStatus = "not-applicable" | "partial" | "complete";

export type NounSyntaxPiece = {
  label: string;
  value: string;
};

export type NounArticleConstraint =
  | { kind: "none" }
  | { kind: "requires"; capabilities: NounArticleCapability[] };

/**
 * One reading of the typed answer, built without looking at the card: either a declension rule and
 * the base it recovers, or an irregular noun whose forms are exactly what was typed.
 */
export type NounCandidateDefinition =
  | { kind: "rule"; rule: string; base: string; gender: NounGender }
  | { kind: "irregular"; singular: string | null; plural: string | null; gender: NounGender };

export type NounSyntaxCandidate = {
  syntaxName: string;
  /** The rule name, or "Irregular". */
  declensionRule: string;
  definition: NounCandidateDefinition;
  articleConstraint: NounArticleConstraint;
};

export type NounSyntaxAttempt = {
  syntax: NounSyntaxRule;
  status: NounSyntaxAttemptStatus;
  pieces: NounSyntaxPiece[];
  missing: string[];
  candidates: NounSyntaxCandidate[];
  consumedTokens: number;
  reason: string;
  /** Typed values aligned with `syntax.fields`, once the syntax is complete. */
  values: string[];
  /**
   * The typed noun's spelling puts it in an article group this syntax excludes (e.g. "lo zaino" in a
   * shorthand syntax). Only steers the preview toward another syntax; grading uses the card's own group.
   */
  excludedBySpelling: boolean;
};

export type NounAnswerEvaluation = {
  result: "correct" | "wrong" | "invalid";
  attempts: NounSyntaxAttempt[];
  candidates: NounSyntaxCandidate[];
  matchingCandidates: NounSyntaxCandidate[];
};

function keywordMatches(value: string, configured: string) {
  return normalizeText(value) === normalizeText(configured);
}

function tokenize(value: string) {
  return (value.normalize("NFC").match(/"[^"]*"|\S+/g) ?? []).map((part) => {
    const unquoted = part.startsWith('"') && part.endsWith('"') ? part.slice(1, -1) : part;
    return unquoted === "-" || unquoted === "—" ? "" : unquoted;
  });
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

function genderMarker(value: string, keywords: AnswerKeywords): NounGender | null {
  if (keywordMatches(value, keywords.masculine)) return "masculine";
  if (keywordMatches(value, keywords.feminine)) return "feminine";
  return null;
}

function tantumMarker(value: string, keywords: AnswerKeywords): "singular" | "plural" | null {
  if (keywordMatches(value, keywords.singularOnly)) return "singular";
  if (keywordMatches(value, keywords.pluralOnly)) return "plural";
  return null;
}

function fieldLabel(field: NounSyntaxField) {
  if (field.kind === "noun") return field.number === "singular" ? "Singular noun" : "Plural noun";
  if (field.definiteness === "indefinite") return "Indefinite article";
  return field.number === "singular" ? "Definite singular article" : "Definite plural article";
}

function articleCapability(field: Extract<NounSyntaxField, { kind: "article" }>): NounArticleCapability {
  if (field.definiteness === "indefinite") return "indefinite-singular";
  return field.number === "singular" ? "definite-singular" : "definite-plural";
}

function syntaxArticleConstraint(syntax: NounSyntaxRule): NounArticleConstraint {
  const capabilities = [...new Set(syntax.fields
    .filter((field): field is Extract<NounSyntaxField, { kind: "article" }> => field.kind === "article")
    .map(articleCapability))];
  return capabilities.length ? { kind: "requires", capabilities } : { kind: "none" };
}

/** The table readings of a typed article that fit this article field's definiteness and number. */
function fieldReadings(field: Extract<NounSyntaxField, { kind: "article" }>, value: string, morphology: NounMorphology) {
  return articleReadings(value, morphology).filter((reading) => reading.definiteness === field.definiteness && reading.number === field.number);
}

/** Genders every typed article agrees on; null when no article constrains gender. */
function articleGenders(fields: NounSyntaxField[], values: string[], morphology: NounMorphology): Set<NounGender> | null {
  let genders: Set<NounGender> | null = null;
  fields.forEach((field, index) => {
    if (field.kind !== "article" || values[index] === undefined) return;
    const readings: ArticleReading[] = fieldReadings(field, values[index]!, morphology);
    const fieldGenders = new Set(readings.map((reading) => reading.gender));
    genders = genders ? new Set([...genders].filter((gender) => fieldGenders.has(gender))) : fieldGenders;
  });
  return genders;
}

function parseMarkers(tokens: string[], syntax: NounSyntaxRule, keywords: AnswerKeywords) {
  let index = 0;
  let gender: NounGender | null = null;
  let tantum: "singular" | "plural" | null = null;
  const pieces: NounSyntaxPiece[] = [];
  const allowedGender = syntax.markers.some((marker) => marker.kind === "gender");
  const allowedTantum = syntax.markers.find((marker) => marker.kind === "tantum");

  while (index < tokens.length) {
    const token = tokens[index] ?? "";
    const parsedGender = genderMarker(token, keywords);
    const parsedTantum = tantumMarker(token, keywords);
    if (parsedGender) {
      if (!allowedGender || gender) return { invalid: true as const, index, gender, tantum, pieces, reason: "Gender marker is not allowed here or was repeated." };
      gender = parsedGender;
      pieces.push({ label: "Gender marker", value: parsedGender });
      index += 1;
      continue;
    }
    if (parsedTantum) {
      if (!allowedTantum || tantum || allowedTantum.value !== parsedTantum) {
        return { invalid: true as const, index, gender, tantum, pieces, reason: "Tantum marker does not match this syntax or was repeated." };
      }
      tantum = parsedTantum;
      pieces.push({ label: "Tantum marker", value: parsedTantum === "singular" ? "singular only" : "plural only" });
      index += 1;
      continue;
    }
    break;
  }

  const missingRequired = syntax.markers.filter((marker) => marker.required && (marker.kind === "gender" ? !gender : tantum !== marker.value));
  return { invalid: false as const, index, gender, tantum, pieces, missingRequired };
}

function ruleSpecificity(ruleName: string, syntax: NounSyntaxRule, morphology: NounMorphology) {
  const rule = morphology.declensionRules.find((item) => item.name === ruleName);
  if (!rule) return 0;
  return Math.max(0, ...syntax.fields.flatMap((field) => {
    if (field.kind !== "noun") return [];
    return [rule.forms[field.number]?.suffix.length ?? 0];
  }));
}

function typedNounForms(syntax: NounSyntaxRule, values: string[]) {
  const forms: Partial<Record<NounFormNumber, string>> = {};
  syntax.fields.forEach((field, index) => {
    if (field.kind === "noun") forms[field.number] = values[index] ?? "";
  });
  return forms;
}

function buildCandidates(
  syntax: NounSyntaxRule,
  morphology: NounMorphology,
  gender: NounGender,
  tantum: "singular" | "plural" | null,
  values: string[],
): NounSyntaxCandidate[] {
  const inferenceSet = morphology.inferenceSets.find((set) => set.name === syntax.inferenceSet);
  if (!inferenceSet) return [];
  const articleConstraint = syntaxArticleConstraint(syntax);
  const typed = typedNounForms(syntax, values);
  const result: NounSyntaxCandidate[] = [];

  for (const ruleName of inferenceSet.declensionRules) {
    const rule = morphology.declensionRules.find((item) => item.name === ruleName);
    if (!rule || (tantum && ruleNumberMode(rule) !== tantum)) continue;
    const bases = (["singular", "plural"] as const)
      .filter((number) => typed[number] !== undefined)
      .map((number) => recognizeNounForm(rule, typed[number]!, number));
    if (!bases.length || bases.some((base) => base === null)) continue;
    if (new Set(bases.map((base) => normalizeText(base!))).size !== 1) continue;
    result.push({
      syntaxName: syntax.name,
      declensionRule: rule.name,
      definition: { kind: "rule", rule: rule.name, base: bases[0]!, gender },
      articleConstraint,
    });
  }

  result.sort((left, right) => {
    const specificity = ruleSpecificity(right.declensionRule, syntax, morphology) - ruleSpecificity(left.declensionRule, syntax, morphology);
    return specificity || left.declensionRule.localeCompare(right.declensionRule);
  });

  // Irregular nouns are implicitly part of every inference set, but an irregular form cannot be
  // inferred, so the answer must supply every form: both numbers, or one number marked as the only one.
  const suppliesEveryForm = (typed.singular !== undefined && typed.plural !== undefined) || Boolean(tantum);
  if (suppliesEveryForm) {
    result.push({
      syntaxName: syntax.name,
      declensionRule: irregularDeclensionName,
      definition: { kind: "irregular", singular: typed.singular ?? null, plural: typed.plural ?? null, gender },
      articleConstraint,
    });
  }
  return result;
}

export function attemptNounSyntax(rawValue: string, syntax: NounSyntaxRule, morphology: NounMorphology, keywords: AnswerKeywords): NounSyntaxAttempt {
  const originalTokens = tokenize(rawValue);
  const notApplicable = (pieces: NounSyntaxPiece[], consumedTokens: number, reason: string): NounSyntaxAttempt => (
    { syntax, status: "not-applicable", pieces, missing: [], candidates: [], consumedTokens, reason, values: [], excludedBySpelling: false }
  );
  const markerParse = parseMarkers(originalTokens, syntax, keywords);
  if (markerParse.invalid) return notApplicable(markerParse.pieces, markerParse.index, markerParse.reason);

  if (markerParse.missingRequired.length && markerParse.index === originalTokens.length) {
    return {
      syntax,
      status: "partial",
      pieces: markerParse.pieces,
      missing: markerParse.missingRequired.map((marker) => marker.kind === "gender" ? "Gender marker" : marker.value === "singular" ? "Singular-only marker" : "Plural-only marker"),
      candidates: [],
      consumedTokens: markerParse.index,
      reason: "Required noun markers are still missing.",
      values: [],
      excludedBySpelling: false,
    };
  }
  if (markerParse.missingRequired.length) return notApplicable(markerParse.pieces, markerParse.index, "Required noun marker is missing before the answer fields.");

  const values = expandElidedArticleTokens(originalTokens.slice(markerParse.index), morphology);
  const pieces = [...markerParse.pieces];
  if (values.length > syntax.fields.length) return notApplicable(pieces, originalTokens.length, "Too many fields for this syntax.");

  for (let index = 0; index < values.length; index += 1) {
    const field = syntax.fields[index];
    const value = values[index] ?? "";
    if (!field) break;
    if (field.kind === "article" && !fieldReadings(field, value, morphology).length) {
      return notApplicable(pieces, markerParse.index + index, `${fieldLabel(field)} does not contain a valid article.`);
    }
    pieces.push({ label: fieldLabel(field), value });
  }

  const genders = articleGenders(syntax.fields, values, morphology);
  if (!markerParse.gender && genders?.size === 1) pieces.push({ label: "Gender from article", value: [...genders][0]! });

  if (values.length < syntax.fields.length) {
    return {
      syntax,
      status: "partial",
      pieces,
      missing: syntax.fields.slice(values.length).map(fieldLabel),
      candidates: [],
      consumedTokens: originalTokens.length,
      reason: "This syntax matches the input so far.",
      values: [],
      excludedBySpelling: false,
    };
  }

  let gender: NounGender | null = null;
  if (markerParse.gender) {
    if (genders && !genders.has(markerParse.gender)) return notApplicable(pieces, originalTokens.length, "The supplied gender and articles conflict.");
    gender = markerParse.gender;
  } else if (genders?.size === 1) {
    gender = [...genders][0]!;
  } else {
    const reason = genders?.size === 0
      ? "The supplied articles conflict about gender."
      : "The supplied article does not determine gender; add a gender marker before the answer fields.";
    return notApplicable(pieces, originalTokens.length, reason);
  }

  const candidates = buildCandidates(syntax, morphology, gender, markerParse.tantum, values);
  const typed = typedNounForms(syntax, values);
  const typedGroup = articleGroupForWord(typed.singular ?? typed.plural ?? "", morphology);
  return {
    syntax,
    status: "complete",
    pieces,
    missing: [],
    candidates,
    consumedTokens: originalTokens.length,
    reason: candidates.length ? "Syntax is complete." : "Syntax is complete, but the supplied forms do not produce an allowed morphology candidate.",
    values,
    excludedBySpelling: Boolean(typedGroup && syntax.excludedArticleGroups.includes(typedGroup)),
  };
}

export function analyzeNounInput(rawValue: string, morphology: NounMorphology, keywords: AnswerKeywords) {
  return morphology.syntaxRules.map((syntax) => attemptNounSyntax(rawValue, syntax, morphology, keywords));
}

export function choosePreviewAttempt(attempts: NounSyntaxAttempt[]) {
  const completeWithCandidates = attempts.filter((attempt) => attempt.status === "complete" && attempt.candidates.length && !attempt.excludedBySpelling);
  if (completeWithCandidates.length) return completeWithCandidates[0];

  const partial = attempts.filter((attempt) => attempt.status === "partial");
  partial.sort((left, right) => right.consumedTokens - left.consumedTokens || left.missing.length - right.missing.length);
  if (partial.length) return partial[0];

  return attempts.find((attempt) => attempt.status === "complete") ?? null;
}

function sameText(left: string, right: string) {
  return normalizeText(left) === normalizeText(right);
}

/** The card-aware half of verification: does this reading of the answer describe this card? */
function candidateMatchesCard(candidate: NounSyntaxCandidate, attempt: NounSyntaxAttempt, card: NounCard, morphology: NounMorphology) {
  const { details } = card;
  if (candidate.definition.gender !== details.gender) return false;

  const declension = details.declension;
  if (candidate.definition.kind === "rule") {
    if (declension.kind !== "rule" || declension.rule !== candidate.definition.rule || !sameText(declension.base, candidate.definition.base)) return false;
  } else {
    if (declension.kind !== "irregular") return false;
    const typed = { singular: candidate.definition.singular, plural: candidate.definition.plural };
    for (const number of ["singular", "plural"] as const) {
      const stored = declension[number];
      const answered = typed[number];
      if (stored ? answered === null || !sameText(stored, answered) : answered !== null) return false;
    }
  }

  const constraint = candidate.articleConstraint;
  if (constraint.kind === "none") {
    if (!articleProfilesEqual(details.articleProfile, nounArticleProfiles.none)) return false;
  } else if (!constraint.capabilities.every((capability) => articleProfileAllows(details.articleProfile, capability))) {
    return false;
  }

  const group = nounArticleGroup(card, morphology);
  if (group && attempt.syntax.excludedArticleGroups.includes(group)) return false;

  const forms = resolvedNounForms(card, morphology);
  return attempt.syntax.fields.every((field, index) => {
    if (field.kind !== "article") return true;
    const formGroup = field.number === "singular" ? forms.singularGroup : forms.pluralGroup;
    const expected = formGroup ? articleSetFor(morphology, formGroup, details.gender)?.[articleKey(field.definiteness, field.number)] : undefined;
    return expected !== undefined && sameText(expected, attempt.values[index] ?? "");
  });
}

export function evaluateNounAnswer(card: Flashcard, rawValue: string, morphology: NounMorphology, keywords: AnswerKeywords): NounAnswerEvaluation {
  if (card.type !== "noun") throw new Error("Noun evaluator requires a noun card.");
  const attempts = analyzeNounInput(rawValue, morphology, keywords);
  const completeAttempts = attempts.filter((attempt) => attempt.status === "complete");
  const candidates = completeAttempts.flatMap((attempt) => attempt.candidates);
  const matchingCandidates = completeAttempts.flatMap((attempt) => attempt.candidates.filter((candidate) => candidateMatchesCard(candidate, attempt, card, morphology)));
  return {
    result: matchingCandidates.length ? "correct" : completeAttempts.length ? "wrong" : "invalid",
    attempts,
    candidates,
    matchingCandidates,
  };
}
