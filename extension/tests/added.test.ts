import test from "node:test";
import assert from "node:assert/strict";
import type { Flashcard } from "../../web/src/cards/types";
import type { LexiconReading } from "../../web/src/lexicon/lookup";
import { newAddedWord, noWords, pendingOps, withChoice, withEnglish, withRemoval, withWriteResult, wordLabel, wordOptions, wordView, type AddedWords } from "../src/added";
import { cleanSelection } from "../src/dictionary";

const cantante: LexiconReading[] = [
  { headword: { pos: "noun", word: "cantante", genders: ["m", "f"], number: "both", plurals: [{ form: "cantanti" }], glosses: ["singer"] }, via: null },
  {
    headword: { pos: "verb", word: "cantare", present: ["canto", "canti", "canta", "cantiamo", "cantate", "cantano"], participle: "cantato", auxiliaries: ["avere"], glosses: ["to sing"] },
    via: { pos: "verb", word: "cantante", of: "cantare", description: "present participle" },
  },
];

const word = (id = "w") => newAddedWord({ id, cardId: 2 ** 40, word: "cantante", readings: cantante, now: 1 });
const card = (english: string) => ({ id: 2 ** 40, english }) as Flashcard;
const state = (...words: ReturnType<typeof word>[]): AddedWords => ({ ...noWords, words });

/** Saves whatever is pending, with `card` as each stored card. */
function save(current: AddedWords, outcome: "saved" | "skipped" | "removed" | "detached" = "saved", english = "singer") {
  const pending = pendingOps(current);
  const results = pending.map(({ op }) => outcome === "saved" ? { id: op.id, outcome, card: card(english) } : outcome === "removed" ? { id: op.id, outcome } : { id: op.id, outcome, reason: "Because." });
  return { pending, next: withWriteResult(current, pending, { ok: true, results }) };
}

test("a new word starts on the first reading with its first English", () => {
  const added = word();
  assert.equal(added.english, "singer");
  assert.equal(wordLabel(added), "cantante / cantanti, masculine noun");
  assert.deepEqual(wordOptions(added).map((option) => [option.reading, option.choice]), [[0, 0], [0, 1], [1, 0]]);
});

test("switching readings brings that reading's English", () => {
  const switched = withChoice(word(), 1, 0);
  assert.equal(switched.english, "to sing");
  assert.equal(wordLabel(switched), "cantare, verb with avere (present participle)");
});

test("a new word is added, then changed and removed by the card it was saved as", () => {
  const first = save(state(word()));
  assert.equal(first.pending[0]!.op.kind, "add");
  const saved = first.next.words[0]!;
  assert.deepEqual([saved.status, saved.saved?.card.english], ["saved", "singer"]);
  assert.equal(wordView(saved).note, "Saved to your words.");
  assert.deepEqual(pendingOps(first.next), []);

  const changed = save(state(withEnglish(saved, "vocalist")), "saved", "vocalist");
  assert.deepEqual(changed.pending.map(({ op }) => [op.kind, op.kind !== "add" && op.card.english]), [["change", "singer"]]);
  assert.equal(changed.next.words[0]!.saved?.english, "vocalist");

  const removed = save(state(withRemoval(changed.next.words[0]!)), "removed");
  assert.deepEqual(removed.pending.map(({ op }) => op.kind), ["remove"]);
  assert.deepEqual(removed.next.words, []);
});

test("a word changed while it was saving stays pending, knowing what's stored", () => {
  const added = state(word());
  const pending = pendingOps(added);
  const meanwhile = state(withChoice(added.words[0]!, 0, 1));
  const next = withWriteResult(meanwhile, pending, { ok: true, results: [{ id: "w", outcome: "saved", card: card("singer") }] });
  const [after] = next.words;
  assert.deepEqual([after!.status, after!.choice, after!.saved?.choice], ["pending", 1, 0]);
  assert.equal(pendingOps(next)[0]!.op.kind, "change");
});

test("a change that can't be made goes back to what's stored; a word that can't be added is marked", () => {
  const saved = save(state(word())).next.words[0]!;
  const reverted = save(state(withChoice(saved, 1, 0)), "skipped").next.words[0]!;
  assert.deepEqual([reverted.status, reverted.reading, reverted.english], ["saved", 0, "singer"]);
  assert.match(wordView(reverted).note!, /^Not changed/);

  const failed = save(state(word()), "skipped").next.words[0]!;
  assert.deepEqual([failed.status, failed.reason], ["failed", "Because."]);
  assert.equal(wordView(failed).undo, "Dismiss");
  assert.equal(wordView(failed).tone, "error");
});

test("a word edited in the app can't be changed from the extension any more", () => {
  const saved = save(state(word())).next.words[0]!;
  const detached = save(state(withEnglish(saved, "vocalist")), "detached").next.words[0]!;
  assert.equal(detached.status, "detached");
  const view = wordView(detached);
  assert.deepEqual([view.undo, view.meanings, view.options], [null, [], []]);
});

test("a failed save keeps everything pending and says why", () => {
  const added = state(word());
  const next = withWriteResult(added, pendingOps(added), { ok: false, error: "Nope." });
  assert.deepEqual([next.words[0]!.status, next.lastError], ["pending", "Nope."]);
  assert.deepEqual([wordView(next.words[0]!, next.lastError).note, wordView(next.words[0]!, next.lastError).tone], ["Nope.", "error"]);
});

test("selections lose surrounding punctuation", () => {
  assert.equal(cleanSelection("  «Libri», "), "Libri");
  assert.equal(cleanSelection("l’uovo."), "l’uovo");
  assert.equal(cleanSelection("perché?"), "perché");
});
