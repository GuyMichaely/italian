import { newCardId } from "../../web/src/cards/ids";
import { appMatch, quietPageUrl } from "./config";
import { lookUpSelection } from "./dictionary";
import {
  lookOps,
  newAddedWord,
  noWords,
  pendingOps,
  trimmed,
  withChoice,
  withEnglish,
  withRemoval,
  withLookResults,
  withWriteResult,
  wordView,
  type AddedWord,
  type AddedWords,
} from "./added";
import type { PopupRequest, ToastMessage, WordAction, WordView, WriterResult } from "./messages";
import type { WriteOp, WriteResult } from "./words";

declare const DEV_BUILD: boolean;

const menuId = "add-to-italian";
const wordsKey = "words";

// ---- The words added, in chrome.storage.local. The background is the only writer; changes run one at a time. ----

let wordsChain: Promise<unknown> = Promise.resolve();

async function readWords(): Promise<AddedWords> {
  const stored = await chrome.storage.local.get(wordsKey);
  return (stored[wordsKey] as AddedWords | undefined) ?? noWords;
}

function updateWords(change: (state: AddedWords) => AddedWords): Promise<AddedWords> {
  const next = wordsChain.then(async () => {
    const state = change(await readWords());
    await chrome.storage.local.set({ [wordsKey]: state });
    await showCount(state);
    return state;
  });
  wordsChain = next.catch(() => undefined);
  return next;
}

/** The badge counts words that need a look: ones that couldn't be added, or saves that failed. */
async function showCount(state: AddedWords) {
  const count = state.words.filter((word) => word.status === "failed" || (word.status === "pending" && state.lastError)).length;
  await chrome.action.setBadgeText({ text: count ? String(count) : "" });
  await chrome.action.setBadgeBackgroundColor({ color: "#ef7070" });
}

// ---- Saving words. ----
//
// Words are saved straight into the inventory in the site's local storage, by a script run in a
// page of the site: an Italian tab that's open; else a small page of the site in a frame of a
// hidden extension page (offscreen.html); else that page opened in a background tab. The app
// doesn't take part. An open app window merges these words in when it next saves.

let delivering: Promise<void> | null = null;
let deliverAgain = false;

/** Saves every change waiting, and any made while that save ran. */
function deliver(): Promise<void> {
  if (delivering) {
    deliverAgain = true;
    return delivering;
  }
  delivering = (async () => {
    do {
      deliverAgain = false;
      await deliverPending();
    } while (deliverAgain);
  })().finally(() => {
    delivering = null;
  });
  return delivering;
}

/** Makes the changes to the inventory through a page of the site that has loaded. */
async function writeThrough(tabId: number, ops: WriteOp[]): Promise<WriteResult> {
  await chrome.scripting.executeScript({ target: { tabId }, files: ["writer.js"] });
  // As JSON text both ways: Chrome drops null fields from objects passed to and from the page.
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (changes: string) => JSON.stringify(window.italianWriteChanges!(JSON.parse(changes))),
    args: [JSON.stringify(ops)],
  });
  if (typeof injection?.result !== "string") throw new Error("The page didn't run the script that saves words.");
  return JSON.parse(injection.result) as WriteResult;
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
async function writeThroughQuietPage(ops: WriteOp[]): Promise<WriteResult> {
  const tab = await chrome.tabs.create({ url: quietPageUrl, active: false });
  try {
    await loaded(tab.id!);
    return await writeThrough(tab.id!, ops);
  } finally {
    await chrome.tabs.remove(tab.id!).catch(() => undefined);
  }
}

const writerScriptId = "italian-writer";
let hiddenWrite: { ops: WriteOp[]; resolve: (result: WriteResult) => void } | null = null;

/** Saves through the small page loaded in a frame of offscreen.html, where writer.js runs as a content script. */
async function writeThroughHiddenPage(ops: WriteOp[]): Promise<WriteResult> {
  const registered = await chrome.scripting.getRegisteredContentScripts({ ids: [writerScriptId] });
  if (!registered.length) {
    await chrome.scripting.registerContentScripts([{ id: writerScriptId, matches: [quietPageUrl], js: ["writer.js"], allFrames: true, runAt: "document_end", persistAcrossSessions: false }]);
  }
  await chrome.offscreen.closeDocument().catch(() => undefined);
  try {
    return await new Promise<WriteResult>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("The site didn't load.")), pageLoadLimitMs);
      hiddenWrite = { ops, resolve: (result) => { clearTimeout(timer); resolve(result); } };
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

/** Words a save is writing right now. Undo on one not stored yet waits for the save, then removes it. */
const writing = new Set<string>();

async function deliverPending() {
  const pending = pendingOps(await readWords());
  if (!pending.length) return;
  const ops = pending.map((item) => item.op);
  for (const op of ops) writing.add(op.id);
  try {
    await writeAndRecord(pending, ops);
  } finally {
    writing.clear();
  }
  await refreshToasts(ops.map((op) => op.id));
}

/**
 * Runs the changes in a page of the site: an open Italian tab, else the hidden page, else (unless
 * `quietly`) the site's static page in a background tab.
 */
async function runInSite(ops: WriteOp[], quietly = false): Promise<WriteResult> {
  const appTab = await openAppTab();
  const throughAppTab = appTab === undefined ? Promise.reject(new Error("No Italian tab is open.")) : writeThrough(appTab, ops);
  // scripts/e2e.mjs turns the hidden page off to try the background tab.
  const noHiddenPage = DEV_BUILD && (globalThis as { italianNoHiddenPage?: boolean }).italianNoHiddenPage;
  const throughHiddenPage = throughAppTab.catch(() => noHiddenPage ? Promise.reject(new Error("Hidden page turned off.")) : writeThroughHiddenPage(ops));
  return quietly ? throughHiddenPage : throughHiddenPage.catch(() => writeThroughQuietPage(ops));
}

async function writeAndRecord(pending: ReturnType<typeof pendingOps>, ops: WriteOp[]) {
  let result: WriteResult;
  try {
    result = await runInSite(ops);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await updateWords((state) => ({ ...state, lastError: `It couldn't be saved: ${reason} It's tried again in a minute.` }));
    void chrome.alarms.create("deliver", { delayInMinutes: 1 });
    return;
  }
  await updateWords((state) => withWriteResult(state, pending, result));
}

let checking: Promise<void> | null = null;

/** Reads the saved words back, after any save running now, without opening a tab. */
function checkStored(): Promise<void> {
  checking ??= (async () => {
    await delivering;
    const looks = lookOps(await readWords());
    if (!looks.length) return;
    let result: WriteResult;
    try {
      result = await runInSite(looks.map((look) => look.op), true);
    } catch {
      return;
    }
    await updateWords((state) => withLookResults(state, looks, result));
  })().finally(() => {
    checking = null;
  });
  return checking;
}

// ---- The toast on the page. ----

/** The tab showing each word's toast, so a save's outcome reaches it. */
const toastTabs = new Map<string, number>();

function messageView(heading: string, note?: string, tone: WordView["tone"] = "normal"): WordView {
  return { id: null, heading, note, meanings: [], options: [], tone };
}

async function viewOf(id: string): Promise<WordView> {
  const state = await readWords();
  const word = state.words.find((item) => item.id === id);
  return word ? wordView(word, state.lastError) : messageView("Removed from your words.");
}

async function showToast(tabId: number, toast: WordView, refresh?: string) {
  try {
    if (refresh === undefined) await chrome.scripting.executeScript({ target: { tabId }, files: ["toast.js"] });
    await chrome.tabs.sendMessage(tabId, { type: "italian-toast", toast, refresh } satisfies ToastMessage);
  } catch {
    // Pages like the Chrome Web Store don't allow scripts; the popup still lists the word.
  }
}

async function refreshToasts(ids: string[]) {
  for (const id of ids) {
    const tabId = toastTabs.get(id);
    if (tabId !== undefined) await showToast(tabId, await viewOf(id), id);
  }
}

async function wordAction(action: WordAction): Promise<WordView> {
  const state = await updateWords((current) => ({
    ...current,
    words: trimmed(current.words.flatMap((word): AddedWord[] => {
      if (word.id !== action.id || word.status === "detached" || word.removing) return [word];
      if (action.action === "undo") return !word.saved && !writing.has(word.id) ? [] : [withRemoval(word)];
      return [action.action === "choose" ? withChoice(word, action.reading, action.choice) : withEnglish(word, action.english)];
    })),
  }));
  void deliver();
  const word = state.words.find((item) => item.id === action.id);
  return word ? wordView(word, state.lastError) : messageView(`Removed from your words.`);
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

async function addWord(input: { word: string; readings: AddedWord["readings"]; reading?: number; choice?: number; context?: string; url?: string }) {
  const word = newAddedWord({ ...input, id: crypto.randomUUID(), cardId: newCardId(), now: Date.now() });
  await updateWords((state) => ({ ...state, words: trimmed([word, ...state.words]) }));
  void deliver();
  return word;
}

async function addSelection(text: string, tab: chrome.tabs.Tab | undefined) {
  const tabId = tab?.id;
  let found: Awaited<ReturnType<typeof lookUpSelection>>;
  try {
    found = await lookUpSelection(text);
  } catch (error) {
    if (tabId !== undefined) await showToast(tabId, messageView("The dictionary couldn't be loaded.", error instanceof Error ? error.message : undefined, "error"));
    return;
  }
  if (!found.readings.length) {
    if (tabId !== undefined) await showToast(tabId, messageView(`“${found.word || text.trim()}” isn't in the dictionary.`, "It has Italian nouns, verbs, adjectives, and adverbs.", "error"));
    return;
  }
  const context = tabId !== undefined ? await selectionContext(tabId) : undefined;
  const word = await addWord({ word: found.word, readings: found.readings, context, url: tab?.url });
  if (tabId === undefined) return;
  toastTabs.set(word.id, tabId);
  await showToast(tabId, await viewOf(word.id));
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

async function handlePopup(request: PopupRequest): Promise<AddedWords> {
  switch (request.type) {
    case "words-get":
      return readWords();
    case "words-add":
      await addWord({ word: request.word, readings: request.readings, reading: request.reading, choice: request.choice });
      return readWords();
    case "words-forget":
      return updateWords((state) => ({ ...state, words: state.words.filter((word) => word.status === "pending") }));
    case "words-check":
      await checkStored();
      return readWords();
    case "words-retry":
      await updateWords((state) => ({ ...state, lastError: undefined }));
      await deliver();
      return readWords();
  }
}

chrome.runtime.onMessage.addListener((message: { type?: string }, _sender, sendResponse) => {
  if (message?.type === "italian-writer-ready") {
    sendResponse(hiddenWrite?.ops ?? null);
    return;
  }
  if (message?.type === "italian-writer-result") {
    hiddenWrite?.resolve((message as WriterResult).result);
    return;
  }
  if (message?.type === "italian-word-action") {
    void wordAction(message as WordAction).then(sendResponse);
    return true;
  }
  if (typeof message?.type === "string" && message.type.startsWith("words-")) {
    void handlePopup(message as PopupRequest).then(sendResponse, (error) => sendResponse({ error: error instanceof Error ? error.message : String(error) }));
    return true;
  }
});

// Development builds let scripts/e2e.mjs add a word without the context menu.
if (DEV_BUILD) Object.assign(globalThis, { italianAddSelection: addSelection, italianDeliver: deliver, italianReadWords: readWords, italianWordAction: wordAction });

// When the worker starts, show the count and save anything left from before.
void readWords().then((state) => {
  void showCount(state);
  if (state.words.some((word) => word.status === "pending")) void deliver();
});
