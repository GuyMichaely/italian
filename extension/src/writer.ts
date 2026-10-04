// Injected into a page of the app's site to make the extension's changes to the inventory stored
// there. In an app tab, the background calls window.italianWriteChanges (background.ts). In the
// hidden frame of offscreen.html, it asks the background for the changes itself.
import { writeChanges, type WriteOp, type WriteResult } from "./words";
import type { WriterReady, WriterResult } from "./messages";

declare global {
  interface Window {
    italianWriteChanges?: (ops: WriteOp[]) => WriteResult;
  }
}

window.italianWriteChanges = writeChanges;

if (window.top !== window && location.hash === "#italian-writer") {
  void (async () => {
    const ops = await chrome.runtime.sendMessage({ type: "italian-writer-ready" } satisfies WriterReady) as WriteOp[] | null;
    if (ops) await chrome.runtime.sendMessage({ type: "italian-writer-result", result: writeChanges(ops) } satisfies WriterResult);
  })();
}
