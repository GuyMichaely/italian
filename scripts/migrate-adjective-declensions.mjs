#!/usr/bin/env node

// One-time conversion of a Parole inventory to adjective declension rules:
// - the inventory gains adjectiveMorphology with the default adjective rules;
// - each adjective card drops its stored italian and four form fields for a declension: the most
//   specific default rule that produces exactly its forms, or Irregular (with the forms as stored)
//   when none does or two tie;
// - studyPreferences.fullDeclensionRules becomes nounFullDeclensionRules, next to an empty
//   adjectiveFullDeclensionRules.
// Works on exported inventory JSON, on the sync API's stored snapshot, and on the raw value of the
// browser's parole-next:inventory localStorage key.

import { readFile, writeFile } from "node:fs/promises";

const [, , inputPath, outputPath] = process.argv;
if (!inputPath || !outputPath) {
  console.error("Usage: node scripts/migrate-adjective-declensions.mjs <input.json> <output.json>");
  process.exit(1);
}

const forms = ["masculineSingular", "feminineSingular", "masculinePlural", "femininePlural"];

function endings(masculineSingular, feminineSingular, masculinePlural, femininePlural) {
  return { masculineSingular, feminineSingular, masculinePlural, femininePlural };
}

const adjectiveMorphology = {
  declensionRules: [
    { name: "-o/-a/-i/-e", endings: endings("o", "a", "i", "e") },
    { name: "-e/-e/-i/-i", endings: endings("e", "e", "i", "i") },
    { name: "-co/-ca/-chi/-che", endings: endings("co", "ca", "chi", "che") },
    { name: "-co/-ca/-ci/-che", endings: endings("co", "ca", "ci", "che") },
    { name: "-go/-ga/-ghi/-ghe", endings: endings("go", "ga", "ghi", "ghe") },
    { name: "-io/-ia/-i/-ie", endings: endings("io", "ia", "i", "ie") },
    { name: "-cio/-cia/-ci/-ce", endings: endings("cio", "cia", "ci", "ce") },
    { name: "-ista/-ista/-isti/-iste", endings: endings("ista", "ista", "isti", "iste") },
    { name: "Invariable", endings: endings("", "", "", "") },
  ],
};

function normalizeText(value) {
  return String(value).normalize("NFC").trim().toLocaleLowerCase("it-IT").replace(/[’`]/g, "'").replace(/\s+/g, " ");
}

function endingMatches(word, ending) {
  return normalizeText(word).endsWith(normalizeText(ending)) && (!ending || word.length > ending.length);
}

/** The longest masculine singular ending among the rules that fit this word. */
function longestMatchingEnding(word) {
  return Math.max(...adjectiveMorphology.declensionRules.filter((rule) => endingMatches(word, rule.endings.masculineSingular)).map((rule) => [...rule.endings.masculineSingular].length));
}

/** The most specific rule that produces exactly these forms; null when none does or two tie. */
function inferDeclension(stored) {
  const matches = [];
  for (const rule of adjectiveMorphology.declensionRules) {
    const word = stored.masculineSingular;
    const ending = rule.endings.masculineSingular;
    if (!endingMatches(word, ending)) continue;
    const base = word.slice(0, word.length - ending.length);
    if (!forms.every((form) => normalizeText(`${base}${rule.endings[form]}`) === normalizeText(stored[form]))) continue;
    matches.push({ rule: rule.name, base, specificity: [...ending].length });
  }
  matches.sort((left, right) => right.specificity - left.specificity);
  const match = matches[0];
  if (!match || matches[1]?.specificity === match.specificity) return null;
  return { kind: "rule", rule: match.rule, base: match.base };
}

const input = JSON.parse(await readFile(inputPath, "utf8"));
if (!input || typeof input !== "object" || !Array.isArray(input.cards)) throw new Error("Inventory must contain a cards array.");
if ("adjectiveMorphology" in input) throw new Error("This inventory already has adjectiveMorphology; it is already converted.");
const preferences = input.studyPreferences;
if (!preferences || !Array.isArray(preferences.fullDeclensionRules)) throw new Error("Inventory studyPreferences need fullDeclensionRules; convert it with migrate-study-modes.mjs first.");

const irregular = [];
const lessSpecific = [];
const byRule = new Map();
const cards = input.cards.map((card) => {
  if (card.type !== "adjective") return card;
  const { italian, details, ...rest } = card;
  const stored = Object.fromEntries(forms.map((form) => [form, String(details[form] || (form === "masculineSingular" ? italian : "") || "").normalize("NFC").trim()]));
  const missing = forms.find((form) => !stored[form]);
  if (missing) throw new Error(`Adjective card ${card.id} (${card.english}) has no ${missing}; fill it in before converting.`);
  const declension = inferDeclension(stored);
  if (declension) {
    byRule.set(declension.rule, [...(byRule.get(declension.rule) ?? []), stored.masculineSingular]);
    const ending = adjectiveMorphology.declensionRules.find((rule) => rule.name === declension.rule).endings.masculineSingular;
    if ([...ending].length < longestMatchingEnding(stored.masculineSingular)) lessSpecific.push(`${forms.map((form) => stored[form]).join(" ")} (${card.english}, ${declension.rule})`);
  }
  else irregular.push(`${forms.map((form) => stored[form]).join(" ")} (${card.english})`);
  return { ...rest, details: { declension: declension ?? { kind: "irregular", ...stored } } };
});

const { fullDeclensionRules, ...otherPreferences } = preferences;
const output = {
  ...input,
  cards,
  adjectiveMorphology,
  studyPreferences: {
    answerKeywords: otherPreferences.answerKeywords,
    nounFullDeclensionRules: fullDeclensionRules,
    adjectiveFullDeclensionRules: [],
    fullDeclensionCards: otherPreferences.fullDeclensionCards,
  },
};

await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(`Wrote converted inventory to ${outputPath}.`);
for (const [rule, words] of byRule) console.log(`  ${rule}: ${words.join(", ")}`);
console.log(`  Irregular: ${irregular.length ? irregular.join("; ") : "none"}`);
if (lessSpecific.length) console.log(`  Following a less specific rule than their ending suggests: ${lessSpecific.join("; ")}`);
if (irregular.length || lessSpecific.length) console.log("Check these adjectives for typos, then fix them in the word editor with the rule set to Auto.");
