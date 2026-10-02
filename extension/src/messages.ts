import type { LexiconReading } from "../../web/src/lexicon/lookup";
import type { WriteResult } from "./words";

/** What the toast on the page shows after a word is added from the context menu. */
export type ToastState = {
  /** The queued word the buttons act on; null for a message with nothing to undo. */
  id: string | null;
  heading: string;
  description?: string;
  english?: string;
  meanings: string[];
  options: { reading: number; choice: number; label: string; selected: boolean }[];
  note?: string;
  tone: "normal" | "error";
};

export type ToastMessage = { type: "italian-toast"; toast: ToastState };

export type ToastAction =
  | { type: "italian-toast-action"; id: string; action: "undo" }
  | { type: "italian-toast-action"; id: string; action: "choose"; reading: number; choice: number }
  | { type: "italian-toast-action"; id: string; action: "english"; english: string }
  | { type: "italian-toast-action"; id: string; action: "keep" };

/** From the popup to the background, which owns the queue. */
export type PopupRequest =
  | { type: "queue-get" }
  | { type: "queue-add"; word: string; readings: LexiconReading[]; reading: number; choice: number }
  | { type: "queue-remove"; id: string }
  | { type: "queue-choose"; id: string; reading: number; choice: number }
  | { type: "queue-clear-recent" }
  | { type: "deliver-now" };

/** From the writer in the hidden frame (offscreen.html): asking for the words to save, then saying what happened. */
export type WriterReady = { type: "italian-writer-ready" };
export type WriterResult = { type: "italian-writer-result"; result: WriteResult };
