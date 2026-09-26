// Prototype-only bridge: copies the production app's inventory (older noun schema) into this build's
// separate storage namespace, converting it the same way scripts/migrate-noun-declensions.mjs does.
// Delete this module when the branch replaces production and the migration script has been run.
import { defaultNounMorphology, cloneNounMorphology, normalizeNounMorphology, type NounSyntaxField } from "../cards/nounMorphology";
import { normalizeCard } from "./cardCodec";
import { assertInventoryState } from "./inventoryState";
import { productionStoragePrefix, storagePrefix } from "./keys";
import type { InventoryState } from "./types";

const productionInventoryKey = `${productionStoragePrefix}:inventory`;

type LegacyRecord = Record<string, unknown>;

export function hasProductionInventory() {
  if (typeof window === "undefined" || (storagePrefix as string) === productionStoragePrefix) return false;
  try {
    const stored = JSON.parse(window.localStorage.getItem(productionInventoryKey) ?? "null") as { cards?: unknown } | null;
    return Array.isArray(stored?.cards) && stored.cards.length > 0;
  } catch {
    return false;
  }
}

function convertCard(value: unknown) {
  const card = value as LegacyRecord;
  if (card?.type !== "noun") return card;
  const details = card.details as LegacyRecord;
  if (!details || "declension" in details) return card;
  return {
    ...card,
    details: {
      declension: { kind: "rule", rule: details.rule, base: details.base ?? "" },
      gender: details.gender,
      articleProfile: details.articleProfile,
      articleGroups: { singular: null, plural: null },
    },
  };
}

function isFullDeclension(fields: NounSyntaxField[]) {
  const has = (kind: string, number: string, definiteness?: string) => fields.some((field) => field.kind === kind && field.number === number && (!definiteness || (field.kind === "article" && field.definiteness === definiteness)));
  return has("article", "singular", "definite") && has("article", "plural", "definite") && has("article", "singular", "indefinite")
    && has("noun", "singular") && has("noun", "plural");
}

function convertMorphology(value: unknown) {
  const morphology = value as LegacyRecord;
  if (!morphology || "articleGroups" in morphology) return morphology;
  return {
    ...morphology,
    articleGroups: cloneNounMorphology(defaultNounMorphology).articleGroups,
    syntaxRules: (morphology.syntaxRules as { fields: NounSyntaxField[] }[]).map((syntax) => ({
      ...syntax,
      excludedArticleGroups: syntax.fields.some((field) => field.kind === "article") && !isFullDeclension(syntax.fields) ? ["lo"] : [],
    })),
  };
}

/** Reads and converts the production inventory; throws with a readable message when it cannot be converted. */
export function readProductionInventory(): InventoryState {
  const stored = JSON.parse(window.localStorage.getItem(productionInventoryKey) ?? "null") as LegacyRecord | null;
  if (!stored || !Array.isArray(stored.cards)) throw new Error("The current Parola app has no saved words in this browser.");
  const state: InventoryState = {
    cards: stored.cards.map((card) => normalizeCard(convertCard(card))),
    nounMorphology: normalizeNounMorphology(convertMorphology(stored.nounMorphology)),
  };
  return assertInventoryState(state);
}
