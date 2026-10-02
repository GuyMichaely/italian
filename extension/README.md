# Italian extension

A Chrome extension that adds Italian words you meet on the web to Italian.

## Using it

- **Add from a page.** Select a word, right-click, and choose **Add “…” to Italian**. The word is looked up in the dictionary (see `docs/LEXICON.md`), and a panel in the corner shows what was added. It has **Undo**, the dictionary's other English meanings, and its other readings, such as cantante as a feminine noun or as a form of cantare. An inflected form adds its dictionary word, so selecting libri adds libro.
- **Search from the toolbar.** The toolbar popup searches Italian or English words and adds any result. It also lists the words waiting to be saved and the ones saved recently.
- **Saving.** Words wait about eight seconds after the last change, so Undo and switching readings stay in the extension. Then they're added straight to your words, which the Italian site keeps in your browser's storage:
  - Each word becomes a card with your own declension rules.
  - Words you already have are skipped.
  - Every word gets the tag `from-extension`, and a word worth checking also gets `needs-review` (a noun of either gender, an Irregular fallback, or missing forms).
  - An Italian tab that's open keeps them: the app merges them in the next time it saves, so nothing you do there overwrites them. Reload the tab to see them.
  - If the site doesn't load, or your words are stored in a way this version doesn't understand (the app changed and the extension needs updating), nothing is written. The words stay queued: the popup shows why, and they're tried again the next time you add a word or press **Save now**.

The extension keeps the sentence the word came from with the word, for later use.

## How it's built

`src/` is TypeScript bundled by esbuild (`build.mjs`) into `dist/`. It reuses the web app's code: the dictionary (`web/src/lexicon/`), card building, and reading and writing the stored inventory (`web/src/storage/browser.ts`). The app has no code for the extension.

Only a page of the site can reach the site's storage, so the extension saves by running `writer.js` in one:

1. an open Italian tab, if there is one that Chrome hasn't unloaded or frozen;
2. otherwise a small static page of the site (`lexicon/ATTRIBUTION.txt`) in a frame of a hidden extension page (`offscreen.html`), where `writer.js` runs as a content script registered for that page;
3. if that fails, the same static page in a background tab, closed afterwards.

The writer reads the inventory, adds the cards, and writes it back with a new `updatedAt`, all in one synchronous step. It refuses if the stored inventory doesn't parse, or if writing it back would drop anything it doesn't know about.

| File | Role |
|---|---|
| `background.ts` | context menu, the queue (`chrome.storage.local`), choosing the page to save through, toast actions |
| `words.ts` | queued words → cards with the learner's rules; the write into storage |
| `writer.ts` | injected into a page of the site to run that write |
| `offscreen.*` | the hidden page holding the site's static page in a frame |
| `queue.ts` | queued words and what a save does to them |
| `dictionary.ts` | the lexicon at `<app>/lexicon/`, and selection cleanup (“l’uovo” → uovo) |
| `toast.ts` | the panel injected into the page after adding (shadow DOM) |
| `popup.*` | the toolbar popup |

## Developing

```sh
npm ci
npm run typecheck
npm test
npm run build                                    # dist/ for https://guymichaely.com/italian/
node build.mjs --app http://localhost:5391/      # dist/ for the web dev server
```

To try a build, load `dist/` at `chrome://extensions` with **Load unpacked**. A development build (`--app`) is named “Italian (dev)” and talks to that app.

`scripts/e2e.mjs` runs Chromium with the development build. It adds words from a page and checks they're saved through the hidden page, through a background tab (dev builds can turn the hidden page off), and through an open app tab, which then keeps them when it saves. It checks that a conflicting change in the app shows the Reload banner and writes nothing, and that stored data with unknown fields is left alone. Then it searches in the popup. It needs Playwright (`npm install --no-save playwright && npx playwright install chromium`) and the web dev server on port 5391.

## Release

`.github/workflows/release-extension.yml` checks and builds the extension, then signs `dist/` with the existing key. The key keeps the extension ID, so installed copies update in place. The workflow publishes `italian.crx`, `updates.xml`, and `version.json` to GitHub Releases. The version comes from `manifest.json`; raise it for Chrome to pick up a release.
