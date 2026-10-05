import type { SyncMode, SyncStatus } from "../storage/cloudSync";
import { readLastSynced } from "../storage/cloudSync";

export type SaveState = "idle" | "saving" | "saved" | "failed";

/** “14:05” today, “3 Oct” before. */
export function syncTime(iso: string) {
  const date = new Date(iso);
  return date.toDateString() === new Date().toDateString()
    ? date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/**
 * The top bar's status: a problem with saving or syncing if there is one, else when this device
 * last synced, and whether it has changes that haven't synced yet.
 */
export function SaveIndicator({ state, sync, mode, unsynced }: { state: SaveState; sync: SyncStatus; mode: SyncMode | Error; unsynced: boolean }) {
  const problem = state === "failed" ? "Save failed"
    : sync.state === "signed-out" ? null
    : mode instanceof Error ? "Choose when to sync"
    : sync.state === "expired" ? "Sign in again to sync"
    : sync.state === "conflict" ? "Sync needs you"
    : sync.state === "offline" ? "Can’t reach sync"
    : sync.state === "error" ? "Sync failed"
    : null;
  if (problem) return <a className="save-indicator failed" href="#/settings" role="status" aria-live="polite"><i />{problem}</a>;
  if (sync.state === "signed-out") return null;
  const last = sync.state === "synced" ? sync.at : readLastSynced();
  const lastText = last ? `Last sync ${syncTime(last)}` : null;
  if (unsynced) return <a className="save-indicator pending" href="#/settings" role="status" aria-live="polite" title={last ? new Date(last).toLocaleString() : undefined}><i />Unsynced changes{lastText && <span className="save-indicator-last"> · {lastText}</span>}</a>;
  return lastText ? <a className="save-indicator idle" href="#/settings" role="status" aria-live="polite" title={new Date(last!).toLocaleString()}>{lastText}</a> : null;
}
