# Italian extension

A Chrome extension that adds Italian words you meet on the web to Italian.

## Using it

- **Add from a page.** Select a word, right-click, and choose **Add “…” to Italian**. The word is looked up in the dictionary (see `docs/LEXICON.md`), and a panel in the corner shows what was added. It has **Undo**, the dictionary's other English meanings, and its other readings, such as cantante as a feminine noun or as a form of cantare. An inflected form adds its dictionary word, so selecting libri adds libro.
- **Search from the toolbar.** The toolbar popup searches Italian or English words and adds any result. It also lists the words waiting to be saved and the ones saved recently.
- **Saving.** Words wait about eight seconds after the last change, so Undo and switching readings stay in the extension. Then they go to the app:
  - They go to an open Italian tab. If there isn't one, the extension opens one in the background and closes it afterwards.
  - The app turns each word into a card with your own declension rules.
  - It skips words you already have.
  - Every word gets the tag `from-extension`, and a word worth checking also gets `needs-review` (a noun of either gender, an Irregular fallback, or missing forms).
  - The app stays on whatever page you're on.

The extension keeps the sentence the word came from with the word, for later use.

## How it's built

`src/` is TypeScript bundled by esbuild (`build.mjs`) into `dist/`. It shares the web app's dictionary code (`web/src/lexicon/`) and the message types (`web/src/extensionProtocol.ts`).

| File | Role |
|---|---|
| `background.ts` | context menu, the queue (`chrome.storage.local`), delivery to the app, toast actions |
| `queue.ts` | queued words and what the app's answer does to them |
| `dictionary.ts` | the lexicon at `<app>/lexicon/`, and selection cleanup (“l’uovo” → uovo) |
| `bridge.ts` | content script on the app's pages; passes words to the app with `window.postMessage` |
| `toast.ts` | the panel injected into the page after adding (shadow DOM) |
| `popup.*` | the toolbar popup |

The extension never writes the app's storage. The app validates what the bridge sends and saves it through its own storage, as it does for words typed into Add words.

## Developing

```sh
npm ci
npm run typecheck
npm test
npm run build                                    # dist/ for https://guymichaely.com/italian/
node build.mjs --app http://localhost:5391/      # dist/ for the web dev server
```

To try a build, load `dist/` at `chrome://extensions` with **Load unpacked**. A development build (`--app`) is named “Italian (dev)” and talks to that app.

`scripts/e2e.mjs` runs Chromium with the development build. It adds a word from a page, checks that the word is delivered and saved, and searches in the popup. It needs Playwright (`npm install --no-save playwright && npx playwright install chromium`) and the web dev server on port 5391.

## Release

`.github/workflows/release-extension.yml` checks and builds the extension, then signs `dist/` with the existing key. The key keeps the extension ID, so installed copies update in place. The workflow publishes `italian.crx`, `updates.xml`, and `version.json` to GitHub Releases. The version comes from `manifest.json`; raise it for Chrome to pick up a release.
