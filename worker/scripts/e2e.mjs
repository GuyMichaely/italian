// Tries sync end to end with two "devices" (browser contexts) on the web dev server, whose /sync
// goes to `wrangler dev` (no Cloudflare Access in front, so anyone may call it). Start both (see
// README.md), then:
//   PLAYWRIGHT=../extension/node_modules/playwright/index.mjs node scripts/e2e.mjs
import assert from "node:assert/strict";

const { chromium } = await import(process.env.PLAYWRIGHT ?? "playwright");
const appUrl = "http://localhost:5391/";
const syncUrl = `${appUrl}sync`;

const server = await fetch(`${syncUrl}/inventory`).then((response) => response.json());
assert.equal(server.inventory, null, "start from an empty local sync server (stop wrangler dev and delete sync/.wrangler)");

const browser = await chromium.launch();
try {
  async function device(name) {
    const context = await browser.newContext();
    const page = await context.newPage();
    page.on("dialog", (dialog) => void dialog.accept());
    await page.goto(`${appUrl}#/settings`);
    await page.getByRole("button", { name: "Sign in with Cloudflare" }).click();
    await page.waitForURL(appUrl);
    await page.locator(".sync-indicator", { hasText: "Last sync" }).waitFor({ timeout: 15000 });
    return { name, page };
  }

  async function addAdverb({ page }, english, italian) {
    await page.getByRole("banner").getByRole("button", { name: "Add words" }).click();
    await page.getByRole("tab", { name: "Adverbs" }).click();
    await page.getByLabel("Row 1 English").fill(english);
    await page.getByLabel("Row 1 adverb").fill(italian);
    await page.getByRole("button", { name: "Add adverbs" }).click();
    await page.getByRole("button", { name: `Delete ${english}` }).waitFor();
  }

  async function syncNow({ page }) {
    await page.goto(`${appUrl}#/settings`);
    const before = await page.evaluate(() => localStorage.getItem("italian:sync-at"));
    await page.getByRole("button", { name: "Sync now" }).click();
    await page.waitForFunction((before) => localStorage.getItem("italian:sync-at") !== before, before);
    await page.goto(`${appUrl}#/words`);
  }

  /** Waits for the server to have a word: an automatic device uploads a moment after an edit. */
  async function serverHas(english) {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const stored = await fetch(`${syncUrl}/inventory`).then((response) => response.json());
      if (stored.inventory?.cards.some((card) => card.english === english)) return;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    assert.fail(`the server never got “${english}”`);
  }

  const words = async ({ page }) => (await page.evaluate(() => JSON.parse(localStorage.getItem("italian:inventory") ?? '{"cards":[]}').cards.map((card) => card.english))).sort();

  const laptop = await device("laptop");
  await addAdverb(laptop, "here", "qui");
  await syncNow(laptop);
  const phone = await device("phone");
  await syncNow(phone);
  assert.deepEqual(await words(phone), ["here"]);
  console.log("Signed in on two devices; the second got the first one's word.");

  // Both sync automatically: a word added on one shows on the other without anyone syncing.
  await phone.page.goto(`${appUrl}#/words`);
  await addAdverb(laptop, "there", "là");
  await phone.page.getByRole("button", { name: "Delete there" }).waitFor({ timeout: 10000 });
  await addAdverb(phone, "already", "già");
  await laptop.page.getByRole("button", { name: "Delete already" }).waitFor({ timeout: 10000 });
  assert.deepEqual(await words(laptop), ["already", "here", "there"]);
  assert.deepEqual(await words(phone), ["already", "here", "there"]);
  console.log("Live: a word added on either device appeared on the other on its own.");

  // Manually: nothing comes in until Sync now.
  await phone.page.goto(`${appUrl}#/settings`);
  await phone.page.getByText("Manually", { exact: true }).click();
  await addAdverb(laptop, "never", "mai");
  await phone.page.waitForTimeout(3000);
  assert.ok(!(await words(phone)).includes("never"), "a manual device waits");
  console.log("Manually: the other device's word waits.");

  // The same word changed on both while the phone waits: Sync now asks which to keep.
  for (const [device, english] of [[laptop, "right here"], [phone, "in here"]]) {
    await device.page.goto(`${appUrl}#/words`);
    await device.page.getByLabel("English for here").fill(english);
    await device.page.getByRole("button", { name: "Save changes" }).click();
    await device.page.getByRole("button", { name: `Delete ${english}` }).waitFor();
  }
  await serverHas("right here");
  await phone.page.goto(`${appUrl}#/settings`);
  await phone.page.getByRole("button", { name: "Sync now" }).click();
  const banner = phone.page.getByRole("alert").filter({ hasText: "with another device" });
  await banner.waitFor({ timeout: 10000 });
  assert.ok((await words(phone)).includes("in here"), "nothing changes while a conflict waits");
  await banner.getByRole("button", { name: "Resolve" }).click();
  const sheet = phone.page.getByRole("dialog");
  await sheet.getByText("Changed differently here and on another device.").waitFor();
  await sheet.locator("label.conflict-side").filter({ hasText: "Other device" }).click();
  await sheet.getByRole("button", { name: "Apply" }).click();
  await sheet.waitFor({ state: "detached" });
  assert.deepEqual(await words(phone), ["already", "never", "right here", "there"]);
  assert.deepEqual(await words(laptop), ["already", "never", "right here", "there"]);
  console.log("Sync now brought the waiting word, and the conflict screen settled the word changed on both.");

  // Signing out keeps the words and stops syncing.
  await phone.page.goto(`${appUrl}#/settings`);
  await phone.page.getByRole("button", { name: "Sign out" }).click();
  await phone.page.getByRole("button", { name: "Sign in with Cloudflare" }).waitFor();
  assert.deepEqual(await words(phone), ["already", "never", "right here", "there"]);
  console.log("Signed out: words kept, sync off.");
} finally {
  await browser.close();
}
