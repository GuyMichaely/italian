import type { LexiconReading } from "../../web/src/lexicon/lookup";
import { shortSuggestionLabel } from "../../web/src/lexicon/suggestions";
import { appUrl } from "./config";
import { lexicon, lookUpSelection, suggestionsOf } from "./dictionary";
import { wordLabel, type QueueState } from "./queue";
import type { PopupRequest } from "./messages";

const search = document.querySelector<HTMLInputElement>("#search")!;
const results = document.querySelector<HTMLElement>("#results")!;
const queue = document.querySelector<HTMLElement>("#queue")!;
const recent = document.querySelector<HTMLElement>("#recent")!;
document.querySelector<HTMLAnchorElement>("#open-app")!.href = appUrl;

async function request(message: PopupRequest): Promise<QueueState> {
  const response = await chrome.runtime.sendMessage(message) as QueueState | { error: string };
  if ("error" in response) throw new Error(response.error);
  return response;
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(className: string, label: string, onClick: () => void) {
  const node = element("button", className, label);
  node.type = "button";
  node.addEventListener("click", onClick);
  return node;
}

// ---- Search ----

let searchId = 0;

type Found = { word: string; readings: LexiconReading[]; heading: string };

async function lookUp(query: string): Promise<Found[]> {
  const [italian, english] = await Promise.all([lookUpSelection(query), lexicon.searchEnglish(query, 8)]);
  const found: Found[] = [];
  if (italian.readings.length) found.push({ word: italian.word, readings: italian.readings, heading: `Italian “${italian.word}”` });
  const italianWords = new Set(italian.readings.map((reading) => JSON.stringify(reading.headword)));
  // An Italian word also turns up in glosses (“bianco” in “airone bianco”); then only a gloss
  // that is the query itself (“camera”) is worth showing.
  const plain = query.trim().toLocaleLowerCase();
  const exact = (reading: LexiconReading) => reading.headword.glosses.some((gloss) => [plain, `to ${plain}`].includes(gloss.toLocaleLowerCase()));
  const fromEnglish = english.filter((reading) => !italianWords.has(JSON.stringify(reading.headword)) && (!italian.readings.length || exact(reading)));
  if (fromEnglish.length) found.push({ word: query.trim(), readings: fromEnglish, heading: `English “${query.trim()}”` });
  return found;
}

function renderResults(found: Found[], query: string) {
  results.replaceChildren();
  if (!found.length) {
    results.append(element("p", "muted", `Nothing found for “${query}”.`));
    return;
  }
  for (const group of found) {
    results.append(element("h2", undefined, group.heading));
    group.readings.forEach((reading, readingIndex) => {
      suggestionsOf(reading).forEach((suggestion, choice) => {
        const item = element("div", "item");
        item.append(element("strong", undefined, shortSuggestionLabel(suggestion)));
        const add = button("add", "Add", async () => {
          add.disabled = true;
          add.textContent = "Adding…";
          try {
            // Each reading is added on its own, so it keeps just that reading.
            renderQueue(await request({ type: "queue-add", word: reading.headword.word, readings: [group.readings[readingIndex]!], reading: 0, choice }));
            add.textContent = "Added";
          } catch (error) {
            add.textContent = "Failed";
            add.title = error instanceof Error ? error.message : String(error);
          }
        });
        item.append(add);
        item.append(element("small", undefined, suggestion.glosses.slice(0, 3).join("; ")));
        results.append(item);
      });
    });
  }
}

let searchTimer: ReturnType<typeof setTimeout> | undefined;
search.addEventListener("input", () => {
  clearTimeout(searchTimer);
  const query = search.value.trim();
  if (!query) {
    results.replaceChildren();
    return;
  }
  searchTimer = setTimeout(async () => {
    const id = ++searchId;
    try {
      const found = await lookUp(query);
      if (id === searchId) renderResults(found, query);
    } catch (error) {
      if (id === searchId) results.replaceChildren(element("p", "error", error instanceof Error ? error.message : "The dictionary couldn't be loaded."));
    }
  }, 250);
});

// ---- Queue ----

function renderQueue(state: QueueState) {
  queue.replaceChildren();
  if (state.words.length || state.lastError) {
    const heading = element("div", "section-heading");
    heading.append(element("h2", undefined, `Waiting to be saved (${state.words.length})`));
    if (state.words.length) heading.append(button("text-button", "Save now", async () => renderQueue(await request({ type: "deliver-now" }))));
    queue.append(heading);
    if (state.lastError) queue.append(element("p", "error", state.lastError));
    for (const word of state.words) {
      const item = element("div", "item");
      item.append(element("strong", undefined, wordLabel(word)));
      item.append(button("remove", "Remove", async () => renderQueue(await request({ type: "queue-remove", id: word.id }))));
      if (word.status === "failed") item.append(element("small", "reason", word.reason ?? "It wasn't saved."));
      else item.append(element("small", undefined, word.english));
      queue.append(item);
    }
  }

  recent.replaceChildren();
  if (state.recent.length) {
    const heading = element("div", "section-heading");
    heading.append(element("h2", undefined, "Recently saved"));
    heading.append(button("text-button", "Clear", async () => renderQueue(await request({ type: "queue-clear-recent" }))));
    recent.append(heading);
    for (const word of state.recent) {
      const item = element("div", "item");
      item.append(element("strong", undefined, word.label));
      item.append(element("small", word.outcome === "skipped" ? "review" : undefined, word.outcome === "added" ? "Added to your words" : word.reason ?? "Skipped"));
      recent.append(item);
    }
  }
}

void request({ type: "queue-get" }).then(renderQueue);
chrome.storage.onChanged.addListener(() => void request({ type: "queue-get" }).then(renderQueue));
