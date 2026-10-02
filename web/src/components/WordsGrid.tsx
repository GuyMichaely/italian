import { Fragment, type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { CardType, Flashcard } from "../cards/types";
import type { NounMorphology } from "../cards/nounMorphology";
import { typeLabels } from "../cardTypes";
import {
  adverbCard,
  adverbRowFromCard,
  emptyAdjectiveBatchRow,
  emptyAdverbBatchRow,
  emptyNounBatchRow,
  emptyVerbBatchRow,
  newRowId,
  parseTags,
  verbCard,
  verbRowFromCard,
  type AdjectiveBatchRow,
  type AdverbBatchRow,
  type NounBatchRow,
  type VerbBatchRow,
} from "../cards/editorModel";
import {
  adjectiveRowUsed,
  adverbRowUsed,
  nounRowUsed,
  updateAdjectiveBatchRow,
  updateNounBatchRow,
  verbRowUsed,
  withSpareRows,
  withoutRow,
} from "../cards/batchRows";
import { nounDraftForEditing, nounDraftWithRule, resolveNounDraft, type NounDraft } from "../cards/nounDraft";
import { adjectiveDraftForEditing, resolveAdjectiveDraft } from "../cards/adjectiveDraft";
import type { AdjectiveMorphology } from "../cards/adjectiveMorphology";
import { AdjectiveRowCells, AdverbRowCells, NounBatchRowCells, VerbRowCells } from "./CardEditorFields";
import { italianHeadword } from "./CardAnswer";
import { newCardId } from "../cards/ids";
import { RowDictionaryNote } from "./DictionaryNoteRow";
import { useDictionaryRows } from "../lexicon/useDictionary";

type Metadata = { setName: string; tags: string };
type GridRow =
  | ({ type: "noun" } & NounDraft & Metadata)
  | ({ type: "verb" } & Omit<VerbBatchRow, "id"> & Metadata)
  | ({ type: "adjective" } & Omit<AdjectiveBatchRow, "id"> & Metadata)
  | ({ type: "adverb" } & Omit<AdverbBatchRow, "id"> & Metadata);

export type GridTab = CardType | "all";

/** Rows typed at the bottom of a part-of-speech tab, which become new words on save. */
type NewRows = {
  noun: (NounBatchRow & Metadata)[];
  verb: (VerbBatchRow & Metadata)[];
  adjective: (AdjectiveBatchRow & Metadata)[];
  adverb: (AdverbBatchRow & Metadata)[];
};

const blankMetadata: Metadata = { setName: "", tags: "" };

const newRowKinds: { [T in CardType]: { empty: (id: string) => NewRows[T][number]; used: (row: NewRows[T][number]) => boolean } } = {
  noun: { empty: (id) => ({ ...emptyNounBatchRow(id), ...blankMetadata }), used: nounRowUsed },
  verb: { empty: (id) => ({ ...emptyVerbBatchRow(id), ...blankMetadata }), used: verbRowUsed },
  adjective: { empty: (id) => ({ ...emptyAdjectiveBatchRow(id), ...blankMetadata }), used: adjectiveRowUsed },
  adverb: { empty: (id) => ({ ...emptyAdverbBatchRow(id), ...blankMetadata }), used: adverbRowUsed },
};

function emptyNewRows(): NewRows {
  return { noun: [newRowKinds.noun.empty(newRowId())], verb: [newRowKinds.verb.empty(newRowId())], adjective: [newRowKinds.adjective.empty(newRowId())], adverb: [newRowKinds.adverb.empty(newRowId())] };
}

function usedNewRows(rows: NewRows) {
  return [
    ...rows.noun.filter(nounRowUsed).map((row) => ({ type: "noun" as const, ...row })),
    ...rows.verb.filter(verbRowUsed).map((row) => ({ type: "verb" as const, ...row })),
    ...rows.adjective.filter(adjectiveRowUsed).map((row) => ({ type: "adjective" as const, ...row })),
    ...rows.adverb.filter(adverbRowUsed).map((row) => ({ type: "adverb" as const, ...row })),
  ];
}

function rowFromCard(card: Flashcard, morphology: NounMorphology, adjectiveMorphology: AdjectiveMorphology): GridRow {
  const metadata = { setName: card.setName ?? "", tags: card.tags.join(", ") };
  if (card.type === "noun") return { type: "noun", ...nounDraftForEditing(card, morphology), ...metadata };
  if (card.type === "verb") {
    const { id: _id, ...row } = verbRowFromCard(card);
    return { type: "verb", ...row, ...metadata };
  }
  if (card.type === "adjective") return { type: "adjective", ...adjectiveDraftForEditing(card, adjectiveMorphology), suggested: false, ...metadata };
  const { id: _id, ...row } = adverbRowFromCard(card);
  return { type: "adverb", ...row, ...metadata };
}

function cardFromRow(row: GridRow, id: number, morphology: NounMorphology, adjectiveMorphology: AdjectiveMorphology): Flashcard {
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
    const resolved = resolveAdjectiveDraft(row, adjectiveMorphology);
    if (!resolved.ok) throw new Error(resolved.error);
    return { ...common, type: "adjective", english, details: { declension: resolved.declension } };
  }
  if (!row.form.trim()) throw new Error("An adverb needs its Italian form.");
  return adverbCard({ ...common, english, form: row.form.trim() });
}

const rowKey = (row: GridRow) => JSON.stringify(row);

const typeHeaders: Record<CardType, string[]> = {
  noun: ["English", "Singular", "Plural", "Gender", "Articles", "Rule", "Forms"],
  verb: ["English", "Infinitive", "io", "tu", "lui / lei", "noi", "voi", "loro", "Aux.", "Participle"],
  adjective: ["English", "Masc. sg.", "Fem. sg.", "Masc. pl.", "Fem. pl.", "Rule", "Forms"],
  adverb: ["English", "Italian"],
};

export function WordsGrid({
  allCards,
  visibleCards,
  tab,
  knownSets,
  morphology,
  adjectiveMorphology,
  selectedIds,
  onToggleSelected,
  onSelectAll,
  onSave,
  onAdd,
  onOpen,
  onRemove,
}: {
  allCards: Flashcard[];
  visibleCards: Flashcard[];
  tab: GridTab;
  knownSets: string[];
  morphology: NounMorphology;
  adjectiveMorphology: AdjectiveMorphology;
  selectedIds: number[];
  onToggleSelected: (id: number) => void;
  onSelectAll: (ids: number[], selected: boolean) => void;
  onSave: (updated: Flashcard[]) => Promise<boolean>;
  onAdd: (created: Flashcard[]) => Promise<void>;
  onOpen: (card: Flashcard) => void;
  onRemove: (id: number) => void;
}) {
  const baseline = useMemo(() => new Map(allCards.map((card) => [card.id, rowFromCard(card, morphology, adjectiveMorphology)])), [adjectiveMorphology, allCards, morphology]);
  const [drafts, setDrafts] = useState<Record<number, GridRow>>({});
  const [rowErrors, setRowErrors] = useState<Record<number, string>>({});
  const [newRows, setNewRows] = useState<NewRows>(emptyNewRows);
  const [newRowErrors, setNewRowErrors] = useState<Record<string, string>>({});
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
  const pendingNew = usedNewRows(newRows);
  const changeCount = dirtyIds.length + pendingNew.length;
  const visibleIdSet = new Set(visibleCards.map((card) => card.id));
  const hiddenChanges = dirtyIds.filter((id) => !visibleIdSet.has(id)).length + pendingNew.filter((row) => row.type !== tab).length;
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

  function changeNewRows<T extends CardType>(type: T, change: (rows: NewRows[T]) => NewRows[T][number][]) {
    const kind = newRowKinds[type];
    setNewRows((current) => ({ ...current, [type]: withSpareRows(change(current[type]), kind.used, kind.empty, 1) }));
  }

  function updateNewRow<T extends CardType>(type: T, id: string, change: (row: NewRows[T][number]) => NewRows[T][number]) {
    changeNewRows(type, (rows) => rows.map((row) => row.id === id ? change(row) : row));
    setNewRowErrors((current) => {
      if (!current[id]) return current;
      const { [id]: _removed, ...rest } = current;
      return rest;
    });
  }

  const dictionaries = {
    noun: useDictionaryRows("noun", { noun: morphology }, newRows.noun, (id, change) => updateNewRow("noun", id, (row) => change(row) as typeof row)),
    verb: useDictionaryRows("verb", {}, newRows.verb, (id, change) => updateNewRow("verb", id, (row) => change(row) as typeof row)),
    adjective: useDictionaryRows("adjective", { adjective: adjectiveMorphology }, newRows.adjective, (id, change) => updateNewRow("adjective", id, (row) => change(row) as typeof row)),
    adverb: useDictionaryRows("adverb", {}, newRows.adverb, (id, change) => updateNewRow("adverb", id, (row) => change(row) as typeof row)),
  };

  function removeNewRow(type: CardType, id: string) {
    const kind = newRowKinds[type];
    setNewRows((current) => ({ ...current, [type]: withoutRow(current[type] as { id: string }[], id, kind.used as (row: { id: string }) => boolean, kind.empty, 1) }));
  }

  function discard() {
    setDrafts({});
    setRowErrors({});
    setNewRows(emptyNewRows());
    setNewRowErrors({});
    setError("");
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    const updated: Flashcard[] = [];
    const errors: Record<number, string> = {};
    for (const id of dirtyIds) {
      try {
        updated.push(cardFromRow(drafts[id]!, id, morphology, adjectiveMorphology));
      } catch (caught) {
        errors[id] = caught instanceof Error ? caught.message : "This row is invalid.";
      }
    }
    const created: Flashcard[] = [];
    const newErrors: Record<string, string> = {};
    pendingNew.forEach((row) => {
      try {
        created.push(cardFromRow(row, newCardId(), morphology, adjectiveMorphology));
      } catch (caught) {
        newErrors[row.id] = caught instanceof Error ? caught.message : "This row is invalid.";
      }
    });
    setRowErrors(errors);
    setNewRowErrors(newErrors);
    const errorCount = Object.keys(errors).length + Object.keys(newErrors).length;
    if (errorCount) {
      setError(`${errorCount} ${errorCount === 1 ? "row needs" : "rows need"} fixing before saving.`);
      return;
    }
    setError("");
    setSaving(true);
    if (updated.length) {
      const saved = await onSave(updated);
      if (!saved) {
        setSaving(false);
        setError("The changes could not be saved. Your edits are still here.");
        return;
      }
      setDrafts({});
    }
    if (created.length) {
      try {
        await onAdd(created);
        setNewRows(emptyNewRows());
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "The new words could not be added. They are still here.");
      }
    }
    setSaving(false);
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
    if (row.type === "noun") {
      const onNounField = (field: string, value: unknown) => field === "rule"
        ? update(card.id, nounDraftWithRule(row, value as string, morphology))
        : onField(field, value);
      return <NounBatchRowCells row={{ ...row, id: String(card.id), pluralSuggested: false }} index={index} morphology={morphology} onChange={onNounField} />;
    }
    if (row.type === "verb") return <VerbRowCells row={{ ...row, id: String(card.id) }} index={index} onChange={onField} />;
    if (row.type === "adjective") return <AdjectiveRowCells row={{ ...row, id: String(card.id) }} index={index} morphology={adjectiveMorphology} onChange={onField} />;
    return <AdverbRowCells row={{ ...row, id: String(card.id) }} index={index} onChange={onField} />;
  }

  function newRowCells(type: CardType, id: string, index: number) {
    if (type === "noun") {
      const row = newRows.noun.find((item) => item.id === id)!;
      return <NounBatchRowCells row={row} index={index} morphology={morphology} onChange={(field, value) => updateNewRow("noun", id, (current) => updateNounBatchRow(current, field, value, morphology))} onLookUp={(word) => dictionaries.noun.lookUp(id, word)} />;
    }
    if (type === "verb") {
      const row = newRows.verb.find((item) => item.id === id)!;
      return <VerbRowCells row={row} index={index} onChange={(field, value) => updateNewRow("verb", id, (current) => ({ ...current, [field]: value }))} onLookUp={(word) => dictionaries.verb.lookUp(id, word)} />;
    }
    if (type === "adjective") {
      const row = newRows.adjective.find((item) => item.id === id)!;
      return <AdjectiveRowCells row={row} index={index} morphology={adjectiveMorphology} onChange={(field, value) => updateNewRow("adjective", id, (current) => updateAdjectiveBatchRow(current, field, value, adjectiveMorphology))} onLookUp={(word) => dictionaries.adjective.lookUp(id, word)} />;
    }
    const row = newRows.adverb.find((item) => item.id === id)!;
    return <AdverbRowCells row={row} index={index} onChange={(field, value) => updateNewRow("adverb", id, (current) => ({ ...current, [field]: value }))} onLookUp={(word) => dictionaries.adverb.lookUp(id, word)} />;
  }

  function newRowsBody(type: CardType) {
    const kind = newRowKinds[type];
    const rows: (NewRows[CardType][number])[] = newRows[type];
    return rows.map((row, offset) => {
      const index = visibleCards.length + offset;
      const used = (kind.used as (item: typeof row) => boolean)(row);
      const rowError = newRowErrors[row.id];
      const setMetadata = (patch: Partial<Metadata>) => updateNewRow(type, row.id, (current) => ({ ...current, ...patch }));
      return <Fragment key={row.id}>
        <tr className={`new-row${used ? " dirty" : ""}${rowError ? " has-error" : ""}`}>
          <td className="select-cell"><span className="new-row-mark" title="New word" aria-hidden="true">+</span></td>
          {newRowCells(type, row.id, index)}
          <td data-label="Set"><input aria-label={`Row ${index + 1} set`} list="known-card-sets" value={row.setName} onChange={(event) => setMetadata({ setName: event.target.value })} placeholder="—" /></td>
          <td data-label="Tags"><input aria-label={`Row ${index + 1} tags`} value={row.tags} onChange={(event) => setMetadata({ tags: event.target.value })} /></td>
          <td className="row-action-cell">{used && <div className="inventory-row-actions">
            <button type="button" className="row-remove" tabIndex={-1} onClick={() => removeNewRow(type, row.id)} aria-label={`Remove new row ${index + 1}`} title="Remove">×</button>
          </div>}</td>
        </tr>
        <RowDictionaryNote dictionary={dictionaries[type]} rowId={row.id} english={row.english} columns={columnCount} />
        {rowError && <tr className="row-error-line"><td colSpan={columnCount}>{row.english.trim() || "New word"}: {rowError}</td></tr>}
      </Fragment>;
    });
  }

  const headers = tab === "all" ? ["Italian", "English"] : [...typeHeaders[tab], "Set"];
  const columnCount = headers.length + 3;

  return <form className="words-grid" onSubmit={save}>
    <datalist id="known-card-sets">{knownSets.map((name) => <option key={name} value={name} />)}</datalist>
    {(visibleCards.length > 0 || tab !== "all") && <div className="batch-table-wrap grid-table-wrap">
      <table className={`batch-table grid-table grid-${tab}`}>
        <thead><tr>
          <th className="select-cell">{visibleCards.length > 0 && <input type="checkbox" aria-label="Select all shown words" checked={allVisibleSelected} onChange={() => onSelectAll(visibleCards.map((card) => card.id), !allVisibleSelected)} />}</th>
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
                    <span lang="it">{italianHeadword(card, morphology, adjectiveMorphology)}</span>
                    <small>{typeLabels[card.type].toLowerCase()}{card.setName ? ` · ${card.setName}` : ""}</small>
                  </button></td>
                  <td data-label="English"><input aria-label={`English for ${card.english}`} value={row.english} onChange={(event) => update(card.id, { english: event.target.value })} /></td>
                </> : typeCells(card, row, index)}
                {metadataCells(card, row)}
              </tr>
              {rowError && <tr className="row-error-line"><td colSpan={columnCount}>{card.english}: {rowError}</td></tr>}
            </Fragment>;
          })}
          {tab !== "all" && newRowsBody(tab)}
        </tbody>
      </table>
    </div>}
    {(changeCount > 0 || error) && <div className="grid-save-bar" role="region" aria-label="Unsaved changes">
      {error
        ? <p className="form-error" role="alert">{error}</p>
        : <p><strong>{changeCount}</strong> unsaved {changeCount === 1 ? "change" : "changes"}{hiddenChanges ? ` (${hiddenChanges} hidden by filters)` : ""}</p>}
      <button type="button" className="text-button" onClick={discard} disabled={saving}>Discard</button>
      <button type="submit" className="primary-button" disabled={saving || !changeCount}>{saving ? "Saving…" : "Save changes"}</button>
    </div>}
  </form>;
}
