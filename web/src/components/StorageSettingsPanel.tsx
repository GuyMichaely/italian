import { type FormEvent, useEffect, useRef, useState } from "react";
import {
  parseInventory,
  readSyncStatus,
  replaceInventory,
  serializeInventory,
  subscribeSyncStatus,
  type CardStorage,
  type SyncLoadPolicy,
} from "../storage";

export function StorageSettingsPanel({
  storage,
  endpoint,
  persistLocal,
  loadPolicy,
  onApply,
  onSyncNow,
}: {
  storage: CardStorage;
  endpoint: string;
  persistLocal: boolean;
  loadPolicy: SyncLoadPolicy;
  onApply: (endpoint: string, persistLocal: boolean, loadPolicy: SyncLoadPolicy) => Promise<void>;
  onSyncNow: () => Promise<void>;
}) {
  const [draftEndpoint, setDraftEndpoint] = useState(endpoint);
  const [draftPersistLocal, setDraftPersistLocal] = useState(persistLocal);
  const [draftLoadPolicy, setDraftLoadPolicy] = useState<SyncLoadPolicy>(loadPolicy);
  const [syncStatus, setSyncStatus] = useState(readSyncStatus);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [savedMessage, setSavedMessage] = useState("");
  const [transferBusy, setTransferBusy] = useState(false);
  const [transferMessage, setTransferMessage] = useState("");
  const [transferError, setTransferError] = useState("");
  const [importText, setImportText] = useState("");
  const importInput = useRef<HTMLInputElement>(null);
  const syncConfigured = Boolean(endpoint.trim());
  const draftSyncConfigured = Boolean(draftEndpoint.trim());

  useEffect(() => subscribeSyncStatus(setSyncStatus), []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setSavedMessage("");
    setSaving(true);
    try {
      const normalizedEndpoint = draftEndpoint.trim();
      await onApply(normalizedEndpoint, normalizedEndpoint ? draftPersistLocal : true, draftLoadPolicy);
      setSavedMessage(normalizedEndpoint ? "Sync settings saved." : "Saved. Your words are stored in this browser only.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Sync settings could not be changed.");
    } finally {
      setSaving(false);
    }
  }

  function currentInventory() {
    return storage.readInventory();
  }

  async function exportInventory() {
    setTransferError("");
    setTransferMessage("");
    setTransferBusy(true);
    try {
      const inventory = await currentInventory();
      const blob = new Blob([serializeInventory(inventory.cards, inventory.nounMorphology)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `parola-inventory-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setTransferMessage(`Exported ${inventory.cards.length} ${inventory.cards.length === 1 ? "card" : "cards"} with noun morphology.`);
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
      await navigator.clipboard.writeText(serializeInventory(inventory.cards, inventory.nounMorphology));
      setTransferMessage(`Copied ${inventory.cards.length} ${inventory.cards.length === 1 ? "card" : "cards"} with noun morphology to the clipboard.`);
    } catch (caught) {
      setTransferError(caught instanceof Error ? caught.message : "Inventory could not be copied.");
    } finally {
      setTransferBusy(false);
    }
  }

  async function replaceWithImportedInventory(imported: ReturnType<typeof parseInventory>, sourceDescription: string) {
    const confirmed = window.confirm(
      `Replace the current inventory with the ${imported.cards.length}-card inventory ${sourceDescription}?\n\nThis replaces cards and noun morphology and will sync remotely when sync is configured.`,
    );
    if (!confirmed) {
      setTransferMessage("Import canceled; the current inventory was not changed.");
      return;
    }
    const saved = await replaceInventory(storage, imported);
    setTransferMessage(`Imported ${saved.cards.length} ${saved.cards.length === 1 ? "card" : "cards"} with noun morphology. Reloading Parola…`);
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

  async function syncNow() {
    setTransferError("");
    setTransferMessage("");
    setTransferBusy(true);
    try {
      await onSyncNow();
      setTransferMessage("Sync completed using the newer timestamp.");
    } catch (caught) {
      setTransferError(caught instanceof Error ? caught.message : "Inventory could not be synced.");
    } finally {
      setTransferBusy(false);
    }
  }

  const syncDirty = draftEndpoint.trim() !== endpoint.trim()
    || (draftSyncConfigured && draftPersistLocal !== persistLocal)
    || draftLoadPolicy !== loadPolicy;

  return <>
    <form className="settings-section" onSubmit={submit} aria-labelledby="sync-heading">
      <div className="settings-section-heading">
        <h2 id="sync-heading">Sync</h2>
        <p>Parola always keeps your words in this browser. Add your API server to keep the same copy on every device.</p>
      </div>
      <div className={`sync-status-card ${syncConfigured ? "remote" : "local"}`}>
        <span className="status-dot" aria-hidden="true" />
        <div>
          <strong>{syncConfigured ? syncStatus.message : "Local only"}</strong>
          <p>{syncConfigured ? "Local and remote are copies of one inventory. The copy with the later timestamp wins." : "No sync server configured."}</p>
        </div>
        {syncConfigured && <button type="button" className="neutral-button" onClick={() => void syncNow()} disabled={saving || transferBusy}>Sync now</button>}
      </div>

      <label className="field">
        <span>Sync API endpoint</span>
        <input type="url" inputMode="url" value={draftEndpoint} onChange={(event) => { setDraftEndpoint(event.target.value); setSavedMessage(""); }} placeholder="https://example.com/cards" autoComplete="off" />
      </label>

      <label className="check-option">
        <input type="checkbox" checked={draftSyncConfigured ? draftPersistLocal : true} disabled={!draftSyncConfigured} onChange={(event) => setDraftPersistLocal(event.target.checked)} />
        <span><strong>Keep a persistent local copy</strong><small>{draftSyncConfigured ? "Store the synchronized inventory in this browser between sessions." : "Always on when no sync server is configured."}</small></span>
      </label>

      <fieldset className="radio-cards">
        <legend>When local and remote differ on startup</legend>
        <label className={draftLoadPolicy === "automatic" ? "selected" : ""}>
          <input type="radio" name="sync-load-policy" checked={draftLoadPolicy === "automatic"} onChange={() => setDraftLoadPolicy("automatic")} />
          <span><strong>Sync automatically</strong><small>Copy the newer state over the older one right away.</small></span>
        </label>
        <label className={draftLoadPolicy === "ask" ? "selected" : ""}>
          <input type="radio" name="sync-load-policy" checked={draftLoadPolicy === "ask"} onChange={() => setDraftLoadPolicy("ask")} />
          <span><strong>Ask first</strong><small>Wait until you press Sync now.</small></span>
        </label>
      </fieldset>
      {error && <p className="form-error" role="alert">{error}</p>}
      {savedMessage && <p className="success-message" role="status">{savedMessage}</p>}
      <div className="button-row">
        <button type="submit" className="primary-button" disabled={saving || transferBusy || !syncDirty}>{saving ? "Saving…" : "Save sync settings"}</button>
      </div>
    </form>

    <section className="settings-section" aria-labelledby="backup-heading">
      <div className="settings-section-heading">
        <h2 id="backup-heading">Backup &amp; restore</h2>
        <p>Export your words and grammar rules as JSON, or replace everything from a backup.</p>
      </div>
      <div className="button-row start">
        <button type="button" className="neutral-button" onClick={() => void exportInventory()} disabled={saving || transferBusy}>Download backup</button>
        <button type="button" className="neutral-button" onClick={() => void copyInventory()} disabled={saving || transferBusy}>Copy to clipboard</button>
      </div>
      <div className="restore-box">
        <h3>Restore</h3>
        <p className="field-hint">Restoring replaces every word and grammar rule{syncConfigured ? " and syncs remotely" : ""}. Make a backup first.</p>
        <div className="button-row start">
          <button type="button" className="neutral-button" onClick={() => importInput.current?.click()} disabled={saving || transferBusy}>Restore from file…</button>
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
            placeholder={'{\n  "cards": [...],\n  "nounMorphology": { ... }\n}'}
            rows={6}
            disabled={saving || transferBusy}
            spellCheck={false}
          />
        </label>
        <div className="button-row start">
          <button type="button" className="neutral-button" onClick={() => void importInventoryText()} disabled={saving || transferBusy || !importText.trim()}>Import pasted JSON</button>
        </div>
      </div>
      {transferMessage && <p className="success-message" role="status">{transferMessage}</p>}
      {transferError && <p className="form-error" role="alert">{transferError}</p>}
    </section>
  </>;
}
