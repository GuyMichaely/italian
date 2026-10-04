import test from "node:test";
import assert from "node:assert/strict";
import type { LexiconHeadword } from "../../web/src/lexicon/format";
import { defaultNounMorphology } from "../../web/src/cards/nounMorphology";
import { defaultAdjectiveMorphology } from "../../web/src/cards/adjectiveMorphology";
import { readLocalSnapshot } from "../../web/src/storage/browser";
import { applyOps, writeChanges, type WordEntry, type WriteOp } from "../src/words";
import type { Flashcard } from "../../web/src/cards/types";

function entry(headword: unknown, overrides: Partial<WordEntry> = {}): WordEntry {
  const word = (headword as { word?: string }).word ?? "";
  return { word, reading: { headword: headword as LexiconHeadword, via: null }, choice: 0, english: "", ...overrides };
}

let nextId = 2 ** 40;
const add = (id: string, headword: unknown, overrides: Partial<WordEntry> = {}): WriteOp => ({ kind: "add", id, cardId: nextId++, entry: entry(headword, overrides) });

const libro = { pos: "noun", word: "libro", genders: ["m"], number: "both", plurals: [{ form: "libri" }], glosses: ["book", "phloem; foliage"] };
const uomo = { pos: "noun", word: "uomo", genders: ["m"], number: "both", plurals: [{ form: "uomini" }], glosses: ["man"] };
const cantante = { pos: "noun", word: "cantante", genders: ["m", "f"], number: "both", plurals: [{ form: "cantanti" }], glosses: ["singer"] };
const capire = { pos: "verb", word: "capire", present: ["capisco", "capisci", "capisce", "capiamo", "capite", "capiscono"], participle: "capito", auxiliaries: ["avere"], glosses: ["to understand"] };
const qui = { pos: "adv", word: "qui", glosses: ["here"] };

const apply = (ops: WriteOp[], existing: Flashcard[] = []) => applyOps(ops, existing, defaultNounMorphology, defaultAdjectiveMorphology);
const savedCard = (result: ReturnType<typeof apply>, id: string) => {
  const outcome = result.results.find((item) => item.id === id);
  assert.equal(outcome?.outcome, "saved", JSON.stringify(outcome));
  return (outcome as { card: Flashcard }).card;
};

test("words become cards with the learner's rules, the extension tag, and the id they were given", () => {
  const ops = [add("a", libro), add("b", capire), add("c", qui, { english: "right here" })];
  const result = apply(ops);
  assert.deepEqual(result.results.map((item) => item.outcome), ["saved", "saved", "saved"]);
  const [book, understand, here] = result.cards as any[];
  assert.deepEqual(book.details.declension, { kind: "rule", rule: "-o → -i", base: "libr" });
  assert.equal(book.english, "book");
  assert.deepEqual(book.tags, ["from-extension"]);
  assert.deepEqual([understand.italian, understand.details.io, understand.details.auxiliary], ["capire", "capisco", "avere"]);
  assert.deepEqual([here.italian, here.english], ["qui", "right here"]);
  assert.deepEqual(result.cards.map((card) => card.id), ops.map((op) => op.kind === "add" && op.cardId));
});

test("words to check get the review tag, and the chosen reading is used", () => {
  const [man, singer] = apply([add("u", uomo), add("c", cantante, { choice: 1 })]).cards as any[];
  assert.deepEqual(man.details.declension, { kind: "irregular", singular: "uomo", plural: "uomini" });
  assert.deepEqual(man.tags, ["from-extension", "needs-review"]);
  assert.equal(singer.details.gender, "feminine");
});

test("words already in the inventory or unreadable are skipped, not fatal; one added twice is added once", () => {
  const first = add("a", libro);
  const existing = apply([first]).cards;
  const result = apply([add("again", libro), add("broken", { pos: "noun" }), add("ok", qui), first], existing);
  assert.equal(result.cards.length, 2);
  assert.deepEqual(result.results.map((item) => [item.id, item.outcome]), [["again", "skipped"], ["broken", "skipped"], ["ok", "saved"], ["a", "saved"]]);
  assert.match((result.results[0] as { reason: string }).reason, /already/);
});

test("a change rebuilds the card under the same id; a removal deletes it", () => {
  const added = apply([add("s", cantante)]);
  const singer = savedCard(added, "s");
  const changed = apply([{ kind: "change", id: "s", card: singer, entry: entry(cantante, { choice: 1, english: "female singer" }) }], added.cards);
  const feminine = savedCard(changed, "s") as any;
  assert.deepEqual([feminine.id, feminine.english, feminine.details.gender], [singer.id, "female singer", "feminine"]);
  assert.equal(changed.cards.length, 1);

  const removed = apply([{ kind: "remove", id: "s", card: feminine }], changed.cards);
  assert.deepEqual(removed.results, [{ id: "s", outcome: "removed" }]);
  assert.deepEqual(removed.cards, []);
});

test("a card changed or deleted in the app is left alone", () => {
  const added = apply([add("q", qui)]);
  const here = savedCard(added, "q");
  const edited = added.cards.map((card) => ({ ...card, english: "right here" }));
  for (const op of [{ kind: "change", id: "q", card: here, entry: entry(qui, { english: "here!" }) }, { kind: "remove", id: "q", card: here }] as WriteOp[]) {
    const result = apply([op], edited);
    assert.equal(result.results[0]!.outcome, "detached");
    assert.deepEqual(result.cards, edited);
  }
  assert.equal(apply([{ kind: "change", id: "q", card: here, entry: entry(qui) }], []).results[0]!.outcome, "detached");
  assert.equal(apply([{ kind: "remove", id: "q", card: here }], []).results[0]!.outcome, "removed");
});

test("a change into a word already there is skipped", () => {
  const added = apply([add("a", libro), add("q", qui)]);
  const here = savedCard(added, "q");
  const result = apply([{ kind: "change", id: "q", card: here, entry: entry(libro) }], added.cards);
  assert.equal(result.results[0]!.outcome, "skipped");
  assert.deepEqual(result.cards, added.cards);
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

test("writing makes the changes in the stored inventory and stamps it", () => {
  useStorage();
  assert.deepEqual(writeChanges([add("a", libro)]).ok, true);
  const second = writeChanges([add("b", qui), add("again", libro)]);
  assert.deepEqual(second.ok && second.results.map((item) => item.outcome), ["saved", "skipped"]);
  const stored = readLocalSnapshot();
  assert.deepEqual(stored.cards.map((card) => card.english), ["here", "book"]);
  assert.ok(stored.updatedAt);
});

test("an inventory stored in a shape it doesn't know is left alone", () => {
  const items = useStorage(JSON.stringify({ cards: [], version: 2 }));
  const result = writeChanges([add("a", libro)]);
  assert.equal(result.ok, false);
  assert.match(!result.ok ? result.error : "", /Update the extension/);
  assert.equal(items.get("italian:inventory"), JSON.stringify({ cards: [], version: 2 }));
});

test("an inventory with data this version doesn't know is left alone", () => {
  useStorage();
  writeChanges([add("a", libro)]);
  const stored = JSON.parse(readStoredJson());
  stored.cards[0].addedFrom = "somewhere";
  const items = useStorage(JSON.stringify(stored));
  assert.equal(writeChanges([add("b", qui)]).ok, false);
  assert.equal(JSON.parse(items.get("italian:inventory")!).cards.length, 1);

  // Data it knows, in another key order, is fine.
  delete stored.cards[0].addedFrom;
  const { cards, ...rest } = stored;
  useStorage(JSON.stringify({ ...rest, cards }));
  assert.equal(writeChanges([add("b", qui)]).ok, true);
});

function readStoredJson() {
  return (globalThis as unknown as { window: { localStorage: { getItem(key: string): string } } }).window.localStorage.getItem("italian:inventory");
}
