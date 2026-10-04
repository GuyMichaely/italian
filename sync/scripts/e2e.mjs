// Tries sync end to end with two "devices" (browser contexts) on the web dev server, against
// `wrangler dev`. Start both (see README.md), then:
//   PLAYWRIGHT=../extension/node_modules/playwright/index.mjs node scripts/e2e.mjs
// The token is the one TOKEN_SECRET=dev-secret (.dev.vars) gives.
import assert from "node:assert/strict";

const { chromium } = await import(process.env.PLAYWRIGHT ?? "playwright");
const appUrl = process.env.APP_URL ?? "http://localhost:5392/";
const syncUrl = process.env.SYNC_URL ?? "http://localhost:8787";

async function devToken(secret = "dev-secret") {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode("italian-sync v1")));
  return `v1.${Buffer.from(signature).toString("base64url")}`;
}

const token = await devToken();
const server = await fetch(`${syncUrl}/inventory`, { headers: { authorization: `Bearer ${token}` } }).then((response) => response.json());
assert.equal(server.inventory, null, "start from an empty local sync server (stop wrangler dev and delete sync/.wrangler)");

const browser = await chromium.launch();
try {
  async function device(name) {
    const context = await browser.newContext();
    const page = await context.newPage();
    page.on("dialog", (dialog) => void dialog.accept());
    // Signing in returns to the app with the token in the address.
    await page.goto(`${appUrl}#sync-token=${encodeURIComponent(token)}`);
    await page.getByText("Synced", { exact: true }).first().waitFor({ timeout: 15000 });
    return { name, page };
  }

  async function addAdverb({ page }, english, italian) {
    await page.getByRole("button", { name: "Add words" }).click();
    await page.getByRole("tab", { name: "Adverbs" }).click();
    await page.getByLabel("Row 1 English").fill(english);
    await page.getByLabel("Row 1 adverb").fill(italian);
    await page.getByRole("button", { name: "Add adverbs" }).click();
    await page.getByRole("button", { name: `Delete ${english}` }).waitFor();
  }

  async function syncNow({ page }) {
    await page.goto(`${appUrl}#/settings`);
    await page.getByRole("button", { name: "Sync now" }).click();
    await page.waitForFunction(() => document.querySelector(".sync-status-card strong")?.textContent !== "Syncing…");
    await page.goto(`${appUrl}#/words`);
  }

  const words = async ({ page }) => (await page.evaluate(() => JSON.parse(localStorage.getItem("italian:inventory") ?? '{"cards":[]}').cards.map((card) => card.english))).sort();

  const laptop = await device("laptop");
  assert.match(laptop.page.url(), /#\/settings$/, "the token was taken out of the address");
  await addAdverb(laptop, "here", "qui");
  await syncNow(laptop);
  const phone = await device("phone");
  await syncNow(phone);
  assert.deepEqual(await words(phone), ["here"]);
  console.log("Signed in on two devices; the second got the first one's word.");

  await addAdverb(laptop, "there", "là");
  await addAdverb(phone, "already", "già");
  await syncNow(laptop);
  await syncNow(phone);
  await syncNow(laptop);
  assert.deepEqual(await words(laptop), ["already", "here", "there"]);
  assert.deepEqual(await words(phone), ["already", "here", "there"]);
  console.log("Words added on each device are on both.");

  // The same word changed on both: the second to sync is asked which to keep.
  for (const [device, english] of [[laptop, "right here"], [phone, "in here"]]) {
    await device.page.goto(`${appUrl}#/words`);
    await device.page.getByLabel("English for here").fill(english);
    await device.page.getByRole("button", { name: "Save changes" }).click();
    await device.page.getByRole("button", { name: `Delete ${english}` }).waitFor();
  }
  await syncNow(laptop);
  await phone.page.goto(`${appUrl}#/settings`);
  await phone.page.getByRole("button", { name: "Sync now" }).click();
  const banner = phone.page.getByRole("alert").filter({ hasText: "with another device" });
  await banner.waitFor({ timeout: 10000 });
  await banner.getByRole("button", { name: "Resolve" }).click();
  const sheet = phone.page.getByRole("dialog");
  await sheet.getByText("Changed differently here and on another device.").waitFor();
  await sheet.locator("label.conflict-side").filter({ hasText: "Other device" }).click();
  await sheet.getByRole("button", { name: "Apply" }).click();
  await sheet.waitFor({ state: "detached" });
  assert.deepEqual(await words(phone), ["already", "right here", "there"]);
  await syncNow(laptop);
  assert.deepEqual(await words(laptop), ["already", "right here", "there"]);
  console.log("A word changed on both devices: the conflict screen asked, and the choice synced.");

  // Signing out keeps the words and stops syncing.
  await phone.page.goto(`${appUrl}#/settings`);
  await phone.page.getByRole("button", { name: "Sign out" }).click();
  await phone.page.getByRole("button", { name: "Sign in with Cloudflare" }).waitFor();
  assert.deepEqual(await words(phone), ["already", "right here", "there"]);
  console.log("Signed out: words kept, sync off.");
} finally {
  await browser.close();
}
