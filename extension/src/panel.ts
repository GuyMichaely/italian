// A word's panel: what was added, with Undo, the dictionary's other English meanings, and its
// other readings. The toast on the page and the popup both show words this way.
import type { WordAction, WordView } from "./messages";

export const panelStyles = `
  .panel {
    box-sizing: border-box; padding: 14px 16px; border: 1px solid #353d48; border-radius: 12px;
    background: #14171c; color: #eef0f3; font: 14px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  }
  .panel.error { border-color: #ef7070; }
  .panel header { display: flex; align-items: flex-start; gap: 10px; margin: 0; }
  .panel h2 { flex: 1; margin: 0; color: #eef0f3; font-size: 14.5px; font-weight: 620; letter-spacing: normal; text-transform: none; }
  .panel button { font: inherit; cursor: pointer; }
  .panel .undo { padding: 2px 10px; border: 1px solid #353d48; border-radius: 999px; background: transparent; color: #a5b3ff; font-size: 13px; font-weight: 600; }
  .panel .close { padding: 0 4px; border: 0; background: transparent; color: #6e7783; font-size: 18px; line-height: 1; }
  .panel .close:hover { color: #eef0f3; }
  .panel p { margin: 6px 0 0; color: #a0a8b3; font-size: 13px; }
  .panel .row { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; margin-top: 9px; }
  .panel .row > span { color: #6e7783; font-size: 12px; font-weight: 600; }
  .panel .chip { padding: 2px 9px; border: 1px solid #353d48; border-radius: 999px; background: transparent; color: #a0a8b3; font-size: 12.5px; text-align: left; }
  .panel .chip:hover { color: #eef0f3; border-color: #4a5461; }
  .panel .chip.selected { border-color: #8b9dff; background: rgba(139, 157, 255, .13); color: #eef0f3; }
  .panel .note { color: #6e7783; font-size: 12px; }
  .panel.error .note { color: #ef7070; }
`;

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

/** The panel for a word; `act` sends a change to the background, and `close` adds a close button. */
export function renderPanel(view: WordView, act: (action: WordAction) => void, close?: () => void) {
  const panel = element("section", view.tone === "error" ? "panel error" : "panel");
  const header = element("header");
  header.append(element("h2", undefined, view.heading));
  const id = view.id;
  if (id && view.undo) header.append(button("undo", view.undo, () => act({ type: "italian-word-action", id, action: "undo" })));
  if (close) {
    const closing = button("close", "×", close);
    closing.setAttribute("aria-label", "Close");
    header.append(closing);
  }
  panel.append(header);

  if (view.description) panel.append(element("p", undefined, view.description));
  if (id && view.meanings.length > 1) {
    const row = element("div", "row");
    row.append(element("span", undefined, "English:"));
    for (const meaning of view.meanings) {
      row.append(button(meaning === view.english ? "chip selected" : "chip", meaning, () => act({ type: "italian-word-action", id, action: "english", english: meaning })));
    }
    panel.append(row);
  }
  if (id && view.options.length > 1) {
    const row = element("div", "row");
    row.append(element("span", undefined, "Readings:"));
    for (const option of view.options) {
      row.append(button(option.selected ? "chip selected" : "chip", option.label, () => act({ type: "italian-word-action", id, action: "choose", reading: option.reading, choice: option.choice })));
    }
    panel.append(row);
  }
  if (view.note) panel.append(element("p", "note", view.note));
  return panel;
}
