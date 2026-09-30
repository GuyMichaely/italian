// Injected into the page where a word was added: a small panel saying what was added, with
// Undo, the dictionary's other meanings, and its other readings. It lives in a shadow root so
// the page's styles don't reach it.
import type { ToastAction, ToastMessage, ToastState } from "./messages";

declare global {
  interface Window {
    italianToastInstalled?: boolean;
  }
}

const hideAfterMs = 9_000;

const styles = `
  :host { all: initial; }
  .toast {
    position: fixed; z-index: 2147483647; right: 16px; bottom: 16px; width: min(380px, calc(100vw - 32px));
    box-sizing: border-box; padding: 14px 16px; border: 1px solid #353d48; border-radius: 12px;
    background: #14171c; color: #eef0f3; box-shadow: 0 12px 32px rgba(0, 0, 0, .45);
    font: 14px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  }
  .toast.error { border-color: #ef7070; }
  header { display: flex; align-items: flex-start; gap: 10px; }
  h2 { flex: 1; margin: 0; font-size: 14.5px; font-weight: 620; }
  button { font: inherit; cursor: pointer; }
  .undo { padding: 2px 10px; border: 1px solid #353d48; border-radius: 999px; background: transparent; color: #a5b3ff; font-size: 13px; font-weight: 600; }
  .close { padding: 0 4px; border: 0; background: transparent; color: #6e7783; font-size: 18px; line-height: 1; }
  .close:hover { color: #eef0f3; }
  p { margin: 6px 0 0; color: #a0a8b3; font-size: 13px; }
  .row { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; margin-top: 9px; }
  .row > span { color: #6e7783; font-size: 12px; font-weight: 600; }
  .chip { padding: 2px 9px; border: 1px solid #353d48; border-radius: 999px; background: transparent; color: #a0a8b3; font-size: 12.5px; text-align: left; }
  .chip:hover { color: #eef0f3; border-color: #4a5461; }
  .chip.selected { border-color: #8b9dff; background: rgba(139, 157, 255, .13); color: #eef0f3; }
  .note { color: #6e7783; font-size: 12px; }
`;

(() => {
  if (window.italianToastInstalled) return;
  window.italianToastInstalled = true;

  const host = document.createElement("div");
  host.id = "italian-extension-toast";
  const root = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = styles;
  root.append(style);
  let hideTimer: ReturnType<typeof setTimeout> | undefined;
  let hovering = false;

  function hide() {
    host.remove();
  }

  function scheduleHide() {
    clearTimeout(hideTimer);
    if (!hovering) hideTimer = setTimeout(hide, hideAfterMs);
  }

  async function act(action: ToastAction) {
    const next = await chrome.runtime.sendMessage(action) as ToastState | undefined;
    if (next) render(next);
  }

  function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function chip(label: string, selected: boolean, onClick: () => void) {
    const button = element("button", selected ? "chip selected" : "chip", label);
    button.type = "button";
    button.addEventListener("click", onClick);
    return button;
  }

  function render(toast: ToastState) {
    root.querySelector(".toast")?.remove();
    const panel = element("section", toast.tone === "error" ? "toast error" : "toast");
    panel.setAttribute("role", "status");
    panel.addEventListener("mouseenter", () => {
      hovering = true;
      clearTimeout(hideTimer);
      // Hovering keeps the word from being saved while its options are being read.
      if (toast.id) void chrome.runtime.sendMessage({ type: "italian-toast-action", id: toast.id, action: "keep" } satisfies ToastAction);
    });
    panel.addEventListener("mouseleave", () => {
      hovering = false;
      scheduleHide();
    });

    const header = element("header");
    header.append(element("h2", undefined, toast.heading));
    if (toast.id) {
      const undo = element("button", "undo", "Undo");
      undo.type = "button";
      undo.addEventListener("click", () => void act({ type: "italian-toast-action", id: toast.id!, action: "undo" }));
      header.append(undo);
    }
    const close = element("button", "close", "×");
    close.type = "button";
    close.setAttribute("aria-label", "Close");
    close.addEventListener("click", hide);
    header.append(close);
    panel.append(header);

    if (toast.description) panel.append(element("p", undefined, toast.description));
    if (toast.id && toast.meanings.length > 1) {
      const row = element("div", "row");
      row.append(element("span", undefined, "English:"));
      for (const meaning of toast.meanings) {
        row.append(chip(meaning, meaning === toast.english, () => void act({ type: "italian-toast-action", id: toast.id!, action: "english", english: meaning })));
      }
      panel.append(row);
    }
    if (toast.id && toast.options.length > 1) {
      const row = element("div", "row");
      row.append(element("span", undefined, "Readings:"));
      for (const option of toast.options) {
        row.append(chip(option.label, option.selected, () => void act({ type: "italian-toast-action", id: toast.id!, action: "choose", reading: option.reading, choice: option.choice })));
      }
      panel.append(row);
    }
    if (toast.note) panel.append(element("p", "note", toast.note));

    root.append(panel);
    if (!host.isConnected) document.documentElement.append(host);
    scheduleHide();
  }

  chrome.runtime.onMessage.addListener((message: ToastMessage) => {
    if (message?.type === "italian-toast") render(message.toast);
  });
})();
