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

/** An app tab to deliver to: one that's open, or a new one in the background. */
async function appTab(): Promise<{ tabId: number; opened: boolean }> {
  const tabs = await chrome.tabs.query({ url: appMatch });
  const open = tabs.find((tab) => tab.id !== undefined && !tab.discarded);
  if (open?.id !== undefined) return { tabId: open.id, opened: false };
  const created = await chrome.tabs.create({ url: appUrl, active: false });
  return { tabId: created.id!, opened: true };
}

async function sendToApp(tabId: number, entries: ExtensionWordEntry[]): Promise<ExtensionImportResult> {
  const deadline = Date.now() + 30_000;
  for (;;) {
    try {
      const result = await chrome.tabs.sendMessage(tabId, { type: "italian-deliver", entries } satisfies DeliverMessage);
      if (result) return result as ExtensionImportResult;
    } catch {
      // The page (or its bridge) hasn't loaded yet.
    }
    if (Date.now() > deadline) throw new Error("Couldn't reach the Italian app. Open it and press Save now.");
    await sleep(500);
  }
}

async function deliverPending() {
  const pending = (await readQueue()).words.filter((word) => word.status === "pending");
  if (!pending.length) return;
  const { tabId, opened } = await appTab();
  try {
    const result = await sendToApp(tabId, pending.map(toEntry));
    await updateQueue((state) => withDeliveryResult(state, pending, result, Date.now()));
  } catch (error) {
    await updateQueue((state) => ({ ...state, lastError: error instanceof Error ? error.message : String(error) }));
  } finally {
    // Close a tab opened only to deliver, unless the learner switched to it.
    if (opened) {
      const tab = await chrome.tabs.get(tabId).catch(() => null);
      if (tab && !tab.active) await chrome.tabs.remove(tabId).catch(() => undefined);
    }
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
