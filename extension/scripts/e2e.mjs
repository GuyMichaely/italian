// Tries the extension end to end in Chromium: adds words from a page, saves them into the site's
// local storage at once (through a hidden page, a background tab, and an open app tab), changes
// and undoes saved words, and checks that the open app keeps them when it next saves and stops on
// a real conflict. Needs the web dev server
// on port 5391 and Playwright:
//   (cd ../web && npm run dev -- --port 5391) &
//   npm install --no-save playwright && npx playwright install chromium
//   node build.mjs --app http://localhost:5391/ && node scripts/e2e.mjs
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const extension = path.join(root, "dist");
const appUrl = "http://localhost:5391/";
const pageUrl = "http://127.0.0.1:5391/e2e-page";

const context = await chromium.launchPersistentContext(mkdtempSync(path.join(tmpdir(), "italian-e2e-")), {
  channel: "chromium",
  headless: true,
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
});
try {
  await context.route(pageUrl, (route) => route.fulfill({ contentType: "text/html", body: "<!doctype html><p id=text>Ho comprato due libri ieri.</p>" }));
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  let opened = [];
  context.on("page", (opening) => opened.push(opening));
  const openedSites = () => opened.filter((opening) => !opening.url().startsWith("chrome-extension:"));
  const appTabs = () => context.pages().filter((open) => open.url().startsWith(appUrl));
  const stored = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("italian:inventory")));
  const english = (inventory) => inventory.cards.map((card) => card.english).sort();

  const page = await context.newPage();
  await page.goto(pageUrl);
  const pageTab = await worker.evaluate(async (url) => (await chrome.tabs.query({ url })).at(0)?.id, pageUrl);
  const add = async (word) => {
    opened = [];
    await worker.evaluate(async ([tabId, url, word]) => globalThis.italianAddSelection(word, { id: tabId, url }), [pageTab, pageUrl, word]);
    await worker.evaluate(() => globalThis.italianDeliver());
    return worker.evaluate(() => globalThis.italianReadWords());
  };
  const act = async (action) => {
    await worker.evaluate((action) => globalThis.italianWordAction({ type: "italian-word-action", ...action }), action);
    await worker.evaluate(() => globalThis.italianDeliver());
    return worker.evaluate(() => globalThis.italianReadWords());
  };
  const latest = (state, word) => state.words.find((item) => item.word === word);

  // ---- Adding from a page. ----
  await page.evaluate(() => {
    const text = document.getElementById("text").firstChild;
    const range = document.createRange();
    range.setStart(text, 17);
    range.setEnd(text, 22);
    getSelection().addRange(range);
  });
  const afterLibri = await add("libri");
  await page.waitForSelector("#italian-extension-toast", { state: "attached", timeout: 5000 });
  const libro = latest(afterLibri, "libri");
  assert.equal(libro.readings[0].headword.word, "libro");
  assert.equal(libro.context, "Ho comprato due libri ieri.");
  console.log("Added from the page; toast shown.");

  // ---- No app tab open: saved at once through a hidden page, without opening a tab. ----
  assert.equal(libro.status, "saved", JSON.stringify(afterLibri));
  assert.equal(openedSites().length, 0, "no tab opened");
  console.log("Saved at once through a hidden page.");

  // ---- If the hidden page can't be used: a static page in a background tab, closed afterwards. ----
  await worker.evaluate(() => { globalThis.italianNoHiddenPage = true; });
  assert.equal(latest(await add("cane"), "cane").status, "saved");
  await worker.evaluate(() => { globalThis.italianNoHiddenPage = false; });
  assert.deepEqual(openedSites().map((opening) => new URL(opening.url()).pathname), ["/lexicon/ATTRIBUTION.txt"]);
  assert.equal(appTabs().length, 0, "the background tab was closed");
  console.log("Saved through a background tab.");

  const app = await context.newPage();
  await app.goto(`${appUrl}#words`);
  const book = (await stored(app)).cards.find((item) => item.english === "book");
  assert.deepEqual(book.tags, ["from-extension"]);
  assert.equal(book.id, libro.cardId, "the id the extension gave it");
  console.log("Stored with the learner's rules and its id:", book.english, JSON.stringify(book.details.declension));

  // ---- An app tab is open: saved through it, without opening anything. ----
  await app.getByRole("button", { name: "Delete book" }).waitFor();
  await page.evaluate(() => document.getElementById("italian-extension-toast")?.remove());
  await add("uova");
  await add("mano");
  assert.equal(openedSites().length, 0, "nothing opened");
  assert.deepEqual(english(await stored(app)), ["book", "dog, male dog", "egg", "hand"]);
  console.log("Saved through the open app tab.");

  // ---- A saved word changed and undone from the toast or popup changes the stored card. ----
  const mano = latest(await act({ id: latest(await worker.evaluate(() => globalThis.italianReadWords()), "mano").id, action: "english", english: "side" }), "mano");
  assert.equal(mano.status, "saved", JSON.stringify({ ...mano, readings: undefined, lastError: (await worker.evaluate(() => globalThis.italianReadWords())).lastError }));
  const side = (await stored(app)).cards.find((item) => item.id === mano.cardId);
  assert.equal(side.english, "side", "changed in place");
  const undone = await act({ id: mano.id, action: "undo" });
  assert.equal(latest(undone, "mano"), undefined);
  assert.deepEqual(english(await stored(app)), ["book", "dog, male dog", "egg"]);
  console.log("Changing a saved word's English changed its card; Undo removed it.");

  // The open app hadn't seen those changes. Its next save keeps them.
  app.on("dialog", (dialog) => void dialog.accept());
  await app.getByRole("button", { name: "Delete book" }).click();
  await app.getByRole("button", { name: "Delete egg" }).waitFor();
  assert.deepEqual(english(await stored(app)), ["dog, male dog", "egg"]);
  console.log("The app's next save merged the extension's changes in.");

  // ---- A word edited in the app is the app's from then on. ----
  await app.evaluate(() => {
    const inventory = JSON.parse(localStorage.getItem("italian:inventory"));
    inventory.cards.find((card) => card.english === "dog, male dog").english = "dog";
    localStorage.setItem("italian:inventory", JSON.stringify(inventory));
  });
  const cane = latest(await worker.evaluate(() => globalThis.italianReadWords()), "cane");
  const detached = latest(await act({ id: cane.id, action: "undo" }), "cane");
  assert.equal(detached.status, "detached");
  assert.deepEqual(english(await stored(app)), ["dog", "egg"]);
  console.log("A word edited in the app was left alone:", detached.reason);

  // ---- A conflict: the same word changed in another window and deleted in this one. ----
  await app.reload();
  await app.getByRole("button", { name: "Delete egg" }).waitFor();
  await app.evaluate(() => {
    const inventory = JSON.parse(localStorage.getItem("italian:inventory"));
    inventory.cards.find((card) => card.english === "egg").english = "eggs";
    inventory.updatedAt = new Date().toISOString();
    localStorage.setItem("italian:inventory", JSON.stringify(inventory));
  });
  await app.getByRole("button", { name: "Delete egg" }).click();
  const banner = app.getByRole("alert").filter({ hasText: "changed in another window" });
  await banner.waitFor({ timeout: 5000 });
  assert.match(await banner.textContent(), /“uovo”/);
  assert.deepEqual(english(await stored(app)), ["dog", "eggs"], "nothing was written");
  await banner.getByRole("button", { name: "Reload" }).click();
  await app.getByRole("button", { name: "Delete eggs" }).waitFor();
  console.log("Conflict: banner shown, nothing written, Reload shows the other window's change.");

  // ---- Stored data this version doesn't understand is left alone. ----
  await app.evaluate(() => {
    const inventory = JSON.parse(localStorage.getItem("italian:inventory"));
    inventory.cards[0].fromTheFuture = true;
    localStorage.setItem("italian:inventory", JSON.stringify(inventory));
  });
  const refused = await add("gatto");
  assert.equal(latest(refused, "gatto").status, "pending");
  assert.match(refused.lastError, /Update the extension/);
  assert.equal((await stored(app)).cards.length, 2);
  console.log("Unknown stored data: the word waits.", refused.lastError);

  // ---- The popup finds English words too. ----
  const extensionId = new URL(worker.url()).host;
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await popup.getByRole("heading", { name: "Adding “gatto” to Italian…" }).waitFor({ timeout: 5000 });
  assert.equal(await popup.locator("#added .panel").count(), 4);
  console.log("Popup lists the words added:", (await popup.locator("#added .panel h2").allTextContents()).join(" | "));
  await popup.fill("#search", "egg");
  await popup.waitForSelector("#results .item strong", { timeout: 5000 });
  const first = await popup.textContent("#results .item strong");
  assert.match(first, /^uovo/);
  console.log("Popup search:", first);
} finally {
  await context.close();
}
