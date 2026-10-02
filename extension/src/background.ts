import { shortSuggestionLabel } from "../../web/src/lexicon/suggestions";
import { appMatch, quietPageUrl } from "./config";
import { lookUpSelection } from "./dictionary";
import {
  chosenSuggestion,
  emptyQueue,
  newQueuedWord,
  toEntry,
  withChoice,
  withDeliveryResult,
  wordDescription,
  wordOptions,
  type QueuedWord,
  type QueueState,
} from "./queue";
import type { PopupRequest, ToastAction, ToastMessage, ToastState, WriterResult } from "./messages";
import type { WordEntry, WriteResult } from "./words";

declare const DEV_BUILD: boolean;

const menuId = "add-to-italian";
const queueKey = "queue";
/** Words wait this long after the last change before they're saved, so Undo and switching stay local. */
const deliveryDelayMs = 8_000;

// ---- Queue storage. The background is the only writer; changes run one at a time. ----

let queueChain: Promise<unknown> = Promise.resolve();

async function readQueue(): Promise<QueueState> {
  const stored = await chrome.storage.local.get(queueKey);
  return (stored[queueKey] as QueueState | undefined) ?? emptyQueue;
}

function updateQueue(change: (state: QueueState) => QueueState): Promise<QueueState> {
  const next = queueChain.then(async () => {
    const state = change(await readQueue());
    await chrome.storage.local.set({ [queueKey]: state });
    await showCount(state);
    return state;
  });
  queueChain = next.catch(() => undefined);
  return next;
}

async function showCount(state: QueueState) {
  const count = state.words.length;
  await chrome.action.setBadgeText({ text: count ? String(count) : "" });
  await chrome.action.setBadgeBackgroundColor({ color: state.words.some((word) => word.status === "failed") ? "#ef7070" : "#8b9dff" });
}

// ---- Saving words. ----
//
// Words are saved straight into the inventory in the site's local storage, by a script run in a
// page of the site: an Italian tab that's open; else a small page of the site in a frame of a
// hidden extension page (offscreen.html); else that page opened in a background tab. The app
// doesn't take part. An open app window merges these words in when it next saves.

let deliveryTimer: ReturnType<typeof setTimeout> | undefined;

function scheduleDelivery(delayMs = deliveryDelayMs) {
  clearTimeout(deliveryTimer);
  deliveryTimer = setTimeout(() => void deliver(), delayMs);
  // The worker may be stopped before the timer fires; the alarm wakes it to try again.
  void chrome.alarms.create("deliver", { when: Date.now() + Math.max(delayMs, 30_000) });
}

let delivering: Promise<void> | null = null;

function deliver() {
  delivering ??= deliverPending().finally(() => {
    delivering = null;
  });
  return delivering;
}

/** Adds the words to the inventory through a page of the site that has loaded. */
async function writeThrough(tabId: number, entries: WordEntry[]): Promise<WriteResult> {
  await chrome.scripting.executeScript({ target: { tabId }, files: ["writer.js"] });
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (words: WordEntry[]) => window.italianWriteWords!(words),
    args: [entries],
  });
  if (!injection?.result) throw new Error("The page didn't run the script that saves words.");
  return injection.result as WriteResult;
}

/** An open app tab that's loaded and that Chrome hasn't unloaded or frozen, if there is one. */
async function openAppTab(): Promise<number | undefined> {
  const tabs = await chrome.tabs.query({ url: appMatch, status: "complete", discarded: false });
  return tabs.find((tab) => tab.id !== undefined && !(tab as { frozen?: boolean }).frozen)?.id;
}

const pageLoadLimitMs = 30_000;

function loaded(tabId: number) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error("The site didn't load.")), pageLoadLimitMs);
    function finish(error?: Error) {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      if (error) reject(error);
      else resolve();
    }
    function listener(id: number, change: { status?: string }) {
      if (id === tabId && change.status === "complete") finish();
    }
    chrome.tabs.onUpdated.addListener(listener);
    void chrome.tabs.get(tabId).then((tab) => { if (tab.status === "complete") finish(); }, () => finish(new Error("The tab was closed.")));
  });
}

/** Opens a small static page of the site in the background, saves through it, and closes it. */
async function writeThroughQuietPage(entries: WordEntry[]): Promise<WriteResult> {
  const tab = await chrome.tabs.create({ url: quietPageUrl, active: false });
  try {
    await loaded(tab.id!);
    return await writeThrough(tab.id!, entries);
  } finally {
    await chrome.tabs.remove(tab.id!).catch(() => undefined);
  }
}

const writerScriptId = "italian-writer";
let hiddenWrite: { entries: WordEntry[]; resolve: (result: WriteResult) => void } | null = null;

/** Saves through the small page loaded in a frame of offscreen.html, where writer.js runs as a content script. */
async function writeThroughHiddenPage(entries: WordEntry[]): Promise<WriteResult> {
  const registered = await chrome.scripting.getRegisteredContentScripts({ ids: [writerScriptId] });
  if (!registered.length) {
    await chrome.scripting.registerContentScripts([{ id: writerScriptId, matches: [quietPageUrl], js: ["writer.js"], allFrames: true, runAt: "document_end", persistAcrossSessions: false }]);
  }
  await chrome.offscreen.closeDocument().catch(() => undefined);
  try {
    return await new Promise<WriteResult>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("The site didn't load.")), pageLoadLimitMs);
      hiddenWrite = { entries, resolve: (result) => { clearTimeout(timer); resolve(result); } };
      chrome.offscreen.createDocument({
        url: "offscreen.html",
        reasons: [chrome.offscreen.Reason.IFRAME_SCRIPTING],
        justification: "Adds the words you pick to your Italian words, which the Italian site stores.",
      }).catch((error) => { clearTimeout(timer); reject(error); });
    });
  } finally {
    hiddenWrite = null;
    await chrome.offscreen.closeDocument().catch(() => undefined);
  }
}

async function deliverPending() {
  const pending = (await readQueue()).words.filter((word) => word.status === "pending");
  if (!pending.length) return;
  const entries = pending.map(toEntry);
  let result: WriteResult;
  try {
    const appTab = await openAppTab();
    const throughAppTab = appTab === undefined ? Promise.reject(new Error("No Italian tab is open.")) : writeThrough(appTab, entries);
    // scripts/e2e.mjs turns the hidden page off to try the background tab.
    const noHiddenPage = DEV_BUILD && (globalThis as { italianNoHiddenPage?: boolean }).italianNoHiddenPage;
    result = await throughAppTab
      .catch(() => noHiddenPage ? Promise.reject(new Error("Hidden page turned off.")) : writeThroughHiddenPage(entries))
      .catch(() => writeThroughQuietPage(entries));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await updateQueue((state) => ({ ...state, lastError: `The words couldn't be saved: ${reason} Press Save now to try again.` }));
    return;
  }
  await updateQueue((state) => withDeliveryResult(state, pending, result, Date.now()));
}

// ---- The toast on the page. ----

function toastFor(word: QueuedWord): ToastState {
  return {
    id: word.id,
    heading: `Added “${word.word}” to Italian`,
    description: word.english ? `“${word.english}”: ${wordDescription(word)}` : wordDescription(word),
    english: word.english,
    meanings: chosenSuggestion(word)?.glosses ?? [],
    options: wordOptions(word).map((option) => ({
      reading: option.reading,
      choice: option.choice,
      label: shortSuggestionLabel(option.suggestion),
      selected: option.reading === word.reading && option.choice === word.choice,
    })),
    note: "It goes to your words in a few seconds.",
    tone: "normal",
  };
}

function messageToast(heading: string, note?: string, tone: ToastState["tone"] = "normal"): ToastState {
  return { id: null, heading, note, meanings: [], options: [], tone };
}

async function showToast(tabId: number, toast: ToastState) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["toast.js"] });
    await chrome.tabs.sendMessage(tabId, { type: "italian-toast", toast } satisfies ToastMessage);
  } catch {
    // Pages like the Chrome Web Store don't allow scripts; the badge still counts the word.
  }
}

async function toastAction(action: ToastAction): Promise<ToastState> {
  if (action.action === "undo") {
    let removed: QueuedWord | undefined;
    await updateQueue((state) => {
      removed = state.words.find((word) => word.id === action.id);
      return { ...state, words: state.words.filter((word) => word.id !== action.id) };
    });
    return removed ? messageToast(`Removed “${removed.word}”.`) : messageToast("It's already in your words.", "Delete it on the Words page.");
  }
  let changed: QueuedWord | undefined;
  await updateQueue((state) => ({
    ...state,
    words: state.words.map((word) => {
      if (word.id !== action.id) return word;
      changed = action.action === "choose" ? withChoice(word, action.reading, action.choice)
        : action.action === "english" ? { ...word, english: action.english }
        : word;
      return changed;
    }),
  }));
  if (!changed) return messageToast("It's already in your words.", "Change it on the Words page.");
  scheduleDelivery();
  return toastFor(changed);
}

// ---- Adding words. ----

/** The sentence around the selection, kept with the word for later. */
async function selectionContext(tabId: number) {
  try {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const selection = window.getSelection();
        const selected = selection?.toString().trim() ?? "";
        const node = selection?.anchorNode;
        const element = node?.nodeType === Node.TEXT_NODE ? node.parentElement : node as Element | null;
        const text = (element?.textContent ?? "").replace(/\s+/g, " ").trim();
        const sentence = text.split(/(?<=[.!?…])\s+/).find((part) => selected && part.includes(selected));
        return (sentence ?? text).slice(0, 500);
      },
    });
    return typeof injection?.result === "string" && injection.result ? injection.result : undefined;
  } catch {
    return undefined;
  }
}

async function addWord(input: { word: string; readings: QueuedWord["readings"]; reading?: number; choice?: number; context?: string; url?: string }) {
  const word = newQueuedWord({ ...input, id: crypto.randomUUID(), now: Date.now() });
  await updateQueue((state) => ({ ...state, words: [...state.words, word] }));
  scheduleDelivery();
  return word;
}

async function addSelection(text: string, tab: chrome.tabs.Tab | undefined) {
  const tabId = tab?.id;
  let found: Awaited<ReturnType<typeof lookUpSelection>>;
  try {
    found = await lookUpSelection(text);
  } catch (error) {
    if (tabId !== undefined) await showToast(tabId, messageToast("The dictionary couldn't be loaded.", error instanceof Error ? error.message : undefined, "error"));
    return;
  }
  if (!found.readings.length) {
    if (tabId !== undefined) await showToast(tabId, messageToast(`“${found.word || text.trim()}” isn't in the dictionary.`, "It has Italian nouns, verbs, adjectives, and adverbs.", "error"));
    return;
  }
  const context = tabId !== undefined ? await selectionContext(tabId) : undefined;
  const word = await addWord({ word: found.word, readings: found.readings, context, url: tab?.url });
  if (tabId !== undefined) await showToast(tabId, toastFor(word));
}

// ---- Events. ----

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: menuId, title: "Add “%s” to Italian", contexts: ["selection"] });
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === menuId && info.selectionText) void addSelection(info.selectionText, tab);
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "deliver") void deliver();
});

async function handlePopup(request: PopupRequest): Promise<QueueState> {
  switch (request.type) {
    case "queue-get":
      return readQueue();
    case "queue-add":
      await addWord({ word: request.word, readings: request.readings, reading: request.reading, choice: request.choice });
      return readQueue();
    case "queue-remove":
      return updateQueue((state) => ({ ...state, words: state.words.filter((word) => word.id !== request.id) }));
    case "queue-choose": {
      const state = await updateQueue((current) => ({
        ...current,
        words: current.words.map((word) => word.id === request.id ? withChoice(word, request.reading, request.choice) : word),
      }));
      scheduleDelivery();
      return state;
    }
    case "queue-clear-recent":
      return updateQueue((state) => ({ ...state, recent: [] }));
    case "deliver-now":
      await updateQueue((state) => ({ ...state, lastError: undefined, words: state.words.map((word) => ({ ...word, status: "pending" as const, reason: undefined })) }));
      await deliver();
      return readQueue();
  }
}

chrome.runtime.onMessage.addListener((message: { type?: string }, _sender, sendResponse) => {
  if (message?.type === "italian-writer-ready") {
    sendResponse(hiddenWrite?.entries ?? null);
    return;
  }
  if (message?.type === "italian-writer-result") {
    hiddenWrite?.resolve((message as WriterResult).result);
    return;
  }
  if (message?.type === "italian-toast-action") {
    void toastAction(message as ToastAction).then(sendResponse);
    return true;
  }
  if (typeof message?.type === "string" && (message.type.startsWith("queue-") || message.type === "deliver-now")) {
    void handlePopup(message as PopupRequest).then(sendResponse, (error) => sendResponse({ error: error instanceof Error ? error.message : String(error) }));
    return true;
  }
});

// Development builds let scripts/e2e.mjs add a word without the context menu.
if (DEV_BUILD) Object.assign(globalThis, { italianAddSelection: addSelection, italianDeliver: deliver, italianReadQueue: readQueue });

// When the worker starts, show the count and deliver anything left from before.
void readQueue().then((state) => {
  void showCount(state);
  if (state.words.some((word) => word.status === "pending")) scheduleDelivery();
});
