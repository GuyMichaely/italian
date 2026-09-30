import type { LexiconReading } from "./lexicon/lookup";

/**
 * The messages between the Italian extension's bridge (a content script on the app's pages) and
 * the app, sent with window.postMessage. Shared by web/ and extension/.
 */
export const extensionImportRequestType = "italian-extension-import";
export const extensionImportResultType = "italian-extension-import-result";
export const extensionRequestSource = "italian-capture-extension";
export const extensionResultSource = "italian-web";

/** Every word the extension adds gets this tag, and one with something to check also gets the review tag. */
export const extensionTag = "from-extension";
export const extensionReviewTag = "needs-review";

/**
 * A word added from the extension: a dictionary reading and which of its suggestions to add.
 * The app turns it into a card with its own rules, so the reading, not a finished card, travels.
 */
export type ExtensionWordEntry = {
  id: string;
  /** The text that was selected or searched. */
  word: string;
  reading: LexiconReading;
  /** Index into suggestionsForReading(reading): a gender, plural, or auxiliary. */
  choice: number;
  english: string;
  /** The sentence the word was found in, and the page. */
  context?: string;
  url?: string;
};

export type ExtensionImportRequest = {
  source: typeof extensionRequestSource;
  type: typeof extensionImportRequestType;
  requestId: string;
  /** Finished cards (the older protocol). */
  candidates?: unknown[];
  entries?: ExtensionWordEntry[];
};

export type ExtensionImportResult = {
  source: typeof extensionResultSource;
  type: typeof extensionImportResultType;
  requestId: string;
  ok: boolean;
  importedCount?: number;
  storage?: "browser" | "sync";
  error?: string;
  /** Entry ids that became cards, and the ones that didn't, with why. */
  added?: string[];
  skipped?: { id: string; reason: string }[];
};
