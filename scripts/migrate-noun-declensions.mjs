#!/usr/bin/env node

// One-time conversion of a Parola inventory from the rule/base noun schema to the declension schema:
// - noun details { rule, base, gender, articleProfile } become
//   { declension: { kind: "rule", rule, base }, gender, articleProfile, articleGroups: { singular: null, plural: null } };
// - noun morphology gains the default editable article groups;
// - each syntax gains excludedArticleGroups: ["lo"] for article-bearing shorthand syntaxes
//   (the retired hardcoded "lo nouns need the full declension" policy), [] otherwise.
// Works on exported inventory JSON and on the sync API's stored snapshot ({ cards, nounMorphology, updatedAt }).

import { readFile, writeFile } from "node:fs/promises";

const [, , inputPath, outputPath] = process.argv;
if (!inputPath || !outputPath) {
  console.error("Usage: node scripts/migrate-noun-declensions.mjs <input.json> <output.json>");
  process.exit(1);
}

const defaultArticleGroups = [
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
    startsWith: [],
    masculine: { definiteSingular: "il", definitePlural: "i", indefiniteSingular: "un" },
    feminine: { definiteSingular: "la", definitePlural: "le", indefiniteSingular: "una" },
  },
];

function objectValue(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value;
}

function convertCard(card) {
  if (card?.type !== "noun") return card;
  const details = objectValue(card.details, `Noun card ${card.id} details`);
  if ("declension" in details) return card;
  if (typeof details.rule !== "string" || !details.rule.trim()) throw new Error(`Noun card ${card.id} has no rule/base definition to convert.`);
  return {
    ...card,
    details: {
      declension: { kind: "rule", rule: details.rule, base: String(details.base ?? "") },
      gender: details.gender,
      articleProfile: details.articleProfile,
      articleGroups: { singular: null, plural: null },
    },
  };
}

function isFullDeclension(syntax) {
  const fields = Array.isArray(syntax.fields) ? syntax.fields : [];
  const has = (kind, number, definiteness) => fields.some((field) => field.kind === kind && field.number === number && (!definiteness || field.definiteness === definiteness));
  return has("article", "singular", "definite") && has("article", "plural", "definite") && has("article", "singular", "indefinite")
    && has("noun", "singular") && has("noun", "plural");
}

function convertMorphology(value) {
  const morphology = objectValue(value, "Noun morphology");
  if ("articleGroups" in morphology) return morphology;
  return {
    ...morphology,
    articleGroups: defaultArticleGroups,
    syntaxRules: morphology.syntaxRules.map((syntax) => ({
      ...syntax,
      excludedArticleGroups: syntax.fields.some((field) => field.kind === "article") && !isFullDeclension(syntax) ? ["lo"] : [],
    })),
  };
}

const input = objectValue(JSON.parse(await readFile(inputPath, "utf8")), "Inventory");
if (!Array.isArray(input.cards)) throw new Error("Inventory must contain a cards array.");
const output = {
  ...input,
  cards: input.cards.map(convertCard),
  nounMorphology: convertMorphology(input.nounMorphology),
};
await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(`Wrote converted inventory to ${outputPath}.`);
console.log("Nouns now store a declension and article-group exceptions; the article table is editable under Grammar.");
