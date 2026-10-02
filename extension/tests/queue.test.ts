import test from "node:test";
import assert from "node:assert/strict";
import type { LexiconReading } from "../../web/src/lexicon/lookup";
import { newQueuedWord, withChoice, withDeliveryResult, wordLabel, wordOptions, emptyQueue } from "../src/queue";
import { cleanSelection } from "../src/dictionary";

const cantante: LexiconReading[] = [
  { headword: { pos: "noun", word: "cantante", genders: ["m", "f"], number: "both", plurals: [{ form: "cantanti" }], glosses: ["singer"] }, via: null },
  {
    headword: { pos: "verb", word: "cantare", present: ["canto", "canti", "canta", "cantiamo", "cantate", "cantano"], participle: "cantato", auxiliaries: ["avere"], glosses: ["to sing"] },
    via: { pos: "verb", word: "cantante", of: "cantare", description: "present participle" },
  },
];

test("a queued word starts on the first reading with its first English", () => {
  const word = newQueuedWord({ id: "w", word: "cantante", readings: cantante, now: 1 });
  assert.equal(word.english, "singer");
  assert.equal(wordLabel(word), "cantante / cantanti, masculine noun");
  assert.deepEqual(wordOptions(word).map((option) => [option.reading, option.choice]), [[0, 0], [0, 1], [1, 0]]);
});

test("switching readings brings that reading's English", () => {
  const word = withChoice(newQueuedWord({ id: "w", word: "cantante", readings: cantante, now: 1 }), 1, 0);
  assert.equal(word.english, "to sing");
  assert.equal(wordLabel(word), "cantare, verb with avere (present participle)");
});

test("a delivery removes saved words and duplicates, and keeps failures with the reason", () => {
  const words = ["a", "b", "c", "d"].map((id) => newQueuedWord({ id, word: "cantante", readings: cantante, now: 1 }));
  const state = { ...emptyQueue, words };
  const delivered = words.slice(0, 3);
  const next = withDeliveryResult(state, delivered, {
    ok: true,
    added: ["a"],
    skipped: [{ id: "b", reason: "It's already in your words." }, { id: "c", reason: "No English." }],
  }, 5);
  assert.deepEqual(next.words.map((word) => [word.id, word.status, word.reason]), [["c", "failed", "No English."], ["d", "pending", undefined]]);
  assert.deepEqual(next.recent.map((word) => [word.id, word.outcome]), [["a", "added"], ["b", "skipped"]]);

  const refused = withDeliveryResult(state, delivered, { ok: false, error: "Nope." }, 5);
  assert.equal(refused.words.length, 4);
  assert.equal(refused.lastError, "Nope.");
});

test("selections lose surrounding punctuation", () => {
  assert.equal(cleanSelection("  «Libri», "), "Libri");
  assert.equal(cleanSelection("l’uovo."), "l’uovo");
  assert.equal(cleanSelection("perché?"), "perché");
});
