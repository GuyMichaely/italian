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
 * The top bar's status. A problem with saving or syncing, with when this device last synced.
 * Otherwise when it last synced, with a dot: yellow while syncing (or about to), green when it's
 * automatic and connected. Set to sync manually, it shows how many changes wait, and syncs them
 * when pressed.
 */
export function SaveIndicator({ state, sync, mode, live, unsyncedChanges, onSyncNow }: {
  state: SaveState;
  sync: SyncStatus;
  mode: SyncMode | Error;
  live: boolean;
  unsyncedChanges: number;
  onSyncNow: () => void;
}) {
  const problem = state === "failed" ? "Save failed"
    : sync.state === "signed-out" ? null
    : mode instanceof Error ? "Choose when to sync"
    : sync.state === "expired" ? "Sign in again to sync"
    : sync.state === "conflict" ? "Sync needs you"
    : sync.state === "offline" ? "Can’t reach sync"
    : sync.state === "error" ? "Sync failed"
    : null;
  const at = sync.state === "synced" ? sync.at : sync.state === "signed-out" ? null : readLastSynced();
  const last = at && `Last sync ${syncTime(at)}`;
  const title = at ? `Last synced ${new Date(at).toLocaleString()}` : undefined;
  if (problem) return <a className="save-indicator failed" href="#/settings" role="status" aria-live="polite" title={title}><i />{problem}{last && <span className="save-indicator-last"> · {last}</span>}</a>;
  if (sync.state === "signed-out" || mode instanceof Error) return null;
  const syncing = sync.state === "syncing" || (mode !== "manual" && unsyncedChanges > 0) || (mode === "automatic" && !live);
  if (mode === "manual" && unsyncedChanges > 0 && !syncing) {
    const changes = `${unsyncedChanges} ${unsyncedChanges === 1 ? "change" : "changes"}`;
    return <button type="button" className="save-indicator unsynced" onClick={onSyncNow} title={title}>
      <span className="unsynced-count">{unsyncedChanges} unsynced {unsyncedChanges === 1 ? "change" : "changes"}</span>
      <span className="unsynced-action" aria-hidden="true">Sync {changes}</span>
    </button>;
  }
  const dot = syncing ? "syncing" : mode === "automatic" ? "live" : null;
  if (!last && !dot) return null;
  return <a className="save-indicator" href="#/settings" role="status" aria-live="polite" title={title}>{dot && <i className={dot} />}{last ?? "Syncing…"}</a>;
}
