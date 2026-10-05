// Injected into the page where a word was added: the word's panel (panel.ts) in the corner. It
// lives in a shadow root so the page's styles don't reach it.
import type { ToastMessage, WordAction, WordView } from "./messages";
import { panelStyles, renderPanel } from "./panel";

declare global {
  interface Window {
    italianToast?: true;
  }
}

const hideAfterMs = 9_000;

const styles = `
  :host { all: initial; }
  ${panelStyles}
  .panel {
    position: fixed; z-index: 2147483647; right: 16px; bottom: 16px; width: min(380px, calc(100vw - 32px));
    box-shadow: 0 12px 32px rgba(0, 0, 0, .45);
  }
`;

(() => {
  // The background injects this before every toast; once per page is enough.
  if (window.italianToast) return;
  window.italianToast = true;

  const host = document.createElement("div");
  host.id = "italian-extension-toast";
  const root = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = styles;
  root.append(style);
  let hideTimer: ReturnType<typeof setTimeout> | undefined;
  let hovering = false;
  let showing: string | null = null;

  function hide() {
    host.remove();
    showing = null;
  }

  function scheduleHide() {
    clearTimeout(hideTimer);
    if (!hovering) hideTimer = setTimeout(hide, hideAfterMs);
  }

  async function act(action: WordAction) {
    const next = await chrome.runtime.sendMessage(action) as WordView | undefined;
    if (next) render(next);
  }

  function render(view: WordView) {
    root.querySelector(".panel")?.remove();
    const panel = renderPanel(view, (action) => void act(action), hide);
    panel.setAttribute("role", "status");
    panel.addEventListener("mouseenter", () => {
      hovering = true;
      clearTimeout(hideTimer);
    });
    panel.addEventListener("mouseleave", () => {
      hovering = false;
      scheduleHide();
    });
    root.append(panel);
    showing = view.id;
    if (!host.isConnected) document.documentElement.append(host);
    scheduleHide();
  }

  chrome.runtime.onMessage.addListener((message: ToastMessage) => {
    if (message?.type !== "italian-toast") return;
    // An update after a save only matters while that word's toast is still up.
    if (message.refresh !== undefined && (message.refresh !== showing || !host.isConnected)) return;
    render(message.toast);
  });
})();
