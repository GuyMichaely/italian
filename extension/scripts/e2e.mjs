// Tries the extension end to end in Chromium: adds a word from a page, lets it be delivered to
// the app, and checks the app saved it. Needs the web dev server on port 5391 and Playwright:
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

  // Start from an empty inventory.
  const app = await context.newPage();
  await app.goto(appUrl);
  await app.evaluate(() => localStorage.removeItem("italian:inventory"));
  await app.close();

  const page = await context.newPage();
  await page.goto(pageUrl);
  await page.evaluate(() => {
    const text = document.getElementById("text").firstChild;
    const range = document.createRange();
    range.setStart(text, 17);
    range.setEnd(text, 22);
    getSelection().addRange(range);
  });
  const tabId = await worker.evaluate(async (url) => (await chrome.tabs.query({ url })).at(0)?.id, pageUrl);
  await worker.evaluate(async ([tabId, url]) => globalThis.italianAddSelection("libri", { id: tabId, url }), [tabId, pageUrl]);
  await page.waitForSelector("#italian-extension-toast", { state: "attached", timeout: 5000 });
  const queued = await worker.evaluate(() => globalThis.italianReadQueue());
  assert.equal(queued.words.length, 1);
  assert.equal(queued.words[0].readings[0].headword.word, "libro");
  assert.equal(queued.words[0].context, "Ho comprato due libri ieri.");
  console.log("Added from the page; toast shown.");

  // Delivery opens the app in a background tab, hands the word over, and closes the tab.
  await worker.evaluate(() => globalThis.italianDeliver());
  const delivered = await worker.evaluate(() => globalThis.italianReadQueue());
  assert.deepEqual(delivered.words, [], JSON.stringify(delivered));
  assert.equal(delivered.recent[0].outcome, "added");

  const check = await context.newPage();
  await check.goto(appUrl);
  const inventory = await check.evaluate(() => JSON.parse(localStorage.getItem("italian:inventory")));
  const card = inventory.cards.find((item) => item.type === "noun");
  assert.equal(card.english, "book");
  assert.deepEqual(card.tags, ["from-extension"]);
  assert.equal(context.pages().filter((open) => open.url().startsWith(appUrl)).length, 1, "the delivery tab was closed");
  console.log("Delivered and saved:", card.english, JSON.stringify(card.details.declension));

  // An app tab opened before the extension was installed or updated has no working bridge.
  // Delivery injects one and goes through that tab, without opening another.
  const updated = worker;
  const addTo = async (sw, word) => {
    const id = await sw.evaluate(async (url) => (await chrome.tabs.query({ url })).at(0)?.id, pageUrl);
    await sw.evaluate(async ([tabId, url, word]) => globalThis.italianAddSelection(word, { id: tabId, url }), [id, pageUrl, word]);
  };
  await check.goto(`${appUrl}?no-bridge`);
  await page.evaluate(() => document.getElementById("italian-extension-toast")?.remove());
  await addTo(updated, "uova");
  await page.waitForSelector("#italian-extension-toast", { state: "attached", timeout: 5000 });
  let opened = 0;
  context.on("page", (opening) => { if (!opening.url().startsWith("chrome-extension:")) opened += 1; });
  await updated.evaluate(() => globalThis.italianDeliver());
  const afterUpdate = await updated.evaluate(() => globalThis.italianReadQueue());
  assert.deepEqual(afterUpdate.words, [], JSON.stringify(afterUpdate));
  assert.equal(opened, 0, "delivered through the open tab");
  console.log("App tab without a bridge: injected one and delivered through it.");

  // An app tab that never answers (frozen, or an old copy of the app): a fresh tab gets the words.
  await check.close();
  await context.route((url) => url.search === "?stale", (route) => route.fulfill({ contentType: "text/html", body: "<!doctype html><p>Not the app</p>" }));
  const stale = await context.newPage();
  await stale.goto(`${appUrl}?stale`);
  await addTo(updated, "mano");
  opened = 0;
  await updated.evaluate(() => globalThis.italianDeliver());
  const afterStale = await updated.evaluate(() => globalThis.italianReadQueue());
  assert.deepEqual(afterStale.words, [], JSON.stringify(afterStale));
  assert.equal(opened, 1, "a fresh tab was opened");
  assert.equal(context.pages().filter((open) => open.url().startsWith(appUrl) && !open.url().includes("?")).length, 0, "and closed again");
  const saved = await stale.evaluate(() => JSON.parse(localStorage.getItem("italian:inventory")).cards.map((card) => card.english));
  assert.deepEqual(saved.sort(), ["book", "egg", "hand"]);
  console.log("With an unresponsive app tab: delivered through a fresh tab.");
  // The popup finds English words too.
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
