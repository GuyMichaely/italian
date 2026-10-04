import type { LexiconReading } from "../../web/src/lexicon/lookup";
import { shortSuggestionLabel } from "../../web/src/lexicon/suggestions";
import { appUrl } from "./config";
import { lexicon, lookUpSelection, suggestionsOf } from "./dictionary";
import { wordView, type AddedWords } from "./added";
import { panelStyles, renderPanel } from "./panel";
import type { PopupRequest, WordAction } from "./messages";

const search = document.querySelector<HTMLInputElement>("#search")!;
const results = document.querySelector<HTMLElement>("#results")!;
const added = document.querySelector<HTMLElement>("#added")!;
document.querySelector<HTMLAnchorElement>("#open-app")!.href = appUrl;
document.head.append(Object.assign(document.createElement("style"), { textContent: panelStyles }));

async function request(message: PopupRequest): Promise<AddedWords> {
  const response = await chrome.runtime.sendMessage(message) as AddedWords | { error: string };
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
            renderAdded(await request({ type: "words-add", word: reading.headword.word, readings: [group.readings[readingIndex]!], reading: 0, choice }));
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

// ---- Words added ----

async function act(action: WordAction) {
  await chrome.runtime.sendMessage(action);
  renderAdded(await request({ type: "words-get" }));
}

function renderAdded(state: AddedWords) {
  added.replaceChildren();
  if (!state.words.length) return;
  const heading = element("div", "section-heading");
  heading.append(element("h2", undefined, "Added"));
  if (state.lastError) heading.append(button("text-button", "Try again", async () => renderAdded(await request({ type: "words-retry" }))));
  else if (state.words.some((word) => word.status !== "pending")) heading.append(button("text-button", "Clear", async () => renderAdded(await request({ type: "words-forget" }))));
  added.append(heading);
  for (const word of state.words) added.append(renderPanel(wordView(word, state.lastError), (action) => void act(action)));
}

// What the extension knows shows at once; then the cards are read back from the site, and any
// changed in the app since are shown as they are there.
void request({ type: "words-get" }).then(renderAdded).then(() => request({ type: "words-check" })).then(renderAdded);
chrome.storage.onChanged.addListener(() => void request({ type: "words-get" }).then(renderAdded));
