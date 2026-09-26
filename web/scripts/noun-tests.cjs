const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const testDist = path.join(__dirname, "..", ".test-dist");
fs.mkdirSync(testDist, { recursive: true });
fs.writeFileSync(path.join(testDist, "package.json"), '{"type":"commonjs"}\n');

const {
  cloneNounMorphology,
  defaultNounMorphology,
  normalizeNounMorphology,
  nounArticleProfiles,
  resolvedNounForms,
  ruleNumberMode,
} = require(path.join(testDist, "cards", "nounMorphology.js"));
const {
  analyzeNounInput,
  evaluateNounAnswer,
} = require(path.join(testDist, "study", "nounSyntax.js"));
const {
  analyzeAnswerSyntax,
} = require(path.join(testDist, "components", "AnswerParsePreview.js"));

const rules = {
  singularBase: "Singular form is the base",
  pluralBase: "Plural form is the base",
  identity: "Unchanged singular / plural",
  oI: "-o → -i",
  aE: "-a → -e",
  chioChi: "-chio → -chi",
};

const keywords = {
  masculine: "m",
  feminine: "f",
  singularOnly: "s",
  pluralOnly: "p",
};

function nounCard({
  english,
  rule,
  base,
  irregular,
  gender = "masculine",
  articleProfile = nounArticleProfiles.all,
  articleGroups = { singular: null, plural: null },
}) {
  return {
    id: 1,
    type: "noun",
    english,
    setName: null,
    tags: [],
    details: {
      declension: irregular ? { kind: "irregular", ...irregular } : { kind: "rule", rule, base },
      gender,
      articleProfile,
      articleGroups,
    },
  };
}

function morphologyWithLearnedRule(ruleName) {
  const morphology = cloneNounMorphology(defaultNounMorphology);
  const learned = morphology.inferenceSets.find((set) => set.name === "Learned shorthand");
  assert.ok(learned, "Learned shorthand inference set should exist");
  if (!learned.declensionRules.includes(ruleName)) learned.declensionRules.push(ruleName);
  return morphology;
}

test("declension forms determine number behavior", () => {
  const byName = new Map(defaultNounMorphology.declensionRules.map((rule) => [rule.name, rule]));
  assert.equal(ruleNumberMode(byName.get(rules.oI)), "both");
  assert.equal(ruleNumberMode(byName.get(rules.singularBase)), "singular");
  assert.equal(ruleNumberMode(byName.get(rules.pluralBase)), "plural");
});

test("ordinary -o/-i shorthand recognizes cetriolo", () => {
  const card = nounCard({ english: "cucumber", rule: rules.oI, base: "cetriol" });
  const evaluation = evaluateNounAnswer(card, "il cetriolo", defaultNounMorphology, keywords);
  assert.equal(evaluation.result, "correct");
  assert.ok(evaluation.matchingCandidates.some((candidate) => candidate.declensionRule === rules.oI && candidate.definition.kind === "rule" && candidate.definition.base === "cetriol"));
});

test("lo-class nouns require full declension even when their rule is learned", () => {
  const morphology = morphologyWithLearnedRule(rules.chioChi);
  const card = nounCard({ english: "mirror", rule: rules.chioChi, base: "spec" });
  assert.equal(evaluateNounAnswer(card, "lo specchio", defaultNounMorphology, keywords).result, "wrong");
  assert.equal(evaluateNounAnswer(card, "lo specchio", morphology, keywords).result, "wrong");
  assert.equal(evaluateNounAnswer(card, "lo specchio gli specchi uno", morphology, keywords).result, "correct");
});

test("lo full-declension policy also applies to ordinary learned declensions", () => {
  const card = nounCard({ english: "backpack", rule: rules.oI, base: "zain" });
  assert.equal(evaluateNounAnswer(card, "lo zaino", defaultNounMorphology, keywords).result, "wrong");
  assert.equal(evaluateNounAnswer(card, "lo zaino gli zaini uno", defaultNounMorphology, keywords).result, "correct");
});

test("parser exposes masculine gender supplied by lo while full declension is still incomplete", () => {
  const card = nounCard({ english: "backpack", rule: rules.oI, base: "zain" });
  const preview = analyzeAnswerSyntax(card, "lo zaino", keywords, defaultNounMorphology);
  assert.equal(preview.syntaxName, "Full declension");
  assert.equal(preview.status, "partial");
  assert.ok(preview.pieces.some((piece) => piece.label === "Gender from article" && piece.value === "masculine"));
});

test("article-taking shorthand requires an article", () => {
  const morphology = morphologyWithLearnedRule(rules.chioChi);
  const card = nounCard({ english: "mirror", rule: rules.chioChi, base: "spec" });
  assert.equal(evaluateNounAnswer(card, "m specchio", morphology, keywords).result, "invalid");
});

test("elided definite article requires an explicit gender when the article is ambiguous", () => {
  const card = nounCard({ english: "tree", rule: rules.oI, base: "alber", gender: "masculine" });
  assert.equal(evaluateNounAnswer(card, "l'albero", defaultNounMorphology, keywords).result, "invalid");
  assert.equal(evaluateNounAnswer(card, "l’albero", defaultNounMorphology, keywords).result, "invalid");
  assert.equal(evaluateNounAnswer(card, "m l'albero", defaultNounMorphology, keywords).result, "correct");
});

test("conflicting explicit gender and article evidence is invalid", () => {
  const card = nounCard({ english: "house", rule: rules.aE, base: "cas", gender: "feminine" });
  assert.equal(evaluateNounAnswer(card, "m la casa", defaultNounMorphology, keywords).result, "invalid");
});

test("article capability constraints do not require an exact profile match", () => {
  const all = nounCard({ english: "book", rule: rules.oI, base: "libr", articleProfile: nounArticleProfiles.all });
  assert.equal(evaluateNounAnswer(all, "il libro", defaultNounMorphology, keywords).result, "correct");
  assert.equal(evaluateNounAnswer(all, "i libri", defaultNounMorphology, keywords).result, "correct");
  assert.equal(evaluateNounAnswer(all, "un libro", defaultNounMorphology, keywords).result, "correct");

  const definiteSingularOnly = nounCard({ english: "book", rule: rules.oI, base: "libr", articleProfile: nounArticleProfiles.definiteSingularOnly });
  assert.equal(evaluateNounAnswer(definiteSingularOnly, "il libro", defaultNounMorphology, keywords).result, "correct");
  assert.equal(evaluateNounAnswer(definiteSingularOnly, "i libri", defaultNounMorphology, keywords).result, "wrong");
  assert.equal(evaluateNounAnswer(definiteSingularOnly, "un libro", defaultNounMorphology, keywords).result, "wrong");
});

test("article profile is independent from whether a declension has plural forms", () => {
  const card = nounCard({ english: "book", rule: rules.oI, base: "libr", articleProfile: nounArticleProfiles.definiteSingularOnly });
  const forms = resolvedNounForms(card, defaultNounMorphology);
  assert.equal(forms.singular, "libro");
  assert.equal(forms.plural, "libri");
  assert.equal(forms.definiteSingularArticle, "il");
  assert.equal(forms.definitePluralArticle, "");
  assert.equal(forms.indefiniteArticle, "");
});

test("singular-only and plural-only article nouns use ordinary article shorthand", () => {
  const morphology = morphologyWithLearnedRule(rules.singularBase);
  const learned = morphology.inferenceSets.find((set) => set.name === "Learned shorthand");
  assert.ok(learned);
  if (!learned.declensionRules.includes(rules.pluralBase)) learned.declensionRules.push(rules.pluralBase);

  const burro = nounCard({ english: "butter", rule: rules.singularBase, base: "burro", articleProfile: nounArticleProfiles.definiteSingularOnly });
  assert.equal(evaluateNounAnswer(burro, "il burro", morphology, keywords).result, "correct");

  const nozze = nounCard({ english: "wedding", rule: rules.pluralBase, base: "nozze", gender: "feminine", articleProfile: nounArticleProfiles.definitePluralOnly });
  assert.equal(evaluateNounAnswer(nozze, "le nozze", morphology, keywords).result, "correct");
});

test("articleless nouns require explicit gender and plurality", () => {
  const card = nounCard({
    english: "Venice",
    rule: rules.singularBase,
    base: "Venezia",
    gender: "feminine",
    articleProfile: nounArticleProfiles.none,
  });
  assert.equal(evaluateNounAnswer(card, "f s Venezia", defaultNounMorphology, keywords).result, "correct");
  assert.equal(evaluateNounAnswer(card, "s f Venezia", defaultNounMorphology, keywords).result, "correct");
  assert.equal(evaluateNounAnswer(card, "f Venezia", defaultNounMorphology, keywords).result, "invalid");
  assert.equal(evaluateNounAnswer(card, "la Venezia", morphologyWithLearnedRule(rules.singularBase), keywords).result, "wrong");
});

test("a structurally complete syntax with zero candidates is wrong, not invalid", () => {
  const morphology = cloneNounMorphology(defaultNounMorphology);
  const learned = morphology.inferenceSets.find((set) => set.name === "Learned shorthand");
  assert.ok(learned);
  learned.declensionRules = [];
  const card = nounCard({ english: "cucumber", rule: rules.oI, base: "cetriol" });
  const evaluation = evaluateNounAnswer(card, "il cetriolo", morphology, keywords);
  assert.equal(evaluation.result, "wrong");
  assert.ok(evaluation.attempts.some((attempt) => attempt.syntax.name === "Definite singular article + noun" && attempt.status === "complete" && attempt.candidates.length === 0));
});

test("candidate ordering prefers a specific suffix over a base-only rule", () => {
  const attempts = analyzeNounInput("la casa", defaultNounMorphology, keywords);
  const articleAttempt = attempts.find((attempt) => attempt.syntax.name === "Definite singular article + noun");
  assert.ok(articleAttempt);
  assert.equal(articleAttempt.status, "complete");
  assert.equal(articleAttempt.candidates[0]?.declensionRule, rules.aE);
  assert.ok(articleAttempt.candidates.some((candidate) => candidate.declensionRule === rules.singularBase));
});

test("live preview lists declensions only from the syntax it displays", () => {
  const morphology = cloneNounMorphology(defaultNounMorphology);
  const articleSyntax = morphology.syntaxRules.find((syntax) => syntax.name === "Definite singular article + noun");
  assert.ok(articleSyntax);
  morphology.syntaxRules.splice(1, 0, {
    ...JSON.parse(JSON.stringify(articleSyntax)),
    name: "Definite singular article + noun (full inference)",
    inferenceSet: "Full noun answers",
  });

  const card = nounCard({ english: "house", rule: rules.aE, base: "cas", gender: "feminine" });
  const preview = analyzeAnswerSyntax(card, "la casa", keywords, morphology);
  assert.equal(preview.syntaxName, "Definite singular article + noun");
  assert.ok(preview.candidateNames.includes(rules.aE));
  assert.equal(preview.candidateNames.includes(rules.chioChi), false);
});

test("morphology schema rejects retired syntax article and number properties", () => {
  const retired = cloneNounMorphology(defaultNounMorphology);
  retired.syntaxRules[0].articleMode = "automatic";
  retired.syntaxRules[0].numberMode = "both";
  assert.throws(() => normalizeNounMorphology(retired), /must contain exactly/i);
});

test("articles come from the editable article table", () => {
  const morphology = cloneNounMorphology(defaultNounMorphology);
  const consonant = morphology.articleGroups.find((group) => group.name === "consonant");
  assert.ok(consonant);
  consonant.masculine.definiteSingular = "el";
  const card = nounCard({ english: "book", rule: rules.oI, base: "libr" });
  assert.equal(resolvedNounForms(card, morphology).definiteSingularArticle, "el");
  assert.equal(evaluateNounAnswer(card, "el libro", morphology, keywords).result, "correct");
  assert.equal(evaluateNounAnswer(card, "il libro", morphology, keywords).result, "invalid");
});

test("i + vowel starts the lo group for both genders", () => {
  const iato = nounCard({ english: "hiatus", rule: rules.oI, base: "iat" });
  const forms = resolvedNounForms(iato, defaultNounMorphology);
  assert.equal(forms.definiteSingularArticle, "lo");
  assert.equal(forms.indefiniteArticle, "uno");
  assert.equal(evaluateNounAnswer(iato, "lo iato gli iati uno", defaultNounMorphology, keywords).result, "correct");
  assert.equal(evaluateNounAnswer(iato, "m l'iato gli iati uno", defaultNounMorphology, keywords).result, "wrong");

  const iena = nounCard({ english: "hyena", rule: rules.aE, base: "ien", gender: "feminine" });
  assert.equal(resolvedNounForms(iena, defaultNounMorphology).definiteSingularArticle, "la");
});

test("a typed article that disagrees with spelling keeps its readings for the preview", () => {
  const attempt = analyzeNounInput("gli dei", defaultNounMorphology, keywords)
    .find((item) => item.syntax.name === "Definite plural article + noun");
  assert.ok(attempt);
  assert.equal(attempt.status, "complete");
  assert.ok(attempt.candidates.some((candidate) => candidate.declensionRule === rules.oI));
  assert.equal(attempt.candidates.some((candidate) => candidate.declensionRule === "Irregular"), false);
});

test("irregular nouns are checked form by form and need every form", () => {
  const dio = nounCard({
    english: "god",
    irregular: { singular: "dio", plural: "dei" },
    articleGroups: { singular: null, plural: "lo" },
  });
  const forms = resolvedNounForms(dio, defaultNounMorphology);
  assert.equal(forms.rule, null);
  assert.equal(forms.definiteSingularArticle, "il");
  assert.equal(forms.definitePluralArticle, "gli");
  assert.equal(evaluateNounAnswer(dio, "il dio gli dei un", defaultNounMorphology, keywords).result, "correct");
  assert.equal(evaluateNounAnswer(dio, "il dio i dei un", defaultNounMorphology, keywords).result, "wrong");
  assert.equal(evaluateNounAnswer(dio, "il dio gli dii un", defaultNounMorphology, keywords).result, "wrong");
  assert.equal(evaluateNounAnswer(dio, "gli dei", defaultNounMorphology, keywords).result, "wrong");
  assert.equal(evaluateNounAnswer(dio, "il dio", defaultNounMorphology, keywords).result, "wrong");

  const preview = analyzeAnswerSyntax(dio, "il dio gli dei un", keywords, defaultNounMorphology);
  assert.ok(preview.candidateNames.includes("Irregular"));
});

test("single-form irregular nouns can be answered with a tantum marker", () => {
  const card = nounCard({
    english: "God",
    irregular: { singular: "Dio", plural: "" },
    articleProfile: nounArticleProfiles.none,
  });
  assert.equal(evaluateNounAnswer(card, "m s Dio", defaultNounMorphology, keywords).result, "correct");
  assert.equal(evaluateNounAnswer(card, "m s Dia", defaultNounMorphology, keywords).result, "wrong");
});

test("article-group exceptions change a regular noun's articles and shorthand policy", () => {
  const chef = nounCard({
    english: "chef",
    rule: rules.identity,
    base: "chef",
    articleGroups: { singular: "lo", plural: "lo" },
  });
  assert.equal(resolvedNounForms(chef, defaultNounMorphology).definiteSingularArticle, "lo");
  assert.equal(evaluateNounAnswer(chef, "lo chef gli chef uno", defaultNounMorphology, keywords).result, "correct");
  assert.equal(evaluateNounAnswer(chef, "il chef i chef un", defaultNounMorphology, keywords).result, "wrong");
  assert.equal(evaluateNounAnswer(chef, "lo chef", defaultNounMorphology, keywords).result, "wrong");
});

test("the lo shorthand policy is an editable syntax exclusion", () => {
  const morphology = morphologyWithLearnedRule(rules.chioChi);
  const card = nounCard({ english: "mirror", rule: rules.chioChi, base: "spec" });
  assert.equal(evaluateNounAnswer(card, "lo specchio", morphology, keywords).result, "wrong");
  for (const syntax of morphology.syntaxRules) syntax.excludedArticleGroups = [];
  assert.equal(evaluateNounAnswer(card, "lo specchio", morphology, keywords).result, "correct");
});

test("morphology validation covers article groups and syntax exclusions", () => {
  const unknownGroup = cloneNounMorphology(defaultNounMorphology);
  unknownGroup.syntaxRules[0].excludedArticleGroups = ["nope"];
  assert.throws(() => normalizeNounMorphology(unknownGroup), /unknown article group/i);

  const sharedLetter = cloneNounMorphology(defaultNounMorphology);
  sharedLetter.articleLetters.vowels.push("h");
  assert.throws(() => normalizeNounMorphology(sharedLetter), /both a vowel and a consonant/i);

  const reserved = cloneNounMorphology(defaultNounMorphology);
  reserved.declensionRules[0].name = "Irregular";
  assert.throws(() => normalizeNounMorphology(reserved), /reserved/i);
});

test("nouns reject article exceptions naming an unknown group", () => {
  const card = nounCard({ english: "book", rule: rules.oI, base: "libr", articleGroups: { singular: "nope", plural: null } });
  assert.throws(() => resolvedNounForms(card, defaultNounMorphology), /unknown article group/i);
});

test("article groups match from top to bottom", () => {
  const card = nounCard({ english: "mirror", rule: rules.chioChi, base: "spec" });
  assert.equal(resolvedNounForms(card, defaultNounMorphology).definiteSingularArticle, "lo");

  const consonantFirst = cloneNounMorphology(defaultNounMorphology);
  consonantFirst.articleGroups.reverse();
  assert.equal(resolvedNounForms(card, consonantFirst).definiteSingularArticle, "il");
});

test("V and C refer to the editable letter lists", () => {
  const hotel = nounCard({ english: "hotel", rule: rules.identity, base: "hotel" });
  assert.equal(resolvedNounForms(hotel, defaultNounMorphology).definiteSingularArticle, "il");

  const silentH = cloneNounMorphology(defaultNounMorphology);
  silentH.articleLetters.consonants = silentH.articleLetters.consonants.filter((letter) => letter !== "h");
  silentH.articleLetters.vowels.push("h");
  assert.equal(resolvedNounForms(hotel, silentH).definiteSingularArticle, "l’");
});

test("a form that no article group matches is an error only when it needs an article", () => {
  const morphology = cloneNounMorphology(defaultNounMorphology);
  morphology.articleLetters.consonants = morphology.articleLetters.consonants.filter((letter) => letter !== "h");
  const hotel = nounCard({ english: "hotel", rule: rules.identity, base: "hotel" });
  assert.throws(() => resolvedNounForms(hotel, morphology), /no article group matches/i);

  const exception = nounCard({ english: "hotel", rule: rules.identity, base: "hotel", articleGroups: { singular: "vowel", plural: "consonant" } });
  assert.equal(resolvedNounForms(exception, morphology).definiteSingularArticle, "l’");

  const articleless = nounCard({ english: "Hollywood", rule: rules.singularBase, base: "Hollywood", articleProfile: nounArticleProfiles.none });
  assert.equal(resolvedNounForms(articleless, morphology).singular, "Hollywood");
});
