const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const testDist = path.join(__dirname, "..", ".test-dist");
fs.mkdirSync(testDist, { recursive: true });
fs.writeFileSync(path.join(testDist, "package.json"), '{"type":"commonjs"}\n');

const { LexiconBuilder, cleanGloss, englishChunks, englishIndex, lexiconChunks, stripStressMarks } = require(path.join(testDist, "lexicon", "extract.js"));
const { chunkFileName, chunkIndexForKey, lexiconKey } = require(path.join(testDist, "lexicon", "format.js"));
const { Lexicon } = require(path.join(testDist, "lexicon", "lookup.js"));
const { describeSuggestion, suggestionsForReadings } = require(path.join(testDist, "lexicon", "suggestions.js"));
const { rowAcceptsSuggestion, rowWithSuggestion } = require(path.join(testDist, "lexicon", "rows.js"));
const { emptyNounBatchRow, emptyVerbBatchRow } = require(path.join(testDist, "cards", "editorModel.js"));
const { defaultNounMorphology } = require(path.join(testDist, "cards", "nounMorphology.js"));
const { defaultAdjectiveMorphology } = require(path.join(testDist, "cards", "adjectiveMorphology.js"));
const { irregularRuleValue, resolveNounDraft } = require(path.join(testDist, "cards", "nounDraft.js"));
const { resolveAdjectiveDraft } = require(path.join(testDist, "cards", "adjectiveDraft.js"));

// Real Wiktionary entries (trimmed to the fields the lexicon reads) for the words tested here.
const sample = fs.readFileSync(path.join(__dirname, "fixtures", "lexicon-sample.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));

function sampleLexicon() {
  const builder = new LexiconBuilder();
  for (const entry of sample) builder.add(entry);
  // Tiny chunks, so lookups cross chunk boundaries the way the real ones do.
  const keyed = builder.finish();
  const { index, chunks } = lexiconChunks(keyed, 400, "test");
  const english = englishChunks(englishIndex(keyed), 400);
  const fetched = [];
  const lexicon = new Lexicon({
    index: async () => ({ build: "test", ...index, englishChunks: english.firstKeys }),
    chunk: async (build, file) => {
      fetched.push(file);
      return file.startsWith("en-") ? english.chunks[Number(file.slice(3, 7))] : chunks[Number(file.slice(0, 4))];
    },
  });
  return { lexicon, index, chunks, fetched };
}

const morphology = { noun: defaultNounMorphology, adjective: defaultAdjectiveMorphology };

async function suggestions(word) {
  const { lexicon } = sampleLexicon();
  return suggestionsForReadings(await lexicon.lookup(word), morphology);
}

function nounForms(suggestion) {
  const { singular, plural, gender, genderDiffersWithPlurality, articles } = suggestion.fields;
  return { singular, plural, gender, genderDiffersWithPlurality, articles };
}

test("stress marks are removed except a word's final accent", () => {
  assert.equal(stripStressMarks("capìscono", true), "capiscono");
  assert.equal(stripStressMarks("città", true), "città");
  assert.equal(stripStressMarks("mi làvo", true), "mi lavo");
  assert.equal(stripStressMarks("và", false), "va");
});

test("glosses lose explanations but keep one-word parentheticals", () => {
  assert.equal(cleanGloss("white (bright and colourless/colorless)"), "white");
  assert.equal(cleanGloss("to wash (oneself)"), "to wash (oneself)");
  assert.equal(cleanGloss("Used as a copula. to be"), "to be");
  assert.equal(cleanGloss("to have; See Category:Italian transitive verbs"), "to have");
  assert.equal(cleanGloss("to be agreeable (to), to be pleasing (to) (idiomatically, to feel like) [with a ‘person’]"), "to be agreeable (to), to be pleasing (to)");
});

test("keys fold case and accents, and each key's chunk is found by binary search", () => {
  assert.equal(lexiconKey("Città"), "citta");
  assert.equal(lexiconKey("dell’arte"), "dell'arte");
  const chunks = ["a", "cane", "m", "zz"];
  assert.equal(chunkIndexForKey(chunks, "a"), 0);
  assert.equal(chunkIndexForKey(chunks, "bello"), 0);
  assert.equal(chunkIndexForKey(chunks, "cane"), 1);
  assert.equal(chunkIndexForKey(chunks, "libro"), 1);
  assert.equal(chunkIndexForKey(chunks, "zzz"), 3);
  assert.equal(chunkFileName(7), "0007.json");
});

test("lookups load each chunk once", async () => {
  const { lexicon, chunks, fetched } = sampleLexicon();
  assert.ok(chunks.length > 10);
  await lexicon.lookup("libro");
  await lexicon.lookup("libro");
  assert.equal(fetched.length, 1);
  assert.deepEqual(await lexicon.lookup("parolaccia"), []);
});

test("a regular noun keeps Auto and its plural", async () => {
  const [libro] = await suggestions("libro");
  assert.equal(libro.type, "noun");
  assert.deepEqual(nounForms(libro), { singular: "libro", plural: "libri", gender: "masculine", genderDiffersWithPlurality: false, articles: "all" });
  assert.equal(libro.fields.english, "book");
  assert.equal(libro.fields.rule, "");
  assert.equal(libro.review, null);
});

test("an inflected form leads to its dictionary word", async () => {
  const [libro] = await suggestions("libri");
  assert.equal(libro.fields.singular, "libro");
  assert.equal(libro.reading.via.description, "plural");
  assert.equal(describeSuggestion(libro), "libro / libri, masculine noun. “libri” is the plural of libro.");
});

test("nouns no rule makes are Irregular and flagged", async () => {
  const [uomo] = await suggestions("uomo");
  assert.deepEqual(nounForms(uomo), { singular: "uomo", plural: "uomini", gender: "masculine", genderDiffersWithPlurality: false, articles: "all" });
  assert.equal(uomo.fields.rule, irregularRuleValue);
  assert.match(uomo.review, /Irregular/);
  assert.ok(resolveNounDraft(uomo.fields, defaultNounMorphology).ok);
});

test("a plural of the other gender sets gender-differs-with-plurality", async () => {
  const [uovo] = await suggestions("uova");
  assert.deepEqual(nounForms(uovo), { singular: "uovo", plural: "uova", gender: "masculine", genderDiffersWithPlurality: true, articles: "all" });
  assert.ok(resolveNounDraft(uovo.fields, defaultNounMorphology).ok);
  assert.equal(describeSuggestion(uovo), "uovo / uova, masculine noun with a feminine plural. “uova” is the plural of uovo.");
});

test("braccio offers both plurals, the usual one first", async () => {
  const nouns = (await suggestions("braccio")).filter((suggestion) => suggestion.type === "noun");
  assert.deepEqual(nouns.map((suggestion) => [suggestion.fields.plural, suggestion.fields.genderDiffersWithPlurality]), [["braccia", true], ["bracci", false]]);
});

test("invariable and plural-only nouns", async () => {
  const [citta] = await suggestions("città");
  assert.deepEqual(nounForms(citta), { singular: "città", plural: "città", gender: "feminine", genderDiffersWithPlurality: false, articles: "all" });
  assert.ok(resolveNounDraft(citta.fields, defaultNounMorphology).ok);

  // Typed without its accent, città still comes before citta, “female equivalent of citto”.
  assert.deepEqual((await suggestions("citta")).map((suggestion) => suggestion.fields.singular), ["città", "citta"]);

  const [forbici] = await suggestions("forbici");
  assert.deepEqual(nounForms(forbici), { singular: "", plural: "forbici", gender: "feminine", genderDiffersWithPlurality: false, articles: "definite-plural" });
  assert.ok(resolveNounDraft(forbici.fields, defaultNounMorphology).ok);
});

test("nouns of either gender offer both, with each gender's plural", async () => {
  const cantante = await suggestions("cantante");
  assert.deepEqual(cantante.map((suggestion) => [suggestion.type, suggestion.fields.gender ?? suggestion.fields.infinitive]), [["noun", "masculine"], ["noun", "feminine"], ["verb", "cantare"]]);
  assert.match(cantante[0].review, /either gender/);
  assert.equal(cantante[2].reading.via.description, "present participle");

  const belga = (await suggestions("belga")).filter((suggestion) => suggestion.type === "noun");
  assert.deepEqual(belga.map((suggestion) => [suggestion.fields.gender, suggestion.fields.plural]), [["masculine", "belgi"], ["feminine", "belghe"]]);
});

test("mano is feminine with a masculine-looking ending", async () => {
  const [mano] = await suggestions("mano");
  assert.deepEqual(nounForms(mano), { singular: "mano", plural: "mani", gender: "feminine", genderDiffersWithPlurality: false, articles: "all" });
  assert.equal(mano.fields.english, "hand");
});

test("problema is masculine", async () => {
  const [problema] = await suggestions("problema");
  assert.deepEqual(nounForms(problema), { singular: "problema", plural: "problemi", gender: "masculine", genderDiffersWithPlurality: false, articles: "all" });
  assert.ok(resolveNounDraft(problema.fields, defaultNounMorphology).ok);
});

test("adjectives come with their four forms", async () => {
  const bianco = await suggestions("bianco");
  assert.deepEqual(bianco.map((suggestion) => suggestion.type), ["adjective", "noun", "noun"]);
  const { masculineSingular, feminineSingular, masculinePlural, femininePlural, english, rule } = bianco[0].fields;
  assert.deepEqual([masculineSingular, feminineSingular, masculinePlural, femininePlural, english, rule], ["bianco", "bianca", "bianchi", "bianche", "white", ""]);
  assert.ok(resolveAdjectiveDraft(bianco[0].fields, defaultAdjectiveMorphology).ok);

  const [belga] = await suggestions("belgi");
  assert.equal(belga.type, "adjective");
  assert.deepEqual([belga.fields.feminineSingular, belga.fields.masculinePlural, belga.fields.femininePlural], ["belga", "belgi", "belghe"]);
  assert.ok(resolveAdjectiveDraft(belga.fields, defaultAdjectiveMorphology).ok);

  const [verde] = await suggestions("verde");
  assert.deepEqual([verde.fields.feminineSingular, verde.fields.masculinePlural, verde.fields.femininePlural], ["verde", "verdi", "verdi"]);
  const [blu] = await suggestions("blu");
  assert.deepEqual([blu.fields.feminineSingular, blu.fields.masculinePlural, blu.fields.femininePlural], ["blu", "blu", "blu"]);
});

test("verbs come with the present tense, participle, and auxiliary, spelled without stress marks", async () => {
  const [capire] = await suggestions("capire");
  assert.deepEqual(capire.fields, { english: "to understand", infinitive: "capire", io: "capisco", tu: "capisci", luiLei: "capisce", noi: "capiamo", voi: "capite", loro: "capiscono", auxiliary: "avere", participle: "capito" });
  assert.equal(capire.review, null);

  const [andare] = await suggestions("vado");
  assert.equal(andare.reading.via.description, "first-person singular present indicative");
  assert.deepEqual([andare.fields.io, andare.fields.tu, andare.fields.luiLei, andare.fields.loro, andare.fields.participle, andare.fields.auxiliary], ["vado", "vai", "va", "vanno", "andato", "essere"]);

  const [avere] = await suggestions("avere");
  assert.deepEqual([avere.fields.io, avere.fields.luiLei], ["ho", "ha"]);
  const [essere] = await suggestions("è");
  assert.deepEqual([essere.fields.english, essere.fields.luiLei, essere.fields.participle], ["to be", "è", "stato"]);
});

test("real accents stay: dà is dare, da is not", async () => {
  const [dare] = await suggestions("dà");
  assert.equal(dare.fields.infinitive, "dare");
  assert.equal(dare.fields.luiLei, "dà");
});

test("a verb taking either auxiliary offers both", async () => {
  const dovere = (await suggestions("dovere")).filter((suggestion) => suggestion.type === "verb");
  assert.deepEqual(dovere.map((suggestion) => suggestion.fields.auxiliary), ["avere", "essere"]);
  assert.match(dovere[0].review, /avere or essere/);
});

test("reflexive verbs drop the pronoun from the participle", async () => {
  const [lavarsi] = await suggestions("lavarsi");
  assert.deepEqual([lavarsi.fields.io, lavarsi.fields.participle, lavarsi.fields.auxiliary], ["mi lavo", "lavato", "essere"]);
});

test("adverbs", async () => {
  const [qui] = await suggestions("qui");
  assert.equal(qui.type, "adverb");
  assert.deepEqual(qui.fields, { english: "here", form: "qui" });
});

test("alternative spellings rank after the word's usual readings", async () => {
  const vado = await suggestions("vado");
  const words = vado.map((suggestion) => suggestion.type === "verb" ? suggestion.fields.infinitive : suggestion.fields.singular);
  assert.equal(words[0], "andare");
  assert.ok(words.length > 1 && words.slice(1).every((word) => word === "guado"));
});

test("adjective tables Wiktionary couldn't parse still give their forms", async () => {
  const [bello] = await suggestions("bello");
  assert.equal(bello.type, "adjective");
  assert.deepEqual([bello.fields.feminineSingular, bello.fields.masculinePlural, bello.fields.femininePlural], ["bella", "belli", "belle"]);
});

test("nouns ending in an accented vowel are invariable when Wiktionary lists no plural", async () => {
  const [pubblicita] = await suggestions("pubblicità");
  assert.deepEqual(nounForms(pubblicita), { singular: "pubblicità", plural: "pubblicità", gender: "feminine", genderDiffersWithPlurality: false, articles: "all" });
});

test("rows are filled in only where the learner hasn't typed the other fields", async () => {
  const [libro] = await suggestions("libro");
  const typed = { ...emptyNounBatchRow("1"), singular: "libro" };
  assert.ok(rowAcceptsSuggestion("noun", typed, null));
  const filled = rowWithSuggestion("noun", typed, libro, null);
  assert.deepEqual([filled.id, filled.english, filled.plural, filled.pluralSuggested], ["1", "book", "libri", false]);

  // English the learner typed stays.
  assert.equal(rowWithSuggestion("noun", { ...typed, english: "a book" }, libro, null).english, "a book");
  // A plural the learner typed blocks filling in; a suggested one doesn't.
  assert.ok(!rowAcceptsSuggestion("noun", { ...typed, plural: "libra" }, null));
  assert.ok(rowAcceptsSuggestion("noun", { ...typed, plural: "libri", pluralSuggested: true }, null));
});

test("a row filled in from the dictionary can be filled in again for a new word", async () => {
  const [libro] = await suggestions("libro");
  const [mano] = await suggestions("mano");
  const filled = rowWithSuggestion("noun", { ...emptyNounBatchRow("1"), singular: "libro" }, libro, null);
  const retyped = { ...filled, singular: "mano" };
  assert.ok(rowAcceptsSuggestion("noun", retyped, libro));
  const refilled = rowWithSuggestion("noun", retyped, mano, libro);
  assert.deepEqual([refilled.english, refilled.plural, refilled.gender], ["hand", "mani", "feminine"]);
  // Once the learner changes a filled-in field, it's theirs.
  assert.ok(!rowAcceptsSuggestion("noun", { ...retyped, gender: "feminine" }, libro));
});

test("verb rows fill the present tense, participle, and auxiliary", async () => {
  const [andare] = await suggestions("andare");
  const row = rowWithSuggestion("verb", { ...emptyVerbBatchRow("v"), infinitive: "andare" }, andare, null);
  assert.deepEqual([row.id, row.english, row.io, row.loro, row.auxiliary, row.participle], ["v", "to go", "vado", "vanno", "essere", "andato"]);
  assert.ok(!rowAcceptsSuggestion("verb", { ...emptyVerbBatchRow("v"), infinitive: "andare", io: "vo" }, null));
});

test("English words find their Italian headwords, a gloss that's just the word first", async () => {
  const { lexicon } = sampleLexicon();
  const hand = await lexicon.searchEnglish("hand");
  assert.equal(hand[0].headword.word, "mano");
  const understand = await lexicon.searchEnglish("to understand");
  assert.equal(understand[0].headword.word, "capire");
  const white = await lexicon.searchEnglish("White");
  assert.deepEqual(new Set(white.slice(0, 3).map((reading) => `${reading.headword.pos}:${reading.headword.word}`)), new Set(["adj:bianco", "noun:bianco"]));
  assert.deepEqual(await lexicon.searchEnglish("the"), []);
});
