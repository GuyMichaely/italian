# Architecture

Parola consists of a static React frontend and an optional remote sync API. Extension work is separate from the current Parola-only implementation.

```text
Parola web (React + Vite)
    |
    +--> local inventory snapshot
    |
    +--> optional remote sync snapshot
```

## Web

The frontend is a static Vite application. React manages the interactive UI; Vite and TypeScript are build-time tools. The production output is ordinary HTML, CSS, and JavaScript in `dist/`.

The build uses relative asset URLs so the same output can be served from `/`, `/parola/`, or another static path.

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
│   └── nounMorphology.ts          noun rules, syntax rules, inference sets, generation
├── storage/                       inventory persistence, sync, import/export (unchanged by the UI)
├── study/
│   ├── setup.ts                   study setup, scope filtering, answer keywords, persistence
│   ├── order.ts                   study-item ordering/shuffling
│   ├── nounSyntax.ts              candidate-based noun syntax evaluation
│   ├── verification.ts            answer verification for all card types
│   └── logic.ts                   study-module public exports
├── views/
│   ├── StudyView.tsx               setup sidebar (staged mid-session), flip/typed cards, summary
│   ├── WordsView.tsx               filters, search, part-of-speech tabs, bulk actions
│   ├── GrammarView.tsx             noun morphology page
│   └── SettingsView.tsx            sync, backup/restore, answer keywords
└── components/
    ├── AppShell.tsx                top navigation (desktop) and bottom tab bar (phone)
    ├── Sheet.tsx                   modal sheet / side drawer / phone bottom sheet
    ├── AddWordsSheet.tsx           batch word creation
    ├── WordDrawer.tsx              single-word editing
    ├── WordsGrid.tsx               editable word grid with sparse drafts that survive filtering
    ├── CardEditorFields.tsx        shared editor fields and batch row cells
    ├── CardAnswer.tsx              answers, typed-answer form, noun diagnostics
    ├── AnswerParsePreview.tsx      structural live answer preview
    ├── NounMorphologyPanel.tsx     declensions, inference sets, and syntax editing
    ├── StorageSettingsPanel.tsx    sync and inventory-transfer settings
    ├── AnswerKeywordSettings.tsx   noun marker keyword settings
    ├── SaveIndicator.tsx           persistence status UI
    └── Icons.tsx                   inline SVG icon set
```

`Flashcard` is a discriminated union keyed by `type`, so `card.type === "noun"` narrows `card.details` to the noun detail schema at compile time. External JSON remains untrusted until `cardCodec` validates and normalizes it.

The shared card base does not require `italian`. Noun cards omit that property because their surface forms are derived. Verb, adjective, and adverb cards still store their canonical `italian` value.

`App.tsx` owns cross-cutting application state, including the current card collection and active noun morphology. Morphology is passed explicitly to study and editor code rather than stored in a second runtime singleton.

English-to-Italian typed verification always uses the prompted card's known part of speech. There is no part-of-speech answer prefix. The English prompt displays the part of speech directly. The parser preview does not repeat it.

## Noun morphology and syntax

A noun card stores `declension` (a declension rule and base, or an irregular noun's singular/plural forms), `gender`, `articleProfile` (three Boolean article capabilities in one of four combinations), and `articleGroups` (per-form article-group exceptions). Forms and articles are never stored: `resolveNounDetails` generates forms from the declension and looks articles up in the morphology's article groups.

`NounMorphology` holds `declensionRules`, `inferenceSets`, `syntaxRules`, and `articleGroups`. An article group has spelling patterns and masculine/feminine article sets; a form belongs to the first group whose pattern matches, otherwise to the last group. The same table answers "which article does this form take" and, read in reverse (`articleReadings`), "what does this typed article say about definiteness, number, and gender". Elided articles are recognized from table entries ending in an apostrophe.

A syntax rule stores markers, ordered fields, an inference-set reference, and `excludedArticleGroups`. Article fields declare definiteness and number and assert the matching article capability; a syntax without article fields asserts the no-article profile and must require gender and singular/plural-only markers.

Verification (`study/nounSyntax.ts`) has two halves. The card-blind half tries every syntax, reads markers and articles through the table, and turns the typed noun forms into readings: one per inference-set rule that recovers a single base, plus an `Irregular` reading when the answer supplies every form. The live preview uses only this half, steering away from syntaxes whose exclusions the typed word's spelling hits. The card-aware half matches a reading when its rule and base (or irregular forms) and gender equal the card's, the card's article profile allows the syntax's article fields, the card's article group is not excluded, and every typed article equals the table's article for the card's form group, gender, definiteness, and number.

Outcomes: a matching reading is correct; otherwise a structurally complete syntax is wrong; no complete syntax is invalid or incomplete.

The grammar editor cascades renames through name references and rejects duplicates. `cards/nounDraft.ts` is the single noun-entry model for Add words, the word drawer, and the grid: surface forms plus an optional rule (Auto, a named rule, or Irregular) and optional article-group exceptions.

See `../docs/NOUN_MORPHOLOGY_AND_SYNTAX.md` for the detailed model.

## Storage and sync

Cards and noun morphology form one logical `InventoryState`. `App` loads them with one `readInventory()` call. Whole-inventory operations use `replaceInventory()` so card definitions and morphology are validated and saved together.

Local snapshots contain `cards`, `nounMorphology`, and an internal `updatedAt`. Remote synchronized snapshots contain the same three values. `nounMorphology` contains declension rules, inference sets, and syntax rules.

Inventory validation checks relationships between cards and morphology. Every noun must reference an existing rule, and enabled article capabilities must have the necessary noun forms. There is no stored noun surface form to cross-check because morphology is the source of truth.

Bulk inventory edits and mass tag changes are committed as one inventory replacement instead of parallel card writes. Single-card creation, editing, and deletion continue to use narrower card operations that preserve active morphology in the same snapshot.

Both local and remote sides carry an inventory-level `updatedAt` timestamp. When they differ, the later timestamp wins. Local changes automatically push remotely when sync is configured. The user can choose whether a synchronized local copy persists between browser sessions and whether startup mismatches reconcile automatically or wait for an explicit Sync now action.

Inventory JSON export/import contains `cards` and `nounMorphology` without transport metadata.

## Morphology editing

`NounMorphologyPanel` edits a draft against the current App-owned inventory. If noun definitions or morphology change externally while that draft is dirty, the panel preserves the unsaved draft but marks it stale and disables saving. The user must explicitly discard the stale draft and reload current inventory before saving further morphology changes.

Changes to non-noun cards do not invalidate the morphology draft.

Noun-to-declension assignment is not duplicated in this panel. Nouns are entered as surface forms (singular, plural, gender, article availability) through `cards/nounDraft.ts`, which infers or validates the declension rule and base.

## External card import contract

The import bridge is intentionally thin. It accepts an envelope containing cards that already obey Parola's current canonical `Flashcard` schema.

Parola normalizes those cards with the same `cardCodec` used at storage boundaries. Unknown card types are rejected. Nouns must contain exactly the current `declension`, `gender`, structured `articleProfile`, and `articleGroups` details and must omit top-level `italian`. The earlier rule/base noun shape, retired `ruleId`, noun `numberMode`, `articleMode`, singular/plural, stored noun Italian, and stored article-detail representations are rejected rather than translated.

Imported noun cards are checked against active `NounMorphology` before persistence. Their referenced rule must exist and every enabled article capability must have the required noun form. After validation, imported cards use the same `addBatch` and `CardStorage` path as ordinary card creation.

This boundary is not a migration layer.

## Validation

`npm test` compiles parser, preview, synchronization, and import-validation modules into temporary CommonJS test output and runs deterministic Node tests against the real source modules. Test files run serially so their shared temporary CommonJS package marker cannot race.

The noun suite covers rule-derived number behavior, the editable article table, irregular nouns, article-group exceptions, the `lo` shorthand exclusion, article-derived gender, article capability matching, profile/declension independence, ambiguous article gender, contradictory evidence, articleless nouns, zero-candidate complete syntax, candidate specificity ordering, strict morphology schema validation, and live-preview candidate scoping. The sync suite covers automatic newer-remote reconciliation, newer-local push, ask-first reconciliation, non-persistent local mode, and offline fallback. Import tests verify that current canonical cards are accepted while retired noun shapes, stored noun Italian, unknown card types, and noun/morphology mismatches are rejected.

These synchronization tests verify decision logic without mutating a deployed inventory. A live browser-to-API smoke test remains the environment-level check for endpoint configuration, CORS/networking, and deployed persistence.

`.github/workflows/validate.yml` runs `npm ci`, `npm test`, the production web build, API syntax, migration-script syntax, and repository extension static checks on relevant pull requests and pushes to `main`.

## API

The API is an independent Node service that stores the timestamped inventory snapshot used for synchronization. It validates the same structured noun schema and name-reference morphology structure as the web app. Noun cards omit `italian`; the API validates rule references and article-profile/rule compatibility instead of storing or checking a redundant noun surface form.

## Deployment

- `.github/workflows/deploy-pages.yml` tests, builds, and deploys only the web app to GitHub Pages.
- `.github/workflows/release-extension.yml` independently validates, signs, and publishes extension release assets through GitHub Releases.
- `.github/workflows/deploy-api.yml` independently deploys the API to Azure App Service.

The former Pages extension compatibility path is retired.
