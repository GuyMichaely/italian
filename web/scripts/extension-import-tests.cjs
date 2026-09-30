const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const testDist = path.join(__dirname, "..", ".test-dist");
fs.mkdirSync(testDist, { recursive: true });
fs.writeFileSync(path.join(testDist, "package.json"), '{"type":"commonjs"}\n');

const {
  defaultNounMorphology,
  nounArticleProfiles,
} = require(path.join(testDist, "cards", "nounMorphology.js"));
const {
  extensionCandidatesToCards,
  extensionEntriesToCards,
  parseExtensionImportRequest,
} = require(path.join(testDist, "extensionImport.js"));
const { defaultAdjectiveMorphology } = require(path.join(testDist, "cards", "adjectiveMorphology.js"));

function canonicalCard(overrides) {
  return {
    id: 0,
    type: "adverb",
    english: "very",
    italian: "molto",
    setName: null,
    tags: [],
    details: {},
    ...overrides,
  };
}

function canonicalNoun(overrides = {}) {
  return {
    id: 0,
    type: "noun",
    english: "mirror",
    setName: null,
    tags: [],
    details: {
      declension: { kind: "rule", rule: "-chio → -chi", base: "spec" },
      gender: "masculine",
      genderDiffersWithPlurality: false,
      articleProfile: nounArticleProfiles.all,
      articleGroups: { singular: null, plural: null },
    },
    ...overrides,
  };
}

test("extension imports accept a current canonical noun card unchanged", () => {
  const input = canonicalNoun();
  const [card] = extensionCandidatesToCards([input], defaultNounMorphology, defaultAdjectiveMorphology);
  assert.deepEqual(card, input);
});

test("extension imports reject a stored Italian field on nouns", () => {
  const retired = canonicalNoun({ italian: "specchio" });
  assert.throws(
    () => extensionCandidatesToCards([retired], defaultNounMorphology, defaultAdjectiveMorphology),
    /must not store a derived italian field/i,
  );
});

test("extension imports reject the retired noun forms/details shape", () => {
  const legacy = canonicalNoun({
    details: {
      gender: "masculine",
      singular: "specchio",
      plural: "specchi",
      definiteSingularArticle: "lo",
      definitePluralArticle: "gli",
      indefiniteArticle: "uno",
    },
  });

  assert.throws(
    () => extensionCandidatesToCards([legacy], defaultNounMorphology, defaultAdjectiveMorphology),
    /must contain exactly.*articleGroups.*articleProfile.*declension.*gender/i,
  );
});

test("extension imports reject the retired rule/base noun schema", () => {
  const retired = canonicalNoun({
    details: {
      rule: "-chio → -chi",
      base: "spec",
      gender: "masculine",
      articleProfile: nounArticleProfiles.all,
    },
  });

  assert.throws(
    () => extensionCandidatesToCards([retired], defaultNounMorphology, defaultAdjectiveMorphology),
    /must contain exactly.*articleGroups.*articleProfile.*declension.*gender/i,
  );
});

test("extension imports reject the retired articleMode noun schema", () => {
  const retired = canonicalNoun({
    details: {
      rule: "-chio → -chi",
      base: "spec",
      gender: "masculine",
      articleMode: "automatic",
    },
  });

  assert.throws(
    () => extensionCandidatesToCards([retired], defaultNounMorphology, defaultAdjectiveMorphology),
    /must contain exactly.*articleGroups.*articleProfile.*declension.*gender/i,
  );
});

test("extension imports reject noun article profiles unsupported by their declension", () => {
  const invalid = canonicalNoun({
    english: "clothes",
    details: {
      declension: { kind: "rule", rule: "Plural form is the base", base: "vestiti" },
      gender: "masculine",
      genderDiffersWithPlurality: false,
      articleProfile: nounArticleProfiles.all,
      articleGroups: { singular: null, plural: null },
    },
  });

  assert.throws(
    () => extensionCandidatesToCards([invalid], defaultNounMorphology, defaultAdjectiveMorphology),
    /requires a noun form/i,
  );
});

test("extension imports reject unknown card types", () => {
  const invalid = canonicalCard({ type: "pronoun", english: "it", italian: "esso" });
  assert.throws(
    () => extensionCandidatesToCards([invalid], defaultNounMorphology, defaultAdjectiveMorphology),
    /incomplete or invalid card/i,
  );
});

test("extension import request parsing accepts only the bridge envelope", () => {
  const request = parseExtensionImportRequest({
    source: "italian-capture-extension",
    type: "italian-extension-import",
    requestId: "request-1",
    candidates: [canonicalCard({})],
  });
  assert.equal(request?.requestId, "request-1");
  assert.equal(parseExtensionImportRequest({ source: "something-else", type: "italian-extension-import" }), null);
});

function entry(id, headword, overrides = {}) {
  return { id, word: headword.word, reading: { headword, via: null }, choice: 0, english: "", ...overrides };
}

const libro = { pos: "noun", word: "libro", genders: ["m"], number: "both", plurals: [{ form: "libri" }], glosses: ["book", "phloem; foliage"] };
const uomo = { pos: "noun", word: "uomo", genders: ["m"], number: "both", plurals: [{ form: "uomini" }], glosses: ["man"] };
const cantante = { pos: "noun", word: "cantante", genders: ["m", "f"], number: "both", plurals: [{ form: "cantanti" }], glosses: ["singer"] };
const capire = { pos: "verb", word: "capire", present: ["capisco", "capisci", "capisce", "capiamo", "capite", "capiscono"], participle: "capito", auxiliaries: ["avere"], glosses: ["to understand"] };
const qui = { pos: "adv", word: "qui", glosses: ["here"] };

test("extension words become cards with the learner's rules and the extension tag", () => {
  const { cards, added, skipped } = extensionEntriesToCards(
    [entry("a", libro), entry("b", capire), entry("c", qui, { english: "right here" })],
    [],
    defaultNounMorphology,
    defaultAdjectiveMorphology,
  );
  assert.deepEqual(added, ["a", "b", "c"]);
  assert.deepEqual(skipped, []);
  assert.deepEqual(cards[0].details.declension, { kind: "rule", rule: "-o → -i", base: "libr" });
  assert.equal(cards[0].english, "book");
  assert.deepEqual(cards[0].tags, ["from-extension"]);
  assert.deepEqual([cards[1].italian, cards[1].details.io, cards[1].details.auxiliary], ["capire", "capisco", "avere"]);
  assert.deepEqual([cards[2].italian, cards[2].english], ["qui", "right here"]);
});

test("extension words to check get the review tag, and the chosen reading is used", () => {
  const { cards } = extensionEntriesToCards([entry("u", uomo), entry("c", cantante, { choice: 1 })], [], defaultNounMorphology, defaultAdjectiveMorphology);
  assert.deepEqual(cards[0].details.declension, { kind: "irregular", singular: "uomo", plural: "uomini" });
  assert.deepEqual(cards[0].tags, ["from-extension", "needs-review"]);
  assert.equal(cards[1].details.gender, "feminine");
});

test("extension words already in the inventory or unreadable are skipped, not fatal", () => {
  const first = extensionEntriesToCards([entry("a", libro)], [], defaultNounMorphology, defaultAdjectiveMorphology).cards;
  const { cards, added, skipped } = extensionEntriesToCards(
    [entry("again", libro), entry("broken", { pos: "noun" }), entry("ok", qui)],
    first,
    defaultNounMorphology,
    defaultAdjectiveMorphology,
  );
  assert.deepEqual(added, ["ok"]);
  assert.equal(cards.length, 1);
  assert.deepEqual(skipped.map((item) => item.id), ["again", "broken"]);
  assert.match(skipped[0].reason, /already/);
});

test("extension import requests may carry dictionary entries instead of cards", () => {
  const request = parseExtensionImportRequest({ source: "italian-capture-extension", type: "italian-extension-import", requestId: "r", entries: [entry("a", libro)] });
  assert.equal(request.entries.length, 1);
  assert.throws(() => parseExtensionImportRequest({ source: "italian-capture-extension", type: "italian-extension-import", requestId: "r", entries: [] }), /incomplete/);
});
