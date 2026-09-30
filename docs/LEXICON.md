# Lexicon

The lexicon is a dictionary of Italian nouns, verbs, adjectives, and adverbs that the app looks words up in to fill in their forms. It is built from English Wiktionary and published as static files beside the app. There is no server.

## Files

`web/public/lexicon/` holds:

- `index.json`: the build id, each chunk's first key, and the table of form descriptions;
- `<build>/NNNN.json`: about 930 chunks of about 30 KB each (about 6 KB compressed);
- `ATTRIBUTION.txt`: the license notice.

Every word is filed under a key, which is the word in lower case, without accents, and with ’ written as '. A key's records are the dictionary words spelled that way and the inflected forms spelled that way. The keys are sorted and cut into chunks of about equal size, so a lookup takes a binary search of `index.json` and one fetch. Chunks sit in a folder named for their contents, so a cached index never pairs with newer chunks.

`src/lexicon/format.ts` defines the records.

A **headword** (dictionary word) carries what the app needs:

| Part of speech | Fields |
|---|---|
| Noun | genders, number (both, singular only, or plural only), plurals (each with a gender when it's stated), glosses |
| Verb | present indicative, past participle, auxiliaries, glosses |
| Adjective | feminine singular, masculine plural, feminine plural, glosses |
| Adverb | glosses |

A **form** points at its headword: “vado” is the “first-person singular present indicative” of “andare”.

## Lookup

`src/lexicon/lookup.ts` loads chunks once each and returns **readings**. A reading is a headword, reached either directly or through one of its forms. Readings come best first:

1. spelled exactly as typed, before spelled with other accents;
2. headwords, then inflected forms, then alternative spellings;
3. headwords defined only by another word (“female equivalent of citto”) last.

`src/lexicon/suggestions.ts` turns a reading into the fields that Add words and the Words grid edit. This step uses the learner's own morphology:

- A noun keeps Auto when one of the learner's rules makes its forms. Otherwise it's Irregular, since the forms come from the dictionary.
- A noun of either gender, or with two plurals (braccia / bracci), gives one suggestion for each.
- A verb whose auxiliary depends on the sentence gives one suggestion for each auxiliary.
- The first gloss fills the English field, and the others are offered as alternatives.

A suggestion carries a `review` note when the learner should check it: a different gender, either auxiliary, an Irregular fallback, or missing forms.

## In the app

When “Fill in words from the dictionary” is on, the app looks up a word when you leave its headword field. It's a per-device setting under Settings → Dictionary, and it's on by default. The headword field is the singular for nouns, the infinitive for verbs, the masculine singular for adjectives, and the adverb itself. This works in Add words and in the Words grid's new rows.

- **What gets filled in.** The first suggestion for the tab's part of speech fills the row. Other fields are filled only while they're untouched: blank, suggested by the rules, or still holding what the dictionary filled in for the previous word. English is kept if you typed it. A form fills in its dictionary word, so libri becomes libro / libri.
- **The note under the row.** It says what was filled in and whether to check it. It also offers the other meanings for the English field and the other readings to switch to. If the row wasn't filled because you'd typed other fields, it offers to fill it.

`src/lexicon/rows.ts` decides whether a row can be filled and how. `src/lexicon/useDictionary.ts` holds the setting and the lookups, and `components/DictionaryNoteRow.tsx` draws the note.

## Building

```sh
cd web
npm run lexicon -- path/to/kaikki.org-dictionary-Italian.jsonl.gz
```

The input is kaikki.org's extract of English Wiktionary's Italian entries: https://kaikki.org/dictionary/Italian/kaikki.org-dictionary-Italian.jsonl.gz (about 76 MB). Don't use `downloads/it/…`, which is Italian Wiktionary with Italian glosses.

The build replaces `web/public/lexicon/`. It takes about 90 seconds. `src/lexicon/extract.ts` does the reading:

- It keeps nouns, verbs, adjectives, and adverbs.
- It drops archaic, obsolete, dialectal, literary, rare, and misspelled senses and forms.
- It shortens glosses: “white (bright and colourless/colorless)” becomes “white”.
- It respells forms that Wiktionary writes with stress marks (vàdo, andàto) the way Italian spells them (vado, andato). It keeps a real accent (dà, può, città) when Wiktionary files that spelling as a form of the word.
- It drops a form whose headword isn't in the lexicon.

`scripts/fixtures/lexicon-sample.jsonl` holds real entries, trimmed to the fields the lexicon reads, for the words `scripts/lexicon-tests.cjs` checks.

## License

Wiktionary's text is licensed CC BY-SA 4.0, and so is the lexicon. The app credits Wiktionary under Settings → Dictionary, and each note links to the word's Wiktionary page.
