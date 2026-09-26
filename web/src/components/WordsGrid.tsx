import { Fragment, type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { CardType, Flashcard } from "../cards/types";
import type { NounMorphology } from "../cards/nounMorphology";
import { typeLabels } from "../cardTypes";
import {
  adjectiveCard,
  adjectiveRowFromCard,
  adverbCard,
  adverbRowFromCard,
  parseTags,
  verbCard,
  verbRowFromCard,
  type AdjectiveBatchRow,
  type AdverbBatchRow,
  type VerbBatchRow,
} from "../cards/editorModel";
import { nounDraftForEditing, resolveNounDraft, type NounDraft } from "../cards/nounDraft";
import { AdjectiveRowCells, AdverbRowCells, NounBatchRowCells, VerbRowCells } from "./CardEditorFields";
import { italianHeadword } from "./CardAnswer";

type Metadata = { setName: string; tags: string };
type GridRow =
  | ({ type: "noun" } & NounDraft & Metadata)
  | ({ type: "verb" } & Omit<VerbBatchRow, "id"> & Metadata)
  | ({ type: "adjective" } & Omit<AdjectiveBatchRow, "id"> & Metadata)
  | ({ type: "adverb" } & Omit<AdverbBatchRow, "id"> & Metadata);

export type GridTab = CardType | "all";

function rowFromCard(card: Flashcard, morphology: NounMorphology): GridRow {
  const metadata = { setName: card.setName ?? "", tags: card.tags.join(", ") };
  if (card.type === "noun") return { type: "noun", ...nounDraftForEditing(card, morphology), ...metadata };
  if (card.type === "verb") {
    const { id: _id, ...row } = verbRowFromCard(card);
    return { type: "verb", ...row, ...metadata };
  }
  if (card.type === "adjective") {
    const { id: _id, ...row } = adjectiveRowFromCard(card);
    return { type: "adjective", ...row, ...metadata };
  }
  const { id: _id, ...row } = adverbRowFromCard(card);
  return { type: "adverb", ...row, ...metadata };
}

function cardFromRow(row: GridRow, id: number, morphology: NounMorphology): Flashcard {
  const common = { id, setName: row.setName.trim() || null, tags: parseTags(row.tags) };
  const english = row.english.trim();
  if (!english) throw new Error("English is required.");
  if (row.type === "noun") {
    const resolved = resolveNounDraft(row, morphology);
    if (!resolved.ok) throw new Error(resolved.error);
    return { ...common, type: "noun", english, details: resolved.details };
  }
  if (row.type === "verb") {
    const fields = [row.infinitive, row.io, row.tu, row.luiLei, row.noi, row.voi, row.loro, row.participle].map((value) => value.trim());
    if (fields.some((value) => !value)) throw new Error("A verb needs the infinitive, all six present-tense forms, and the participle.");
    return verbCard({ ...row, ...common, english, infinitive: fields[0]!, io: fields[1]!, tu: fields[2]!, luiLei: fields[3]!, noi: fields[4]!, voi: fields[5]!, loro: fields[6]!, participle: fields[7]! });
  }
  if (row.type === "adjective") {
    const fields = [row.masculineSingular, row.feminineSingular, row.masculinePlural, row.femininePlural].map((value) => value.trim());
    if (fields.some((value) => !value)) throw new Error("An adjective needs all four forms.");
    return adjectiveCard({ ...common, english, masculineSingular: fields[0]!, feminineSingular: fields[1]!, masculinePlural: fields[2]!, femininePlural: fields[3]! });
  }
  if (!row.form.trim()) throw new Error("An adverb needs its Italian form.");
  return adverbCard({ ...common, english, form: row.form.trim() });
}

const rowKey = (row: GridRow) => JSON.stringify(row);

const typeHeaders: Record<CardType, string[]> = {
  noun: ["English", "Singular", "Plural", "Gender", "Articles", "Rule", "Forms"],
  verb: ["English", "Infinitive", "io", "tu", "lui / lei", "noi", "voi", "loro", "Aux.", "Participle"],
  adjective: ["English", "Masc. sg.", "Fem. sg.", "Masc. pl.", "Fem. pl."],
  adverb: ["English", "Italian"],
};

export function WordsGrid({
  allCards,
  visibleCards,
  tab,
  knownSets,
  morphology,
  selectedIds,
  onToggleSelected,
  onSelectAll,
  onSave,
  onOpen,
  onRemove,
}: {
  allCards: Flashcard[];
  visibleCards: Flashcard[];
  tab: GridTab;
  knownSets: string[];
  morphology: NounMorphology;
  selectedIds: number[];
  onToggleSelected: (id: number) => void;
  onSelectAll: (ids: number[], selected: boolean) => void;
  onSave: (updated: Flashcard[]) => Promise<boolean>;
  onOpen: (card: Flashcard) => void;
  onRemove: (id: number) => void;
}) {
  const baseline = useMemo(() => new Map(allCards.map((card) => [card.id, rowFromCard(card, morphology)])), [allCards, morphology]);
  const [drafts, setDrafts] = useState<Record<number, GridRow>>({});
  const [rowErrors, setRowErrors] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const previousBaseline = useRef(baseline);

  // Keep unsaved edits when the inventory changes underneath them (bulk tags, sync):
  // fields the draft never touched follow the new stored value; edited fields win.
  useEffect(() => {
    const previous = previousBaseline.current;
    previousBaseline.current = baseline;
    if (previous === baseline) return;
    setDrafts((current) => {
      const next: Record<number, GridRow> = {};
      for (const [idText, draft] of Object.entries(current)) {
        const id = Number(idText);
        const before = previous.get(id);
        const after = baseline.get(id);
        if (!after || after.type !== draft.type) continue;
        const merged = { ...draft } as Record<string, unknown>;
        for (const [field, value] of Object.entries(after)) {
          if (before && (before as Record<string, unknown>)[field] === merged[field]) merged[field] = value;
        }
        next[id] = merged as GridRow;
      }
      return next;
    });
  }, [baseline]);

  const dirtyIds = useMemo(() => Object.keys(drafts).map(Number).filter((id) => {
    const original = baseline.get(id);
    return original && rowKey(original) !== rowKey(drafts[id]!);
  }), [baseline, drafts]);
  const visibleIdSet = new Set(visibleCards.map((card) => card.id));
  const hiddenDirty = dirtyIds.filter((id) => !visibleIdSet.has(id)).length;
  const allVisibleSelected = visibleCards.length > 0 && visibleCards.every((card) => selectedIds.includes(card.id));

  function rowFor(card: Flashcard) {
    return drafts[card.id] ?? baseline.get(card.id)!;
  }

  function update(id: number, patch: Record<string, unknown>) {
    setDrafts((current) => ({ ...current, [id]: { ...(current[id] ?? baseline.get(id)!), ...patch } as GridRow }));
    setRowErrors((current) => {
      if (!current[id]) return current;
      const { [id]: _removed, ...rest } = current;
      return rest;
    });
  }

  function discard() {
    setDrafts({});
    setRowErrors({});
    setError("");
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    const updated: Flashcard[] = [];
    const errors: Record<number, string> = {};
    for (const id of dirtyIds) {
      try {
        updated.push(cardFromRow(drafts[id]!, id, morphology));
      } catch (caught) {
        errors[id] = caught instanceof Error ? caught.message : "This row is invalid.";
      }
    }
    setRowErrors(errors);
    const errorCount = Object.keys(errors).length;
    if (errorCount) {
      setError(`${errorCount} ${errorCount === 1 ? "row needs" : "rows need"} fixing before saving.`);
      return;
    }
    setError("");
    setSaving(true);
    const saved = await onSave(updated);
    setSaving(false);
    if (saved) setDrafts({});
    else setError("The changes could not be saved. Your edits are still here.");
  }

  function metadataCells(card: Flashcard, row: GridRow) {
    return <>
      {tab !== "all" && <td data-label="Set"><input aria-label={`Set for ${card.english}`} list="known-card-sets" value={row.setName} onChange={(event) => update(card.id, { setName: event.target.value })} placeholder="—" /></td>}
      <td data-label="Tags"><input aria-label={`Tags for ${card.english}`} value={row.tags} onChange={(event) => update(card.id, { tags: event.target.value })} /></td>
      <td className="row-action-cell"><div className="inventory-row-actions">
        <button type="button" className="row-open" onClick={() => onOpen(card)} aria-label={`Open ${card.english}`} title="Open in editor">↗</button>
        <button type="button" className="row-remove" onClick={() => { if (window.confirm(`Delete “${card.english}”?`)) onRemove(card.id); }} aria-label={`Delete ${card.english}`} title="Delete">×</button>
      </div></td>
    </>;
  }

  function typeCells(card: Flashcard, row: GridRow, index: number) {
    const onField = (field: string, value: unknown) => update(card.id, { [field]: value });
    if (row.type === "noun") return <NounBatchRowCells row={{ ...row, id: String(card.id), pluralSuggested: false }} index={index} morphology={morphology} onChange={onField} />;
    if (row.type === "verb") return <VerbRowCells row={{ ...row, id: String(card.id) }} index={index} onChange={onField} />;
    if (row.type === "adjective") return <AdjectiveRowCells row={{ ...row, id: String(card.id) }} index={index} onChange={onField} />;
    return <AdverbRowCells row={{ ...row, id: String(card.id) }} index={index} onChange={onField} />;
  }

  const headers = tab === "all" ? ["Italian", "English"] : [...typeHeaders[tab], "Set"];
  const columnCount = headers.length + 3;

  return <form className="words-grid" onSubmit={save}>
    <datalist id="known-card-sets">{knownSets.map((name) => <option key={name} value={name} />)}</datalist>
    {visibleCards.length > 0 && <div className="batch-table-wrap grid-table-wrap">
      <table className={`batch-table grid-table grid-${tab}`}>
        <thead><tr>
          <th className="select-cell"><input type="checkbox" aria-label="Select all shown words" checked={allVisibleSelected} onChange={() => onSelectAll(visibleCards.map((card) => card.id), !allVisibleSelected)} /></th>
          {headers.map((header) => <th key={header}>{header}</th>)}
          <th>Tags</th>
          <th><span className="sr-only">Actions</span></th>
        </tr></thead>
        <tbody>
          {visibleCards.map((card, index) => {
            const row = rowFor(card);
            const dirty = dirtyIds.includes(card.id);
            const rowError = rowErrors[card.id];
            return <Fragment key={card.id}>
              <tr className={`${selectedIds.includes(card.id) ? "selected" : ""}${dirty ? " dirty" : ""}${rowError ? " has-error" : ""}`}>
                <td className="select-cell"><input type="checkbox" aria-label={`Select ${card.english}`} checked={selectedIds.includes(card.id)} onChange={() => onToggleSelected(card.id)} /></td>
                {tab === "all" ? <>
                  <td className="italian-cell"><button type="button" className="italian-open" onClick={() => onOpen(card)} title="Open in editor">
                    <span className={`pos-dot ${card.type}`} title={typeLabels[card.type]} />
                    <span lang="it">{italianHeadword(card, morphology)}</span>
                    <small>{typeLabels[card.type].toLowerCase()}{card.setName ? ` · ${card.setName}` : ""}</small>
                  </button></td>
                  <td data-label="English"><input aria-label={`English for ${card.english}`} value={row.english} onChange={(event) => update(card.id, { english: event.target.value })} /></td>
                </> : typeCells(card, row, index)}
                {metadataCells(card, row)}
              </tr>
              {rowError && <tr className="row-error-line"><td colSpan={columnCount}>{card.english}: {rowError}</td></tr>}
            </Fragment>;
          })}
        </tbody>
      </table>
    </div>}
    {(dirtyIds.length > 0 || error) && <div className="grid-save-bar" role="region" aria-label="Unsaved changes">
      {error
        ? <p className="form-error" role="alert">{error}</p>
        : <p><strong>{dirtyIds.length}</strong> unsaved {dirtyIds.length === 1 ? "change" : "changes"}{hiddenDirty ? ` (${hiddenDirty} hidden by filters)` : ""}</p>}
      <button type="button" className="text-button" onClick={discard} disabled={saving}>Discard</button>
      <button type="submit" className="primary-button" disabled={saving || !dirtyIds.length}>{saving ? "Saving…" : "Save changes"}</button>
    </div>}
  </form>;
}
