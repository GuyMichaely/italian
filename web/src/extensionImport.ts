import type { Flashcard } from "./cards/types";
import type { NounMorphology } from "./cards/nounMorphology";
import type { AdjectiveMorphology } from "./cards/adjectiveMorphology";
import { normalizeCard } from "./storage/cardCodec";
import { assertCardsFitMorphology } from "./storage/inventoryState";

export const extensionImportRequestType = "parole-extension-import";
export const extensionImportResultType = "parole-extension-import-result";

export type ExtensionImportRequest = {
  source: "parole-capture-extension";
  type: typeof extensionImportRequestType;
  requestId: string;
  candidates: unknown[];
};

export type ExtensionImportResult = {
  source: "parole-web";
  type: typeof extensionImportResultType;
  requestId: string;
  ok: boolean;
  importedCount?: number;
  storage?: "browser" | "sync";
  error?: string;
};

function text(value: unknown) {
  return String(value ?? "").normalize("NFC").trim();
}

export function parseExtensionImportRequest(value: unknown): ExtensionImportRequest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const request = value as Partial<ExtensionImportRequest>;
  if (request.source !== "parole-capture-extension" || request.type !== extensionImportRequestType) return null;
  const requestId = text(request.requestId);
  if (!requestId || !Array.isArray(request.candidates) || !request.candidates.length) {
    throw new Error("Extension import request is incomplete.");
  }
  return { source: "parole-capture-extension", type: extensionImportRequestType, requestId, candidates: request.candidates };
}

export function extensionCandidatesToCards(values: unknown[], morphology: NounMorphology, adjectiveMorphology: AdjectiveMorphology): Flashcard[] {
  const cards = values.map(normalizeCard);
  assertCardsFitMorphology(cards, morphology, adjectiveMorphology);
  return cards;
}
