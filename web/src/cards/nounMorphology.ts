import type {
  Flashcard,
  NounArticleProfile,
  NounDeclension,
  NounGender,
  NounDetails,
} from "./types";

export type { NounArticleGroupOverrides, NounArticleProfile, NounDeclension, NounGender } from "./types";
export type NounNumberMode = "both" | "singular" | "plural";
export type NounFormNumber = "singular" | "plural";
export type NounDefiniteness = "definite" | "indefinite";

export type NounFormTransform = {
  suffix: string;
};

export type NounDeclensionRule = {
  name: string;
  /** Limits the rule to nouns of one gender (e.g. -a → -e to feminine nouns); null applies to both. */
  gender: NounGender | null;
  forms: Partial<Record<NounFormNumber, NounFormTransform>>;
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
  articleLetters: NounArticleLetters;
  articleGroups: NounArticleGroup[];
};

export type NounDefinition = NounDetails;

export type ResolvedNounForms = {
  /** The singular's gender (for a plural-only noun, the plural's). */
  gender: NounGender;
  pluralGender: NounGender;
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
    { name: "Singular form is the base", gender: null, forms: { singular: { suffix: "" } } },
    { name: "Plural form is the base", gender: null, forms: { plural: { suffix: "" } } },
    { name: "Unchanged singular / plural", gender: null, forms: { singular: { suffix: "" }, plural: { suffix: "" } } },
    { name: "-o → -i", gender: null, forms: { singular: { suffix: "o" }, plural: { suffix: "i" } } },
    { name: "-e → -i", gender: null, forms: { singular: { suffix: "e" }, plural: { suffix: "i" } } },
    { name: "-a → -e", gender: "feminine", forms: { singular: { suffix: "a" }, plural: { suffix: "e" } } },
    { name: "-a → -i", gender: "masculine", forms: { singular: { suffix: "a" }, plural: { suffix: "i" } } },
    { name: "-ca → -che", gender: "feminine", forms: { singular: { suffix: "ca" }, plural: { suffix: "che" } } },
    { name: "-ga → -ghe", gender: "feminine", forms: { singular: { suffix: "ga" }, plural: { suffix: "ghe" } } },
    { name: "-chio → -chi", gender: null, forms: { singular: { suffix: "chio" }, plural: { suffix: "chi" } } },
  ],
  articleLetters: {
    vowels: ["a", "e", "i", "o", "u", "à", "á", "è", "é", "ì", "í", "ò", "ó", "ù", "ú"],
    consonants: ["b", "c", "d", "f", "g", "h", "j", "k", "l", "m", "n", "p", "q", "r", "s", "t", "v", "w", "x", "y", "z"],
  },
  articleGroups: [
    {
      name: "lo / gli",
      startsWith: ["sC", "z", "gn", "ps", "pn", "x", "y", "iV"],
      masculine: { definiteSingular: "lo", definitePlural: "gli", indefiniteSingular: "uno" },
      feminine: { definiteSingular: "la", definitePlural: "le", indefiniteSingular: "una" },
    },
    {
      name: "l’ / gli",
      startsWith: ["V"],
      masculine: { definiteSingular: "l’", definitePlural: "gli", indefiniteSingular: "un" },
      feminine: { definiteSingular: "l’", definitePlural: "le", indefiniteSingular: "un’" },
    },
    {
      name: "il / i",
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

export function objectValue(value: unknown, label: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

export function assertExactKeys(value: Record<string, unknown>, label: string, expected: string[]) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`${label} must contain exactly: ${wanted.join(", ")}.`);
  }
}

export function nonEmptyString(value: unknown, label: string) {
  const result = typeof value === "string" ? value.trim() : "";
  if (!result) throw new Error(`${label} must be a non-empty string.`);
  return result;
}

/** Text that may be empty, such as a suffix; anything else is an error. */
export function textField(value: unknown, label: string) {
  if (typeof value !== "string") throw new Error(`${label} must be text.`);
  return value;
}

function normalizedTransform(value: unknown, label: string): NounFormTransform | undefined {
  if (value === undefined || value === null) return undefined;
  const transform = objectValue(value, label);
  assertExactKeys(transform, label, ["suffix"]);
  return { suffix: textField(transform.suffix, `${label} suffix`).normalize("NFC") };
}

export function assertUniqueNames(values: { name: string }[], label: string) {
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

export function ruleAllowsGender(rule: NounDeclensionRule, gender: NounGender) {
  return rule.gender === null || rule.gender === gender;
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
  return articlePatternForWord(word, morphology)?.group ?? null;
}

/** The group a word's spelling puts it in, with the pattern inside that group that matched first. */
export function articlePatternForWord(word: string, morphology: NounMorphology) {
  const normalized = normalizeText(word);
  for (const group of morphology.articleGroups) {
    const pattern = group.startsWith.find((item) => patternMatches(normalized, item, morphology.articleLetters));
    if (pattern !== undefined) return { group: group.name, pattern };
  }
  return null;
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

export function otherGender(gender: NounGender): NounGender {
  return gender === "masculine" ? "feminine" : "masculine";
}

export function resolveNounDetails(details: NounDetails, morphology: NounMorphology, label = "Noun"): ResolvedNounForms {
  const { singular, plural } = declensionForms(details.declension, morphology, label);
  if (details.declension.kind === "rule") {
    const ruleName = details.declension.rule;
    const rule = morphology.declensionRules.find((item) => item.name === ruleName);
    if (rule && !ruleAllowsGender(rule, details.gender)) throw new Error(`${label} is ${details.gender}, but “${rule.name}” is only for ${rule.gender} nouns.`);
  }
  if (!singular && !plural) throw new Error(`${label} has neither a singular nor a plural form.`);
  if (details.genderDiffersWithPlurality && !(singular && plural)) throw new Error(`${label} can only differ in gender with plurality if it has both a singular and a plural.`);
  const pluralGender = details.genderDiffersWithPlurality ? otherGender(details.gender) : details.gender;
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
  const pluralArticles = pluralGroup ? articleSetFor(morphology, pluralGroup, pluralGender) : null;
  return {
    gender: details.gender,
    pluralGender,
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

/** The most specific rule that produces exactly these forms for this gender; null when none or when two tie. */
export function inferRuleDeclension(input: { singular: string; plural: string }, gender: NounGender, morphology: NounMorphology): Extract<NounDeclension, { kind: "rule" }> | null {
  const singular = input.singular.normalize("NFC").trim();
  const plural = input.plural.normalize("NFC").trim();
  if (!singular && !plural) return null;
  const numberMode: NounNumberMode = singular && plural ? "both" : singular ? "singular" : "plural";

  const matches: { rule: string; base: string; specificity: number }[] = [];
  for (const rule of morphology.declensionRules) {
    if (!ruleSupportsNumberMode(rule, numberMode) || !ruleAllowsGender(rule, gender)) continue;
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

/**
 * The plurals the rules predict from a singular: among two-number rules allowed for the gender whose
 * singular ending matches, only the most specific (longest ending) ones count. More than one entry
 * means equally specific rules disagree.
 */
export function predictedPlurals(singular: string, gender: NounGender, morphology: NounMorphology) {
  const word = singular.normalize("NFC").trim();
  let best = -1;
  let plurals: string[] = [];
  for (const rule of morphology.declensionRules) {
    if (!rule.forms.singular || !rule.forms.plural || !ruleAllowsGender(rule, gender)) continue;
    const base = recognizeNounForm(rule, word, "singular");
    if (base === null) continue;
    const specificity = [...rule.forms.singular.suffix].length;
    if (specificity < best) continue;
    const plural = generateNounForm(rule, base, "plural") ?? "";
    if (specificity > best) {
      best = specificity;
      plurals = [];
    }
    if (!plurals.some((item) => normalizeText(item) === normalizeText(plural))) plurals.push(plural);
  }
  return plurals;
}

/**
 * The singulars the rules predict from a plural: among two-number rules allowed for the gender whose
 * plural ending matches, only the most specific (longest ending) ones count.
 */
export function predictedSingulars(plural: string, gender: NounGender, morphology: NounMorphology) {
  const word = plural.normalize("NFC").trim();
  let best = -1;
  let singulars: string[] = [];
  for (const rule of morphology.declensionRules) {
    if (!rule.forms.singular || !rule.forms.plural || !ruleAllowsGender(rule, gender)) continue;
    const base = recognizeNounForm(rule, word, "plural");
    if (base === null) continue;
    const specificity = [...rule.forms.plural.suffix].length;
    if (specificity < best) continue;
    const singular = generateNounForm(rule, base, "singular") ?? "";
    if (specificity > best) {
      best = specificity;
      singulars = [];
    }
    if (!singulars.some((item) => normalizeText(item) === normalizeText(singular))) singulars.push(singular);
  }
  return singulars;
}

/** Whether a two-number noun's singular follows from its plural and gender alone. */
export function singularIsPredictable(forms: Pick<ResolvedNounForms, "singular" | "plural" | "gender">, morphology: NounMorphology) {
  if (!forms.singular || !forms.plural) return true;
  const singulars = predictedSingulars(forms.plural, forms.gender, morphology);
  return singulars.length === 1 && normalizeText(singulars[0]!) === normalizeText(forms.singular);
}

/** Whether a two-number noun's plural follows from its singular and gender alone. */
export function pluralIsPredictable(forms: Pick<ResolvedNounForms, "singular" | "plural" | "gender">, morphology: NounMorphology) {
  if (!forms.singular || !forms.plural) return true;
  const plurals = predictedPlurals(forms.singular, forms.gender, morphology);
  return plurals.length === 1 && normalizeText(plurals[0]!) === normalizeText(forms.plural);
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
  const letters = [...new Set(value.map((item) => normalizeText(textField(item, label))))];
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

function normalizeRuleGender(value: unknown, ruleName: string): NounGender | null {
  if (value === null) return null;
  if (value === "masculine" || value === "feminine") return value;
  throw new Error(`Declension rule ${ruleName} gender must be masculine, feminine, or null.`);
}

export function normalizeNounMorphology(value: unknown): NounMorphology {
  const payload = objectValue(value, "Noun morphology");
  assertExactKeys(payload, "Noun morphology", ["articleGroups", "articleLetters", "declensionRules"]);
  if (!Array.isArray(payload.declensionRules) || !Array.isArray(payload.articleGroups)) {
    throw new Error("Noun morphology needs articleGroups and declensionRules arrays.");
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

  const declensionRules: NounDeclensionRule[] = payload.declensionRules.map((raw) => {
    const rule = objectValue(raw, "Declension rule");
    assertExactKeys(rule, "Declension rule", ["name", "gender", "forms"]);
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
      gender: normalizeRuleGender(rule.gender, name),
      forms: { ...(singular ? { singular } : {}), ...(plural ? { plural } : {}) },
    };
  });
  assertUniqueNames(declensionRules, "declension rule");

  return { declensionRules, articleLetters, articleGroups };
}
