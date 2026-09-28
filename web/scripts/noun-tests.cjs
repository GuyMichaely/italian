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
  inferRuleDeclension,
  normalizeNounMorphology,
  nounArticleProfiles,
  predictedPlurals,
  resolvedNounForms,
  ruleNumberMode,
} = require(path.join(testDist, "cards", "nounMorphology.js"));
const {
  articleSlots,
  checkArticleAnswer,
  checkWordAnswer,
  parseWordAnswer,
} = require(path.join(testDist, "study", "nounAnswers.js"));
const {
  defaultStudyPreferences,
  fullDeclensionReasons,
  normalizeStudyPreferences,
} = require(path.join(testDist, "study", "preferences.js"));
const { articleDrillPool, drawArticleCard } = require(path.join(testDist, "study", "articleDrill.js"));
const { articlePromptForms, promptGender } = require(path.join(testDist, "study", "prompts.js"));
const { analyzeAnswerSyntax } = require(path.join(testDist, "components", "AnswerParsePreview.js"));
const { consistentInventoryState, parseInventoryState } = require(path.join(testDist, "storage", "inventoryState.js"));

const rules = {
  singularBase: "Singular form is the base",
  pluralBase: "Plural form is the base",
  identity: "Unchanged singular / plural",
  oI: "-o → -i",
  eI: "-e → -i",
  aE: "-a → -e",
  aI: "-a → -i",
  caChe: "-ca → -che",
  chioChi: "-chio → -chi",
};

const keywords = defaultStudyPreferences.answerKeywords;

let nextId = 1;
function nounCard({
  english,
  rule,
  base,
  irregular,
  gender = "masculine",
  articleProfile = nounArticleProfiles.all,
  articleGroups = { singular: null, plural: null },
  id = nextId++,
}) {
  return {
    id,
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

function word(card, answer, { morphology = defaultNounMorphology, preferences = defaultStudyPreferences, genderGiven = false } = {}) {
  return checkWordAnswer(card, answer, { morphology, preferences, genderGiven });
}

function article(card, answer, morphology = defaultNounMorphology) {
  return checkArticleAnswer(card, answer, morphology);
}

/* ---------- Morphology ---------- */

test("declension forms determine number behavior", () => {
  const byName = new Map(defaultNounMorphology.declensionRules.map((rule) => [rule.name, rule]));
  assert.equal(ruleNumberMode(byName.get(rules.oI)), "both");
  assert.equal(ruleNumberMode(byName.get(rules.singularBase)), "singular");
  assert.equal(ruleNumberMode(byName.get(rules.pluralBase)), "plural");
});

test("gendered rules only apply to nouns of their gender", () => {
  assert.deepEqual(inferRuleDeclension({ singular: "casa", plural: "case" }, "feminine", defaultNounMorphology), { kind: "rule", rule: rules.aE, base: "cas" });
  assert.equal(inferRuleDeclension({ singular: "casa", plural: "case" }, "masculine", defaultNounMorphology), null);
  const wrongGender = nounCard({ english: "house", rule: rules.aE, base: "cas", gender: "masculine" });
  assert.throws(() => resolvedNounForms(wrongGender, defaultNounMorphology), /only for feminine nouns/i);
});

test("plural prediction uses only the most specific matching rules", () => {
  assert.deepEqual(predictedPlurals("specchio", "masculine", defaultNounMorphology), ["specchi"]);
  assert.deepEqual(predictedPlurals("amica", "feminine", defaultNounMorphology), ["amiche"]);
  assert.deepEqual(predictedPlurals("problema", "masculine", defaultNounMorphology), ["problemi"]);
  assert.deepEqual(predictedPlurals("città", "feminine", defaultNounMorphology), ["città"]);

  const ambiguous = cloneNounMorphology(defaultNounMorphology);
  ambiguous.declensionRules.push(
    { name: "-co → -chi", gender: null, forms: { singular: { suffix: "co" }, plural: { suffix: "chi" } } },
    { name: "-co → -ci", gender: null, forms: { singular: { suffix: "co" }, plural: { suffix: "ci" } } },
  );
  assert.deepEqual(predictedPlurals("parco", "masculine", ambiguous).sort(), ["parchi", "parci"]);
});

test("morphology validation covers letters, reserved names, and rule genders", () => {
  const sharedLetter = cloneNounMorphology(defaultNounMorphology);
  sharedLetter.articleLetters.vowels.push("h");
  assert.throws(() => normalizeNounMorphology(sharedLetter), /both a vowel and a consonant/i);

  const reserved = cloneNounMorphology(defaultNounMorphology);
  reserved.declensionRules[0].name = "Irregular";
  assert.throws(() => normalizeNounMorphology(reserved), /reserved/i);

  const badGender = cloneNounMorphology(defaultNounMorphology);
  badGender.declensionRules[0].gender = "neuter";
  assert.throws(() => normalizeNounMorphology(badGender), /gender/i);

  const retired = { ...cloneNounMorphology(defaultNounMorphology), syntaxRules: [] };
  assert.throws(() => normalizeNounMorphology(retired), /must contain exactly/i);
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

test("i + vowel starts the lo group for both genders", () => {
  const iato = nounCard({ english: "hiatus", rule: rules.oI, base: "iat" });
  const forms = resolvedNounForms(iato, defaultNounMorphology);
  assert.equal(forms.definiteSingularArticle, "lo");
  assert.equal(forms.indefiniteArticle, "uno");
  const iena = nounCard({ english: "hyena", rule: rules.aE, base: "ien", gender: "feminine" });
  assert.equal(resolvedNounForms(iena, defaultNounMorphology).definiteSingularArticle, "la");
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

test("article profile is independent from whether a declension has plural forms", () => {
  const card = nounCard({ english: "book", rule: rules.oI, base: "libr", articleProfile: nounArticleProfiles.definiteSingularOnly });
  const forms = resolvedNounForms(card, defaultNounMorphology);
  assert.equal(forms.plural, "libri");
  assert.equal(forms.definiteSingularArticle, "il");
  assert.equal(forms.definitePluralArticle, "");
  assert.equal(forms.indefiniteArticle, "");
});

/* ---------- Word mode ---------- */

test("one form with a fitting article answers a predictable noun", () => {
  const card = nounCard({ english: "cucumber", rule: rules.oI, base: "cetriol" });
  for (const answer of ["il cetriolo", "i cetrioli", "un cetriolo", "il cetriolo i cetrioli"]) assert.equal(word(card, answer).correct, true, answer);
  assert.equal(word(card, "lo cetriolo").correct, false);
  assert.equal(word(card, "cetriolo").correct, false);
  assert.equal(word(card, "il cetriola").correct, false);
});

test("lo nouns no longer need the full declension", () => {
  const card = nounCard({ english: "mirror", rule: rules.chioChi, base: "spec" });
  assert.equal(word(card, "lo specchio").correct, true);
  assert.equal(word(card, "uno specchio").correct, true);
});

test("an elided article needs a gender marker unless the prompt gives the gender", () => {
  const card = nounCard({ english: "tree", rule: rules.oI, base: "alber" });
  assert.equal(word(card, "l'albero").correct, false);
  assert.equal(word(card, "l’albero").correct, false);
  assert.equal(word(card, "m l'albero").correct, true);
  assert.equal(word(card, "l'albero m").correct, true);
  assert.equal(word(card, "f l'albero").correct, false);
  assert.equal(word(card, "gli alberi").correct, true);
  assert.equal(word(card, "l'albero", { genderGiven: true }).correct, true);
});

test("an explicit gender that disagrees with the noun is wrong", () => {
  const card = nounCard({ english: "house", rule: rules.aE, base: "cas", gender: "feminine" });
  assert.equal(word(card, "la casa").correct, true);
  assert.equal(word(card, "m la casa").correct, false);
});

test("irregular nouns need both forms", () => {
  const dio = nounCard({ english: "god", irregular: { singular: "dio", plural: "dei" }, articleGroups: { singular: null, plural: "lo" } });
  assert.equal(word(dio, "il dio gli dei").correct, true);
  assert.equal(word(dio, "gli dei il dio").correct, true);
  const single = word(dio, "il dio");
  assert.equal(single.correct, false);
  assert.match(single.problems.join(" "), /irregular/);
  assert.equal(word(dio, "il dio i dei").correct, false);
});

test("a noun that doesn't follow the winning rule needs both forms", () => {
  const cinema = nounCard({ english: "cinema", rule: rules.identity, base: "cinema" });
  assert.deepEqual(fullDeclensionReasons(cinema, defaultNounMorphology, defaultStudyPreferences), ["unpredictable"]);
  assert.equal(word(cinema, "il cinema").correct, false);
  assert.equal(word(cinema, "il cinema i cinema").correct, true);
});

test("equally specific rules that disagree make a noun need both forms", () => {
  const morphology = cloneNounMorphology(defaultNounMorphology);
  morphology.declensionRules.push(
    { name: "-co → -chi", gender: null, forms: { singular: { suffix: "co" }, plural: { suffix: "chi" } } },
    { name: "-co → -ci", gender: null, forms: { singular: { suffix: "co" }, plural: { suffix: "ci" } } },
  );
  const parco = nounCard({ english: "park", rule: "-co → -chi", base: "par" });
  assert.equal(word(parco, "il parco", { morphology }).correct, false);
  assert.equal(word(parco, "il parco i parchi", { morphology }).correct, true);

  const onlyChi = cloneNounMorphology(defaultNounMorphology);
  onlyChi.declensionRules.push({ name: "-co → -chi", gender: null, forms: { singular: { suffix: "co" }, plural: { suffix: "chi" } } });
  assert.equal(word(parco, "il parco", { morphology: onlyChi }).correct, true);
  const amico = nounCard({ english: "friend", rule: rules.oI, base: "amic" });
  assert.equal(word(amico, "un amico", { morphology: onlyChi }).correct, false);
});

test("drilled rules and marked words need both forms", () => {
  const card = nounCard({ english: "book", rule: rules.oI, base: "libr" });
  const drilling = { ...defaultStudyPreferences, fullDeclensionRules: [rules.oI] };
  assert.equal(word(card, "il libro", { preferences: drilling }).correct, false);
  assert.equal(word(card, "il libro i libri", { preferences: drilling }).correct, true);
  const marked = { ...defaultStudyPreferences, fullDeclensionCards: [card.id] };
  assert.deepEqual(fullDeclensionReasons(card, defaultNounMorphology, marked), ["card"]);
  assert.equal(word(card, "i libri", { preferences: marked }).correct, false);
});

test("single-form nouns need the singular- or plural-only marker", () => {
  const nozze = nounCard({ english: "wedding", rule: rules.pluralBase, base: "nozze", gender: "feminine", articleProfile: nounArticleProfiles.definitePluralOnly });
  assert.equal(word(nozze, "p le nozze").correct, true);
  assert.equal(word(nozze, "le nozze").correct, false);
  assert.equal(word(nozze, "s le nozze").correct, false);

  const libro = nounCard({ english: "book", rule: rules.oI, base: "libr" });
  assert.equal(word(libro, "s il libro").correct, false);
});

test("articleless nouns need a gender marker and take no article", () => {
  const venezia = nounCard({ english: "Venice", rule: rules.singularBase, base: "Venezia", gender: "feminine", articleProfile: nounArticleProfiles.none });
  assert.equal(word(venezia, "f s Venezia").correct, true);
  assert.equal(word(venezia, "s f Venezia").correct, true);
  assert.equal(word(venezia, "s Venezia").correct, false);
  assert.equal(word(venezia, "f s la Venezia").correct, false);
});

test("article profiles limit which articles a form takes", () => {
  const card = nounCard({ english: "book", rule: rules.oI, base: "libr", articleProfile: nounArticleProfiles.definiteSingularOnly });
  assert.equal(word(card, "il libro").correct, true);
  assert.equal(word(card, "un libro").correct, false);
});

test("nouns spelled alike in both numbers are placed by their article", () => {
  const citta = nounCard({ english: "city", rule: rules.identity, base: "città", gender: "feminine" });
  assert.equal(word(citta, "la città").correct, true);
  assert.equal(word(citta, "le città").correct, true);
  assert.equal(word(citta, "la città le città").correct, true);
  assert.equal(word(citta, "i città").correct, false);
});

test("articles come from the editable article table", () => {
  const morphology = cloneNounMorphology(defaultNounMorphology);
  morphology.articleGroups.find((group) => group.name === "consonant").masculine.definiteSingular = "el";
  const card = nounCard({ english: "book", rule: rules.oI, base: "libr" });
  assert.equal(word(card, "el libro", { morphology }).correct, true);
  assert.equal(word(card, "il libro", { morphology }).correct, false);
});

test("word answers parse without the card and report incomplete input", () => {
  assert.equal(parseWordAnswer("il", defaultNounMorphology, keywords).status, "incomplete");
  assert.equal(parseWordAnswer("m f il libro", defaultNounMorphology, keywords).status, "invalid");
  assert.equal(parseWordAnswer("il i libro", defaultNounMorphology, keywords).status, "invalid");
  const parsed = parseWordAnswer("m l'albero", defaultNounMorphology, keywords);
  assert.equal(parsed.status, "complete");
  assert.deepEqual(parsed.phrases, [{ article: "l'", noun: "albero" }]);

  const card = nounCard({ english: "tree", rule: rules.oI, base: "alber" });
  const preview = analyzeAnswerSyntax({ card, mode: "word" }, "l'albero", keywords, defaultNounMorphology);
  assert.equal(preview.status, "complete");
  assert.deepEqual(preview.pieces.map((piece) => piece.label), ["Article", "Noun"]);
});

/* ---------- Article mode ---------- */

test("article answers list the articles in order, with optional nouns", () => {
  const specchio = nounCard({ english: "mirror", rule: rules.chioChi, base: "spec" });
  assert.deepEqual(articleSlots(specchio, defaultNounMorphology).map((slot) => slot.article), ["lo", "gli", "uno"]);
  assert.equal(article(specchio, "lo gli uno").correct, true);
  assert.equal(article(specchio, "lo specchio gli specchi uno specchio").correct, true);
  assert.equal(article(specchio, "lo gli").correct, false);
  assert.equal(article(specchio, "il i un").correct, false);
  assert.equal(article(specchio, "lo specchio gli specchii uno").correct, false);

  const amica = nounCard({ english: "friend", rule: rules.caChe, base: "ami", gender: "feminine" });
  assert.equal(article(amica, "l' le un'").correct, true);
  assert.equal(article(amica, "l'amica le amiche un'amica").correct, true);
  assert.equal(article(amica, "l' gli un").correct, false);
});

test("article answers only ask for the articles a noun takes", () => {
  const nozze = nounCard({ english: "wedding", rule: rules.pluralBase, base: "nozze", gender: "feminine", articleProfile: nounArticleProfiles.definitePluralOnly });
  assert.equal(article(nozze, "le").correct, true);
  assert.deepEqual(articlePromptForms(nozze, defaultNounMorphology), ["nozze"]);

  const dio = nounCard({ english: "god", irregular: { singular: "dio", plural: "dei" }, articleGroups: { singular: null, plural: "lo" } });
  assert.equal(article(dio, "il gli un").correct, true);
  assert.deepEqual(articlePromptForms(dio, defaultNounMorphology), ["dio", "dei"]);
});

test("the article drill splits a single-group class by start pattern", () => {
  const cards = [
    nounCard({ english: "mirror", rule: rules.chioChi, base: "spec" }),
    nounCard({ english: "backpack", rule: rules.oI, base: "zain" }),
    nounCard({ english: "gnome", rule: rules.oI, base: "gnom" }),
    nounCard({ english: "book", rule: rules.oI, base: "libr" }),
    nounCard({ english: "house", rule: rules.aE, base: "cas", gender: "feminine" }),
    nounCard({ english: "aunt", rule: rules.aE, base: "zi", gender: "feminine" }),
    nounCard({ english: "Venice", rule: rules.singularBase, base: "Venezia", gender: "feminine", articleProfile: nounArticleProfiles.none }),
  ];
  const pool = articleDrillPool(cards, defaultNounMorphology);
  // lo/gli/uno split into sC, z, gn; il/i/un whole; la/le/una spans two groups so stays whole; Venice takes no articles.
  const shape = pool.map((buckets) => buckets.map((bucket) => bucket.map((card) => card.english).sort()));
  assert.equal(pool.length, 3);
  assert.ok(shape.some((buckets) => buckets.length === 3));
  assert.ok(shape.some((buckets) => buckets.length === 1 && buckets[0].join() === "aunt,house"));

  const drawn = drawArticleCard(pool, cards[0].id, () => 0);
  assert.ok(drawn);
  assert.notEqual(drawn.id, cards[0].id);
});

/* ---------- Prompts and preferences ---------- */

test("prompts shared with a noun of the other gender show the gender", () => {
  const male = nounCard({ english: "colleague", irregular: { singular: "collega", plural: "colleghi" } });
  const female = nounCard({ english: "colleague", rule: "-ga → -ghe", base: "colle", gender: "feminine" });
  const book = nounCard({ english: "book", rule: rules.oI, base: "libr" });
  const cards = [male, female, book];
  assert.equal(promptGender(male, cards, "english", defaultNounMorphology), "masculine");
  assert.equal(promptGender(female, cards, "italian", defaultNounMorphology), "feminine");
  assert.equal(promptGender(book, cards, "english", defaultNounMorphology), null);
});

test("study preferences validate keywords and prune deleted references", () => {
  assert.throws(() => normalizeStudyPreferences({ ...defaultStudyPreferences, answerKeywords: { ...keywords, feminine: "m" } }), /different/i);
  assert.throws(() => normalizeStudyPreferences({ ...defaultStudyPreferences, answerKeywords: { ...keywords, masculine: "m x" } }), /one token/i);

  const card = nounCard({ english: "book", rule: rules.oI, base: "libr" });
  const state = {
    cards: [card],
    nounMorphology: defaultNounMorphology,
    studyPreferences: { ...defaultStudyPreferences, fullDeclensionCards: [card.id, 9999], fullDeclensionRules: [rules.oI, "gone"] },
  };
  assert.throws(() => parseInventoryState(state, "Inventory"), /unknown/i);
  const consistent = consistentInventoryState(state);
  assert.deepEqual(consistent.studyPreferences.fullDeclensionCards, [card.id]);
  assert.deepEqual(consistent.studyPreferences.fullDeclensionRules, [rules.oI]);
  assert.doesNotThrow(() => parseInventoryState(consistent, "Inventory"));
});
