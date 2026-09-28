const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const testDist = path.join(__dirname, "..", ".test-dist");
fs.mkdirSync(testDist, { recursive: true });
fs.writeFileSync(path.join(testDist, "package.json"), '{"type":"commonjs"}\n');
const { appendMistakeReviewSet, availableReviewItems } = require(path.join(testDist, "study", "reviews.js"));

const cards = Array.from({ length: 20 }, (_, index) => ({
  id: index + 1, type: "adverb", english: `Word ${index + 1}`, italian: `Parola ${index + 1}`,
  setName: null, tags: [], details: {},
}));
const items = cards.map((card) => ({ key: `${card.id}:english`, card, promptLanguage: "english" }));

test("20 → 10 → 5 rounds remain independent and an older set can branch", () => {
  let sets = appendMistakeReviewSet([], items, null);
  sets = appendMistakeReviewSet(sets, items.slice(0, 10), 1);
  sets = appendMistakeReviewSet(sets, items.slice(0, 5), 2);
  assert.deepEqual(sets.map((set) => availableReviewItems(set, cards).length), [20, 10, 5]);
  assert.deepEqual(sets.map((set) => set.sourceSetId), [null, 1, 2]);
  const earlierSets = sets.slice();
  sets = appendMistakeReviewSet(sets, availableReviewItems(sets[0], cards).slice(15), 1);
  assert.deepEqual(sets.slice(0, 3), earlierSets);
  assert.equal(sets[3].sourceSetId, 1);
  assert.deepEqual(sets[3].items.map((item) => item.card.id), [16, 17, 18, 19, 20]);
});

test("perfect or skipped rounds add no empty set, and identical failures still represent separate rounds", () => {
  const mistakes = items.slice(0, 2);
  const sets = appendMistakeReviewSet([], mistakes, null);
  mistakes.pop();
  assert.equal(sets[0].items.length, 2);
  assert.deepEqual(appendMistakeReviewSet(sets, [], 1), sets);
  const repeated = appendMistakeReviewSet(sets, sets[0].items, 1);
  assert.deepEqual(repeated.map((set) => set.id), [1, 2]);
  assert.deepEqual(repeated.map((set) => set.items.length), [2, 2]);
});

test("replays retain failed directions and reflect edited or removed cards without altering the snapshot", () => {
  const mixed = [items[0], { ...items[0], key: "1:italian", promptLanguage: "italian" }, items[1]];
  const [set] = appendMistakeReviewSet([], mixed, null);
  const editedCard = { ...cards[0], english: "Updated word" };
  const resolved = availableReviewItems(set, [editedCard]);
  assert.deepEqual(resolved.map((item) => item.key), ["1:english", "1:italian"]);
  assert.deepEqual(resolved.map((item) => item.promptLanguage), ["english", "italian"]);
  assert.ok(resolved.every((item) => item.card.english === "Updated word"));
  assert.equal(set.items.length, 3);
  assert.equal(set.items[0].card.english, "Word 1");
  assert.deepEqual(availableReviewItems(set, []), []);
});
