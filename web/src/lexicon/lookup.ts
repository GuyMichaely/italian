import {
  chunkFileName,
  chunkIndexForKey,
  decodeRecords,
  isLexiconForm,
  lexiconKey,
  type LexiconChunk,
  type LexiconForm,
  type LexiconHeadword,
  type LexiconIndex,
  type LexiconRecord,
} from "./format";

/** Where the lexicon's files come from: fetched from the site, or read from disk in tests. */
export type LexiconSource = {
  index(): Promise<LexiconIndex>;
  chunk(build: string, file: string): Promise<LexiconChunk>;
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
  private chunks = new Map<number, Promise<LexiconChunk>>();

  constructor(private source: LexiconSource) {}

  private index() {
    this.indexPromise ??= this.source.index().catch((error) => {
      this.indexPromise = null;
      throw error;
    });
    return this.indexPromise;
  }

  /** Every record filed under the word's key, whatever its accents. */
  async records(word: string): Promise<LexiconRecord[]> {
    const key = lexiconKey(word);
    if (!key) return [];
    const index = await this.index();
    const number = chunkIndexForKey(index.chunks, key);
    let chunk = this.chunks.get(number);
    if (!chunk) {
      chunk = this.source.chunk(index.build, chunkFileName(number));
      this.chunks.set(number, chunk);
      chunk.catch(() => this.chunks.delete(number));
    }
    const stored = (await chunk)[key];
    return stored ? decodeRecords(key, stored, index.descriptions) : [];
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
