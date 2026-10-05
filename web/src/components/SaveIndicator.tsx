import type { SyncStatus } from "../storage/cloudSync";

export type SaveState = "idle" | "saving" | "saved" | "failed";

function indicator(className: string, text: string) {
  return <div className={`save-indicator ${className}`} role="status" aria-live="polite"><i />{text}</div>;
}

export function SaveIndicator({ state, sync }: { state: SaveState; sync: SyncStatus }) {
  if (state === "saving") return indicator("saving", "Saving…");
  if (state === "failed") return indicator("failed", "Save failed");
  switch (sync.state) {
    case "syncing": return indicator("saving", "Syncing…");
    case "synced": return indicator("saved", "Synced");
    case "conflict": return indicator("failed", "Sync needs you");
    case "offline": return indicator("idle", "Offline");
    case "error": return indicator("failed", "Sync failed");
    case "expired": return indicator("failed", "Sign in again");
    case "signed-out":
    case "idle": return state === "saved" ? indicator("saved", "Saved") : null;
  }
}
