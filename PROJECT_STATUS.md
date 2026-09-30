# Parola project status

_Last updated: 2026-09-28_

This is the durable checkpoint for the current Parola architecture, project decisions, and next steps.

## Project policy

GitHub issues are informal ideas and reminders. They are not an authoritative specification, SDLC queue, priority order, or requirement to use branches, pull requests, milestones, release gates, or compatibility layers.

Current conversation decisions and current code take precedence over old issue wording.

## Data and schema policy

Do not design around backwards compatibility.

Treat each release as if it were a fresh 1.0. Keep one canonical data model. When a useful schema change would otherwise lose real user data, provide a one-time migration script or instructions outside the application. Do not commit permanent compatibility readers or dual schemas merely to preserve old representations.

## Current Parola architecture

Parola web is a static React/Vite application served at `https://guymichaely.com/parola/`. It is local-first and may optionally synchronize the same complete inventory snapshot with the Node API deployed separately to Azure.

Cards and noun morphology form one logical inventory. Browser persistence stores one `parola:inventory` JSON value containing cards, noun morphology, and an internal `updatedAt` timestamp. Remote synchronization uses the same complete snapshot and last-write-wins timestamp semantics.

`Flashcard` is a discriminated union keyed by `type`. Nouns, verbs, adjectives, and adverbs each have their own typed `details` shape. Storage/import code validates external JSON at runtime before it enters that typed model.

## Inventory synchronization

- Local and remote are copies of one complete inventory snapshot.
- The later `updatedAt` wins; there is no per-card merge.
- Local mutations push automatically while sync is configured.
- The server rejects stale snapshot writes.
- Startup can reconcile automatically or wait for explicit **Sync now**.
- Browser persistence can be disabled while remote sync remains active for the session.
- Manual inventory export/import contains `cards`, `nounMorphology`, and `studyPreferences`, without sync transport metadata.

Deterministic tests cover newer-remote reconciliation, newer-local push, ask-first behavior, non-persistent local mode, and offline fallback. A real browser-to-Azure smoke test remains an environment-level verification task rather than missing synchronization logic.

## Inventory and editing

Cards have optional sets and ordinary tags. There is no deck model. The Inventory grid and normal single-card editor are the canonical editing interfaces.

Current card creation/editing supports nouns, verbs, adjectives, and adverbs. Duplicate card creation is rejected. Bulk edits and mass tag changes commit through complete inventory replacement so cards and noun morphology remain consistent.

Noun definitions live in the Inventory noun grid. The noun grid shows English, gender, base, declension, article profile, derived singular/plural forms, set, and tags. Number and the Italian noun surface form are not stored on the noun card because both are derived from its declension rule and base.

## Typed study

The prompted card determines the expected part of speech; the learner does not type part-of-speech prefixes. English prompts display the part of speech next to the prompt itself rather than inside the parse preview.

Study supports English, Italian, or both prompt directions; optional typed Italian verification; one direction per word; English-first ordering when both directions are studied; scope filtering by part of speech, set, or tag; mistake review; and creation of mistake tags.

Study has two checkboxes, Words and Articles, and at least one stays checked. Words prompts each card in the chosen directions; a noun's answer is the noun, one form or both, with an optional article, plus gender and singular-/plural-only keywords (default `m`, `f`, `s`, `p`) where nothing else shows them. Both forms are required for irregular nouns, nouns whose plural the rules don't predict, nouns using a drilled rule, and nouns marked individually. Articles alone prompts each noun that takes an article with its Italian form and asks for every article it takes. With both checked, English prompts for such nouns ask for every article plus the forms a word answer needs. Articles and forms can be typed in any order, and every combination is a shuffled round over the cards in scope. The live preview is card-blind; a wrong answer lists what was wrong. Answer keywords, drilled rules, and marked nouns are `studyPreferences` in the inventory, so they sync with it. Nouns taking both genders are two cards, and shared prompts show `(m)`/`(f)`.

Verb and adverb typed verification use their stored forms. Adjectives are generated from editable adjective rules (`adjectiveMorphology`) or stored as irregular forms; a typed answer is one form when the rules work out the rest from it, otherwise all four forms (irregular, unpredicted, drilled, or marked adjectives). A noun's one form likewise has to predict the other (the plural in -i does not). See `docs/ADJECTIVE_DECLENSIONS.md`.

## Noun morphology

A canonical noun card stores:

- `declension`: `{ kind: "rule", rule, base }` or, for irregular nouns, `{ kind: "irregular", singular, plural }`;
- `gender`, the singular's gender;
- `genderDiffersWithPlurality`, true when the plural takes the other gender (`l’uovo` / `le uova`), which also requires both forms in word mode; a single gender marker gives the singular's gender, and `mf` / `fm` give each typed form's gender in the order typed;
- `articleProfile`, an object with Boolean `definiteSingular`, `definitePlural`, and `indefiniteSingular` capabilities (four canonical combinations: all, definite singular only, definite plural only, none);
- `articleGroups`, per-form article-group exceptions (`null` means the group comes from spelling).

A noun card does not store top-level `italian` or article strings. Regular forms are generated from the rule and base; articles come from the morphology's editable article groups, where each form's group is the first group, top to bottom, whose spelling pattern matches (`sC`, `iV`, `V`, `C`, …, with `V` and `C` defined by editable vowel and consonant lists) unless the noun overrides it (for example plural `dei` in the `lo` group gives `gli dei`).

Declension rules and article groups use unique names as references, and the grammar editor cascades renames (rules into nouns and drilled rules; article groups into noun exceptions). `Irregular` is reserved as a rule name. A declension rule can be limited to one gender; the defaults make the `-a → -e`, `-ca → -che`, and `-ga → -ghe` rules feminine and `-a → -i` masculine. A plural is predictable when the most specific matching rules (longest singular ending) agree on it.

The former inference sets, answer-syntax rules, and `lo` full-declension exclusion are retired; `scripts/migrate-study-modes.mjs` converts inventories that use them. `scripts/migrate-gender-plurality.mjs` adds `genderDiffersWithPlurality: false` to the nouns of inventories from before that field.

See `docs/NOUN_MORPHOLOGY_AND_STUDY.md` for the detailed model.

## External card import contract

Parola does not contain a compatibility adapter for retired card formats.

The external import bridge accepts only cards that already obey the current canonical `Flashcard` schema. Unknown card types are rejected. Nouns must contain current `declension`, `gender`, `genderDiffersWithPlurality`, structured `articleProfile`, and `articleGroups` details, must not contain top-level `italian`, and must agree with active noun morphology. Retired `ruleId`, noun `numberMode`, `articleMode`, singular/plural, and stored article-detail payloads are rejected rather than converted.

After validation, imported cards use the same `addBatch` and `CardStorage` persistence path as ordinary card creation.

## Automated validation

`npm test` runs deterministic tests against the real noun answer checking and preview, study item building, study preferences, and the external import contract. Noun coverage includes rule genders and plural prediction, the editable article table, irregular nouns, article-group exceptions, word, article, and combined answer checking, markers, article profiles, prompt gender hints, and strict rejection of retired schemas.

Test files run serially because they share one temporary CommonJS output directory.

`.github/workflows/validate.yml` runs tests, the production web build, API syntax, migration-script syntax, and repository static checks on relevant pull requests and pushes to `main`.

## Deployment

- `.github/workflows/deploy-pages.yml` tests, builds, and deploys only the web app to GitHub Pages.
- `.github/workflows/deploy-api.yml` independently deploys the optional synchronization API to Azure.
- Extension release infrastructure is separate from Pages.

The former Pages extension compatibility feed/package path has been removed.

## Inventory migration state

The current noun and adjective schemas are intentionally canonical and do not read previous representations. `scripts/migrate-adjective-declensions.mjs` converts inventories from before adjective rules, and renames the drilled noun rules to `nounFullDeclensionRules`. `scripts/migrate-article-profiles.mjs` is a one-off utility for converting retired `articleMode` inventories outside application runtime and removes the retired stored noun `italian` value as part of that conversion.

## Parola-only remaining work

Remaining work is primarily validation and product iteration:

1. Run a live browser-to-Azure synchronization smoke test.
2. Manually exercise noun-study edge cases in the actual UI.
3. Expand automated coverage beyond the current noun-heavy suite if useful.
4. Continue normal UX/product iteration as new requirements are identified.
