#!/usr/bin/env node

// One-time conversion of a Parole inventory to nouns that record whether their gender differs with
// plurality (l’uovo / le uova): every noun card's details gain genderDiffersWithPlurality: false.
// Mark the nouns that do change gender afterwards in the word editor.
// Works on exported inventory JSON, on the sync API's stored snapshot, and on the raw value of the
// browser's parole:inventory localStorage key.

import { readFile, writeFile } from "node:fs/promises";

const [, , inputPath, outputPath] = process.argv;
if (!inputPath || !outputPath) {
  console.error("Usage: node scripts/migrate-gender-plurality.mjs <input.json> <output.json>");
  process.exit(1);
}

const input = JSON.parse(await readFile(inputPath, "utf8"));
if (!input || typeof input !== "object" || !Array.isArray(input.cards)) throw new Error("Inventory must contain a cards array.");

let converted = 0;
const cards = input.cards.map((card) => {
  if (card.type !== "noun") return card;
  if ("genderDiffersWithPlurality" in card.details) throw new Error(`Noun card ${card.id} already has genderDiffersWithPlurality; this inventory is already converted.`);
  converted += 1;
  const { declension, gender, articleProfile, articleGroups, ...rest } = card.details;
  return { ...card, details: { declension, gender, genderDiffersWithPlurality: false, articleProfile, articleGroups, ...rest } };
});

await writeFile(outputPath, `${JSON.stringify({ ...input, cards }, null, 2)}\n`, "utf8");
console.log(`Wrote converted inventory to ${outputPath} (${converted} nouns).`);
console.log("Mark nouns like l’uovo / le uova with “Gender differs with plurality” in the word editor.");
