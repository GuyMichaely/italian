import type { SyncMode, SyncStatus } from "../storage/cloudSync";
import { readLastSynced } from "../storage/cloudSync";

export type SaveState = "idle" | "saving" | "saved" | "failed";

/** “14:05” today, “3 Oct” before. */
function when(iso: string) {
  const date = new Date(iso);
  return date.toDateString() === new Date().toDateString()
    ? date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/** The top bar's status: a problem with saving or syncing if there is one, else when this device last synced. */
export function SaveIndicator({ state, sync, mode }: { state: SaveState; sync: SyncStatus; mode: SyncMode | Error }) {
  const problem = state === "failed" ? "Save failed"
    : sync.state === "signed-out" ? null
    : mode instanceof Error ? "Choose when to sync"
    : sync.state === "expired" ? "Sign in again to sync"
    : sync.state === "conflict" ? "Sync needs you"
    : sync.state === "offline" ? "Can’t reach sync"
    : sync.state === "error" ? "Sync failed"
    : null;
  if (problem) return <a className="save-indicator failed" href="#/settings" role="status" aria-live="polite"><i />{problem}</a>;
  const last = sync.state === "signed-out" ? null : sync.state === "synced" ? sync.at : readLastSynced();
  return last ? <a className="save-indicator idle" href="#/settings" role="status" aria-live="polite" title={new Date(last).toLocaleString()}>Last sync {when(last)}</a> : null;
}
