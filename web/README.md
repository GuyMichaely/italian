# Italian web

Italian is a static flashcard web app for learning Italian.

## Architecture

The app is intentionally small and hosting-provider agnostic:

- React for the interactive UI.
- Vite only as a development/build tool.
- Plain CSS.
- No Next.js.
- No application server required for local-only use.
- Browser `localStorage` for optional persistent local inventory state.
- Optional sync between devices through the Cloudflare Worker in `../sync/`.

A production build is just static files in `dist/`. The build uses relative asset URLs, so the same `dist/` can be served at `/`, `/italian/`, or another directory without rebuilding.

The canonical production deployment is `https://guymichaely.com/italian/`.

## Storage and sync

The app always has a local working inventory and works on its own. Settings → **Sign in with Cloudflare** turns on sync with `https://sync.guymichaely.com` (`../sync/`): every signed-in device keeps the same words, changes from each are merged, and anything changed on two devices at once waits on the conflict screen for you to choose. `VITE_SYNC_URL` points a dev build at `wrangler dev`.

## Noun morphology

Noun cards store a declension (a rule and base, or irregular forms), gender, article profile, and article-group exceptions. Declension rules, optionally limited to one gender, generate noun forms; the article table gives each form its articles. Study has two checkboxes: Words (type the noun, with an article or a gender marker) and Articles (type every article a noun takes, in any order); checking both asks English-prompted nouns for the word and all its articles.

See `../docs/NOUN_MORPHOLOGY_AND_STUDY.md` for the model and how answers are checked.

## Inventory transfer

**Backup & restore** in Settings can export/download the inventory, copy it to the clipboard, import a JSON file, or replace the inventory from pasted JSON.

The inventory JSON payload contains `cards`, `nounMorphology`, and `studyPreferences`; export-format/version/timestamp metadata is not added.

## Development

```bash
npm install
npm run dev
```

Build:

```bash
npm run build
```

The deployable site will be in `dist/`. Local Node tooling is not required when builds are performed by GitHub Actions.
