# Architecture

Italian consists of a static React frontend and an optional sync server (`../sync/`, a Cloudflare Worker). Extension work is separate from the web app.

```text
Italian web (React + Vite)
    |
    +--> local inventory (localStorage)
    |
    +--> sync server, when signed in (merged three ways on the device)
```

## Web

The frontend is a static Vite application. React manages the interactive UI; Vite and TypeScript are build-time tools. The production output is ordinary HTML, CSS, and JavaScript in `dist/`.

The build uses relative asset URLs so the same output can be served from `/`, `/italian/`, or another static path.

The main source boundaries are:

```text
src/
├── App.tsx                         application state, inventory saves, study session
├── app/useHashRoute.ts             hash routes: #/study, #/words, #/grammar, #/settings
├── cardTypes.ts                   shared card-type labels and ordering
├── cards/
│   ├── types.ts                   discriminated Flashcard union and typed detail schemas
│   ├── ids.ts                     random ids for new cards
│   ├── editorModel.ts             batch-entry rows, drafts, and card construction
│   ├── batchRows.ts               spare-row, suggestion, and "is this row used" helpers shared by Add words and the grid
│   ├── nounDraft.ts               the one noun-entry model: surface forms → rule, base, articles
│   ├── nounMorphology.ts          declension rules, article table, generation, plural prediction
│   ├── adjectiveDraft.ts          the adjective-entry model: four forms → rule and base
│   └── adjectiveMorphology.ts     adjective rules, generation, prediction
├── lexicon/                       Wiktionary dictionary lookups (docs/LEXICON.md)
│   ├── format.ts                  record types, keys, chunk index search, compact storage
│   ├── extract.ts                 kaikki entries → records, respelling, chunking (used by npm run lexicon)
│   ├── lookup.ts                  cached chunk fetches, readings ranked best first
│   ├── suggestions.ts             readings → noun/verb/adjective/adverb fields, using the learner's rules
│   ├── rows.ts                    filling an entry row from a suggestion without overwriting typed fields
│   └── useDictionary.ts           the per-device autofill setting and row lookups for Add words and the grid
├── storage/                       inventory persistence, merging saves, sync, import/export (cards, morphology, study preferences)
├── study/
│   ├── setup.ts                   study setup (mode, scope, prompts), persistence
│   ├── order.ts                   study-item ordering/shuffling
│   ├── nounAnswers.ts             word- and article-mode answer parsing and checking
│   ├── preferences.ts             synced study preferences; when a noun needs both forms
│   ├── prompts.ts                 prompt gender hints and article-mode prompt forms
│   ├── verification.ts            answer verification for all card types
│   └── logic.ts                   study-module public exports
├── views/
│   ├── StudyView.tsx               setup sidebar (staged mid-session), flip/typed cards, summary
│   ├── WordsView.tsx               filters, search, part-of-speech tabs, bulk actions
│   ├── GrammarView.tsx             noun and adjective morphology page
│   └── SettingsView.tsx            sync, backup/restore, answer keywords, drilled rules
└── components/
    ├── AppShell.tsx                top navigation (desktop) and bottom tab bar (phone)
    ├── Sheet.tsx                   modal sheet / side drawer / phone bottom sheet
    ├── AddWordsSheet.tsx           batch word creation
    ├── WordDrawer.tsx              single-word editing
    ├── WordsGrid.tsx               editable word grid with sparse drafts that survive filtering, and new-word rows per part of speech
    ├── DictionaryNoteRow.tsx       the line under a row saying what the dictionary filled in, with other readings and meanings
    ├── CardEditorFields.tsx        shared editor fields and batch row cells
    ├── CardAnswer.tsx              answers, typed-answer form, noun diagnostics
    ├── AnswerParsePreview.tsx      structural live answer preview
    ├── NounMorphologyPanel.tsx     declension and article-table editing
    ├── StorageSettingsPanel.tsx    signing in to sync, and backup and restore
    ├── ConflictSheet.tsx           the conflict screen: changes made both here and elsewhere, side by side
    ├── AnswerKeywordSettings.tsx   noun marker keyword settings
    ├── SaveIndicator.tsx           saving and sync status
    └── Icons.tsx                   inline SVG icon set
```

`Flashcard` is a discriminated union keyed by `type`, so `card.type === "noun"` narrows `card.details` to the noun detail schema at compile time. External JSON remains untrusted until `cardCodec` validates and normalizes it.

The shared card base does not require `italian`. Noun and adjective cards omit that property because their surface forms are derived from `details.declension` and the inventory's `nounMorphology` or `adjectiveMorphology`. Verb and adverb cards still store their canonical `italian` value.

`App.tsx` owns cross-cutting application state, including the current card collection and the active noun and adjective morphology. Morphology is passed explicitly to study and editor code rather than stored in a second runtime singleton.

Each completed study round with wrong answers adds a numbered mistake review set. Earlier sets remain replayable, including after returning to the full session; replaying a set can produce another set without replacing its parent. Sets preserve the failed prompt directions and resolve current card data on replay. This history lives in app memory and clears when the session setup changes or the page reloads. Switching between typing and flipping preserves it.

English-to-Italian typed verification always uses the prompted card's known part of speech. There is no part-of-speech answer prefix. The English prompt displays the part of speech directly. The parser preview does not repeat it.

## Noun morphology and noun study

A noun card stores `declension` (a declension rule and base, or an irregular noun's singular/plural forms), `gender`, `genderDiffersWithPlurality` (the plural's articles use the other gender), `articleProfile` (three Boolean article capabilities in one of four combinations), and `articleGroups` (per-form article-group exceptions). Forms and articles are never stored: `resolveNounDetails` generates forms from the declension and looks articles up in the morphology's article groups.

`NounMorphology` holds `declensionRules` (each optionally limited to one gender), `articleLetters` (the vowel and consonant lists behind the `V` and `C` pattern tokens), and `articleGroups`. An article group has spelling patterns and masculine/feminine article sets; a form belongs to the first group, top to bottom, whose pattern matches. There is no catch-all: a form that needs an article and matches nothing is a validation error unless the noun sets an exception. The same table answers "which article does this form take" and, read in reverse (`articleReadings`), "what does this typed article say about definiteness, number, and gender". Elided articles are recognized from table entries ending in an apostrophe.

Study setup has two checkboxes, Words and Articles; `study/order.ts` builds the round's items, giving each noun item an answer mode: `word`, `article` (Articles alone, Italian prompt), or `wordWithArticles` (both checked, English prompt, noun takes articles). `study/nounAnswers.ts` parses every mode the same way without the card (the live preview uses only this): markers anywhere, then articles and noun forms in any order, each form going with the article before it. The check then matches each typed article to the article slot it fills, requires every slot outside word mode, requires the forms `study/preferences.ts` says the noun needs (gender differing with plurality, irregular, unpredictable plural, drilled rule, or marked word) outside article mode, and in word mode requires the singular-/plural-only marker for single-form nouns and each typed form's gender to be shown by an article or marker (a single marker is the singular's gender; `mf`/`fm` give each typed form's gender in typed order); typed articles, forms, and markers must always be right. `study/prompts.ts` adds `(m)`/`(f)` to prompts shared by nouns of different genders.

See `../docs/NOUN_MORPHOLOGY_AND_STUDY.md` for the detailed model.

## Storage and sync

Cards and noun morphology form one logical `InventoryState`. `App` loads them with one `readInventory()` call, and every change (adding, editing or deleting words, Grammar, study preferences) is saved as a whole inventory with `saveInventory()`, so card definitions and morphology are validated and saved together. `replaceInventory()` writes over what is stored; only importing a backup uses it.

Local snapshots contain `cards`, `nounMorphology`, `adjectiveMorphology`, `studyPreferences`, and an internal `updatedAt`. `studyPreferences` holds the answer keywords, drilled declension rules, and nouns that always need both forms; references to deleted nouns or rules are pruned on every save.

Inventory validation checks relationships between cards and morphology. Every noun must reference an existing rule, and enabled article capabilities must have the necessary noun forms. There is no stored noun surface form to cross-check because morphology is the source of truth.

The stored inventory can change while a window is open: another window of the app saves, or something else on the site writes it (the extension adds words this way). So `BrowserStorage` remembers the inventory as this window last read or wrote it, and `saveInventory()` merges three ways (`storage/merge.ts`): that base, this window's inventory, and what is stored now.

Each card records when it was added or last changed (`editedAt`). Saving stamps the cards that are new or differ from what the window had (`cards/edited.ts`), so the Words page can sort by it; an unchanged card keeps its time.

- Cards are matched by id. A card added on either side is kept. A card changed or deleted on one side only takes that side's version; the same change on both sides is fine.
- A card changed differently on both sides, or deleted on one and changed on the other, is a conflict. So are the noun rules, adjective rules, or study preferences changed differently on both sides (each merges as one piece).
- The same word added on both sides under different ids is a conflict. So are rules changed on one side such that words in the merge no longer fit them; each choice says which words it would drop.
- Every conflict has a key, and `mergeInventory(base, mine, theirs, choices)` settles those with a choice. Without one it throws `InventoryConflictError` listing them all, with both versions, and nothing is written.
- `ConflictSheet` (the conflict screen) shows each conflict side by side and merges again with the choices. Closing it on a window conflict drops this window's change; on a sync conflict, sync waits until it's settled.

Other windows' saves, and the extension's, reach an open window as `storage` events; it shows the new inventory at once.

`storage/cloudSync.ts` syncs signed-in devices through the server, which keeps the inventory and a version. A sync merges the inventory as this browser last synced it, the inventory here, and the server's, saves the result here, and uploads it "only if the server is still on the version merged with"; if another device synced in between it merges again. Syncs run one at a time (across windows too, with a Web Lock). When depends on the device's sync mode (`SyncMode`, kept on the device): automatically (after changes, on opening and coming back, and whenever the server's live connection, `LiveUpdates`, says another device changed something), when editing (the same without the live connection), or manually. A sync asks for the server's inventory only if it has moved past the version last synced. Cloudflare Access guards the server; the app's requests carry its sign-in cookie, and an expired sign-in shows Sign in again. See `../sync/README.md`.

New cards get random ids (`cards/ids.ts`) when they are made, so cards added in two places at once can't share an id. Older cards keep their small sequential ids.

Inventory JSON export/import contains `cards`, `nounMorphology`, `adjectiveMorphology`, and `studyPreferences` without sync metadata.

## Morphology editing

`NounMorphologyPanel` edits a draft against the current App-owned inventory. If noun definitions or morphology change externally while that draft is dirty, the panel preserves the unsaved draft but marks it stale and disables saving. The user must explicitly discard the stale draft and reload current inventory before saving further morphology changes.

Changes to non-noun cards do not invalidate the morphology draft.

Noun-to-declension assignment is not duplicated in this panel. Nouns are entered as surface forms (singular, plural, gender, article availability) through `cards/nounDraft.ts`, which infers or validates the declension rule and base.

## Stored card contract

Everything read from storage or an imported backup is normalized with `cardCodec`. Unknown card types are rejected. Nouns must contain exactly the current `declension`, `gender`, `genderDiffersWithPlurality`, structured `articleProfile`, and `articleGroups` details and must omit top-level `italian`. The earlier rule/base noun shape, retired `ruleId`, noun `numberMode`, `articleMode`, singular/plural, stored noun Italian, and stored article-detail representations are rejected rather than translated. Noun cards must also fit the active `NounMorphology`: their rule must exist and every enabled article capability must have the required noun form.

This boundary is not a migration layer.

## Validation

`npm test` compiles parser, preview, synchronization, and import-validation modules into temporary CommonJS test output and runs deterministic Node tests against the real source modules. Test files run serially so their shared temporary CommonJS package marker cannot race.

The noun suite covers rule genders and plural prediction, the editable article table, irregular nouns, article-group exceptions, word-mode checking (optional articles, both-form requirements, singular-/plural-only and gender markers, article profiles), article and combined checking in any order, study item modes, prompt gender hints, and study-preference validation and pruning. Storage tests verify that current canonical cards are accepted while retired noun shapes, stored noun Italian, unknown card types, and noun/morphology mismatches are rejected, and cover the three-way merge with its conflicts and choices, saving over changes made in another window, and syncing two devices against a fake server (first sign-in, words added on both, a conflict settled by a choice, another device syncing in between, a rejected token). `../sync/scripts/e2e.mjs` tries the same in a browser against `wrangler dev`.

`.github/workflows/validate.yml` runs `npm ci`, `npm test`, the production web build, the sync server's typecheck and tests, migration-script syntax, and the extension's typecheck, tests, and build on relevant pull requests and pushes to `main`.

## Deployment

- `.github/workflows/deploy-pages.yml` tests, builds, and deploys only the web app to GitHub Pages.
- `.github/workflows/release-extension.yml` independently validates, signs, and publishes extension release assets through GitHub Releases.
- The sync server is deployed from `../sync/` with `npx wrangler deploy`.

The former Pages extension compatibility path is retired.
