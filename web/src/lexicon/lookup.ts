import {
  chunkFileName,
  chunkIndexForKey,
  decodeRecords,
  englishChunkFileName,
  englishSearchWords,
  isLexiconForm,
  lexiconKey,
  type EnglishChunk,
  type LexiconChunk,
  type LexiconForm,
  type LexiconHeadword,
  type LexiconIndex,
  type LexiconRecord,
} from "./format";

/** Where the lexicon's files come from: fetched from the site, or read from disk in tests. */
export type LexiconSource = {
  index(): Promise<LexiconIndex>;
  /** A chunk file: a LexiconChunk, or an EnglishChunk for en-NNNN.json. */
  chunk(build: string, file: string): Promise<unknown>;
};

/** Fetches the lexicon published beside the app, e.g. `lexicon/` relative to the page. */
export function fetchedLexiconSource(baseUrl: string): LexiconSource {
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const json = async (url: string) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`The dictionary couldn't be loaded (${response.status}).`);
    return response.json();
  };
  return {
    index: () => json(`${base}index.json`),
    chunk: (build, file) => json(`${base}${build}/${file}`),
  };
}

/** One way to read a looked-up word: a dictionary word, reached directly or through one of its forms. */
export type LexiconReading = {
  headword: LexiconHeadword;
  /** How the looked-up word relates to the headword, when it's a form of it (“libri” → plural of “libro”). */
  via: LexiconForm | null;
};

/** Headwords defined only by another word (“female equivalent of citto”) rank below other spellings’ real words. */
const derivedGloss = /^(female equivalent|synonym|diminutive|augmentative|pejorative|alternative form|obsolete form) of /i;

function sameSpelling(left: string, right: string) {
  return left.normalize("NFC").toLocaleLowerCase("it-IT") === right.normalize("NFC").toLocaleLowerCase("it-IT");
}

/**
 * Looks words up, loading each chunk once. Readings come best first: spelled exactly as typed
 * before spelled with other accents, dictionary words before inflected forms, alternative
 * spellings after those, and words defined only by another word last.
 */
export class Lexicon {
  private indexPromise: Promise<LexiconIndex> | null = null;
  private chunks = new Map<string, Promise<unknown>>();

  constructor(private source: LexiconSource) {}

  private index() {
    this.indexPromise ??= this.source.index().catch((error) => {
      this.indexPromise = null;
      throw error;
    });
    return this.indexPromise;
  }

  private chunk<Chunk>(build: string, file: string) {
    let chunk = this.chunks.get(file);
    if (!chunk) {
      chunk = this.source.chunk(build, file);
      this.chunks.set(file, chunk);
      chunk.catch(() => this.chunks.delete(file));
    }
    return chunk as Promise<Chunk>;
  }

  /** Every record filed under the word's key, whatever its accents. */
  async records(word: string): Promise<LexiconRecord[]> {
    const key = lexiconKey(word);
    if (!key) return [];
    const index = await this.index();
    const chunk = await this.chunk<LexiconChunk>(index.build, chunkFileName(chunkIndexForKey(index.chunks, key)));
    const stored = chunk[key];
    return stored ? decodeRecords(key, stored, index.descriptions) : [];
  }

  /** Headwords whose glosses use an English word, best first, as "pos:word". */
  async englishRefs(word: string): Promise<string[]> {
    const key = lexiconKey(word);
    const index = await this.index();
    if (!key || !index.englishChunks?.length) return [];
    const chunk = await this.chunk<EnglishChunk>(index.build, englishChunkFileName(chunkIndexForKey(index.englishChunks, key)));
    return chunk[key] ?? [];
  }

  /**
   * Italian headwords for an English word or phrase. With several words, headwords whose
   * glosses use all of them come first.
   */
  async searchEnglish(query: string, limit = 8): Promise<LexiconReading[]> {
    const words = englishSearchWords(query);
    if (!words.length) return [];
    const lists = await Promise.all(words.map((word) => this.englishRefs(word)));
    const scores = new Map<string, number>();
    lists.forEach((refs) => refs.forEach((ref, position) => scores.set(ref, (scores.get(ref) ?? 0) + position)));
    for (const [ref, score] of scores) {
      const missing = lists.filter((refs) => !refs.includes(ref)).length;
      scores.set(ref, score + missing * 1000);
    }
    const ranked = Array.from(scores.entries()).sort((left, right) => left[1] - right[1]).slice(0, limit).map(([ref]) => ref);
    const readings: LexiconReading[] = [];
    for (const ref of ranked) {
      const colon = ref.indexOf(":");
      const pos = ref.slice(0, colon);
      const word = ref.slice(colon + 1);
      for (const record of await this.records(word)) {
        if (!isLexiconForm(record) && record.pos === pos && record.word === word) readings.push({ headword: record, via: null });
      }
    }
    return readings.slice(0, limit);
  }

  async lookup(word: string): Promise<LexiconReading[]> {
    const query = word.normalize("NFC").trim();
    const records = await this.records(query);
    const rank = (record: LexiconRecord) =>
      (sameSpelling(record.word, query) ? 0 : 3)
      + (!isLexiconForm(record) ? (record.glosses.every((gloss) => derivedGloss.test(gloss)) ? 4 : 0) : /^alternative/.test(record.description) ? 2 : 1);
    const ordered = records.map((record, order) => ({ record, order })).sort((left, right) => rank(left.record) - rank(right.record) || left.order - right.order);

    const readings: LexiconReading[] = [];
    const add = (headword: LexiconHeadword, via: LexiconForm | null) => {
      const id = JSON.stringify(headword);
      if (!readings.some((reading) => JSON.stringify(reading.headword) === id)) readings.push({ headword, via });
    };
    const headwordsOf = new Map<string, Promise<LexiconRecord[]>>();
    for (const { record } of ordered) {
      if (!isLexiconForm(record)) {
        add(record, null);
        continue;
      }
      const key = lexiconKey(record.of);
      if (!headwordsOf.has(key)) headwordsOf.set(key, this.records(record.of));
      for (const candidate of await headwordsOf.get(key)!) {
        if (!isLexiconForm(candidate) && candidate.pos === record.pos && candidate.word === record.of) add(candidate, record);
      }
    }
    return readings;
  }
}
