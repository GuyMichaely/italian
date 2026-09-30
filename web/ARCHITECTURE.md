# Architecture

Parole consists of a static React frontend and an optional remote sync API. Extension work is separate from the current Parole-only implementation.

```text
Parole web (React + Vite)
    |
    +--> local inventory snapshot
    |
    +--> optional remote sync snapshot
```

## Web

The frontend is a static Vite application. React manages the interactive UI; Vite and TypeScript are build-time tools. The production output is ordinary HTML, CSS, and JavaScript in `dist/`.

The build uses relative asset URLs so the same output can be served from `/`, `/parole/`, or another static path.

The main source boundaries are:

```text
src/
├── App.tsx                         application state, inventory mutations, study session, external import
├── app/useHashRoute.ts             hash routes: #/study, #/words, #/grammar, #/settings
├── cardTypes.ts                   shared card-type labels and ordering
├── extensionImport.ts             external import envelope and canonical-card validation
├── cards/
│   ├── types.ts                   discriminated Flashcard union and typed detail schemas
│   ├── editorModel.ts             batch-entry rows, drafts, and card construction
│   ├── nounDraft.ts               the one noun-entry model: surface forms → rule, base, articles
│   ├── nounMorphology.ts          declension rules, article table, generation, plural prediction
│   ├── adjectiveDraft.ts          the adjective-entry model: four forms → rule and base
│   └── adjectiveMorphology.ts     adjective rules, generation, prediction
├── storage/                       inventory persistence, sync, import/export (cards, morphology, study preferences)
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
    ├── WordsGrid.tsx               editable word grid with sparse drafts that survive filtering
    ├── CardEditorFields.tsx        shared editor fields and batch row cells
    ├── CardAnswer.tsx              answers, typed-answer form, noun diagnostics
    ├── AnswerParsePreview.tsx      structural live answer preview
    ├── NounMorphologyPanel.tsx     declension and article-table editing
    ├── StorageSettingsPanel.tsx    sync and inventory-transfer settings
    ├── AnswerKeywordSettings.tsx   noun marker keyword settings
    ├── SaveIndicator.tsx           persistence status UI
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

Cards and noun morphology form one logical `InventoryState`. `App` loads them with one `readInventory()` call. Whole-inventory operations use `replaceInventory()` so card definitions and morphology are validated and saved together.

Local snapshots contain `cards`, `nounMorphology`, `studyPreferences`, and an internal `updatedAt`. Remote synchronized snapshots contain the same four values. `studyPreferences` holds the answer keywords, drilled declension rules, and nouns that always need both forms; references to deleted nouns or rules are pruned on every save.

Inventory validation checks relationships between cards and morphology. Every noun must reference an existing rule, and enabled article capabilities must have the necessary noun forms. There is no stored noun surface form to cross-check because morphology is the source of truth.

Bulk inventory edits and mass tag changes are committed as one inventory replacement instead of parallel card writes. Single-card creation, editing, and deletion continue to use narrower card operations that preserve active morphology in the same snapshot.

Both local and remote sides carry an inventory-level `updatedAt` timestamp. When they differ, the later timestamp wins. Local changes automatically push remotely when sync is configured. The user can choose whether a synchronized local copy persists between browser sessions and whether startup mismatches reconcile automatically or wait for an explicit Sync now action.

Inventory JSON export/import contains `cards`, `nounMorphology`, and `studyPreferences` without transport metadata.

## Morphology editing

`NounMorphologyPanel` edits a draft against the current App-owned inventory. If noun definitions or morphology change externally while that draft is dirty, the panel preserves the unsaved draft but marks it stale and disables saving. The user must explicitly discard the stale draft and reload current inventory before saving further morphology changes.

Changes to non-noun cards do not invalidate the morphology draft.

Noun-to-declension assignment is not duplicated in this panel. Nouns are entered as surface forms (singular, plural, gender, article availability) through `cards/nounDraft.ts`, which infers or validates the declension rule and base.

## External card import contract

The import bridge is intentionally thin. It accepts an envelope containing cards that already obey Parole's current canonical `Flashcard` schema.

Parole normalizes those cards with the same `cardCodec` used at storage boundaries. Unknown card types are rejected. Nouns must contain exactly the current `declension`, `gender`, `genderDiffersWithPlurality`, structured `articleProfile`, and `articleGroups` details and must omit top-level `italian`. The earlier rule/base noun shape, retired `ruleId`, noun `numberMode`, `articleMode`, singular/plural, stored noun Italian, and stored article-detail representations are rejected rather than translated.

Imported noun cards are checked against active `NounMorphology` before persistence. Their referenced rule must exist and every enabled article capability must have the required noun form. After validation, imported cards use the same `addBatch` and `CardStorage` path as ordinary card creation.

This boundary is not a migration layer.

## Validation

`npm test` compiles parser, preview, synchronization, and import-validation modules into temporary CommonJS test output and runs deterministic Node tests against the real source modules. Test files run serially so their shared temporary CommonJS package marker cannot race.

The noun suite covers rule genders and plural prediction, the editable article table, irregular nouns, article-group exceptions, word-mode checking (optional articles, both-form requirements, singular-/plural-only and gender markers, article profiles), article and combined checking in any order, study item modes, prompt gender hints, and study-preference validation and pruning. The sync suite covers automatic newer-remote reconciliation, newer-local push, ask-first reconciliation, non-persistent local mode, and offline fallback. Import tests verify that current canonical cards are accepted while retired noun shapes, stored noun Italian, unknown card types, and noun/morphology mismatches are rejected.

These synchronization tests verify decision logic without mutating a deployed inventory. A live browser-to-API smoke test remains the environment-level check for endpoint configuration, CORS/networking, and deployed persistence.

`.github/workflows/validate.yml` runs `npm ci`, `npm test`, the production web build, API syntax, migration-script syntax, and repository extension static checks on relevant pull requests and pushes to `main`.

## API

The API is an independent Node service that stores the timestamped inventory snapshot used for synchronization. It validates the same structured noun schema and name-reference morphology structure as the web app. Noun cards omit `italian`; the API validates rule references and article-profile/rule compatibility instead of storing or checking a redundant noun surface form.

## Deployment

- `.github/workflows/deploy-pages.yml` tests, builds, and deploys only the web app to GitHub Pages.
- `.github/workflows/release-extension.yml` independently validates, signs, and publishes extension release assets through GitHub Releases.
- `.github/workflows/deploy-api.yml` independently deploys the API to Azure App Service.

The former Pages extension compatibility path is retired.
