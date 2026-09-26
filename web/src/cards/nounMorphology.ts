import type {
  Flashcard,
  NounArticleProfile,
  NounCard,
  NounDeclension,
  NounGender,
  NounDetails,
} from "./types";

export type { NounArticleGroupOverrides, NounArticleProfile, NounDeclension, NounGender } from "./types";
export type NounNumberMode = "both" | "singular" | "plural";
export type NounArticleCapability = "definite-singular" | "definite-plural" | "indefinite-singular";
export type NounFormNumber = "singular" | "plural";
export type NounDefiniteness = "definite" | "indefinite";

export type NounFormTransform = {
  suffix: string;
};

export type NounDeclensionRule = {
  name: string;
  forms: Partial<Record<NounFormNumber, NounFormTransform>>;
};

export type NounInferenceSet = {
  name: string;
  declensionRules: string[];
};

export type NounSyntaxMarker =
  | { kind: "gender"; required: boolean }
  | { kind: "tantum"; required: boolean; value: "singular" | "plural" };

export type NounSyntaxField =
  | { kind: "article"; definiteness: NounDefiniteness; number: NounFormNumber }
  | { kind: "noun"; number: NounFormNumber };

export type NounSyntaxRule = {
  name: string;
  markers: NounSyntaxMarker[];
  markerOrder: "any";
  fields: NounSyntaxField[];
  inferenceSet: string;
  /** Nouns whose article group is listed here cannot be answered with this syntax (e.g. "lo" nouns in shorthand). */
  excludedArticleGroups: string[];
};

export type NounArticleSet = {
  definiteSingular: string;
  definitePlural: string;
  indefiniteSingular: string;
};

/**
 * One row of the article table. Patterns describe how a word starts: lowercase letters match
 * themselves, `V` matches any letter in the vowel set and `C` any letter in the consonant set,
 * e.g. `sC` for s + consonant or `iV` for i + vowel. Groups are checked from top to bottom and the
 * first group with a matching pattern wins.
 */
export type NounArticleGroup = {
  name: string;
  startsWith: string[];
  masculine: NounArticleSet;
  feminine: NounArticleSet;
};

/** The letters that the `V` and `C` pattern tokens stand for. */
export type NounArticleLetters = {
  vowels: string[];
  consonants: string[];
};

export type NounMorphology = {
  declensionRules: NounDeclensionRule[];
  inferenceSets: NounInferenceSet[];
  syntaxRules: NounSyntaxRule[];
  articleLetters: NounArticleLetters;
  articleGroups: NounArticleGroup[];
};

export type NounDefinition = NounDetails;

export type ResolvedNounForms = {
  gender: NounGender;
  articleProfile: NounArticleProfile;
  /** The declension rule's name, or null for an irregular noun. */
  rule: string | null;
  numberMode: NounNumberMode;
  singular: string;
  plural: string;
  /** Effective article groups (after exceptions); null when the noun lacks that form. */
  singularGroup: string | null;
  pluralGroup: string | null;
  definiteSingularArticle: string;
  definitePluralArticle: string;
  indefiniteArticle: string;
};

/** Display name used for irregular nouns wherever a declension rule name would appear. */
export const irregularDeclensionName = "Irregular";

export const nounArticleProfiles = {
  all: { definiteSingular: true, definitePlural: true, indefiniteSingular: true },
  definiteSingularOnly: { definiteSingular: true, definitePlural: false, indefiniteSingular: false },
  definitePluralOnly: { definiteSingular: false, definitePlural: true, indefiniteSingular: false },
  none: { definiteSingular: false, definitePlural: false, indefiniteSingular: false },
} as const satisfies Record<string, NounArticleProfile>;

export const defaultNounMorphology: NounMorphology = {
  declensionRules: [
    { name: "Singular form is the base", forms: { singular: { suffix: "" } } },
    { name: "Plural form is the base", forms: { plural: { suffix: "" } } },
    { name: "Unchanged singular / plural", forms: { singular: { suffix: "" }, plural: { suffix: "" } } },
    { name: "-o → -i", forms: { singular: { suffix: "o" }, plural: { suffix: "i" } } },
    { name: "-e → -i", forms: { singular: { suffix: "e" }, plural: { suffix: "i" } } },
    { name: "-a → -e", forms: { singular: { suffix: "a" }, plural: { suffix: "e" } } },
    { name: "-a → -i", forms: { singular: { suffix: "a" }, plural: { suffix: "i" } } },
    { name: "-ca → -che", forms: { singular: { suffix: "ca" }, plural: { suffix: "che" } } },
    { name: "-ga → -ghe", forms: { singular: { suffix: "ga" }, plural: { suffix: "ghe" } } },
    { name: "-chio → -chi", forms: { singular: { suffix: "chio" }, plural: { suffix: "chi" } } },
  ],
  inferenceSets: [
    {
      name: "Full noun answers",
      declensionRules: [
        "Singular form is the base",
        "Plural form is the base",
        "Unchanged singular / plural",
        "-o → -i",
        "-e → -i",
        "-a → -e",
        "-a → -i",
        "-ca → -che",
        "-ga → -ghe",
        "-chio → -chi",
      ],
    },
    {
      name: "Learned shorthand",
      declensionRules: [
        "Singular form is the base",
        "Plural form is the base",
        "Unchanged singular / plural",
        "-o → -i",
        "-e → -i",
        "-a → -e",
        "-a → -i",
        "-ca → -che",
        "-ga → -ghe",
      ],
    },
  ],
  syntaxRules: [
    {
      name: "Definite singular article + noun",
      markers: [{ kind: "gender", required: false }],
      markerOrder: "any",
      fields: [
        { kind: "article", definiteness: "definite", number: "singular" },
        { kind: "noun", number: "singular" },
      ],
      inferenceSet: "Learned shorthand",
      excludedArticleGroups: ["lo"],
    },
    {
      name: "Definite plural article + noun",
      markers: [{ kind: "gender", required: false }],
      markerOrder: "any",
      fields: [
        { kind: "article", definiteness: "definite", number: "plural" },
        { kind: "noun", number: "plural" },
      ],
      inferenceSet: "Learned shorthand",
      excludedArticleGroups: ["lo"],
    },
    {
      name: "Indefinite singular article + noun",
      markers: [{ kind: "gender", required: false }],
      markerOrder: "any",
      fields: [
        { kind: "article", definiteness: "indefinite", number: "singular" },
        { kind: "noun", number: "singular" },
      ],
      inferenceSet: "Learned shorthand",
      excludedArticleGroups: ["lo"],
    },
    {
      name: "Full declension",
      markers: [{ kind: "gender", required: false }],
      markerOrder: "any",
      fields: [
        { kind: "article", definiteness: "definite", number: "singular" },
        { kind: "noun", number: "singular" },
        { kind: "article", definiteness: "definite", number: "plural" },
        { kind: "noun", number: "plural" },
        { kind: "article", definiteness: "indefinite", number: "singular" },
      ],
      inferenceSet: "Full noun answers",
      excludedArticleGroups: [],
    },
    {
      name: "Articleless singular noun",
      markers: [
        { kind: "gender", required: true },
        { kind: "tantum", required: true, value: "singular" },
      ],
      markerOrder: "any",
      fields: [{ kind: "noun", number: "singular" }],
      inferenceSet: "Full noun answers",
      excludedArticleGroups: [],
    },
    {
      name: "Articleless plural noun",
      markers: [
        { kind: "gender", required: true },
        { kind: "tantum", required: true, value: "plural" },
      ],
      markerOrder: "any",
      fields: [{ kind: "noun", number: "plural" }],
      inferenceSet: "Full noun answers",
      excludedArticleGroups: [],
    },
  ],
  articleLetters: {
    vowels: ["a", "e", "i", "o", "u", "à", "á", "è", "é", "ì", "í", "ò", "ó", "ù", "ú"],
    consonants: ["b", "c", "d", "f", "g", "h", "j", "k", "l", "m", "n", "p", "q", "r", "s", "t", "v", "w", "x", "y", "z"],
  },
  articleGroups: [
    {
      name: "lo",
      startsWith: ["sC", "z", "gn", "ps", "pn", "x", "y", "iV"],
      masculine: { definiteSingular: "lo", definitePlural: "gli", indefiniteSingular: "uno" },
      feminine: { definiteSingular: "la", definitePlural: "le", indefiniteSingular: "una" },
    },
    {
      name: "vowel",
      startsWith: ["V"],
      masculine: { definiteSingular: "l’", definitePlural: "gli", indefiniteSingular: "un" },
      feminine: { definiteSingular: "l’", definitePlural: "le", indefiniteSingular: "un’" },
    },
    {
      name: "consonant",
      startsWith: ["C"],
      masculine: { definiteSingular: "il", definitePlural: "i", indefiniteSingular: "un" },
      feminine: { definiteSingular: "la", definitePlural: "le", indefiniteSingular: "una" },
    },
  ],
};

export function normalizeText(value: string) {
  return value.normalize("NFC").trim().toLocaleLowerCase("it-IT").replace(/[’`]/g, "'").replace(/\s+/g, " ");
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
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

function nonEmptyString(value: unknown, label: string) {
  const result = String(value ?? "").trim();
  if (!result) throw new Error(`${label} must be a non-empty string.`);
  return result;
}

function normalizedTransform(value: unknown, label: string): NounFormTransform | undefined {
  if (value === undefined || value === null) return undefined;
  const transform = objectValue(value, label);
  assertExactKeys(transform, label, ["suffix"]);
  return { suffix: String(transform.suffix ?? "").normalize("NFC") };
}

function assertUniqueNames(values: { name: string }[], label: string) {
  const names = new Set<string>();
  for (const value of values) {
    if (names.has(value.name)) throw new Error(`Duplicate ${label} name: ${value.name}.`);
    names.add(value.name);
  }
}

export function cloneNounMorphology(value: NounMorphology) {
  return clone(value);
}

export function ruleNumberMode(rule: NounDeclensionRule): NounNumberMode {
  const singular = Boolean(rule.forms.singular);
  const plural = Boolean(rule.forms.plural);
  if (singular && plural) return "both";
  if (singular) return "singular";
  return "plural";
}

export function ruleSupportsNumberMode(rule: NounDeclensionRule, numberMode: NounNumberMode) {
  return ruleNumberMode(rule) === numberMode;
}

export function ruleSupportsFormNumber(rule: NounDeclensionRule, number: NounFormNumber) {
  return Boolean(rule.forms[number]);
}

export function articleProfileAllows(profile: NounArticleProfile, capability: NounArticleCapability) {
  if (capability === "definite-singular") return profile.definiteSingular;
  if (capability === "definite-plural") return profile.definitePlural;
  return profile.indefiniteSingular;
}

export function articleProfilesEqual(left: NounArticleProfile, right: NounArticleProfile) {
  return left.definiteSingular === right.definiteSingular
    && left.definitePlural === right.definitePlural
    && left.indefiniteSingular === right.indefiniteSingular;
}

export function normalizeNounArticleProfile(value: unknown, label = "Noun article profile"): NounArticleProfile {
  const profile = objectValue(value, label);
  assertExactKeys(profile, label, ["definiteSingular", "definitePlural", "indefiniteSingular"]);
  if (
    typeof profile.definiteSingular !== "boolean"
    || typeof profile.definitePlural !== "boolean"
    || typeof profile.indefiniteSingular !== "boolean"
  ) {
    throw new Error(`${label} capabilities must be booleans.`);
  }

  const normalized = {
    definiteSingular: profile.definiteSingular,
    definitePlural: profile.definitePlural,
    indefiniteSingular: profile.indefiniteSingular,
  };
  const allowed = Object.values(nounArticleProfiles).some((candidate) => articleProfilesEqual(candidate, normalized as NounArticleProfile));
  if (!allowed) {
    throw new Error(`${label} must be all articles, definite singular only, definite plural only, or no articles.`);
  }
  return normalized as NounArticleProfile;
}

/** Whether every enabled article capability has the noun form it needs. */
export function articleProfileCompatibleWithForms(profile: NounArticleProfile, forms: { singular: string; plural: string }) {
  if ((profile.definiteSingular || profile.indefiniteSingular) && !forms.singular) return false;
  if (profile.definitePlural && !forms.plural) return false;
  return true;
}

/* ---------- Articles ---------- */

function patternMatches(word: string, pattern: string, letters: NounArticleLetters) {
  const characters = [...word];
  const tokens = [...pattern];
  if (tokens.length > characters.length) return false;
  return tokens.every((token, index) => {
    const letter = characters[index]!;
    if (token === "V") return letters.vowels.includes(letter);
    if (token === "C") return letters.consonants.includes(letter);
    return token === letter;
  });
}

/** The article group a word's spelling puts it in: the first group, top to bottom, with a matching pattern. */
export function articleGroupForWord(word: string, morphology: NounMorphology) {
  const normalized = normalizeText(word);
  const match = morphology.articleGroups.find((group) => group.startsWith.some((pattern) => patternMatches(normalized, pattern, morphology.articleLetters)));
  return match?.name ?? null;
}

export function articleSetFor(morphology: NounMorphology, groupName: string, gender: NounGender) {
  const group = morphology.articleGroups.find((item) => item.name === groupName);
  return group ? group[gender] : null;
}

export function articleKey(definiteness: NounDefiniteness, number: NounFormNumber): keyof NounArticleSet {
  if (definiteness === "indefinite") return "indefiniteSingular";
  return number === "singular" ? "definiteSingular" : "definitePlural";
}

export type ArticleReading = {
  group: string;
  gender: NounGender;
  definiteness: NounDefiniteness;
  number: NounFormNumber;
};

/** Every group/gender/definiteness/number combination the article table maps to this typed article. */
export function articleReadings(value: string, morphology: NounMorphology): ArticleReading[] {
  const typed = normalizeText(value);
  if (!typed) return [];
  const slots: [NounDefiniteness, NounFormNumber][] = [["definite", "singular"], ["definite", "plural"], ["indefinite", "singular"]];
  const readings: ArticleReading[] = [];
  for (const group of morphology.articleGroups) {
    for (const gender of ["masculine", "feminine"] as const) {
      for (const [definiteness, number] of slots) {
        if (normalizeText(group[gender][articleKey(definiteness, number)]) === typed) readings.push({ group: group.name, gender, definiteness, number });
      }
    }
  }
  return readings;
}

/** Articles that attach to the next word without a space (l’amica, un’amica). */
export function elidedArticles(morphology: NounMorphology) {
  const articles = new Set<string>();
  for (const group of morphology.articleGroups) {
    for (const set of [group.masculine, group.feminine]) {
      for (const article of Object.values(set)) {
        const normalized = normalizeText(article);
        if (normalized.endsWith("'")) articles.add(normalized);
      }
    }
  }
  return [...articles];
}

/* ---------- Forms ---------- */

export function generateNounForm(rule: NounDeclensionRule, base: string, number: NounFormNumber) {
  const transform = rule.forms[number];
  if (!transform) return null;
  return `${base.normalize("NFC")}${transform.suffix}`;
}

export function recognizeNounForm(rule: NounDeclensionRule, surface: string, number: NounFormNumber) {
  const transform = rule.forms[number];
  if (!transform) return null;
  const value = surface.normalize("NFC").trim();
  const suffix = transform.suffix.normalize("NFC");
  if (!suffix) return value;
  if (!normalizeText(value).endsWith(normalizeText(suffix))) return null;
  return value.slice(0, value.length - suffix.length);
}

/** The surface forms a declension produces; throws when a rule declension names an unknown rule. */
export function declensionForms(declension: NounDeclension, morphology: NounMorphology, label = "Noun") {
  if (declension.kind === "irregular") return { singular: declension.singular, plural: declension.plural };
  const rule = morphology.declensionRules.find((item) => item.name === declension.rule);
  if (!rule) throw new Error(`${label} references unknown declension rule ${declension.rule}.`);
  return {
    singular: generateNounForm(rule, declension.base, "singular") ?? "",
    plural: generateNounForm(rule, declension.base, "plural") ?? "",
  };
}

export function nounDefinitionForCard(card: Flashcard): NounDefinition {
  if (card.type !== "noun") throw new Error("Only noun cards have noun definitions.");
  return clone(card.details);
}

export function resolveNounDetails(details: NounDetails, morphology: NounMorphology, label = "Noun"): ResolvedNounForms {
  const { singular, plural } = declensionForms(details.declension, morphology, label);
  if (!singular && !plural) throw new Error(`${label} has neither a singular nor a plural form.`);
  if (!articleProfileCompatibleWithForms(details.articleProfile, { singular, plural })) {
    throw new Error(`${label} has an article profile that requires a noun form it does not have.`);
  }
  const groupNames = new Set(morphology.articleGroups.map((group) => group.name));
  for (const override of [details.articleGroups.singular, details.articleGroups.plural]) {
    if (override && !groupNames.has(override)) throw new Error(`${label} references unknown article group ${override}.`);
  }
  const profile = details.articleProfile;
  const groupFor = (form: string, needed: boolean, override: string | null) => {
    if (!form) return null;
    const group = override ?? articleGroupForWord(form, morphology);
    if (!group && needed) throw new Error(`${label}: no article group matches “${form}”. Add a pattern under Grammar → Articles or set an exception.`);
    return group;
  };
  const singularGroup = groupFor(singular, profile.definiteSingular || profile.indefiniteSingular, details.articleGroups.singular);
  const pluralGroup = groupFor(plural, profile.definitePlural, details.articleGroups.plural);
  const singularArticles = singularGroup ? articleSetFor(morphology, singularGroup, details.gender) : null;
  const pluralArticles = pluralGroup ? articleSetFor(morphology, pluralGroup, details.gender) : null;
  return {
    gender: details.gender,
    articleProfile: profile,
    rule: details.declension.kind === "rule" ? details.declension.rule : null,
    numberMode: singular && plural ? "both" : singular ? "singular" : "plural",
    singular,
    plural,
    singularGroup,
    pluralGroup,
    definiteSingularArticle: profile.definiteSingular ? singularArticles?.definiteSingular ?? "" : "",
    definitePluralArticle: profile.definitePlural ? pluralArticles?.definitePlural ?? "" : "",
    indefiniteArticle: profile.indefiniteSingular ? singularArticles?.indefiniteSingular ?? "" : "",
  };
}

export function resolvedNounForms(card: Flashcard, morphology: NounMorphology): ResolvedNounForms {
  if (card.type !== "noun") throw new Error("Only noun cards have noun forms.");
  return resolveNounDetails(card.details, morphology, `Noun card ${card.id}`);
}

/** The article group used for a noun as a whole: its singular's group, or its plural's for plural-only nouns. */
export function nounArticleGroup(card: NounCard, morphology: NounMorphology) {
  const forms = resolvedNounForms(card, morphology);
  return forms.singularGroup ?? forms.pluralGroup;
}

export function ruleForNounCard(card: Flashcard, morphology: NounMorphology) {
  if (card.type !== "noun" || card.details.declension.kind !== "rule") return null;
  const name = card.details.declension.rule;
  return morphology.declensionRules.find((rule) => rule.name === name) ?? null;
}

/** The most specific rule that produces exactly these forms; null when none or when two tie. */
export function inferRuleDeclension(input: { singular: string; plural: string }, morphology: NounMorphology): Extract<NounDeclension, { kind: "rule" }> | null {
  const singular = input.singular.normalize("NFC").trim();
  const plural = input.plural.normalize("NFC").trim();
  if (!singular && !plural) return null;
  const numberMode: NounNumberMode = singular && plural ? "both" : singular ? "singular" : "plural";

  const matches: { rule: string; base: string; specificity: number }[] = [];
  for (const rule of morphology.declensionRules) {
    if (!ruleSupportsNumberMode(rule, numberMode)) continue;
    const singularBase = singular ? recognizeNounForm(rule, singular, "singular") : null;
    const pluralBase = plural ? recognizeNounForm(rule, plural, "plural") : null;
    if (singular && singularBase === null) continue;
    if (plural && pluralBase === null) continue;
    if (singularBase !== null && pluralBase !== null && normalizeText(singularBase) !== normalizeText(pluralBase)) continue;
    const suffixLengths = [rule.forms.singular?.suffix.length, rule.forms.plural?.suffix.length].filter((value): value is number => value !== undefined);
    matches.push({ rule: rule.name, base: singularBase ?? pluralBase ?? "", specificity: Math.max(...suffixLengths) });
  }
  matches.sort((left, right) => right.specificity - left.specificity || left.rule.localeCompare(right.rule));
  const match = matches[0];
  if (!match || matches[1]?.specificity === match.specificity) return null;
  return { kind: "rule", rule: match.rule, base: match.base };
}

/* ---------- Validation ---------- */

function normalizeArticleSet(value: unknown, label: string): NounArticleSet {
  const set = objectValue(value, label);
  assertExactKeys(set, label, ["definiteSingular", "definitePlural", "indefiniteSingular"]);
  return {
    definiteSingular: nonEmptyString(set.definiteSingular, `${label} definite singular`),
    definitePlural: nonEmptyString(set.definitePlural, `${label} definite plural`),
    indefiniteSingular: nonEmptyString(set.indefiniteSingular, `${label} indefinite singular`),
  };
}

function normalizeLetterList(value: unknown, label: string) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array of letters.`);
  const letters = [...new Set(value.map((item) => normalizeText(String(item ?? ""))))];
  for (const letter of letters) {
    if ([...letter].length !== 1 || !/\p{L}/u.test(letter)) throw new Error(`${label} must contain single letters; “${letter}” is not one.`);
  }
  if (!letters.length) throw new Error(`${label} must contain at least one letter.`);
  return letters;
}

function normalizeArticleLetters(value: unknown): NounArticleLetters {
  const letters = objectValue(value, "Article letters");
  assertExactKeys(letters, "Article letters", ["vowels", "consonants"]);
  const vowels = normalizeLetterList(letters.vowels, "Vowels");
  const consonants = normalizeLetterList(letters.consonants, "Consonants");
  const shared = vowels.filter((letter) => consonants.includes(letter));
  if (shared.length) throw new Error(`A letter cannot be both a vowel and a consonant: ${shared.join(", ")}.`);
  return { vowels, consonants };
}

/** Patterns keep `V` and `C` as set tokens and lowercase every other letter. */
function normalizeArticlePattern(value: unknown, groupName: string) {
  const raw = nonEmptyString(value, `Article group ${groupName} pattern`).normalize("NFC");
  const pattern = [...raw].map((token) => token === "V" || token === "C" ? token : token.toLocaleLowerCase("it-IT")).join("");
  if (/\s/u.test(pattern)) throw new Error(`Article group ${groupName} pattern “${raw}” must not contain spaces.`);
  return pattern;
}

export function normalizeNounMorphology(value: unknown): NounMorphology {
  const payload = objectValue(value, "Noun morphology");
  assertExactKeys(payload, "Noun morphology", ["articleGroups", "articleLetters", "declensionRules", "inferenceSets", "syntaxRules"]);
  if (!Array.isArray(payload.declensionRules) || !Array.isArray(payload.inferenceSets) || !Array.isArray(payload.syntaxRules) || !Array.isArray(payload.articleGroups)) {
    throw new Error("Noun morphology needs articleGroups, declensionRules, inferenceSets, and syntaxRules arrays.");
  }

  const articleLetters = normalizeArticleLetters(payload.articleLetters);
  const articleGroups: NounArticleGroup[] = payload.articleGroups.map((raw) => {
    const group = objectValue(raw, "Article group");
    assertExactKeys(group, "Article group", ["name", "startsWith", "masculine", "feminine"]);
    if (!Array.isArray(group.startsWith)) throw new Error("Article group startsWith must be an array.");
    const name = nonEmptyString(group.name, "Article group name");
    return {
      name,
      startsWith: [...new Set(group.startsWith.map((pattern) => normalizeArticlePattern(pattern, name)))],
      masculine: normalizeArticleSet(group.masculine, `Article group ${name} masculine articles`),
      feminine: normalizeArticleSet(group.feminine, `Article group ${name} feminine articles`),
    };
  });
  if (!articleGroups.length) throw new Error("Noun morphology needs at least one article group.");
  assertUniqueNames(articleGroups, "article group");
  const articleGroupNames = new Set(articleGroups.map((group) => group.name));

  const declensionRules: NounDeclensionRule[] = payload.declensionRules.map((raw) => {
    const rule = objectValue(raw, "Declension rule");
    assertExactKeys(rule, "Declension rule", ["name", "forms"]);
    const forms = objectValue(rule.forms, "Declension rule forms");
    const formKeys = Object.keys(forms);
    if (formKeys.some((key) => key !== "singular" && key !== "plural")) throw new Error("Declension rule forms can contain only singular and plural.");
    const singular = normalizedTransform(forms.singular, "Singular transform");
    const plural = normalizedTransform(forms.plural, "Plural transform");
    if (!singular && !plural) throw new Error("A declension rule must define at least one form.");
    const name = nonEmptyString(rule.name, "Declension rule name");
    if (name === irregularDeclensionName || name.startsWith(":")) throw new Error(`“${name}” is reserved; choose another declension rule name.`);
    return {
      name,
      forms: { ...(singular ? { singular } : {}), ...(plural ? { plural } : {}) },
    };
  });
  assertUniqueNames(declensionRules, "declension rule");
  const ruleNames = new Set(declensionRules.map((rule) => rule.name));

  const inferenceSets: NounInferenceSet[] = payload.inferenceSets.map((raw) => {
    const set = objectValue(raw, "Inference set");
    assertExactKeys(set, "Inference set", ["name", "declensionRules"]);
    if (!Array.isArray(set.declensionRules)) throw new Error("Inference set declensionRules must be an array.");
    const declensionRuleNames = set.declensionRules.map((name) => nonEmptyString(name, "Inference rule name"));
    for (const name of declensionRuleNames) {
      if (!ruleNames.has(name)) throw new Error(`Inference set references unknown declension rule: ${name}.`);
    }
    return {
      name: nonEmptyString(set.name, "Inference set name"),
      declensionRules: [...new Set(declensionRuleNames)],
    };
  });
  assertUniqueNames(inferenceSets, "inference set");
  const inferenceSetNames = new Set(inferenceSets.map((set) => set.name));

  const syntaxRules: NounSyntaxRule[] = payload.syntaxRules.map((raw) => {
    const syntax = objectValue(raw, "Syntax rule");
    assertExactKeys(syntax, "Syntax rule", ["name", "markers", "markerOrder", "fields", "inferenceSet", "excludedArticleGroups"]);
    if (!Array.isArray(syntax.markers) || !Array.isArray(syntax.fields) || !Array.isArray(syntax.excludedArticleGroups)) {
      throw new Error("Syntax rule markers, fields, and excludedArticleGroups must be arrays.");
    }
    if (syntax.markerOrder !== "any") throw new Error("Syntax markerOrder must be any.");

    const markers: NounSyntaxMarker[] = syntax.markers.map((rawMarker) => {
      const marker = objectValue(rawMarker, "Syntax marker");
      if (marker.kind === "gender") {
        assertExactKeys(marker, "Gender syntax marker", ["kind", "required"]);
        return { kind: "gender", required: Boolean(marker.required) };
      }
      if (marker.kind === "tantum" && (marker.value === "singular" || marker.value === "plural")) {
        assertExactKeys(marker, "Tantum syntax marker", ["kind", "required", "value"]);
        return { kind: "tantum", required: Boolean(marker.required), value: marker.value };
      }
      throw new Error("Syntax marker must be a gender marker or a singular/plural tantum marker.");
    });
    if (markers.filter((marker) => marker.kind === "gender").length > 1) throw new Error("A syntax rule can contain at most one gender marker.");
    if (markers.filter((marker) => marker.kind === "tantum").length > 1) throw new Error("A syntax rule can contain at most one tantum marker.");

    const fields: NounSyntaxField[] = syntax.fields.map((rawField) => {
      const field = objectValue(rawField, "Syntax field");
      if (field.kind === "noun" && (field.number === "singular" || field.number === "plural")) {
        assertExactKeys(field, "Noun syntax field", ["kind", "number"]);
        return { kind: "noun", number: field.number };
      }
      if (
        field.kind === "article"
        && (field.number === "singular" || field.number === "plural")
        && (field.definiteness === "definite" || field.definiteness === "indefinite")
      ) {
        assertExactKeys(field, "Article syntax field", ["kind", "definiteness", "number"]);
        if (field.definiteness === "indefinite" && field.number !== "singular") throw new Error("Indefinite article fields must be singular.");
        return { kind: "article", number: field.number, definiteness: field.definiteness };
      }
      throw new Error("Syntax field must be a noun form or article field.");
    });
    if (!fields.some((field) => field.kind === "noun")) throw new Error("A syntax rule must contain at least one noun field.");

    const inferenceSet = nonEmptyString(syntax.inferenceSet, "Syntax inference set");
    if (!inferenceSetNames.has(inferenceSet)) throw new Error("Syntax rule references an unknown inference set.");
    const tantum = markers.find((marker) => marker.kind === "tantum");
    if (tantum && fields.some((field) => field.number !== tantum.value)) {
      throw new Error(`Noun syntax ${syntax.name} has a ${tantum.value}-only marker but contains a field of the other number.`);
    }
    if (!fields.some((field) => field.kind === "article")) {
      const genderMarker = markers.find((marker) => marker.kind === "gender");
      if (!genderMarker?.required || !tantum?.required) {
        throw new Error("An articleless syntax must require explicit gender and singular/plural-only markers.");
      }
    }
    const excludedArticleGroups = [...new Set(syntax.excludedArticleGroups.map((name) => nonEmptyString(name, "Excluded article group")))];
    for (const name of excludedArticleGroups) {
      if (!articleGroupNames.has(name)) throw new Error(`Syntax rule references unknown article group: ${name}.`);
    }

    return {
      name: nonEmptyString(syntax.name, "Syntax rule name"),
      markers,
      markerOrder: "any",
      fields,
      inferenceSet,
      excludedArticleGroups,
    };
  });
  assertUniqueNames(syntaxRules, "syntax rule");

  return { declensionRules, inferenceSets, syntaxRules, articleLetters, articleGroups };
}
