import type { LexiconReading } from "../../web/src/lexicon/lookup";
import type { WriteResult } from "./words";

/** A word as the toast on the page and the popup show it, or a plain message (id null). */
export type WordView = {
  /** The word the buttons act on; null for a message with nothing to act on. */
  id: string | null;
  heading: string;
  description?: string;
  english?: string;
  meanings: string[];
  options: { reading: number; choice: number; label: string; selected: boolean }[];
  /** The label of the button that takes the word back out, if it can be. */
  undo?: "Undo" | "Dismiss" | null;
  note?: string;
  tone: "normal" | "error";
};

/** Shows a toast; `refresh` only updates the toast already showing that word. */
export type ToastMessage = { type: "italian-toast"; toast: WordView; refresh?: string };

/** From the toast or the popup: a change to a word the extension added. */
export type WordAction =
  | { type: "italian-word-action"; id: string; action: "undo" }
  | { type: "italian-word-action"; id: string; action: "choose"; reading: number; choice: number }
  | { type: "italian-word-action"; id: string; action: "english"; english: string };

/** From the popup to the background, which owns the words. */
export type PopupRequest =
  | { type: "words-get" }
  | { type: "words-add"; word: string; readings: LexiconReading[]; reading: number; choice: number }
  | { type: "words-forget" }
  /** Reads the saved words back from the site, to show changes made in the app. */
  | { type: "words-check" }
  | { type: "words-retry" };

/** From the writer in the hidden frame (offscreen.html): asking for the changes to save, then saying what happened. */
export type WriterReady = { type: "italian-writer-ready" };
export type WriterResult = { type: "italian-writer-result"; result: WriteResult };
