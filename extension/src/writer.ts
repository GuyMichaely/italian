// Injected into a page of the app's site to add queued words to the inventory stored there.
// In an app tab, the background calls window.italianWriteWords with the words (background.ts).
// In the hidden frame of offscreen.html, it asks the background for the words itself.
import { writeWords, type WordEntry, type WriteResult } from "./words";
import type { WriterReady, WriterResult } from "./messages";

declare global {
  interface Window {
    italianWriteWords?: (entries: WordEntry[]) => WriteResult;
  }
}

window.italianWriteWords = writeWords;

if (window.top !== window && location.hash === "#italian-writer") {
  void (async () => {
    const entries = await chrome.runtime.sendMessage({ type: "italian-writer-ready" } satisfies WriterReady) as WordEntry[] | null;
    if (entries) await chrome.runtime.sendMessage({ type: "italian-writer-result", result: writeWords(entries) } satisfies WriterResult);
  })();
}
