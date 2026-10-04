const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const testDist = path.join(__dirname, "..", ".test-dist");
fs.mkdirSync(testDist, { recursive: true });
fs.writeFileSync(path.join(testDist, "package.json"), '{"type":"commonjs"}\n');

const { defaultNounMorphology, nounArticleProfiles } = require(path.join(testDist, "cards", "nounMorphology.js"));
const { defaultAdjectiveMorphology } = require(path.join(testDist, "cards", "adjectiveMorphology.js"));
const { normalizeCard } = require(path.join(testDist, "storage", "cardCodec.js"));
const { assertCardsFitMorphology, emptyInventoryState } = require(path.join(testDist, "storage", "inventoryState.js"));
const { InventoryConflictError, mergeInventory } = require(path.join(testDist, "storage", "merge.js"));
const { BrowserStorage, readLocalSnapshot, writeLocalSnapshot } = require(path.join(testDist, "storage", "browser.js"));
const { withEditTimes } = require(path.join(testDist, "cards", "edited.js"));
const { withSpareRows } = require(path.join(testDist, "cards", "batchRows.js"));

function adverb(id, italian, english = italian, overrides = {}) {
  return { id, type: "adverb", english, italian, setName: null, tags: [], editedAt: "2026-01-01T00:00:00.000Z", details: {}, ...overrides };
}

function noun(overrides = {}) {
  return {
    id: 0,
    type: "noun",
    english: "mirror",
    setName: null,
    tags: [],
    editedAt: "2026-01-01T00:00:00.000Z",
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

function inventory(cards, overrides = {}) {
  return { ...emptyInventoryState(), cards: cards.map(normalizeCard), ...overrides };
}

function withKeyword(state, masculine) {
  return { ...state, studyPreferences: { ...state.studyPreferences, answerKeywords: { ...state.studyPreferences.answerKeywords, masculine } } };
}

// ---- Cards as stored. ----

test("a current noun card is stored unchanged", () => {
  const input = noun();
  assert.deepEqual(normalizeCard(input), input);
});

test("cards in retired shapes are refused", () => {
  assert.throws(() => normalizeCard(noun({ italian: "specchio" })), /must not store a derived italian field/i);
  for (const details of [
    { gender: "masculine", singular: "specchio", plural: "specchi", definiteSingularArticle: "lo", definitePluralArticle: "gli", indefiniteArticle: "uno" },
    { rule: "-chio → -chi", base: "spec", gender: "masculine", articleProfile: nounArticleProfiles.all },
    { rule: "-chio → -chi", base: "spec", gender: "masculine", articleMode: "automatic" },
  ]) {
    assert.throws(() => normalizeCard(noun({ details })), /must contain exactly.*articleGroups.*articleProfile.*declension.*gender/i);
  }
  assert.throws(() => normalizeCard(adverb(1, "esso", "it", { type: "pronoun" })), /incomplete or invalid card/i);
});

test("a card without the time it was edited is refused", () => {
  assert.throws(() => normalizeCard(adverb(1, "qui", "here", { editedAt: undefined })), /editedAt/);
  assert.throws(() => normalizeCard(adverb(1, "qui", "here", { editedAt: "yesterday" })), /editedAt/);
});

test("saving stamps new and changed cards with the time, and leaves the rest", () => {
  const before = [adverb(1, "qui"), adverb(2, "là")].map(normalizeCard);
  // Same content in another key order is not a change.
  const reordered = { details: {}, tags: [], setName: null, italian: "là", english: "là", type: "adverb", id: 2, editedAt: "2026-10-04T11:00:00.000Z" };
  const after = withEditTimes(before, [adverb(3, "già"), adverb(1, "qui", "here"), reordered], "2026-10-04T12:00:00.000Z");
  assert.deepEqual(after.map((card) => card.editedAt), ["2026-10-04T12:00:00.000Z", "2026-10-04T12:00:00.000Z", before[1].editedAt]);
});

test("a noun whose article profile its declension can't support doesn't fit the rules", () => {
  const card = normalizeCard(noun({
    english: "clothes",
    details: {
      declension: { kind: "rule", rule: "Plural form is the base", base: "vestiti" },
      gender: "masculine",
      genderDiffersWithPlurality: false,
      articleProfile: nounArticleProfiles.all,
      articleGroups: { singular: null, plural: null },
    },
  }));
  assert.throws(() => assertCardsFitMorphology([card], defaultNounMorphology, defaultAdjectiveMorphology), /requires a noun form/i);
});

// ---- Add words rows. ----

test("rows end with exactly one empty row", () => {
  const empty = (id) => ({ id, text: "" });
  const used = (row) => Boolean(row.text);
  assert.deepEqual(withSpareRows([empty("a")], used, empty).map((row) => row.id), ["a"]);
  assert.equal(withSpareRows([], used, empty).length, 1);
  assert.deepEqual(withSpareRows([{ id: "a", text: "x" }, empty("b"), empty("c")], used, empty).map((row) => row.id), ["a", "b"]);
  const grown = withSpareRows([{ id: "a", text: "x" }], used, empty);
  assert.deepEqual([grown.length, grown[1].text], [2, ""]);
});

// ---- Merging. ----

test("words added on both sides are all kept, this side's first", () => {
  const base = inventory([adverb(1, "qui")]);
  const merged = mergeInventory(base, inventory([adverb(2, "là"), adverb(1, "qui")]), inventory([adverb(3, "già"), adverb(1, "qui")]));
  assert.deepEqual(merged.cards.map((card) => card.id), [2, 3, 1]);
});

test("a word changed on one side only takes that change", () => {
  const base = inventory([adverb(1, "qui"), adverb(2, "là")]);
  const mine = inventory([adverb(1, "qui", "right here"), adverb(2, "là")]);
  const theirs = inventory([adverb(1, "qui"), adverb(2, "là", "over there")]);
  assert.deepEqual(mergeInventory(base, mine, theirs).cards.map((card) => card.english), ["right here", "over there"]);
});

test("the same change made on both sides is no conflict", () => {
  const base = inventory([adverb(1, "qui")]);
  const changed = inventory([adverb(1, "qui", "right here")]);
  assert.equal(mergeInventory(base, changed, changed).cards[0].english, "right here");
});

test("deletions are kept unless the other side changed the word", () => {
  const base = inventory([adverb(1, "qui"), adverb(2, "là")]);
  const merged = mergeInventory(base, inventory([adverb(2, "là")]), inventory([adverb(1, "qui"), adverb(2, "là", "there")]));
  assert.deepEqual(merged.cards.map((card) => [card.id, card.english]), [[2, "there"]]);

  assert.throws(
    () => mergeInventory(base, inventory([adverb(2, "là")]), inventory([adverb(1, "qui", "here!"), adverb(2, "là")])),
    (error) => error instanceof InventoryConflictError && error.words.join() === "qui",
  );
});

test("a word changed differently on both sides is a conflict that names it", () => {
  const base = inventory([adverb(1, "qui")]);
  assert.throws(
    () => mergeInventory(base, inventory([adverb(1, "qui", "right here")]), inventory([adverb(1, "qui", "in here")])),
    (error) => error instanceof InventoryConflictError && error.words.join() === "qui" && /“qui”/.test(error.message),
  );
});

test("settings merge as a whole: one side's change is kept, two different changes conflict", () => {
  const base = inventory([adverb(1, "qui")]);
  const merged = mergeInventory(base, withKeyword(base, "masc"), inventory([adverb(2, "là"), adverb(1, "qui")]));
  assert.equal(merged.studyPreferences.answerKeywords.masculine, "masc");
  assert.equal(merged.cards.length, 2);

  assert.throws(() => mergeInventory(base, withKeyword(base, "masc"), withKeyword(base, "mas")), /study preferences/);
});

test("the same word added on both sides is a conflict", () => {
  const base = inventory([]);
  assert.throws(
    () => mergeInventory(base, inventory([adverb(2, "qui")]), inventory([adverb(3, "qui")])),
    (error) => error instanceof InventoryConflictError && /already exists/.test(error.message),
  );
});

test("a word added on the other side must still fit this side's rules", () => {
  const base = inventory([]);
  const withoutRule = { ...base, nounMorphology: { ...base.nounMorphology, declensionRules: base.nounMorphology.declensionRules.filter((rule) => rule.name !== "-chio → -chi") } };
  assert.throws(() => mergeInventory(base, withoutRule, inventory([noun({ id: 5 })])), InventoryConflictError);
});

// ---- Saving in the browser. ----

function fakeLocalStorage() {
  const items = new Map();
  return {
    getItem: (key) => items.has(key) ? items.get(key) : null,
    setItem: (key, value) => items.set(key, String(value)),
    removeItem: (key) => items.delete(key),
  };
}

test("a save keeps words written to storage since this window read it", async () => {
  global.window = { localStorage: fakeLocalStorage() };
  const tab = new BrowserStorage();
  await tab.saveInventory(inventory([adverb(1, "qui")]));
  const read = await tab.readInventory();

  // Something else on the site adds a word.
  const stored = readLocalSnapshot();
  writeLocalSnapshot({ ...stored, cards: [normalizeCard(adverb(2, "là")), ...stored.cards], updatedAt: new Date(Date.now() + 1000).toISOString() });

  const saved = await tab.saveInventory({ ...read, cards: [normalizeCard(adverb(1, "qui", "right here"))] });
  assert.deepEqual(saved.cards.map((card) => [card.id, card.english]), [[2, "là"], [1, "right here"]]);
  assert.deepEqual(readLocalSnapshot().cards.map((card) => card.id), [2, 1]);
});

test("a save that conflicts writes nothing", async () => {
  global.window = { localStorage: fakeLocalStorage() };
  const first = new BrowserStorage();
  await first.saveInventory(inventory([adverb(1, "qui")]));
  const second = new BrowserStorage();
  const state = await second.readInventory();
  await first.readInventory();

  await first.saveInventory(inventory([adverb(1, "qui", "right here")]));
  await assert.rejects(second.saveInventory({ ...state, cards: [normalizeCard(adverb(1, "qui", "in here"))] }), InventoryConflictError);
  assert.equal(readLocalSnapshot().cards[0].english, "right here");

  // Replacing (an import) writes over whatever is stored.
  await second.replaceInventory(inventory([adverb(9, "mai")]));
  assert.deepEqual(readLocalSnapshot().cards.map((card) => card.id), [9]);
});
