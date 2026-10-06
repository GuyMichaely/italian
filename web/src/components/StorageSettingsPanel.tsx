import { useRef, useState } from "react";
import {
  parseInventory,
  replaceInventory,
  serializeInventory,
  type CardStorage,
} from "../storage";
import type { MergeChoices, InventoryConflictError } from "../storage/merge";
import type { SyncController } from "@guymichaely/app-sync";
import { SyncSettings, type SyncModeOption } from "@guymichaely/app-sync/react";

const modes: SyncModeOption[] = [
  { mode: "automatic", title: "Automatically", detail: "Your changes go up as you make them, and other devices’ changes appear here as they’re made." },
  { mode: "on-edit", title: "When I edit", detail: "Your changes go up as you make them. Other devices’ changes come in then, when you open the app, and when you come back to it." },
  { mode: "manual", title: "Manually", detail: "Only when you press Sync now. Words from your other devices and the extension wait until then, and the longer devices go between syncs, the likelier a clash." },
];

export function StorageSettingsPanel({
  storage,
  sync,
  signedIn,
  onResolve,
}: {
  storage: CardStorage;
  sync: SyncController<MergeChoices, InventoryConflictError>;
  signedIn: boolean;
  onResolve: () => void;
}) {
  const [transferBusy, setTransferBusy] = useState(false);
  const [transferMessage, setTransferMessage] = useState("");
  const [transferError, setTransferError] = useState("");
  const [importText, setImportText] = useState("");
  const importInput = useRef<HTMLInputElement>(null);

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
    <SyncSettings controller={sync} className="settings-section" modes={modes} onResolve={onResolve} />

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
