import {
  compareKeys,
  encodeRecords,
  englishSearchWords,
  isLexiconForm,
  type EnglishChunk,
  type LexiconChunk,
  type LexiconIndex,
  lexiconKey,
  type LexiconAdjective,
  type LexiconForm,
  type LexiconGender,
  type LexiconHeadword,
  type LexiconNoun,
  type LexiconPos,
  type LexiconRecord,
  type LexiconVerb,
} from "./format";

/** The parts of a kaikki.org (wiktextract) entry the lexicon reads. */
export type KaikkiEntry = {
  word: string;
  pos: string;
  head_templates?: { name: string; args?: Record<string, string> }[];
  forms?: { form: string; tags?: string[] }[];
  senses?: { glosses?: string[]; tags?: string[]; form_of?: { word: string }[]; alt_of?: { word: string }[] }[];
};

const kaikkiPos: Record<string, LexiconPos> = { noun: "noun", verb: "verb", adj: "adj", adv: "adv" };

/** Senses and forms carrying these tags aren't what a learner wants from a lookup. */
const noiseTags = new Set([
  "archaic", "obsolete", "dialectal", "literary", "poetic", "rare", "regional", "proscribed", "nonstandard",
  "dated", "uncommon", "Traditional", "misspelling", "error-unknown-tag",
]);
const noiseLabel = /\b(archaic|obsolete|dialectal|literary|poetic|rare|regional|proscribed|nonstandard|dated|uncommon)\b/i;

const maxGlosses = 5;

function isNoisy(tags: string[] | undefined) {
  return (tags ?? []).some((tag) => noiseTags.has(tag));
}

/** Wiktionary writes “-” for a form that doesn't exist. */
function usable(form: string | undefined) {
  return !form || /^[-—–]$/.test(form.trim()) ? "" : form;
}

function hasExactTags(tags: string[] | undefined, expected: string[]) {
  const actual = tags ?? [];
  return actual.length === expected.length && expected.every((tag) => actual.includes(tag));
}

/** Removes Wiktionary's stress marks (grave/acute on vowels); `keepFinal` keeps a word's last accent, which is usually spelled (città, può). */
export function stripStressMarks(text: string, keepFinal: boolean) {
  return text
    .normalize("NFC")
    .split(/(\s+)/)
    .map((token) => {
      const letters = Array.from(token.normalize("NFD"));
      let lastBase = letters.length - 1;
      while (lastBase > 0 && /\p{M}/u.test(letters[lastBase]!)) lastBase -= 1;
      return letters
        .filter((letter, index) => !(/[̀́]/.test(letter) && !(keepFinal && index > lastBase)))
        .join("")
        .normalize("NFC");
    })
    .join("");
}

/**
 * Shortens a Wiktionary gloss to what a learner would type: drops [bracketed notes] and
 * parenthetical explanations, but keeps a one-word parenthetical like “(oneself)”.
 * “white (bright and colourless/colorless)” → “white”.
 */
export function cleanGloss(gloss: string) {
  let text = gloss
    .replace(/\[[^\]]*\]/g, " ")
    // “Used as a copula. to be” → “to be”; “to have; See Category:…” → “to have”
    .replace(/^Used\b[^.]*\.\s+(?=to\s)/, "")
    .replace(/[;,]?\s*See Category:.*$/, "");
  let previous = "";
  while (previous !== text) {
    previous = text;
    text = text.replace(/\(([^()]*)\)/g, (whole, inner: string) => (/^[\p{L}'-]+$/u.test(inner.trim()) ? `\u0000${inner.trim()}\u0001` : " "));
  }
  return text
    .replace(/\u0000/g, "(")
    .replace(/\u0001/g, ")")
    .replace(/\s+([,;:.])/g, "$1")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[,;:]\s*/, "")
    .replace(/[\s,;:.]+$/, "");
}

/** Splits a template argument like `braccia<g:f><q:…>,bracci<g:m>` at the commas outside <…>. */
function templateItems(value: string | undefined) {
  if (!value) return [];
  const items: string[] = [];
  let depth = 0;
  let current = "";
  for (const character of value) {
    if (character === "<") depth += 1;
    if (character === ">") depth = Math.max(0, depth - 1);
    if (character === "," && depth === 0) {
      items.push(current);
      current = "";
    } else current += character;
  }
  items.push(current);
  return items
    .map((item) => {
      const cut = item.indexOf("<");
      const text = (cut === -1 ? item : item.slice(0, cut)).trim();
      const modifiers = cut === -1 ? "" : item.slice(cut);
      const gender = /<g:([mf])/.exec(modifiers)?.[1] as LexiconGender | undefined;
      return { text, gender, noisy: noiseLabel.test(modifiers.replace(/<ref:.*$/, "")) };
    })
    .filter((item) => item.text);
}

function lemmaName(word: string) {
  return word.replace(/\s+(m|f|mf|n|m-p|f-p|pl|p|m pl|f pl)$/, "").trim();
}

function headwordGlosses(entry: KaikkiEntry) {
  const glosses: string[] = [];
  for (const sense of entry.senses ?? []) {
    if (sense.form_of || sense.alt_of || isNoisy(sense.tags) || sense.tags?.includes("form-of") || sense.tags?.includes("alt-of")) continue;
    const gloss = cleanGloss(sense.glosses?.[0] ?? "");
    if (gloss && !glosses.includes(gloss)) glosses.push(gloss);
    if (glosses.length === maxGlosses) break;
  }
  return glosses;
}

function templateArgs(entry: KaikkiEntry, name: string) {
  const template = entry.head_templates?.find((item) => item.name === name);
  return template ? template.args ?? {} : null;
}

function nounHeadword(entry: KaikkiEntry, glosses: string[]): LexiconNoun | null {
  const args = templateArgs(entry, "it-noun");
  if (!args) return null;
  const genderSpecs = templateItems(args["1"]);
  const specs = genderSpecs.filter((item) => !item.noisy).length ? genderSpecs.filter((item) => !item.noisy) : genderSpecs;
  const genders = new Set<LexiconGender>();
  for (const spec of specs) {
    const base = spec.text.replace(/-p$/, "");
    if (base === "m" || base === "mf" || base === "mfbysense") genders.add("m");
    if (base === "f" || base === "mf" || base === "mfbysense") genders.add("f");
  }
  if (!genders.size) return null;
  const orderedGenders = (["m", "f"] as const).filter((gender) => genders.has(gender));
  if (specs.every((spec) => spec.text.endsWith("-p"))) {
    return { pos: "noun", word: entry.word, genders: orderedGenders, number: "plural", plurals: [], glosses };
  }

  const pluralItems = templateItems(args["2"]);
  if (pluralItems.length === 1 && pluralItems[0]!.text === "-") {
    return { pos: "noun", word: entry.word, genders: orderedGenders, number: "singular", plurals: [], glosses };
  }
  if (pluralItems.some((item) => item.text === "#")) {
    return { pos: "noun", word: entry.word, genders: orderedGenders, number: "both", plurals: [{ form: entry.word }], glosses };
  }

  const plurals: LexiconNoun["plurals"] = [];
  const add = (form: string, gender?: LexiconGender) => {
    if (!plurals.some((plural) => plural.form === form && plural.gender === gender)) plurals.push(gender ? { form, gender } : { form });
  };
  const defaults = () => {
    for (const form of entry.forms ?? []) {
      const tags = form.tags ?? [];
      if (!tags.includes("plural") || !tags.every((tag) => tag === "plural" || tag === "masculine" || tag === "feminine")) continue;
      const gender = tags.includes("feminine") ? "f" : tags.includes("masculine") ? "m" : undefined;
      // A plural of another gender belongs to the feminine or masculine counterpart (dio → dee).
      if (gender && !genders.has(gender)) continue;
      add(form.form, genders.size > 1 ? gender : undefined);
    }
  };
  const items = pluralItems.length ? pluralItems : [{ text: "+", gender: undefined, noisy: false }];
  for (const item of items) {
    if (item.noisy || item.text === "-" || item.text === "?" || item.text === "!") continue;
    if (/^[a-zà-ÿ'’ -]+$/i.test(item.text) && item.text !== "pl") add(item.text, item.gender);
    else defaults();
  }
  // Wiktionary's default plural isn't always listed; words ending in an accented vowel, a
  // consonant, or -i don't change (la pubblicità / le pubblicità, il notebook / i notebook).
  if (!plurals.length && items.some((item) => !item.noisy && /^[+~]$/.test(item.text)) && /([àèéìíòóù]|[^aeiou\s'’]|i)$/i.test(entry.word)) add(entry.word);
  return { pos: "noun", word: entry.word, genders: orderedGenders, number: "both", plurals, glosses };
}

const presentPersons = [
  ["first-person", "singular"],
  ["second-person", "singular"],
  ["third-person", "singular"],
  ["first-person", "plural"],
  ["second-person", "plural"],
  ["third-person", "plural"],
] as const;

function verbHeadword(entry: KaikkiEntry, glosses: string[]): LexiconVerb | null {
  const args = templateArgs(entry, "it-verb");
  if (!args) return null;
  const forms = entry.forms ?? [];
  const present = presentPersons.map(([person, number]) =>
    usable(forms.find((form) => hasExactTags(form.tags, [person, number, "present", "indicative"]))?.form),
  ) as LexiconVerb["present"];
  const participleForm = usable(forms.find((form) => hasExactTags(form.tags, ["participle", "past"]))?.form);
  // A reflexive verb's participle is listed with its pronoun (lavatosi); the card wants lavato.
  const participle = /si$/.test(entry.word) ? participleForm.replace(/si$/, "") : participleForm;
  const auxiliaries: LexiconVerb["auxiliaries"] = [];
  for (const form of forms) {
    if (!form.tags?.includes("auxiliary")) continue;
    const auxiliary = stripStressMarks(form.form, false);
    if ((auxiliary === "avere" || auxiliary === "essere") && !auxiliaries.includes(auxiliary)) auxiliaries.push(auxiliary);
  }
  if (!auxiliaries.length) {
    const spec = args["1"] ?? "";
    if (/^[aà]/.test(spec)) auxiliaries.push("avere");
    else if (/^e/.test(spec)) auxiliaries.push("essere");
  }
  return { pos: "verb", word: entry.word, present, participle, auxiliaries, glosses };
}

function adjectiveHeadword(entry: KaikkiEntry, glosses: string[]): LexiconAdjective | null {
  const args = templateArgs(entry, "it-adj");
  if (!args) return null;
  if (args.inv) return { pos: "adj", word: entry.word, forms: [entry.word, entry.word, entry.word], glosses };
  // Tables Wiktionary couldn't parse still tag their forms, with an extra error tag (bello).
  const forms = (entry.forms ?? []).map((form) => ({ ...form, tags: form.tags?.filter((tag) => tag !== "error-unrecognized-form") }));
  const find = (...tagSets: string[][]) => usable(forms.find((form) => tagSets.some((tags) => hasExactTags(form.tags, tags)))?.form);
  const plural = find(["plural"]);
  const masculinePlural = find(["masculine", "plural"]) || plural;
  const femininePlural = find(["feminine", "plural"]) || plural;
  // Two-ending adjectives (verde, belga) list no feminine singular: it's the masculine one.
  const feminineSingular = find(["feminine"], ["feminine", "singular"]) || (masculinePlural || femininePlural ? entry.word : "");
  return { pos: "adj", word: entry.word, forms: [feminineSingular, masculinePlural, femininePlural], glosses };
}

function formDescription(sense: NonNullable<KaikkiEntry["senses"]>[number]) {
  const gloss = sense.glosses?.[0] ?? "";
  // “inflection of abdicare:” is followed by the inflection as a second gloss.
  if (/^inflection of .*:$/.test(gloss) && sense.glosses?.[1]) return sense.glosses[1].trim();
  const match = /^(.*?)\s+of\s+\S/.exec(gloss);
  if (match) return match[1]!.trim();
  return (sense.tags ?? []).filter((tag) => tag !== "form-of" && tag !== "alt-of").join(" ");
}

/**
 * Collects headwords and forms from kaikki entries, then respells the forms Wiktionary writes
 * with stress marks (vàdo, andàto) the way Italian spells them (vado, andato) — keeping real
 * accents (dà, può) by checking which spelling Wiktionary itself files as a form of the word.
 */
export class LexiconBuilder {
  private titles = new Set<string>();
  private formsOf = new Map<string, Set<string>>();
  private headwords: LexiconHeadword[] = [];
  private forms: LexiconForm[] = [];

  add(entry: KaikkiEntry) {
    const senses = entry.senses ?? [];
    if (senses.some((sense) => !sense.tags?.includes("misspelling"))) this.titles.add(entry.word);
    const pos = kaikkiPos[entry.pos];
    if (!pos) return;

    for (const sense of senses) {
      const target = sense.form_of?.[0]?.word ?? sense.alt_of?.[0]?.word;
      if (!target || sense.tags?.includes("misspelling")) continue;
      const of = lemmaName(target);
      if (!of || of === entry.word) continue;
      this.forms.push({ pos, word: entry.word, of, description: formDescription(sense) });
      if (!this.formsOf.has(entry.word)) this.formsOf.set(entry.word, new Set());
      this.formsOf.get(entry.word)!.add(of);
    }

    const glosses = headwordGlosses(entry);
    if (!glosses.length) return;
    const headword =
      pos === "noun" ? nounHeadword(entry, glosses)
      : pos === "verb" ? verbHeadword(entry, glosses)
      : pos === "adj" ? adjectiveHeadword(entry, glosses)
      : { pos, word: entry.word, glosses };
    if (headword) this.headwords.push(headword);
  }

  /** How Italian spells a form Wiktionary wrote with stress marks. */
  respell(raw: string, headword: string) {
    if (!raw) return raw;
    const candidates = Array.from(new Set([raw.normalize("NFC"), stripStressMarks(raw, true), stripStressMarks(raw, false)]));
    return (
      candidates.find((candidate) => candidate === headword || this.formsOf.get(candidate)?.has(headword))
      ?? candidates.find((candidate) => this.titles.has(candidate))
      ?? stripStressMarks(raw, true)
    );
  }

  private respelled(headword: LexiconHeadword): LexiconHeadword {
    const respell = (form: string) => this.respell(form, headword.word);
    switch (headword.pos) {
      case "noun":
        return { ...headword, plurals: headword.plurals.map((plural) => ({ ...plural, form: respell(plural.form) })) };
      case "verb":
        return { ...headword, present: headword.present.map(respell) as LexiconVerb["present"], participle: respell(headword.participle) };
      case "adj":
        return { ...headword, forms: headword.forms.map(respell) as LexiconAdjective["forms"] };
      default:
        return headword;
    }
  }

  /** Every record grouped by key, keys sorted; forms of words the lexicon doesn't have are dropped. */
  finish(): [string, LexiconRecord[]][] {
    const byKey = new Map<string, LexiconRecord[]>();
    const file = (record: LexiconRecord) => {
      const key = lexiconKey(record.word);
      if (!key) return;
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key)!.push(record);
    };
    const headwordPos = new Set(this.headwords.map((headword) => `${headword.pos} ${headword.word}`));
    for (const headword of this.headwords) file(this.respelled(headword));
    const seen = new Set<string>();
    for (const form of this.forms) {
      const id = `${form.pos} ${form.word} ${form.of} ${form.description}`;
      if (seen.has(id) || !headwordPos.has(`${form.pos} ${form.of}`)) continue;
      seen.add(id);
      file(form);
    }
    return Array.from(byKey.entries()).sort(([left], [right]) => compareKeys(left, right));
  }
}

/**
 * Cuts sorted records into chunks of about `targetBytes` of JSON each, and the index listing
 * each chunk's first key. Form descriptions are numbered in the index (see StoredForm).
 */
/**
 * The English index: each English word in a headword's first three glosses points back at the
 * headword. Headwords rank by how well the word describes them: a gloss that's just the word
 * (“book”, “to book”) first, then earlier glosses before later ones, then shorter glosses, then
 * words with more senses, then shorter words.
 */
export function englishIndex(keyed: [string, LexiconRecord[]][], perWord = 40): [string, string[]][] {
  const byWord = new Map<string, { ref: string; score: number }[]>();
  for (const [, records] of keyed) {
    for (const record of records) {
      if (isLexiconForm(record)) continue;
      const ref = `${record.pos}:${record.word}`;
      record.glosses.slice(0, 3).forEach((gloss, position) => {
        const words = englishSearchWords(gloss);
        for (const word of words) {
          // Ties go to words with more senses, then shorter ones: rough signs of a common word.
          const score = (words.length === 1 ? 0 : 10_000) + position * 1000 + Math.min(words.length, 9) * 100
            + (5 - Math.min(record.glosses.length, 5)) * 10 + Math.min(record.word.length, 9);
          if (!byWord.has(word)) byWord.set(word, []);
          const refs = byWord.get(word)!;
          const existing = refs.find((item) => item.ref === ref);
          if (existing) existing.score = Math.min(existing.score, score);
          else refs.push({ ref, score });
        }
      });
    }
  }
  return Array.from(byWord.entries())
    .map(([word, refs]): [string, string[]] => [word, refs.sort((left, right) => left.score - right.score).slice(0, perWord).map((item) => item.ref)])
    .sort(([left], [right]) => compareKeys(left, right));
}

/** Cuts the English index into chunks like the Italian ones. */
export function englishChunks(index: [string, string[]][], targetBytes: number): { firstKeys: string[]; chunks: EnglishChunk[] } {
  const chunks: { first: string; entries: EnglishChunk; bytes: number }[] = [];
  for (const [word, refs] of index) {
    const bytes = JSON.stringify(word).length + JSON.stringify(refs).length + 2;
    let current = chunks.at(-1);
    if (!current || current.bytes + bytes > targetBytes) {
      current = { first: word, entries: {}, bytes: 2 };
      chunks.push(current);
    }
    current.entries[word] = refs;
    current.bytes += bytes;
  }
  return { firstKeys: chunks.map((chunk) => chunk.first), chunks: chunks.map((chunk) => chunk.entries) };
}

export function lexiconChunks(keyed: [string, LexiconRecord[]][], targetBytes: number, source: string): { index: Omit<LexiconIndex, "build" | "englishChunks">; chunks: LexiconChunk[] } {
  const descriptions: string[] = [];
  const descriptionIds = new Map<string, number>();
  const descriptionId = (text: string) => {
    if (!descriptionIds.has(text)) {
      descriptionIds.set(text, descriptions.length);
      descriptions.push(text);
    }
    return descriptionIds.get(text)!;
  };
  const chunks: { first: string; entries: LexiconChunk; bytes: number }[] = [];
  for (const [key, records] of keyed) {
    const stored = encodeRecords(key, records, descriptionId);
    const bytes = JSON.stringify(key).length + JSON.stringify(stored).length + 2;
    let current = chunks.at(-1);
    if (!current || current.bytes + bytes > targetBytes) {
      current = { first: key, entries: {}, bytes: 2 };
      chunks.push(current);
    }
    current.entries[key] = stored;
    current.bytes += bytes;
  }
  return { index: { source, chunks: chunks.map((chunk) => chunk.first), descriptions }, chunks: chunks.map((chunk) => chunk.entries) };
}
