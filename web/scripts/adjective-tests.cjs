const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const testDist = path.join(__dirname, "..", ".test-dist");
fs.mkdirSync(testDist, { recursive: true });
fs.writeFileSync(path.join(testDist, "package.json"), '{"type":"commonjs"}\n');

const {
  defaultAdjectiveMorphology,
  followsLessSpecificRule,
  inferAdjectiveDeclension,
  normalizeAdjectiveMorphology,
  predictedAdjectiveForms,
  resolvedAdjectiveForms,
} = require(path.join(testDist, "cards", "adjectiveMorphology.js"));
const { resolveAdjectiveDraft, emptyAdjectiveDraft } = require(path.join(testDist, "cards", "adjectiveDraft.js"));
const { irregularRuleValue } = require(path.join(testDist, "cards", "nounDraft.js"));
const { checkAdjectiveAnswer } = require(path.join(testDist, "study", "verification.js"));
const { adjectiveFullFormsReasons, defaultStudyPreferences } = require(path.join(testDist, "study", "preferences.js"));
const { normalizeCard } = require(path.join(testDist, "storage", "cardCodec.js"));
const { analyzeAnswerSyntax } = require(path.join(testDist, "components", "AnswerParsePreview.js"));

const morphology = defaultAdjectiveMorphology;
let nextId = 1;

function forms(masculineSingular, feminineSingular, masculinePlural, femininePlural) {
  return { masculineSingular, feminineSingular, masculinePlural, femininePlural };
}

function adjective(english, declension, id = nextId++) {
  return { id, type: "adjective", english, setName: null, tags: [], details: { declension } };
}

function ruled(english, rule, base) {
  return adjective(english, { kind: "rule", rule, base });
}

function check(card, answer, preferences = defaultStudyPreferences) {
  return checkAdjectiveAnswer(card, answer, morphology, preferences);
}

test("rules generate the four forms from a base", () => {
  assert.deepEqual(resolvedAdjectiveForms(ruled("red", "-o/-a/-i/-e", "ross"), morphology), { forms: forms("rosso", "rossa", "rossi", "rosse"), rule: "-o/-a/-i/-e" });
  assert.deepEqual(resolvedAdjectiveForms(ruled("old", "-io/-ia/-i/-ie", "vecch"), morphology).forms, forms("vecchio", "vecchia", "vecchi", "vecchie"));
  assert.deepEqual(resolvedAdjectiveForms(ruled("blue", "Invariable", "blu"), morphology).forms, forms("blu", "blu", "blu", "blu"));
  assert.throws(() => resolvedAdjectiveForms(ruled("red", "gone", "ross"), morphology), /unknown adjective rule/);
});

test("the most specific matching ending predicts the forms, and ties predict nothing", () => {
  assert.equal(predictedAdjectiveForms("vecchio", morphology).length, 1);
  assert.equal(predictedAdjectiveForms("marcio", morphology)[0].femininePlural, "marce");
  assert.equal(predictedAdjectiveForms("ottimista", morphology)[0].masculinePlural, "ottimisti");
  assert.equal(predictedAdjectiveForms("lungo", morphology)[0].masculinePlural, "lunghi");
  assert.equal(predictedAdjectiveForms("rosa", morphology)[0].femininePlural, "rosa");
  assert.equal(predictedAdjectiveForms("bianco", morphology).length, 2);
});

test("inference picks the most specific rule that makes the forms", () => {
  assert.deepEqual(inferAdjectiveDeclension(forms("bianco", "bianca", "bianchi", "bianche"), morphology), { kind: "rule", rule: "-co/-ca/-chi/-che", base: "bian" });
  assert.deepEqual(inferAdjectiveDeclension(forms("economico", "economica", "economici", "economiche"), morphology), { kind: "rule", rule: "-co/-ca/-ci/-che", base: "economi" });
  assert.deepEqual(inferAdjectiveDeclension(forms("verde", "verde", "verdi", "verdi"), morphology), { kind: "rule", rule: "-e/-e/-i/-i", base: "verd" });
  assert.equal(inferAdjectiveDeclension(forms("belga", "belga", "belgi", "belghe"), morphology), null);
  // A typo that happens to fit a shorter ending is flagged.
  const typo = inferAdjectiveDeclension(forms("bianco", "bianca", "bianci", "biance"), morphology);
  assert.equal(typo.rule, "-o/-a/-i/-e");
  assert.equal(followsLessSpecificRule(typo.rule, "bianco", morphology), true);
  assert.equal(followsLessSpecificRule("-o/-a/-i/-e", "rosso", morphology), false);
});

test("the masculine singular alone answers a predictable adjective", () => {
  const rosso = ruled("red", "-o/-a/-i/-e", "ross");
  assert.equal(check(rosso, "rosso").correct, true);
  assert.equal(check(rosso, "rosso rossa rossi rosse").correct, true);
  assert.equal(check(rosso, "rossa").correct, false);
  const wrong = check(rosso, "rosso rossa rossi rossi");
  assert.equal(wrong.correct, false);
  assert.match(wrong.problems.join(" "), /feminine plural isn’t “rossi”/);
  assert.match(check(rosso, "rosso rossa").problems.join(" "), /all four forms/);
});

test("ambiguous, irregular, drilled, and marked adjectives need all four forms", () => {
  const bianco = ruled("white", "-co/-ca/-chi/-che", "bian");
  assert.deepEqual(adjectiveFullFormsReasons(bianco, morphology, defaultStudyPreferences), ["unpredictable"]);
  assert.match(check(bianco, "bianco").problems.join(" "), /Give all four forms/);
  assert.equal(check(bianco, "bianco bianca bianchi bianche").correct, true);

  const belga = adjective("Belgian", { kind: "irregular", ...forms("belga", "belga", "belgi", "belghe") });
  assert.deepEqual(adjectiveFullFormsReasons(belga, morphology, defaultStudyPreferences), ["irregular"]);
  assert.equal(check(belga, "belga").correct, false);
  assert.equal(check(belga, "belga belga belgi belghe").correct, true);

  const rosso = ruled("red", "-o/-a/-i/-e", "ross");
  const drilling = { ...defaultStudyPreferences, adjectiveFullDeclensionRules: ["-o/-a/-i/-e"] };
  assert.equal(check(rosso, "rosso", drilling).correct, false);
  assert.equal(check(rosso, "rosso rossa rossi rosse", drilling).correct, true);
  const marked = { ...defaultStudyPreferences, fullDeclensionCards: [rosso.id] };
  assert.deepEqual(adjectiveFullFormsReasons(rosso, morphology, marked), ["card"]);
});

test("drafts infer a rule, suggest nothing when rules tie, and check a chosen rule", () => {
  const draft = (patch) => resolveAdjectiveDraft({ ...emptyAdjectiveDraft(), english: "x", ...patch }, morphology);
  const rosso = draft({ masculineSingular: "rosso" });
  assert.equal(rosso.ok, true);
  assert.deepEqual(rosso.declension, { kind: "rule", rule: "-o/-a/-i/-e", base: "ross" });
  assert.match(draft({ masculineSingular: "bianco" }).error, /More than one rule fits/);
  assert.equal(draft(forms("bianco", "bianca", "bianchi", "bianche")).declension.rule, "-co/-ca/-chi/-che");
  assert.match(draft({ masculineSingular: "bianco", feminineSingular: "bianca" }).error, /all four forms/);
  assert.match(draft({ ...forms("bianco", "bianca", "bianchi", "bianche"), rule: "-co/-ca/-ci/-che" }).error, /makes the masc\. pl\. “bianci”/);
  assert.equal(draft({ masculineSingular: "bianco", rule: "-co/-ca/-ci/-che" }).forms.masculinePlural, "bianci");
  assert.match(draft({ masculineSingular: "belga", rule: irregularRuleValue }).error, /needs all four forms/);
  assert.equal(draft({ ...forms("belga", "belga", "belgi", "belghe"), rule: irregularRuleValue }).declension.kind, "irregular");
});

test("adjective morphology and cards are validated strictly", () => {
  assert.throws(() => normalizeAdjectiveMorphology({ declensionRules: [{ name: "Irregular", endings: forms("o", "a", "i", "e") }] }), /reserved/);
  assert.throws(() => normalizeAdjectiveMorphology({ declensionRules: [{ name: "x", endings: { masculineSingular: "o" } }] }), /must contain exactly/);
  assert.throws(() => normalizeAdjectiveMorphology({ declensionRules: [{ name: "x", endings: forms("o", "a", "i", "e") }, { name: "x", endings: forms("e", "e", "i", "i") }] }), /Duplicate/);

  const card = normalizeCard({ id: 1, type: "adjective", english: "red", setName: null, tags: [], details: { declension: { kind: "rule", rule: "-o/-a/-i/-e", base: "ross" } } });
  assert.deepEqual(card.details, { declension: { kind: "rule", rule: "-o/-a/-i/-e", base: "ross" } });
  assert.throws(() => normalizeCard({ id: 1, type: "adjective", english: "red", italian: "rosso", setName: null, tags: [], details: { declension: { kind: "rule", rule: "-o/-a/-i/-e", base: "ross" } } }), /must not store a derived italian/);
  assert.throws(() => normalizeCard({ id: 1, type: "adjective", english: "red", setName: null, tags: [], details: forms("rosso", "rossa", "rossi", "rosse") }), /must contain exactly: declension/);
});

test("the adjective preview reads one form or four without the card", () => {
  const card = ruled("red", "-o/-a/-i/-e", "ross");
  const keywords = defaultStudyPreferences.answerKeywords;
  const one = analyzeAnswerSyntax({ card, mode: "word" }, "rosso", keywords, undefined);
  assert.equal(one.status, "complete");
  assert.equal(one.syntaxName, "Masculine singular");
  assert.equal(analyzeAnswerSyntax({ card, mode: "word" }, "rosso rossa", keywords, undefined).status, "partial");
  assert.equal(analyzeAnswerSyntax({ card, mode: "word" }, "rosso rossa rossi rosse", keywords, undefined).status, "complete");
  assert.equal(analyzeAnswerSyntax({ card, mode: "word" }, "a b c d e", keywords, undefined).status, "invalid");
});
