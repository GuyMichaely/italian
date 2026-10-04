# Italian extension

A Chrome extension that adds Italian words you meet on the web to Italian.

## Using it

- **Add from a page.** Select a word, right-click, and choose **Add “…” to Italian**. The word is looked up in the dictionary (see `docs/LEXICON.md`), and a panel in the corner shows what was added. It has **Undo**, the dictionary's other English meanings, and its other readings, such as cantante as a feminine noun or as a form of cantare. An inflected form adds its dictionary word, so selecting libri adds libro.
- **Search from the toolbar.** The toolbar popup searches Italian or English words and adds any result. It also lists the words you've added recently, each in the same panel as on the page.
- **Changing a word.** Undo, another meaning, or another reading, in the panel on the page or in the popup, changes the card that's stored. Once you edit or delete the word on the Words page, it's the app's: the extension leaves it alone and says so. Opening the popup reads your words back from the site (through an open Italian tab or the hidden page, never a new tab), so a word changed there shows as it is now.
- **Saving.** Words are added at once, straight to your words, which the Italian site keeps in your browser's storage:
  - Each word becomes a card with your own declension rules.
  - Words you already have are skipped.
  - Every word gets the tag `from-extension`, and a word worth checking also gets `needs-review` (a noun of either gender, an Irregular fallback, or missing forms).
  - An Italian tab that's open keeps them: the app merges them in the next time it saves, so nothing you do there overwrites them. Reload the tab to see them.
  - If the site doesn't load, or your words are stored in a way this version doesn't understand (the app changed and the extension needs updating), nothing is written. The changes wait: the panel shows why, the badge counts them, and they're tried again the next time you change a word or press **Try again** in the popup (and every minute while the site doesn't load).

The extension keeps the sentence the word came from with the word, for later use.

## How it's built

`src/` is TypeScript bundled by esbuild (`build.mjs`) into `dist/`. It reuses the web app's code: the dictionary (`web/src/lexicon/`), card building, and reading and writing the stored inventory (`web/src/storage/browser.ts`). The app has no code for the extension.

Only a page of the site can reach the site's storage, so the extension saves by running `writer.js` in one:

1. an open Italian tab, if there is one that Chrome hasn't unloaded or frozen;
2. otherwise a small static page of the site (`lexicon/ATTRIBUTION.txt`) in a frame of a hidden extension page (`offscreen.html`), where `writer.js` runs as a content script registered for that page;
3. if that fails, the same static page in a background tab, closed afterwards.

The writer reads the inventory, makes the changes (add, change, or remove a card), and writes it back with a new `updatedAt`, all in one synchronous step. Each word's card id is chosen when it's added, so a save that's tried twice adds it once. A change or removal goes ahead only while the stored card is exactly as the extension last wrote it. The writer refuses if the stored inventory doesn't parse, or if writing it back would drop anything it doesn't know about.

| File | Role |
|---|---|
| `background.ts` | context menu, the words added (`chrome.storage.local`), choosing the page to save through, word actions |
| `words.ts` | changes → cards with the learner's rules; the write into storage |
| `writer.ts` | injected into a page of the site to run that write |
| `offscreen.*` | the hidden page holding the site's static page in a frame |
| `added.ts` | the words added, the changes waiting, and what a save does to them |
| `dictionary.ts` | the lexicon at `<app>/lexicon/`, and selection cleanup (“l’uovo” → uovo) |
| `panel.ts` | a word's panel, shown by the toast and the popup |
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

`scripts/e2e.mjs` runs Chromium with the development build. It adds words from a page and checks they're saved through the hidden page, through a background tab (dev builds can turn the hidden page off), and through an open app tab, which then keeps them when it saves. It changes and undoes a saved word, and checks a word edited in the app is left alone. It checks that a conflicting change in the app shows the Reload banner and writes nothing, and that stored data with unknown fields is left alone. Then it searches in the popup. It needs Playwright (`npm install --no-save playwright && npx playwright install chromium`) and the web dev server on port 5391.

## Release

`.github/workflows/release-extension.yml` checks and builds the extension, then signs `dist/` with the existing key. The key keeps the extension ID, so installed copies update in place. The workflow publishes `italian.crx`, `updates.xml`, and `version.json` to GitHub Releases. The version comes from `manifest.json`; raise it for Chrome to pick up a release.
