import test from "node:test";
import assert from "node:assert/strict";
import type { LexiconHeadword } from "../../web/src/lexicon/format";
import { defaultNounMorphology } from "../../web/src/cards/nounMorphology";
import { defaultAdjectiveMorphology } from "../../web/src/cards/adjectiveMorphology";
import { readLocalSnapshot } from "../../web/src/storage/browser";
import { entriesToCards, writeWords, type WordEntry } from "../src/words";

function entry(id: string, headword: unknown, overrides: Partial<WordEntry> = {}): WordEntry {
  const word = (headword as { word?: string }).word ?? "";
  return { id, word, reading: { headword: headword as LexiconHeadword, via: null }, choice: 0, english: "", ...overrides };
}

const libro = { pos: "noun", word: "libro", genders: ["m"], number: "both", plurals: [{ form: "libri" }], glosses: ["book", "phloem; foliage"] };
const uomo = { pos: "noun", word: "uomo", genders: ["m"], number: "both", plurals: [{ form: "uomini" }], glosses: ["man"] };
const cantante = { pos: "noun", word: "cantante", genders: ["m", "f"], number: "both", plurals: [{ form: "cantanti" }], glosses: ["singer"] };
const capire = { pos: "verb", word: "capire", present: ["capisco", "capisci", "capisce", "capiamo", "capite", "capiscono"], participle: "capito", auxiliaries: ["avere"], glosses: ["to understand"] };
const qui = { pos: "adv", word: "qui", glosses: ["here"] };

const toCards = (entries: WordEntry[], existing: Parameters<typeof entriesToCards>[1] = []) => entriesToCards(entries, existing, defaultNounMorphology, defaultAdjectiveMorphology);

test("words become cards with the learner's rules and the extension tag", () => {
  const { cards, added, skipped } = toCards([entry("a", libro), entry("b", capire), entry("c", qui, { english: "right here" })]);
  assert.deepEqual(added, ["a", "b", "c"]);
  assert.deepEqual(skipped, []);
  const [book, understand, here] = cards as any[];
  assert.deepEqual(book.details.declension, { kind: "rule", rule: "-o → -i", base: "libr" });
  assert.equal(book.english, "book");
  assert.deepEqual(book.tags, ["from-extension"]);
  assert.deepEqual([understand.italian, understand.details.io, understand.details.auxiliary], ["capire", "capisco", "avere"]);
  assert.deepEqual([here.italian, here.english], ["qui", "right here"]);
  assert.equal(new Set(cards.map((card) => card.id)).size, 3);
  assert.ok(cards.every((card) => Number.isSafeInteger(card.id) && card.id >= 2 ** 32));
});

test("words to check get the review tag, and the chosen reading is used", () => {
  const [man, singer] = toCards([entry("u", uomo), entry("c", cantante, { choice: 1 })]).cards as any[];
  assert.deepEqual(man.details.declension, { kind: "irregular", singular: "uomo", plural: "uomini" });
  assert.deepEqual(man.tags, ["from-extension", "needs-review"]);
  assert.equal(singer.details.gender, "feminine");
});

test("words already in the inventory or unreadable are skipped, not fatal", () => {
  const first = toCards([entry("a", libro)]).cards;
  const { cards, added, skipped } = toCards([entry("again", libro), entry("broken", { pos: "noun" }), entry("ok", qui)], first);
  assert.deepEqual(added, ["ok"]);
  assert.equal(cards.length, 1);
  assert.deepEqual(skipped.map((item) => item.id), ["again", "broken"]);
  assert.match(skipped[0]!.reason, /already/);
});

function useStorage(initial?: string) {
  const items = new Map<string, string>(initial === undefined ? [] : [["italian:inventory", initial]]);
  Object.assign(globalThis, {
    window: {
      localStorage: {
        getItem: (key: string) => items.get(key) ?? null,
        setItem: (key: string, value: string) => void items.set(key, value),
        removeItem: (key: string) => void items.delete(key),
      },
    },
  });
  return items;
}

test("writing adds the words to the stored inventory and stamps it", () => {
  useStorage();
  const first = writeWords([entry("a", libro)]);
  assert.deepEqual(first, { ok: true, added: ["a"], skipped: [] });
  const second = writeWords([entry("b", qui), entry("again", libro)]);
  assert.deepEqual(second.ok && [second.added, second.skipped.map((item) => item.id)], [["b"], ["again"]]);
  const stored = readLocalSnapshot();
  assert.deepEqual(stored.cards.map((card) => card.english), ["here", "book"]);
  assert.ok(stored.updatedAt);
});

test("an inventory stored in a shape it doesn't know is left alone", () => {
  const items = useStorage(JSON.stringify({ cards: [], version: 2 }));
  const result = writeWords([entry("a", libro)]);
  assert.equal(result.ok, false);
  assert.match(!result.ok ? result.error : "", /Update the extension/);
  assert.equal(items.get("italian:inventory"), JSON.stringify({ cards: [], version: 2 }));
});

test("an inventory with data this version doesn't know is left alone", () => {
  useStorage();
  writeWords([entry("a", libro)]);
  const stored = JSON.parse(readStoredJson());
  stored.cards[0].addedFrom = "somewhere";
  const items = useStorage(JSON.stringify(stored));
  assert.equal(writeWords([entry("b", qui)]).ok, false);
  assert.equal(JSON.parse(items.get("italian:inventory")!).cards.length, 1);

  // Data it knows, in another key order, is fine.
  delete stored.cards[0].addedFrom;
  const { cards, ...rest } = stored;
  useStorage(JSON.stringify({ ...rest, cards }));
  assert.equal(writeWords([entry("b", qui)]).ok, true);
});

function readStoredJson() {
  return (globalThis as unknown as { window: { localStorage: { getItem(key: string): string } } }).window.localStorage.getItem("italian:inventory");
}
