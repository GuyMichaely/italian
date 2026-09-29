# Parola

Parola is an Italian flashcard suite with three independently understandable parts:

- `web/` — static React/Vite frontend.
- `extension/` — Chrome extension for staging words and contexts before review/import.
- `api/` — optional Node synchronization API.

## Production

The public repository is the canonical source for both the web app and extension release.

- Web app: `https://guymichaely.com/parola/`
- Extension update feed: `https://github.com/GuyMichaely/parola/releases/latest/download/updates.xml`
- Signed extension CRX: `https://github.com/GuyMichaely/parola/releases/latest/download/parola.crx`

`.github/workflows/release-extension.yml` independently validates, signs, and publishes the extension through GitHub Releases. An installed `0.2.4` client successfully updated to `0.2.5` through that feed, so GitHub Pages no longer packages or publishes an extension compatibility feed.

`.github/workflows/deploy-pages.yml` builds, tests, and deploys only the web app. The optional API is deployed separately to Azure by `.github/workflows/deploy-api.yml`.

The frontend always has a local working inventory. Configuring an API endpoint adds timestamp-based synchronization with a remote copy so the same inventory can be kept in sync across machines.

Parola's external card-import boundary accepts only the current canonical `Flashcard` schema. Noun cards store a `declension` (a declension rule and base, or an irregular noun's forms), `gender`, `genderDiffersWithPlurality` (the plural takes the other gender, as in l’uovo / le uova), an explicit `articleProfile` object with `definiteSingular`, `definitePlural`, and `indefiniteSingular` Boolean capabilities, and `articleGroups` exceptions. They do not store a top-level `italian` value or article strings: forms come from the declension and articles from the editable article table. Adjective cards likewise store only a `declension` (an adjective rule and base, or an irregular adjective's four forms) and no `italian` value; see `docs/ADJECTIVE_DECLENSIONS.md`. Only the four supported article-profile combinations are accepted: all three capabilities, definite singular only, definite plural only, or none. Parola does not translate retired card schemas at this boundary; `scripts/migrate-noun-declensions.mjs` converts inventories using the earlier rule/base noun shape.

## Project checkpoint

See [`PROJECT_STATUS.md`](PROJECT_STATUS.md) for the current architecture decisions, deployment status, testing policy, roadmap, and immediate next steps.

See `web/README.md`, `web/ARCHITECTURE.md`, and `extension/README.md` for development details.
