import type { ExtensionImportResult, ExtensionWordEntry } from "../../web/src/extensionProtocol";
import { shortSuggestionLabel } from "../../web/src/lexicon/suggestions";
import { appMatch, appUrl } from "./config";
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
import type { DeliverMessage, PopupRequest, ToastAction, ToastMessage, ToastState } from "./messages";

declare const DEV_BUILD: boolean;

const menuId = "add-to-italian";
const queueKey = "queue";
/** Words wait this long after the last change before going to the app, so Undo and switching stay local. */
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

// ---- Delivery to the app. ----

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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Rejects if the promise takes longer than `ms`, so one tab that never answers can't hold up every later delivery. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("The app took too long to answer.")), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

/** An open app tab Chrome hasn't unloaded, if there is one. */
async function openAppTab(): Promise<number | undefined> {
  const tabs = await chrome.tabs.query({ url: appMatch });
  return tabs.find((tab) => tab.id !== undefined && !tab.discarded && tab.status === "complete")?.id;
}

/**
 * Hands words to the bridge in an app tab. A tab opened before the extension was installed or
 * updated has no working bridge, so one is injected when the page is loaded but doesn't answer.
 */
async function sendToApp(tabId: number, entries: ExtensionWordEntry[], waitMs: number): Promise<ExtensionImportResult> {
  const deadline = Date.now() + waitMs;
  let injected = false;
  for (;;) {
    try {
      // The bridge itself gives up after 20 seconds of the app not answering.
      const result = await withTimeout(chrome.tabs.sendMessage(tabId, { type: "italian-deliver", entries } satisfies DeliverMessage), 25_000);
      if (result) return result as ExtensionImportResult;
    } catch (error) {
      if (error instanceof Error && error.message === "The app took too long to answer.") throw error;
      const tab = await chrome.tabs.get(tabId).catch(() => null);
      if (!tab) throw new Error("The Italian tab was closed.");
      if (!injected && tab.status === "complete") {
        injected = true;
        await chrome.scripting.executeScript({ target: { tabId }, files: ["bridge.js"] }).catch(() => undefined);
        continue;
      }
    }
    if (Date.now() > deadline) throw new Error("Couldn't reach the Italian app.");
    await sleep(500);
  }
}

async function deliverPending() {
  const pending = (await readQueue()).words.filter((word) => word.status === "pending");
  if (!pending.length) return;
  const entries = pending.map(toEntry);
  const record = (result: ExtensionImportResult) => updateQueue((state) => withDeliveryResult(state, pending, result, Date.now()));

  // First an open app tab. It may be frozen in the background or running an older copy of the
  // app, so if it doesn't take the words, a fresh tab gets them instead.
  const existing = await openAppTab();
  if (existing !== undefined) {
    try {
      const result = await sendToApp(existing, entries, 5_000);
      if (result.ok) {
        await record(result);
        return;
      }
    } catch {
      // Fall through to a fresh tab.
    }
  }

  const created = await chrome.tabs.create({ url: appUrl, active: false });
  const tabId = created.id!;
  try {
    await record(await sendToApp(tabId, entries, 30_000));
  } catch (error) {
    await updateQueue((state) => ({ ...state, lastError: `${error instanceof Error ? error.message : String(error)} Open Italian and press Save now.` }));
  } finally {
    // Close the tab opened only to deliver, unless the learner switched to it.
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (tab && !tab.active) await chrome.tabs.remove(tabId).catch(() => undefined);
  }
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
  if (message?.type === "italian-bridge-ready") {
    void readQueue().then((state) => {
      if (state.words.some((word) => word.status === "pending")) scheduleDelivery(1_000);
    });
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
