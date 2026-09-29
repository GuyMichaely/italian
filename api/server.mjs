import { createServer } from "node:http";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

const port = Number(process.env.PORT || 8080);
const dataPath = process.env.PAROLA_DATA_PATH || "/home/data/inventory.json";
const allowedOrigin = process.env.PAROLA_ALLOWED_ORIGIN || "https://guymichaely.com";
const validTypes = new Set(["noun", "verb", "adjective", "adverb"]);
const maxBodyBytes = 1024 * 1024;

const nounArticleProfiles = {
  all: { definiteSingular: true, definitePlural: true, indefiniteSingular: true },
  definiteSingularOnly: { definiteSingular: true, definitePlural: false, indefiniteSingular: false },
  definitePluralOnly: { definiteSingular: false, definitePlural: true, indefiniteSingular: false },
  none: { definiteSingular: false, definitePlural: false, indefiniteSingular: false },
};

const defaultNounMorphology = {
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
  ]
};

const adjectiveForms = ["masculineSingular", "feminineSingular", "masculinePlural", "femininePlural"];

function adjectiveEndings(masculineSingular, feminineSingular, masculinePlural, femininePlural) {
  return { masculineSingular, feminineSingular, masculinePlural, femininePlural };
}

const defaultAdjectiveMorphology = {
  declensionRules: [
    { name: "-o/-a/-i/-e", endings: adjectiveEndings("o", "a", "i", "e") },
    { name: "-e/-e/-i/-i", endings: adjectiveEndings("e", "e", "i", "i") },
    { name: "-co/-ca/-chi/-che", endings: adjectiveEndings("co", "ca", "chi", "che") },
    { name: "-co/-ca/-ci/-che", endings: adjectiveEndings("co", "ca", "ci", "che") },
    { name: "-go/-ga/-ghi/-ghe", endings: adjectiveEndings("go", "ga", "ghi", "ghe") },
    { name: "-io/-ia/-i/-ie", endings: adjectiveEndings("io", "ia", "i", "ie") },
    { name: "-cio/-cia/-ci/-ce", endings: adjectiveEndings("cio", "cia", "ci", "ce") },
    { name: "-ista/-ista/-isti/-iste", endings: adjectiveEndings("ista", "ista", "isti", "iste") },
    { name: "Invariable", endings: adjectiveEndings("", "", "", "") },
  ],
};

const defaultStudyPreferences = {
  answerKeywords: { masculine: "m", feminine: "f", singularOnly: "s", pluralOnly: "p" },
  nounFullDeclensionRules: [],
  adjectiveFullDeclensionRules: [],
  fullDeclensionCards: [],
};

let writeQueue = Promise.resolve();

function corsHeaders(req) {
  const origin = req.headers.origin;
  if (origin !== allowedOrigin) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "86400",
    vary: "Origin",
  };
}

function sendJson(res, status, value, headers = {}) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers });
  res.end(JSON.stringify(value));
}

function normalizeIdentityText(value) {
  return String(value).normalize("NFC").trim().toLocaleLowerCase("it-IT").replace(/[’`]/g, "'").replace(/\s+/g, " ");
}

function nounIdentity(declension) {
  return declension.kind === "rule"
    ? `rule\u0000${normalizeIdentityText(declension.rule)}\u0000${normalizeIdentityText(declension.base)}`
    : `irregular\u0000${normalizeIdentityText(declension.singular)}\u0000${normalizeIdentityText(declension.plural)}`;
}

function adjectiveIdentity(declension) {
  return declension.kind === "rule"
    ? `rule\u0000${normalizeIdentityText(declension.rule)}\u0000${normalizeIdentityText(declension.base)}`
    : `irregular\u0000${adjectiveForms.map((form) => normalizeIdentityText(declension[form])).join("\u0000")}`;
}

function cardDuplicateKey(card) {
  const italianIdentity = card.type === "noun"
    ? nounIdentity(card.details.declension)
    : card.type === "adjective" ? adjectiveIdentity(card.details.declension) : normalizeIdentityText(card.italian);
  return `${card.type}\u0000${normalizeIdentityText(card.english)}\u0000${italianIdentity}`;
}

function cardIdentityLabel(card) {
  if (card.type === "adjective") {
    const declension = card.details.declension;
    return declension.kind === "rule" ? `${declension.rule} / base ${declension.base}` : declension.masculineSingular;
  }
  if (card.type !== "noun") return card.italian;
  const declension = card.details.declension;
  return declension.kind === "rule" ? `${declension.rule} / base ${declension.base || "∅"}` : [declension.singular, declension.plural].filter(Boolean).join(" / ");
}

function objectValue(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value;
}

function assertExactKeys(value, label, expected) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`${label} must contain exactly: ${wanted.join(", ")}.`);
  }
}

function articleProfilesEqual(left, right) {
  return left.definiteSingular === right.definiteSingular
    && left.definitePlural === right.definitePlural
    && left.indefiniteSingular === right.indefiniteSingular;
}

function normalizeNounArticleProfile(value, label = "Noun article profile") {
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
  if (!Object.values(nounArticleProfiles).some((candidate) => articleProfilesEqual(candidate, normalized))) {
    throw new Error(`${label} must be all articles, definite singular only, definite plural only, or no articles.`);
  }
  return normalized;
}

function normalizeNounDeclension(value) {
  const declension = objectValue(value, "Noun declension");
  if (declension.kind === "rule") {
    assertExactKeys(declension, "Noun rule declension", ["kind", "rule", "base"]);
    return { kind: "rule", rule: nonEmptyString(declension.rule, "Noun declension rule"), base: String(declension.base ?? "").normalize("NFC") };
  }
  if (declension.kind === "irregular") {
    assertExactKeys(declension, "Noun irregular declension", ["kind", "singular", "plural"]);
    const singular = String(declension.singular ?? "").normalize("NFC").trim();
    const plural = String(declension.plural ?? "").normalize("NFC").trim();
    if (!singular && !plural) throw new Error("An irregular noun needs a singular or plural form.");
    return { kind: "irregular", singular, plural };
  }
  throw new Error("Noun declension must be a rule or irregular declension.");
}

function normalizeArticleGroupOverrides(value) {
  const overrides = objectValue(value, "Noun article groups");
  assertExactKeys(overrides, "Noun article groups", ["singular", "plural"]);
  const group = (raw) => raw === null ? null : nonEmptyString(raw, "Noun article group exception");
  return { singular: group(overrides.singular), plural: group(overrides.plural) };
}

function normalizeCard(value, { requireId = false } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Card must be an object.");
  const id = Number(value.id);
  if (requireId && (!Number.isSafeInteger(id) || id < 1)) throw new Error("Card id must be a positive integer.");
  const type = String(value.type || "");
  if (!validTypes.has(type)) throw new Error("Invalid card type.");
  const english = String(value.english || "").trim();
  if (!english) throw new Error("Card needs English text.");
  const rawDetails = value.details && typeof value.details === "object" && !Array.isArray(value.details) ? value.details : {};
  let details;
  let italian;

  if (type === "noun") {
    if (Object.prototype.hasOwnProperty.call(value, "italian")) throw new Error("Noun cards must not store a derived italian field.");
    assertExactKeys(rawDetails, "Noun card details", ["articleGroups", "articleProfile", "declension", "gender", "genderDiffersWithPlurality"]);
    const gender = rawDetails.gender;
    if (gender !== "masculine" && gender !== "feminine") throw new Error("Noun card needs a masculine or feminine gender.");
    if (typeof rawDetails.genderDiffersWithPlurality !== "boolean") throw new Error("Noun card genderDiffersWithPlurality must be true or false.");
    details = {
      declension: normalizeNounDeclension(rawDetails.declension),
      gender,
      genderDiffersWithPlurality: rawDetails.genderDiffersWithPlurality,
      articleProfile: normalizeNounArticleProfile(rawDetails.articleProfile),
      articleGroups: normalizeArticleGroupOverrides(rawDetails.articleGroups),
    };
  } else if (type === "adjective") {
    if (Object.prototype.hasOwnProperty.call(value, "italian")) throw new Error("Adjective cards must not store a derived italian field.");
    assertExactKeys(rawDetails, "Adjective card details", ["declension"]);
    details = { declension: normalizeAdjectiveDeclension(rawDetails.declension) };
  } else {
    italian = String(value.italian || "").trim();
    if (!italian) throw new Error(`${type} card needs Italian text.`);
    details = Object.fromEntries(Object.entries(rawDetails).map(([key, item]) => [key, String(item)]));
  }

  return {
    ...(requireId ? { id } : {}),
    type,
    english,
    ...(type === "noun" || type === "adjective" ? {} : { italian }),
    setName: typeof value.setName === "string" && value.setName.trim() ? value.setName.trim() : null,
    tags: Array.isArray(value.tags) ? [...new Set(value.tags.map(String).map((tag) => tag.trim()).filter(Boolean))] : [],
    details,
  };
}

function normalizeAdjectiveDeclension(value) {
  const declension = objectValue(value, "Adjective declension");
  if (declension.kind === "rule") {
    assertExactKeys(declension, "Adjective declension", ["kind", "rule", "base"]);
    return { kind: "rule", rule: nonEmptyString(declension.rule, "Adjective declension rule"), base: nonEmptyString(declension.base, "Adjective declension base").normalize("NFC") };
  }
  if (declension.kind === "irregular") {
    assertExactKeys(declension, "Adjective declension", ["kind", ...adjectiveForms]);
    return { kind: "irregular", ...Object.fromEntries(adjectiveForms.map((form) => [form, nonEmptyString(declension[form], `Irregular adjective ${form}`).normalize("NFC")])) };
  }
  throw new Error('Adjective declension kind must be "rule" or "irregular".');
}

function normalizeAdjectiveMorphology(value) {
  const payload = objectValue(value, "Adjective morphology");
  assertExactKeys(payload, "Adjective morphology", ["declensionRules"]);
  if (!Array.isArray(payload.declensionRules)) throw new Error("Adjective morphology needs a declensionRules array.");
  const declensionRules = payload.declensionRules.map((raw) => {
    const rule = objectValue(raw, "Adjective rule");
    assertExactKeys(rule, "Adjective rule", ["name", "endings"]);
    const name = nonEmptyString(rule.name, "Adjective rule name");
    if (name === "Irregular" || name.startsWith(":")) throw new Error(`“${name}” is reserved; choose another adjective rule name.`);
    const endings = objectValue(rule.endings, `Adjective rule ${name} endings`);
    assertExactKeys(endings, `Adjective rule ${name} endings`, adjectiveForms);
    return { name, endings: Object.fromEntries(adjectiveForms.map((form) => [form, String(endings[form] ?? "").normalize("NFC").trim()])) };
  });
  assertUniqueNames(declensionRules, "adjective rule");
  return { declensionRules };
}

function nonEmptyString(value, label) {
  const result = String(value ?? "").trim();
  if (!result) throw new Error(`${label} must be a non-empty string.`);
  return result;
}

function normalizeTransform(value, label) {
  if (value === undefined || value === null) return null;
  const transform = objectValue(value, label);
  assertExactKeys(transform, label, ["suffix"]);
  return { suffix: String(transform.suffix ?? "").normalize("NFC") };
}

function assertUniqueNames(values, label) {
  const names = new Set();
  for (const value of values) {
    if (names.has(value.name)) throw new Error(`Duplicate ${label} name: ${value.name}.`);
    names.add(value.name);
  }
}

function articleProfileCompatibleWithForms(profile, forms) {
  if ((profile.definiteSingular || profile.indefiniteSingular) && !forms.singular) return false;
  if (profile.definitePlural && !forms.plural) return false;
  return true;
}

function normalizeArticleSet(value, label) {
  const set = objectValue(value, label);
  assertExactKeys(set, label, ["definiteSingular", "definitePlural", "indefiniteSingular"]);
  return {
    definiteSingular: nonEmptyString(set.definiteSingular, `${label} definite singular`),
    definitePlural: nonEmptyString(set.definitePlural, `${label} definite plural`),
    indefiniteSingular: nonEmptyString(set.indefiniteSingular, `${label} indefinite singular`),
  };
}

function normalizeLetterList(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array of letters.`);
  const letters = [...new Set(value.map((item) => normalizeIdentityText(item ?? "")))];
  for (const letter of letters) {
    if ([...letter].length !== 1 || !/\p{L}/u.test(letter)) throw new Error(`${label} must contain single letters; “${letter}” is not one.`);
  }
  if (!letters.length) throw new Error(`${label} must contain at least one letter.`);
  return letters;
}

function normalizeArticleLetters(value) {
  const letters = objectValue(value, "Article letters");
  assertExactKeys(letters, "Article letters", ["vowels", "consonants"]);
  const vowels = normalizeLetterList(letters.vowels, "Vowels");
  const consonants = normalizeLetterList(letters.consonants, "Consonants");
  const shared = vowels.filter((letter) => consonants.includes(letter));
  if (shared.length) throw new Error(`A letter cannot be both a vowel and a consonant: ${shared.join(", ")}.`);
  return { vowels, consonants };
}

function normalizeArticlePattern(value, groupName) {
  const raw = nonEmptyString(value, `Article group ${groupName} pattern`).normalize("NFC");
  const pattern = [...raw].map((token) => token === "V" || token === "C" ? token : token.toLocaleLowerCase("it-IT")).join("");
  if (/\s/u.test(pattern)) throw new Error(`Article group ${groupName} pattern “${raw}” must not contain spaces.`);
  return pattern;
}

function normalizeNounMorphology(value) {
  const payload = objectValue(value, "Noun morphology");
  assertExactKeys(payload, "Noun morphology", ["articleGroups", "articleLetters", "declensionRules"]);
  if (!Array.isArray(payload.declensionRules) || !Array.isArray(payload.articleGroups)) {
    throw new Error("Noun morphology needs articleGroups and declensionRules arrays.");
  }

  const articleLetters = normalizeArticleLetters(payload.articleLetters);
  const articleGroups = payload.articleGroups.map((raw) => {
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

  const declensionRules = payload.declensionRules.map((raw) => {
    const rule = objectValue(raw, "Declension rule");
    assertExactKeys(rule, "Declension rule", ["name", "gender", "forms"]);
    const forms = objectValue(rule.forms, "Declension rule forms");
    if (Object.keys(forms).some((key) => key !== "singular" && key !== "plural")) throw new Error("Declension rule forms can contain only singular and plural.");
    const singular = normalizeTransform(forms.singular, "Singular transform");
    const plural = normalizeTransform(forms.plural, "Plural transform");
    if (!singular && !plural) throw new Error("A declension rule must define at least one form.");
    const name = nonEmptyString(rule.name, "Declension rule name");
    if (name === "Irregular" || name.startsWith(":")) throw new Error(`“${name}” is reserved; choose another declension rule name.`);
    if (rule.gender !== null && rule.gender !== "masculine" && rule.gender !== "feminine") throw new Error(`Declension rule ${name} gender must be masculine, feminine, or null.`);
    return {
      name,
      gender: rule.gender,
      forms: { ...(singular ? { singular } : {}), ...(plural ? { plural } : {}) },
    };
  });
  assertUniqueNames(declensionRules, "declension rule");
  return { declensionRules, articleLetters, articleGroups };
}

function normalizeAnswerKeywords(value) {
  const raw = objectValue(value, "Answer keywords");
  assertExactKeys(raw, "Answer keywords", ["masculine", "feminine", "singularOnly", "pluralOnly"]);
  const keywords = Object.fromEntries(["masculine", "feminine", "singularOnly", "pluralOnly"].map((key) => {
    const keyword = String(raw[key] ?? "").normalize("NFC").trim().toLocaleLowerCase("it-IT");
    if (!keyword || /\s|[|:"'’]/u.test(keyword)) throw new Error("Each answer keyword must be one token without spaces, quotes, or apostrophes.");
    return [key, keyword];
  }));
  if (new Set(Object.values(keywords)).size !== 4) throw new Error("Each answer keyword must be different.");
  const compounds = [keywords.masculine + keywords.feminine, keywords.feminine + keywords.masculine];
  if (compounds[0] === compounds[1] || compounds.some((compound) => Object.values(keywords).includes(compound))) {
    throw new Error(`The gender keywords together (“${compounds[0]}”, “${compounds[1]}”) must differ from every answer keyword.`);
  }
  return keywords;
}

function ruleNameList(value, label) {
  if (!Array.isArray(value)) throw new Error(`Study preferences need a ${label} array.`);
  return [...new Set(value.map((name) => nonEmptyString(name, "Full-declension rule name")))];
}

function normalizeStudyPreferences(value) {
  const raw = objectValue(value, "Study preferences");
  assertExactKeys(raw, "Study preferences", ["answerKeywords", "nounFullDeclensionRules", "adjectiveFullDeclensionRules", "fullDeclensionCards"]);
  if (!Array.isArray(raw.fullDeclensionCards)) throw new Error("Study preferences need a fullDeclensionCards array.");
  const cards = raw.fullDeclensionCards.map((id) => {
    if (!Number.isSafeInteger(id)) throw new Error("Full-declension card ids must be integers.");
    return id;
  });
  return {
    answerKeywords: normalizeAnswerKeywords(raw.answerKeywords),
    nounFullDeclensionRules: ruleNameList(raw.nounFullDeclensionRules, "nounFullDeclensionRules"),
    adjectiveFullDeclensionRules: ruleNameList(raw.adjectiveFullDeclensionRules, "adjectiveFullDeclensionRules"),
    fullDeclensionCards: [...new Set(cards)],
  };
}

function declinedCardIds(cards) {
  return new Set(cards.filter((card) => card.type === "noun" || card.type === "adjective").map((card) => card.id));
}

/** Study preferences without references to deleted words or rules. */
function prunedStudyPreferences({ cards, nounMorphology, adjectiveMorphology, studyPreferences }) {
  const nounRules = new Set(nounMorphology.declensionRules.map((rule) => rule.name));
  const adjectiveRules = new Set(adjectiveMorphology.declensionRules.map((rule) => rule.name));
  const ids = declinedCardIds(cards);
  return {
    ...studyPreferences,
    nounFullDeclensionRules: studyPreferences.nounFullDeclensionRules.filter((name) => nounRules.has(name)),
    adjectiveFullDeclensionRules: studyPreferences.adjectiveFullDeclensionRules.filter((name) => adjectiveRules.has(name)),
    fullDeclensionCards: studyPreferences.fullDeclensionCards.filter((id) => ids.has(id)),
  };
}

function validateState({ cards, nounMorphology, adjectiveMorphology, studyPreferences }) {
  const duplicateKeys = new Set();
  for (const card of cards) {
    const duplicateKey = cardDuplicateKey(card);
    if (duplicateKeys.has(duplicateKey)) throw new Error(`Duplicate ${card.type} card for “${cardIdentityLabel(card)}” / “${card.english}”.`);
    duplicateKeys.add(duplicateKey);
  }

  const rules = new Map(nounMorphology.declensionRules.map((rule) => [rule.name, rule]));
  const groupNames = new Set(nounMorphology.articleGroups.map((group) => group.name));
  for (const card of cards) {
    if (card.type !== "noun") continue;
    const label = `Noun card ${card.id ?? card.english}`;
    const { declension, articleGroups } = card.details;
    let forms;
    if (declension.kind === "rule") {
      const rule = rules.get(declension.rule);
      if (!rule) throw new Error(`${label} references unknown declension rule ${declension.rule}.`);
      if (rule.gender !== null && rule.gender !== card.details.gender) throw new Error(`${label} is ${card.details.gender}, but “${rule.name}” is only for ${rule.gender} nouns.`);
      forms = { singular: Boolean(rule.forms.singular), plural: Boolean(rule.forms.plural) };
    } else {
      forms = { singular: Boolean(declension.singular), plural: Boolean(declension.plural) };
    }
    if (!articleProfileCompatibleWithForms(card.details.articleProfile, forms)) {
      throw new Error(`${label} has an article profile that requires a noun form it does not have.`);
    }
    if (card.details.genderDiffersWithPlurality && !(forms.singular && forms.plural)) {
      throw new Error(`${label} can only differ in gender with plurality if it has both a singular and a plural.`);
    }
    for (const group of [articleGroups.singular, articleGroups.plural]) {
      if (group !== null && !groupNames.has(group)) throw new Error(`${label} references unknown article group ${group}.`);
    }
  }

  const adjectiveRules = new Map(adjectiveMorphology.declensionRules.map((rule) => [rule.name, rule]));
  for (const card of cards) {
    if (card.type !== "adjective" || card.details.declension.kind !== "rule") continue;
    if (!adjectiveRules.has(card.details.declension.rule)) throw new Error(`Adjective card ${card.id ?? card.english} references unknown adjective rule ${card.details.declension.rule}.`);
  }

  for (const name of studyPreferences.nounFullDeclensionRules) {
    if (!rules.has(name)) throw new Error(`Study preferences name unknown declension rule ${name}.`);
  }
  for (const name of studyPreferences.adjectiveFullDeclensionRules) {
    if (!adjectiveRules.has(name)) throw new Error(`Study preferences name unknown adjective rule ${name}.`);
  }
  const ids = declinedCardIds(cards);
  for (const id of studyPreferences.fullDeclensionCards) {
    if (!ids.has(id)) throw new Error(`Study preferences name unknown noun or adjective card ${id}.`);
  }
}

function emptyState() {
  return {
    cards: [],
    nounMorphology: structuredClone(defaultNounMorphology),
    adjectiveMorphology: structuredClone(defaultAdjectiveMorphology),
    studyPreferences: structuredClone(defaultStudyPreferences),
    updatedAt: null,
  };
}

async function ensureDataDirectory() {
  await mkdir(dirname(dataPath), { recursive: true });
}

async function readState() {
  await ensureDataDirectory();
  try {
    const parsed = objectValue(JSON.parse(await readFile(dataPath, "utf8")), "Inventory state");
    if (!Array.isArray(parsed.cards)) throw new Error("Inventory state needs a cards array.");
    if (!parsed.nounMorphology) throw new Error("Inventory state needs nounMorphology.");
    if (!parsed.adjectiveMorphology) throw new Error("Inventory state needs adjectiveMorphology.");
    if (!parsed.studyPreferences) throw new Error("Inventory state needs studyPreferences.");
    const cards = parsed.cards.map((card) => normalizeCard(card, { requireId: true }));
    const nounMorphology = normalizeNounMorphology(parsed.nounMorphology);
    const adjectiveMorphology = normalizeAdjectiveMorphology(parsed.adjectiveMorphology);
    const studyPreferences = normalizeStudyPreferences(parsed.studyPreferences);
    const updatedAt = parsed.updatedAt === null || parsed.updatedAt === undefined
      ? null
      : typeof parsed.updatedAt === "string" && Number.isFinite(Date.parse(parsed.updatedAt))
        ? parsed.updatedAt
        : (() => { throw new Error("Inventory state has an invalid updatedAt timestamp."); })();
    const state = { cards, nounMorphology, adjectiveMorphology, studyPreferences, updatedAt };
    validateState(state);
    return state;
  } catch (error) {
    if (error?.code === "ENOENT") return emptyState();
    throw error;
  }
}

async function writeAtomic(path, contents) {
  await ensureDataDirectory();
  const tempPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tempPath, contents, "utf8");
  await rename(tempPath, path);
}

async function writeState(state) {
  validateState(state);
  await writeAtomic(dataPath, `${JSON.stringify(state, null, 2)}\n`);
}

function queueWrite(operation) {
  const next = writeQueue.then(operation);
  writeQueue = next.catch(() => {});
  return next;
}

function mutateCards(operation) {
  return queueWrite(async () => {
    const state = await readState();
    const result = await operation(state.cards);
    const studyPreferences = prunedStudyPreferences(state);
    await writeState({ ...state, studyPreferences, updatedAt: new Date().toISOString() });
    return result;
  });
}

function replaceStateIfNewer(incoming) {
  const { updatedAt } = incoming;
  return queueWrite(async () => {
    const current = await readState();
    const incomingTime = Date.parse(updatedAt);
    const currentTime = current.updatedAt ? Date.parse(current.updatedAt) : Number.NEGATIVE_INFINITY;
    if (incomingTime < currentTime) return { conflict: true, state: current };
    if (incomingTime === currentTime) {
      const sameState = ["cards", "nounMorphology", "adjectiveMorphology", "studyPreferences"]
        .every((key) => JSON.stringify(incoming[key]) === JSON.stringify(current[key]));
      return sameState ? { conflict: false, state: current } : { conflict: true, state: current };
    }
    await writeState(incoming);
    return { conflict: false, state: incoming };
  });
}

async function readJsonBody(req) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > maxBodyBytes) throw new Error("Request body exceeds 1 MiB.");
    chunks.push(chunk);
  }
  if (!chunks.length) return null;
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const server = createServer(async (req, res) => {
  const cors = corsHeaders(req);
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    if (req.method === "OPTIONS") {
      if (req.headers.origin && req.headers.origin !== allowedOrigin) return sendJson(res, 403, { error: "Origin not allowed." });
      res.writeHead(204, cors);
      return res.end();
    }
    if (req.method === "GET" && url.pathname === "/health") return sendJson(res, 200, { ok: true });

    if (url.pathname === "/state") {
      if (req.method === "GET") return sendJson(res, 200, await readState(), cors);
      if (req.method === "PUT") {
        const body = await readJsonBody(req);
        if (!body || !Array.isArray(body.cards)) return sendJson(res, 400, { error: "PUT /state requires a cards array." }, cors);
        if (!body.nounMorphology) return sendJson(res, 400, { error: "PUT /state requires nounMorphology." }, cors);
        if (!body.adjectiveMorphology) return sendJson(res, 400, { error: "PUT /state requires adjectiveMorphology." }, cors);
        if (!body.studyPreferences) return sendJson(res, 400, { error: "PUT /state requires studyPreferences." }, cors);
        if (typeof body.updatedAt !== "string" || !Number.isFinite(Date.parse(body.updatedAt))) return sendJson(res, 400, { error: "PUT /state requires a valid updatedAt timestamp." }, cors);
        const cards = body.cards.map((card) => normalizeCard(card, { requireId: true }));
        const state = {
          cards,
          nounMorphology: normalizeNounMorphology(body.nounMorphology),
          adjectiveMorphology: normalizeAdjectiveMorphology(body.adjectiveMorphology),
          studyPreferences: normalizeStudyPreferences(body.studyPreferences),
          updatedAt: body.updatedAt,
        };
        validateState(state);
        const result = await replaceStateIfNewer(state);
        if (result.conflict) return sendJson(res, 409, { error: "Remote inventory is newer.", state: result.state }, cors);
        return sendJson(res, 200, result.state, cors);
      }
      return sendJson(res, 405, { error: "Method not allowed." }, { ...cors, allow: "GET, PUT, OPTIONS" });
    }

    if (url.pathname !== "/cards") return sendJson(res, 404, { error: "Not found." }, cors);
    if (req.method === "GET") return sendJson(res, 200, { cards: (await readState()).cards }, cors);

    if (req.method === "POST") {
      const body = await readJsonBody(req);
      const incoming = Array.isArray(body) ? body : body?.cards;
      if (!Array.isArray(incoming) || !incoming.length) return sendJson(res, 400, { error: "POST body must contain a non-empty cards array." }, cors);
      const created = await mutateCards((cards) => {
        const normalized = incoming.map((value) => normalizeCard(value));
        const keys = new Set(cards.map(cardDuplicateKey));
        for (const card of normalized) {
          const key = cardDuplicateKey(card);
          if (keys.has(key)) throw new Error(`A ${card.type} card for “${cardIdentityLabel(card)}” / “${card.english}” already exists.`);
          keys.add(key);
        }
        let nextId = cards.reduce((max, card) => Math.max(max, card.id), 0) + 1;
        const added = normalized.map((card) => ({ ...card, id: nextId++ }));
        cards.unshift(...added);
        return added;
      });
      return sendJson(res, 201, { cards: created }, cors);
    }

    if (req.method === "PUT") {
      const updatedCard = normalizeCard(await readJsonBody(req), { requireId: true });
      const result = await mutateCards((cards) => {
        const index = cards.findIndex((card) => card.id === updatedCard.id);
        if (index < 0) return null;
        cards[index] = updatedCard;
        return updatedCard;
      });
      if (!result) return sendJson(res, 404, { error: "Card not found." }, cors);
      return sendJson(res, 200, { card: result }, cors);
    }

    if (req.method === "DELETE") {
      const id = Number(url.searchParams.get("id"));
      if (!Number.isSafeInteger(id) || id < 1) return sendJson(res, 400, { error: "DELETE requires a positive integer id." }, cors);
      const deleted = await mutateCards((cards) => {
        const index = cards.findIndex((card) => card.id === id);
        if (index < 0) return false;
        cards.splice(index, 1);
        return true;
      });
      if (!deleted) return sendJson(res, 404, { error: "Card not found." }, cors);
      res.writeHead(204, cors);
      return res.end();
    }

    return sendJson(res, 405, { error: "Method not allowed." }, { ...cors, allow: "GET, POST, PUT, DELETE, OPTIONS" });
  } catch (error) {
    console.error(error);
    const message = error instanceof SyntaxError ? "Request body must be valid JSON." : error instanceof Error ? error.message : "Internal server error.";
    return sendJson(res, 400, { error: message }, cors);
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Parola API listening on port ${port}; state: ${dataPath}`);
});
