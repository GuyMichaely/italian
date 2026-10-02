// Runs on the app's pages and hands the extension's words to the app with window.postMessage.
import {
  extensionImportRequestType,
  extensionImportResultType,
  extensionRequestSource,
  extensionResultSource,
  type ExtensionImportRequest,
  type ExtensionImportResult,
  type ExtensionWordEntry,
} from "../../web/src/extensionProtocol";
import type { BridgeReady, DeliverMessage } from "./messages";

/** The app answers once its words have loaded; until then the request is repeated. */
const retryMs = 250;
const timeoutMs = 20_000;

function importThroughApp(entries: ExtensionWordEntry[]): Promise<ExtensionImportResult> {
  const requestId = crypto.randomUUID();
  const request: ExtensionImportRequest = { source: extensionRequestSource, type: extensionImportRequestType, requestId, entries };
  return new Promise((resolve) => {
    const finish = (result: ExtensionImportResult) => {
      window.removeEventListener("message", onMessage);
      clearInterval(retry);
      clearTimeout(timeout);
      resolve(result);
    };
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== window.location.origin) return;
      const message = event.data as Partial<ExtensionImportResult> | null;
      if (message?.source !== extensionResultSource || message.type !== extensionImportResultType || message.requestId !== requestId) return;
      finish(message as ExtensionImportResult);
    };
    const post = () => window.postMessage(request, window.location.origin);
    window.addEventListener("message", onMessage);
    const retry = setInterval(post, retryMs);
    const timeout = setTimeout(() => finish({
      source: extensionResultSource,
      type: extensionImportResultType,
      requestId,
      ok: false,
      error: "The app didn't answer. Reload it and try again.",
    }), timeoutMs);
    post();
  });
}

declare global {
  interface Window {
    italianBridgeAlive?: () => boolean;
  }
}

// The background injects the bridge into app tabs opened before the extension was installed or
// updated. A bridge left from an older version of the extension can no longer reach it, so only
// a working one keeps a second from starting.
if (!window.italianBridgeAlive?.()) {
  window.italianBridgeAlive = () => Boolean(chrome.runtime?.id);

  chrome.runtime.onMessage.addListener((message: DeliverMessage, _sender, sendResponse) => {
    if (message?.type !== "italian-deliver") return;
    void importThroughApp(message.entries).then(sendResponse);
    return true;
  });

  void chrome.runtime.sendMessage({ type: "italian-bridge-ready" } satisfies BridgeReady).catch(() => {
    // The background may be restarting; it delivers on its own schedule too.
  });
}
