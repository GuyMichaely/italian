import { useRef, useState } from "react";
import {
  parseInventory,
  replaceInventory,
  serializeInventory,
  type CardStorage,
} from "../storage";
import { readLastSynced, type SyncMode, type SyncStatus } from "../storage/cloudSync";
import { syncTime } from "./SaveIndicator";

const modes: { mode: SyncMode; title: string; detail: string }[] = [
  { mode: "automatic", title: "Automatically", detail: "Your changes go up as you make them, and other devices’ changes appear here as they’re made." },
  { mode: "on-edit", title: "When I edit", detail: "Your changes go up as you make them. Other devices’ changes come in then, when you open the app, and when you come back to it." },
  { mode: "manual", title: "Manually", detail: "Only when you press Sync now. Words from your other devices and the extension wait until then, and the longer devices go between syncs, the likelier a clash." },
];

function syncSummary(status: SyncStatus, mode: SyncMode | Error, unsynced: boolean): { title: string; detail: string; tone: "local" | "remote" | "pending" | "warning" } {
  switch (status.state) {
    case "signed-out": return { title: "Not syncing", detail: "Your words are kept in this browser. Sign in to keep the same words on every device.", tone: "local" };
    case "expired": return { title: "Sign in again", detail: "Your sign-in has expired, so this device has stopped syncing. Your words are kept here and sync once you sign in again.", tone: "warning" };
    case "syncing": return { title: "Syncing…", detail: "Merging this browser’s words with the other devices’.", tone: "remote" };
    case "idle":
    case "synced": {
      const at = status.state === "synced" ? status.at : readLastSynced();
      const last = at ? `Last synced ${syncTime(at)}.` : "Not synced yet.";
      if (!unsynced) return { title: "Up to date", detail: `${last} Nothing here is waiting to sync.`, tone: "remote" };
      const next = mode === "manual" ? "Press Sync now to send them." : mode instanceof Error ? "Choose when to sync to send them." : "They’ll sync in a moment.";
      return { title: "Unsynced changes", detail: `${last} Some changes here haven’t synced yet. ${next}`, tone: "pending" };
    }
    case "offline": return { title: "Can’t reach the sync server", detail: status.message, tone: "warning" };
    case "conflict": return { title: "Waiting for you", detail: `${status.error.conflicts.length} ${status.error.conflicts.length === 1 ? "change clashes" : "changes clash"} with another device. Sync is paused until you pick which to keep.`, tone: "warning" };
    case "error": return { title: "Sync failed", detail: status.message, tone: "warning" };
  }
}

export function StorageSettingsPanel({
  storage,
  sync,
  mode,
  onMode,
  onSignIn,
  onSignOut,
  onSyncNow,
  onResolve,
  unsynced,
}: {
  storage: CardStorage;
  sync: SyncStatus;
  mode: SyncMode | Error;
  unsynced: boolean;
  onMode: (mode: SyncMode) => void;
  onSignIn: () => void;
  onSignOut: () => void;
  onSyncNow: () => void;
  onResolve: () => void;
}) {
  const [transferBusy, setTransferBusy] = useState(false);
  const [transferMessage, setTransferMessage] = useState("");
  const [transferError, setTransferError] = useState("");
  const [importText, setImportText] = useState("");
  const importInput = useRef<HTMLInputElement>(null);
  const signedIn = sync.state !== "signed-out";
  const summary = syncSummary(sync, mode, unsynced);

  function currentInventory() {
    return storage.readInventory();
  }

  async function exportInventory() {
    setTransferError("");
    setTransferMessage("");
    setTransferBusy(true);
    try {
      const inventory = await currentInventory();
      const blob = new Blob([serializeInventory(inventory)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `italian-inventory-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setTransferMessage(`Exported ${inventory.cards.length} ${inventory.cards.length === 1 ? "card" : "cards"} with noun morphology and study preferences.`);
    } catch (caught) {
      setTransferError(caught instanceof Error ? caught.message : "Inventory could not be exported.");
    } finally {
      setTransferBusy(false);
    }
  }

  async function copyInventory() {
    setTransferError("");
    setTransferMessage("");
    setTransferBusy(true);
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard access is not available in this browser context.");
      const inventory = await currentInventory();
      await navigator.clipboard.writeText(serializeInventory(inventory));
      setTransferMessage(`Copied ${inventory.cards.length} ${inventory.cards.length === 1 ? "card" : "cards"} with noun morphology to the clipboard.`);
    } catch (caught) {
      setTransferError(caught instanceof Error ? caught.message : "Inventory could not be copied.");
    } finally {
      setTransferBusy(false);
    }
  }

  async function replaceWithImportedInventory(imported: ReturnType<typeof parseInventory>, sourceDescription: string) {
    const confirmed = window.confirm(
      `Replace the current inventory with the ${imported.cards.length}-card inventory ${sourceDescription}?\n\nThis replaces cards, noun morphology, and study preferences${signedIn ? ", and syncs to your other devices" : ""}.`,
    );
    if (!confirmed) {
      setTransferMessage("Import canceled; the current inventory was not changed.");
      return;
    }
    const saved = await replaceInventory(storage, imported);
    setTransferMessage(`Imported ${saved.cards.length} ${saved.cards.length === 1 ? "card" : "cards"} with noun morphology and study preferences. Reloading…`);
    window.location.reload();
  }

  async function importInventory(file: File) {
    setTransferError("");
    setTransferMessage("");
    setTransferBusy(true);
    try {
      await replaceWithImportedInventory(parseInventory(await file.text()), `from ${file.name}`);
    } catch (caught) {
      setTransferError(caught instanceof Error ? caught.message : "Inventory could not be imported.");
    } finally {
      setTransferBusy(false);
      if (importInput.current) importInput.current.value = "";
    }
  }

  async function importInventoryText() {
    setTransferError("");
    setTransferMessage("");
    const text = importText.trim();
    if (!text) {
      setTransferError("Paste inventory JSON before importing.");
      return;
    }
    setTransferBusy(true);
    try {
      await replaceWithImportedInventory(parseInventory(text), "from the pasted JSON");
    } catch (caught) {
      setTransferError(caught instanceof Error ? caught.message : "Inventory could not be imported.");
    } finally {
      setTransferBusy(false);
    }
  }

  return <>
    <section className="settings-section" aria-labelledby="sync-heading">
      <div className="settings-section-heading">
        <h2 id="sync-heading">Sync</h2>
      </div>
      <div className={`sync-status-card ${summary.tone}`}>
        <span className="status-dot" aria-hidden="true" />
        <div>
          <strong>{summary.title}</strong>
          <p>{summary.detail}</p>
        </div>
      </div>
      {signedIn && <fieldset className="radio-cards stacked">
        <legend>When to sync</legend>
        {mode instanceof Error && <p className="form-error" role="alert">{mode.message}</p>}
        {modes.map((option) => <label key={option.mode} className={mode === option.mode ? "selected" : ""}>
          <input type="radio" name="sync-mode" checked={mode === option.mode} onChange={() => onMode(option.mode)} />
          <span><strong>{option.title}</strong><small>{option.detail}</small></span>
        </label>)}
      </fieldset>}
      <div className="button-row start">
        {!signedIn && <button type="button" className="primary-button" onClick={onSignIn}>Sign in with Cloudflare</button>}
        {sync.state === "expired" && <button type="button" className="primary-button" onClick={onSignIn}>Sign in again</button>}
        {sync.state === "conflict" && <button type="button" className="primary-button" onClick={onResolve}>Resolve</button>}
        {signedIn && sync.state !== "conflict" && sync.state !== "expired" && <button type="button" className="neutral-button" onClick={onSyncNow} disabled={sync.state === "syncing"}>Sync now</button>}
        {signedIn && <button type="button" className="text-button" onClick={() => { if (window.confirm("Stop syncing on this device? Your words stay here.")) onSignOut(); }}>Sign out</button>}
      </div>
    </section>

    <section className="settings-section" aria-labelledby="backup-heading">
      <div className="settings-section-heading">
        <h2 id="backup-heading">Backup &amp; restore</h2>
      </div>
      <div className="button-row start">
        <button type="button" className="neutral-button" onClick={() => void exportInventory()} disabled={transferBusy}>Download backup</button>
        <button type="button" className="neutral-button" onClick={() => void copyInventory()} disabled={transferBusy}>Copy to clipboard</button>
      </div>
      <div className="restore-box">
        <h3>Restore</h3>
        <p className="field-hint">Restoring replaces every word and grammar rule{signedIn ? " on every device" : ""}. Make a backup first.</p>
        <div className="button-row start">
          <button type="button" className="neutral-button" onClick={() => importInput.current?.click()} disabled={transferBusy}>Restore from file…</button>
          <input ref={importInput} type="file" accept=".json,application/json" hidden onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void importInventory(file);
          }} />
        </div>
        <label className="field">
          <span>Import inventory JSON</span>
          <textarea
            value={importText}
            onChange={(event) => setImportText(event.target.value)}
            placeholder={'{\n  "cards": [...],\n  "nounMorphology": { ... },\n  "adjectiveMorphology": { ... },\n  "studyPreferences": { ... }\n}'}
            rows={6}
            disabled={transferBusy}
            spellCheck={false}
          />
        </label>
        <div className="button-row start">
          <button type="button" className="neutral-button" onClick={() => void importInventoryText()} disabled={transferBusy || !importText.trim()}>Import pasted JSON</button>
        </div>
      </div>
      {transferMessage && <p className="success-message" role="status">{transferMessage}</p>}
      {transferError && <p className="form-error" role="alert">{transferError}</p>}
    </section>
  </>;
}
