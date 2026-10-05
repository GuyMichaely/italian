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

const conflictsOf = (run) => {
  try {
    run();
  } catch (error) {
    if (error instanceof InventoryConflictError) return error.conflicts;
    throw error;
  }
  assert.fail("expected a conflict");
};

test("deletions are kept unless the other side changed the word; choosing settles it", () => {
  const base = inventory([adverb(1, "qui"), adverb(2, "là")]);
  const merged = mergeInventory(base, inventory([adverb(2, "là")]), inventory([adverb(1, "qui"), adverb(2, "là", "there")]));
  assert.deepEqual(merged.cards.map((card) => [card.id, card.english]), [[2, "there"]]);

  const mine = inventory([adverb(2, "là")]);
  const theirs = inventory([adverb(1, "qui", "here!"), adverb(2, "là")]);
  const [conflict] = conflictsOf(() => mergeInventory(base, mine, theirs));
  assert.deepEqual([conflict.key, conflict.kind, conflict.mine, conflict.theirs.english], ["card:1", "card", null, "here!"]);
  assert.deepEqual(mergeInventory(base, mine, theirs, { "card:1": "mine" }).cards.map((card) => card.id), [2]);
  assert.deepEqual(mergeInventory(base, mine, theirs, { "card:1": "theirs" }).cards.map((card) => card.english), ["here!", "là"]);
});

test("a word changed differently on both sides is a conflict; every conflict is listed at once", () => {
  const base = inventory([adverb(1, "qui"), adverb(2, "là")]);
  const conflicts = conflictsOf(() => mergeInventory(base, inventory([adverb(1, "qui", "right here"), adverb(2, "là", "over there")]), inventory([adverb(1, "qui", "in here"), adverb(2, "là", "yonder")])));
  assert.deepEqual(conflicts.map((conflict) => conflict.key), ["card:1", "card:2"]);
});

test("settings merge as a whole: one side's change is kept, two different changes conflict", () => {
  const base = inventory([adverb(1, "qui")]);
  const merged = mergeInventory(base, withKeyword(base, "masc"), inventory([adverb(2, "là"), adverb(1, "qui")]));
  assert.equal(merged.studyPreferences.answerKeywords.masculine, "masc");
  assert.equal(merged.cards.length, 2);

  const [conflict] = conflictsOf(() => mergeInventory(base, withKeyword(base, "masc"), withKeyword(base, "mas")));
  assert.deepEqual([conflict.key, conflict.changedInBoth], ["part:studyPreferences", true]);
  assert.equal(mergeInventory(base, withKeyword(base, "masc"), withKeyword(base, "mas"), { "part:studyPreferences": "theirs" }).studyPreferences.answerKeywords.masculine, "mas");
});

test("the same word added on both sides is a conflict; the chosen one is kept", () => {
  const base = inventory([]);
  const [conflict] = conflictsOf(() => mergeInventory(base, inventory([adverb(2, "qui")]), inventory([adverb(3, "qui")])));
  assert.deepEqual([conflict.key, conflict.kind, conflict.mine.id, conflict.theirs.id], ["duplicate:2:3", "duplicate", 2, 3]);
  assert.deepEqual(mergeInventory(base, inventory([adverb(2, "qui")]), inventory([adverb(3, "qui")]), { "duplicate:2:3": "theirs" }).cards.map((card) => card.id), [3]);
});

test("a word that doesn't fit the merged rules makes the rules a conflict, naming what each choice drops", () => {
  const base = inventory([]);
  const withoutRule = { ...base, nounMorphology: { ...base.nounMorphology, declensionRules: base.nounMorphology.declensionRules.filter((rule) => rule.name !== "-chio → -chi") } };
  const theirs = inventory([noun({ id: 5 })]);
  const [conflict] = conflictsOf(() => mergeInventory(base, withoutRule, theirs));
  assert.deepEqual([conflict.key, conflict.changedInBoth, conflict.removes.mine.map((card) => card.id), conflict.removes.theirs], ["part:nounMorphology", false, [5], []]);
  assert.deepEqual(mergeInventory(base, withoutRule, theirs, { "part:nounMorphology": "theirs" }).cards.map((card) => card.id), [5]);
  assert.deepEqual(mergeInventory(base, withoutRule, theirs, { "part:nounMorphology": "mine" }).cards, []);
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

// ---- Syncing with the server. ----

const { syncOnce, markSyncSignedIn, SyncSignedOutError } = require(path.join(testDist, "storage", "cloudSync.js"));

/** A fake sync server with the real one's rules, and devices that each have their own storage. */
function fakeServer() {
  const server = { version: 0, inventory: null, beforePut: null, signedIn: true, downloads: 0 };
  global.fetch = async (url, init = {}) => {
    // Access turns a request without its sign-in away with a redirect to its login page.
    if (!server.signedIn) return { type: "opaqueredirect", status: 0, ok: false };
    if ((init.method ?? "GET") === "GET") {
      const since = new URL(url).searchParams.get("since");
      if (since !== null && Number(since) === server.version) return Response.json({ version: server.version, unchanged: true });
      server.downloads += 1;
      return Response.json({ version: server.version, inventory: server.inventory });
    }
    server.beforePut?.();
    server.beforePut = null;
    const body = JSON.parse(init.body);
    if (body.baseVersion !== server.version) return Response.json({ version: server.version, inventory: server.inventory }, { status: 409 });
    server.version += 1;
    server.inventory = body.inventory;
    return Response.json({ version: server.version });
  };
  return server;
}

function device(cards) {
  const localStorage = fakeLocalStorage();
  const use = () => { global.window = { localStorage }; };
  use();
  markSyncSignedIn();
  if (cards) writeLocalSnapshot({ ...inventory(cards), updatedAt: new Date().toISOString() });
  return {
    use,
    sync: (choices) => { use(); return syncOnce("https://sync.test", choices); },
    edit: (change) => { use(); const stored = readLocalSnapshot(); writeLocalSnapshot({ ...stored, cards: change(stored.cards).map(normalizeCard), updatedAt: new Date().toISOString() }); },
    words: () => { use(); return readLocalSnapshot().cards.map((card) => card.english).sort(); },
  };
}

test("a first sync uploads this device's words, and a new device takes them", async () => {
  const server = fakeServer();
  const laptop = device([adverb(1, "qui", "here")]);
  await laptop.sync();
  assert.equal(server.version, 1);
  const phone = device();
  await phone.sync();
  assert.deepEqual(phone.words(), ["here"]);
  assert.equal(server.version, 1, "nothing new to upload");
});

test("when nothing changed anywhere, a sync downloads nothing", async () => {
  const server = fakeServer();
  const laptop = device([adverb(1, "qui", "here")]);
  await laptop.sync();
  const downloads = server.downloads;
  await laptop.sync();
  await laptop.sync();
  assert.equal(server.downloads, downloads);
  assert.equal(server.version, 1);
  laptop.edit((cards) => [normalizeCard(adverb(2, "là", "there")), ...cards]);
  await laptop.sync();
  assert.equal(server.downloads, downloads, "an upload from the version it has needs no download either");
  assert.equal(server.version, 2);
});
test("words added on two devices both end up on both", async () => {
  fakeServer();
  const laptop = device([adverb(1, "qui", "here")]);
  await laptop.sync();
  const phone = device();
  await phone.sync();
  laptop.edit((cards) => [normalizeCard(adverb(2, "là", "there")), ...cards]);
  phone.edit((cards) => [normalizeCard(adverb(3, "già", "already")), ...cards]);
  await laptop.sync();
  await phone.sync();
  await laptop.sync();
  assert.deepEqual(laptop.words(), ["already", "here", "there"]);
  assert.deepEqual(phone.words(), ["already", "here", "there"]);
});

test("a word changed differently on two devices waits for a choice, then syncs", async () => {
  const server = fakeServer();
  const laptop = device([adverb(1, "qui", "here")]);
  await laptop.sync();
  const phone = device();
  await phone.sync();
  laptop.edit(() => [adverb(1, "qui", "right here")]);
  phone.edit(() => [adverb(1, "qui", "in here")]);
  await laptop.sync();
  await assert.rejects(phone.sync(), (error) => error instanceof InventoryConflictError && error.conflicts[0].key === "card:1");
  assert.deepEqual(phone.words(), ["in here"], "nothing changed while it waits");
  await phone.sync({ "card:1": "theirs" });
  assert.deepEqual(phone.words(), ["right here"]);
  assert.equal(server.inventory.cards[0].english, "right here");
});

test("a device that synced in between is merged in, not overwritten", async () => {
  const server = fakeServer();
  const laptop = device([adverb(1, "qui", "here")]);
  await laptop.sync();
  laptop.edit((cards) => [normalizeCard(adverb(2, "là", "there")), ...cards]);
  // Another device uploads between this one's download and upload.
  server.beforePut = () => {
    server.version += 1;
    server.inventory = { ...server.inventory, cards: [normalizeCard(adverb(3, "già", "already")), ...server.inventory.cards] };
  };
  await laptop.sync();
  assert.deepEqual(laptop.words(), ["already", "here", "there"]);
  assert.deepEqual(server.inventory.cards.map((card) => card.english).sort(), ["already", "here", "there"]);
});

test("an expired sign-in means signing in again", async () => {
  const server = fakeServer();
  const laptop = device([adverb(1, "qui")]);
  server.signedIn = false;
  await assert.rejects(laptop.sync(), SyncSignedOutError);
});
