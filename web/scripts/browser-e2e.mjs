import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const baseUrl = process.env.PAROLE_E2E_URL || "http://127.0.0.1:4173/";

const morphology = {
  declensionRules: [
    {
      name: "-chio → -chi",
      gender: null,
      forms: {
        singular: { suffix: "chio" },
        plural: { suffix: "chi" },
      },
    },
  ],
  articleLetters: {
    vowels: ["a", "e", "i", "o", "u", "à", "á", "è", "é", "ì", "í", "ò", "ó", "ù", "ú"],
    consonants: ["b", "c", "d", "f", "g", "h", "j", "k", "l", "m", "n", "p", "q", "r", "s", "t", "v", "w", "x", "y", "z"],
  },
  articleGroups: [
    {
      name: "lo",
      startsWith: ["sC", "z", "gn", "ps", "pn", "x", "y", "iV"],
      masculine: { definiteSingular: "lo", definitePlural: "gli", indefiniteSingular: "uno" },
      feminine: { definiteSingular: "la", definitePlural: "le", indefiniteSingular: "una" },
    },
    {
      name: "vowel",
      startsWith: ["V"],
      masculine: { definiteSingular: "l’", definitePlural: "gli", indefiniteSingular: "un" },
      feminine: { definiteSingular: "l’", definitePlural: "le", indefiniteSingular: "un’" },
    },
    {
      name: "consonant",
      startsWith: ["C"],
      masculine: { definiteSingular: "il", definitePlural: "i", indefiniteSingular: "un" },
      feminine: { definiteSingular: "la", definitePlural: "le", indefiniteSingular: "una" },
    },
  ],
};

const currentInventory = {
  cards: [
    {
      id: 59,
      type: "noun",
      english: "mirror",
      setName: null,
      tags: [],
      details: {
        declension: { kind: "rule", rule: "-chio → -chi", base: "spec" },
        gender: "masculine",
        genderDiffersWithPlurality: false,
        articleProfile: {
          definiteSingular: true,
          definitePlural: true,
          indefiniteSingular: true,
        },
        articleGroups: { singular: null, plural: null },
      },
    },
  ],
  nounMorphology: morphology,
  adjectiveMorphology: {
    declensionRules: [{ name: "-o/-a/-i/-e", endings: { masculineSingular: "o", feminineSingular: "a", masculinePlural: "i", femininePlural: "e" } }],
  },
  studyPreferences: {
    answerKeywords: { masculine: "m", feminine: "f", singularOnly: "s", pluralOnly: "p" },
    nounFullDeclensionRules: [],
    adjectiveFullDeclensionRules: [],
    fullDeclensionCards: [],
  },
};

const staleLocalSnapshot = {
  ...currentInventory,
  cards: currentInventory.cards.map((card) => ({ ...card, italian: "specchio" })),
  updatedAt: "2026-08-20T14:00:00.000Z",
};

let browser;
let page;

try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error));

  await page.addInitScript((snapshot) => {
    const seedKey = "parole:e2e-stale-state-seeded";
    if (window.sessionStorage.getItem(seedKey)) return;
    window.localStorage.clear();
    window.localStorage.setItem("parole:inventory", JSON.stringify(snapshot));
    window.sessionStorage.setItem(seedKey, "1");
  }, staleLocalSnapshot);

  await page.goto(baseUrl, { waitUntil: "networkidle" });

  const storageWarning = page.getByText(/Storage unavailable: Noun card 59 must not store a derived italian field\./i);
  await storageWarning.waitFor({ state: "visible" });

  await page.getByRole("link", { name: "Local" }).click();
  await page.getByLabel("Import inventory JSON").fill(JSON.stringify(currentInventory));

  page.once("dialog", async (dialog) => {
    assert.match(dialog.message(), /Replace the current inventory with the 1-card inventory/i);
    await dialog.accept();
  });

  const navigation = page.waitForNavigation({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Import pasted JSON" }).click();
  await navigation;

  await page.getByRole("navigation", { name: "Main" }).first().getByRole("link", { name: "Study" }).click();
  await page.getByRole("heading", { name: "mirror" }).waitFor({ state: "visible" });
  assert.equal((await page.locator(".study-card .pos-badge").textContent())?.trim(), "Noun");

  const persisted = await page.evaluate(() => JSON.parse(window.localStorage.getItem("parole:inventory") || "null"));
  assert.ok(persisted, "Imported inventory should be persisted to localStorage.");
  assert.equal(persisted.cards.length, 1);
  assert.equal(persisted.cards[0].english, "mirror");
  assert.equal(Object.prototype.hasOwnProperty.call(persisted.cards[0], "italian"), false);

  await page.getByRole("radio", { name: "Type the Italian" }).click();

  const answer = page.getByRole("textbox", { name: "Answer" });
  await answer.fill("lo");
  const stillNeeded = page.locator(".answer-parse-message").filter({ hasText: "Type the noun after its article." });
  await stillNeeded.waitFor({ state: "visible" });

  await answer.fill("lo specchio");
  await page.getByRole("button", { name: "Check answer" }).click();
  await page.getByRole("status").filter({ hasText: "Correct" }).waitFor({ state: "visible" });

  await page.getByRole("button", { name: /Continue/ }).click();
  await page.getByRole("heading", { name: "Session complete" }).waitFor({ state: "visible" });
  await page.getByRole("checkbox", { name: /^Articles/ }).check();
  await page.getByRole("heading", { name: "mirror" }).waitFor({ state: "visible" });
  await page.getByRole("textbox", { name: "Answer" }).fill("uno lo specchio gli");
  await page.getByRole("button", { name: "Check answer" }).click();
  await page.getByRole("status").filter({ hasText: "Correct" }).waitFor({ state: "visible" });

  await page.getByRole("button", { name: /Continue/ }).click();
  await page.getByRole("heading", { name: "Session complete" }).waitFor({ state: "visible" });
  await page.getByRole("checkbox", { name: /^Words/ }).uncheck();
  await page.getByRole("heading", { name: "specchio" }).waitFor({ state: "visible" });
  await page.getByRole("textbox", { name: "Answer" }).fill("gli uno lo");
  await page.getByRole("button", { name: "Check answer" }).click();
  await page.getByRole("status").filter({ hasText: "Correct" }).waitFor({ state: "visible" });

  assert.deepEqual(pageErrors, [], `Unexpected page errors: ${pageErrors.map(String).join("\n")}`);
  console.log("Browser E2E passed: stale inventory replacement, noun prompt metadata, word-mode checking, words with articles, and articles alone.");
} catch (error) {
  await mkdir("test-results", { recursive: true });
  if (page) {
    await page.screenshot({ path: "test-results/browser-e2e.png", fullPage: true }).catch(() => {});
  }
  console.error(error);
  process.exitCode = 1;
} finally {
  await browser?.close();
}
