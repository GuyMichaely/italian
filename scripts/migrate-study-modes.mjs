#!/usr/bin/env node

// One-time conversion of an Italian inventory from the syntax-rule noun answers to word and article modes:
// - noun morphology drops inferenceSets and syntaxRules;
// - each declension rule gains a gender: -a → -e, -ca → -che and -ga → -ghe become feminine and
//   -a → -i masculine (only when every noun using the rule has that gender), every other rule null;
// - the inventory gains studyPreferences: the default answer keywords (m, f, s, p), and as
//   fullDeclensionRules every two-form rule that the shorthand syntaxes' inference set left out
//   (the rules that used to need the full declension), with no individually marked nouns.
// Works on exported inventory JSON, on the sync API's stored snapshot, and on the raw value of the
// browser's italian:inventory localStorage key ({ cards, nounMorphology, updatedAt }).

import { readFile, writeFile } from "node:fs/promises";

const [, , inputPath, outputPath] = process.argv;
if (!inputPath || !outputPath) {
  console.error("Usage: node scripts/migrate-study-modes.mjs <input.json> <output.json>");
  process.exit(1);
}

function objectValue(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value;
}

const genderBySuffixes = {
  "a→e": "feminine",
  "a→i": "masculine",
  "ca→che": "feminine",
  "ga→ghe": "feminine",
};

function ruleGender(rule, cards) {
  const gender = genderBySuffixes[`${rule.forms.singular?.suffix ?? "-"}→${rule.forms.plural?.suffix ?? "-"}`];
  if (!gender) return null;
  const users = cards.filter((card) => card.type === "noun" && card.details.declension.kind === "rule" && card.details.declension.rule === rule.name);
  return users.every((card) => card.details.gender === gender) ? gender : null;
}

/** Rules the shorthand syntaxes (answers that give only one noun form) could not assume. */
function drilledRules(morphology) {
  const shorthandSets = new Set((morphology.syntaxRules ?? [])
    .filter((syntax) => {
      const numbers = new Set(syntax.fields.filter((field) => field.kind === "noun").map((field) => field.number));
      return numbers.size === 1 && !syntax.markers.some((marker) => marker.kind === "tantum");
    })
    .map((syntax) => syntax.inferenceSet));
  if (!shorthandSets.size) return [];
  const allowed = new Set((morphology.inferenceSets ?? []).filter((set) => shorthandSets.has(set.name)).flatMap((set) => set.declensionRules));
  return morphology.declensionRules
    .filter((rule) => rule.forms.singular && rule.forms.plural && !allowed.has(rule.name))
    .map((rule) => rule.name);
}

const input = objectValue(JSON.parse(await readFile(inputPath, "utf8")), "Inventory");
if (!Array.isArray(input.cards)) throw new Error("Inventory must contain a cards array.");
if ("studyPreferences" in input) throw new Error("This inventory already has studyPreferences; it is already converted.");
const morphology = objectValue(input.nounMorphology, "Noun morphology");

const { inferenceSets: _inferenceSets, syntaxRules: _syntaxRules, ...rest } = morphology;
const declensionRules = morphology.declensionRules.map(({ name, forms }) => ({ name, gender: ruleGender({ name, forms }, input.cards), forms }));
const output = {
  cards: input.cards,
  nounMorphology: { ...rest, declensionRules },
  studyPreferences: {
    answerKeywords: { masculine: "m", feminine: "f", singularOnly: "s", pluralOnly: "p" },
    fullDeclensionRules: drilledRules(morphology),
    fullDeclensionCards: [],
  },
  ...("updatedAt" in input ? { updatedAt: input.updatedAt } : {}),
};

await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(`Wrote converted inventory to ${outputPath}.`);
for (const rule of declensionRules.filter((item) => item.gender)) console.log(`  ${rule.name}: ${rule.gender} only`);
console.log(`  Drilling (both forms required in word mode): ${output.studyPreferences.fullDeclensionRules.join(", ") || "none"}`);
console.log("Answer keywords are the defaults (m, f, s, p); change them under Settings if you customized them.");
