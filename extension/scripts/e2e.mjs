// Tries the extension end to end in Chromium: adds words from a page, saves them into the site's
// local storage (through a hidden page, a background tab, and an open app tab), and checks that
// the open app keeps them when it next saves and stops on a real conflict. Needs the web dev server
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
  const add = (word) => worker.evaluate(async ([tabId, url, word]) => globalThis.italianAddSelection(word, { id: tabId, url }), [pageTab, pageUrl, word]);
  const deliver = async () => {
    opened = [];
    await worker.evaluate(() => globalThis.italianDeliver());
    const queue = await worker.evaluate(() => globalThis.italianReadQueue());
    assert.deepEqual(queue.words, [], JSON.stringify(queue));
    return queue;
  };

  // ---- Adding from a page. ----
  await page.evaluate(() => {
    const text = document.getElementById("text").firstChild;
    const range = document.createRange();
    range.setStart(text, 17);
    range.setEnd(text, 22);
    getSelection().addRange(range);
  });
  await add("libri");
  await page.waitForSelector("#italian-extension-toast", { state: "attached", timeout: 5000 });
  const queued = await worker.evaluate(() => globalThis.italianReadQueue());
  assert.equal(queued.words.length, 1);
  assert.equal(queued.words[0].readings[0].headword.word, "libro");
  assert.equal(queued.words[0].context, "Ho comprato due libri ieri.");
  console.log("Added from the page; toast shown.");

  // ---- No app tab open: saved through a hidden page, without opening a tab. ----
  const delivered = await deliver();
  assert.equal(delivered.recent[0].outcome, "added");
  assert.equal(openedSites().length, 0, "no tab opened");
  console.log("Saved through a hidden page.");

  // ---- If the hidden page can't be used: a static page in a background tab, closed afterwards. ----
  await add("cane");
  await worker.evaluate(() => { globalThis.italianNoHiddenPage = true; });
  await deliver();
  await worker.evaluate(() => { globalThis.italianNoHiddenPage = false; });
  assert.deepEqual(openedSites().map((opening) => new URL(opening.url()).pathname), ["/lexicon/ATTRIBUTION.txt"]);
  assert.equal(appTabs().length, 0, "the background tab was closed");
  console.log("Saved through a background tab.");

  const app = await context.newPage();
  await app.goto(`${appUrl}#words`);
  const book = (await stored(app)).cards.find((item) => item.english === "book");
  assert.deepEqual(book.tags, ["from-extension"]);
  assert.ok(book.id >= 2 ** 32, "a random id");
  console.log("Stored with the learner's rules and a random id:", book.english, JSON.stringify(book.details.declension));

  // ---- An app tab is open: saved through it, without opening anything. ----
  await app.getByRole("button", { name: "Delete book" }).waitFor();
  await page.evaluate(() => document.getElementById("italian-extension-toast")?.remove());
  await add("uova");
  await add("mano");
  await deliver();
  assert.equal(openedSites().length, 0, "nothing opened");
  assert.deepEqual(english(await stored(app)), ["book", "dog, male dog", "egg", "hand"]);
  console.log("Saved through the open app tab.");

  // The open app hadn't seen those words. Its next save keeps them.
  app.on("dialog", (dialog) => void dialog.accept());
  await app.getByRole("button", { name: "Delete book" }).click();
  await app.getByRole("button", { name: "Delete egg" }).waitFor();
  assert.deepEqual(english(await stored(app)), ["dog, male dog", "egg", "hand"]);
  console.log("The app's next save merged the new words in.");

  // ---- A conflict: the same word changed in another window and deleted in this one. ----
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
  assert.deepEqual(english(await stored(app)), ["dog, male dog", "eggs", "hand"], "nothing was written");
  await banner.getByRole("button", { name: "Reload" }).click();
  await app.getByRole("button", { name: "Delete eggs" }).waitFor();
  console.log("Conflict: banner shown, nothing written, Reload shows the other window's change.");

  // ---- Stored data this version doesn't understand is left alone. ----
  await app.evaluate(() => {
    const inventory = JSON.parse(localStorage.getItem("italian:inventory"));
    inventory.cards[0].fromTheFuture = true;
    localStorage.setItem("italian:inventory", JSON.stringify(inventory));
  });
  await add("gatto");
  await worker.evaluate(() => globalThis.italianDeliver());
  const refused = await worker.evaluate(() => globalThis.italianReadQueue());
  assert.equal(refused.words.length, 1);
  assert.match(refused.lastError, /Update the extension/);
  assert.equal((await stored(app)).cards.length, 3);
  console.log("Unknown stored data: words kept in the queue.", refused.lastError);

  // ---- The popup finds English words too. ----
  const extensionId = new URL(worker.url()).host;
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await popup.fill("#search", "egg");
  await popup.waitForSelector("#results .item strong", { timeout: 5000 });
  const first = await popup.textContent("#results .item strong");
  assert.match(first, /^uovo/);
  console.log("Popup search:", first);
} finally {
  await context.close();
}
