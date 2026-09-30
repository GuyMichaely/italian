/**
 * The dictionary the app looks words up in, built from Wiktionary by scripts/build-lexicon.cjs
 * and published as static files beside the app (public/lexicon/). See docs/LEXICON.md.
 *
 * Every word is filed under its key (lower case, accents and apostrophe styles folded), so a
 * lookup finds “città” from “citta”. A key holds dictionary words spelled that way and the
 * inflected forms spelled that way, each pointing at the dictionary word it inflects.
 */

export type LexiconGender = "m" | "f";

export type LexiconNoun = {
  pos: "noun";
  word: string;
  /** Both for nouns that take either gender (il/la cantante). */
  genders: LexiconGender[];
  /** "plural" nouns (forbici) are filed under their plural; "singular" nouns have no plural. */
  number: "both" | "singular" | "plural";
  /** In Wiktionary's order; `gender` only where the plural's gender is stated (le uova, le braccia). Empty when unknown. */
  plurals: { form: string; gender?: LexiconGender }[];
  glosses: string[];
};

export type LexiconVerb = {
  pos: "verb";
  word: string;
  /** Present indicative io, tu, lui/lei, noi, voi, loro; "" where Wiktionary has none. */
  present: [string, string, string, string, string, string];
  participle: string;
  /** Usually one; both for verbs like dovere whose auxiliary depends on the sentence. */
  auxiliaries: ("avere" | "essere")[];
  glosses: string[];
};

export type LexiconAdjective = {
  pos: "adj";
  word: string;
  /** Feminine singular, masculine plural, feminine plural; "" where Wiktionary has none. */
  forms: [string, string, string];
  glosses: string[];
};

export type LexiconAdverb = {
  pos: "adv";
  word: string;
  glosses: string[];
};

export type LexiconHeadword = LexiconNoun | LexiconVerb | LexiconAdjective | LexiconAdverb;

export type LexiconPos = LexiconHeadword["pos"];

/** An inflected or alternative spelling: “vado” is the first-person singular present indicative of “andare”. */
export type LexiconForm = {
  pos: LexiconPos;
  word: string;
  of: string;
  /** Wiktionary's description without “of …”, e.g. “plural” or “first-person singular present indicative”. */
  description: string;
};

export type LexiconRecord = LexiconHeadword | LexiconForm;

/**
 * How a chunk file stores records, to keep the files small: a headword omits `word` when it's
 * spelled like its key, and a form is `[of, description, word?]`, where `description` indexes
 * the index file's `descriptions` (“verb:past participle”).
 */
export type StoredHeadword = Omit<LexiconHeadword, "word"> & { word?: string };
export type StoredForm = [of: string, description: number] | [of: string, description: number, word: string];
export type StoredRecord = StoredHeadword | StoredForm;

/** One chunk file: consecutive keys in sorted order. */
export type LexiconChunk = Record<string, StoredRecord[]>;

/** public/lexicon/index.json: each chunk's first key, so a key's chunk is found by binary search. */
export type LexiconIndex = {
  build: string;
  source: string;
  chunks: string[];
  descriptions: string[];
};

export function isLexiconForm(record: LexiconRecord): record is LexiconForm {
  return "of" in record;
}

/** The key a word is filed under: lower case, without accents, with ’ written as '. */
export function lexiconKey(word: string) {
  return word.normalize("NFD").replace(/\p{M}/gu, "").replace(/[’‘`´]/g, "'").toLowerCase().trim().replace(/\s+/g, " ");
}

/** Keys compare by UTF-16 code units, the same in the build script and the browser. */
export function compareKeys(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** The chunk holding `key`: the last chunk whose first key is not after it. */
export function chunkIndexForKey(chunks: string[], key: string) {
  let low = 0;
  let high = chunks.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (compareKeys(chunks[middle]!, key) <= 0) low = middle;
    else high = middle - 1;
  }
  return low;
}

export function chunkFileName(index: number) {
  return `${String(index).padStart(4, "0")}.json`;
}

export function encodeRecords(key: string, records: LexiconRecord[], descriptionId: (text: string) => number): StoredRecord[] {
  return records.map((record) => {
    if (isLexiconForm(record)) {
      const description = descriptionId(`${record.pos}:${record.description}`);
      return record.word === key ? [record.of, description] : [record.of, description, record.word];
    }
    if (record.word !== key) return record;
    const { word: _word, ...stored } = record;
    return stored;
  });
}

export function decodeRecords(key: string, stored: StoredRecord[], descriptions: string[]): LexiconRecord[] {
  return stored.map((record) => {
    if (Array.isArray(record)) {
      const [of, id, word] = record;
      const description = descriptions[id] ?? "";
      const colon = description.indexOf(":");
      return { pos: description.slice(0, colon) as LexiconPos, word: word ?? key, of, description: description.slice(colon + 1) };
    }
    return { ...record, word: record.word ?? key } as LexiconHeadword;
  });
}
