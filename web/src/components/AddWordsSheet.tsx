import { type FormEvent, useEffect, useState } from "react";
import type { CardType, Flashcard } from "../cards/types";
import type { NounMorphology } from "../cards/nounMorphology";
import { cardTypes, typeLabels } from "../cardTypes";
import {
  adjectiveCard,
  adverbCard,
  clearBatchDraft,
  emptyAdjectiveBatchRow,
  emptyAdverbBatchRow,
  emptyNounBatchRow,
  emptyVerbBatchRow,
  newRowId,
  parseTags,
  readBatchDraft,
  readCardAdderType,
  type AdjectiveBatchRow,
  type AdverbBatchRow,
  type BatchDraft,
  type NounBatchRow,
  type VerbBatchRow,
  verbCard,
  writeBatchDraft,
  writeCardAdderType,
} from "../cards/editorModel";
import { nounCardFromDraft, suggestedPlural, type NounDraft } from "../cards/nounDraft";
import {
  AdjectiveRowCells,
  AdverbRowCells,
  NounBatchRowCells,
  SetField,
  TagsField,
  VerbRowCells,
} from "./CardEditorFields";
import { Icon } from "./Icons";
import { Sheet } from "./Sheet";

function updateNounBatchRow<K extends keyof NounDraft>(row: NounBatchRow, field: K, value: NounDraft[K], morphology: NounMorphology): NounBatchRow {
  const next = { ...row, [field]: value } as NounBatchRow;
  if (field === "plural") return { ...next, pluralSuggested: false };
  if (field === "singular" && (row.pluralSuggested || !row.plural.trim())) {
    const plural = suggestedPlural(String(value), morphology);
    return { ...next, plural, pluralSuggested: Boolean(plural) };
  }
  return next;
}

function nounRowUsed(row: NounBatchRow) {
  return Boolean(row.english.trim() || row.singular.trim() || (!row.pluralSuggested && row.plural.trim()));
}

export function BatchNouns({
  knownSets,
  morphology,
  saving,
  error,
  onSave,
  onCancel,
}: {
  knownSets: string[];
  morphology: NounMorphology;
  saving: boolean;
  error: string;
  onSave: (cards: Flashcard[]) => Promise<void>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<BatchDraft<NounBatchRow>>(() => {
    const stored = readBatchDraft("noun", () => Array.from({ length: 3 }, (_, index) => emptyNounBatchRow(String(index + 1))));
    return { ...stored, rows: stored.rows.map((row) => ({ ...emptyNounBatchRow(row.id), ...row })) };
  });
  const [localError, setLocalError] = useState("");
  const rows = draft.rows;

  useEffect(() => {
    writeBatchDraft("noun", draft);
  }, [draft]);

  function updateRow<K extends keyof NounDraft>(id: string, field: K, value: NounDraft[K]) {
    setDraft((currentDraft) => {
      const updated = currentDraft.rows.map((row) => row.id === id ? updateNounBatchRow(row, field, value, morphology) : row);
      const last = updated.at(-1);
      const nextRows = last && nounRowUsed(last) ? [...updated, emptyNounBatchRow(newRowId())] : updated;
      return { ...currentDraft, rows: nextRows };
    });
  }

  function removeRow(id: string) {
    setDraft((currentDraft) => ({ ...currentDraft, rows: currentDraft.rows.length === 1 ? currentDraft.rows : currentDraft.rows.filter((row) => row.id !== id) }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const setName = draft.setName.trim() || null;
    const tags = parseTags(draft.tags);
    const used = rows.filter(nounRowUsed);
    if (!used.length) {
      setLocalError("Enter at least one noun.");
      return;
    }
    let cards: Flashcard[];
    try {
      cards = used.map((row, index) => nounCardFromDraft(row, { id: Date.now() + index, setName, tags }, morphology));
    } catch (caught) {
      setLocalError(caught instanceof Error ? caught.message : "The noun rows do not match the configured morphology.");
      return;
    }
    setLocalError("");
    await onSave(cards);
  }

  return (
    <form onSubmit={submit} className="batch-form">
      <div className="batch-meta-fields">
        <SetField knownSets={knownSets} value={draft.setName} onChange={(setName) => setDraft((currentDraft) => ({ ...currentDraft, setName }))} />
        <TagsField value={draft.tags} onChange={(tags) => setDraft((currentDraft) => ({ ...currentDraft, tags }))} />
      </div>
      <p className="batch-help">Type the singular and Parola suggests the plural, the declension rule, and every article. Pick a rule only when Auto can’t decide. Drafts are kept on this device.</p>
      <div className="batch-table-wrap">
        <table className="batch-table noun-batch-table">
          <thead><tr><th>English</th><th>Singular</th><th>Plural</th><th>Gender</th><th>Articles</th><th>Rule</th><th>Forms</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>
            {rows.map((row, index) => <tr key={row.id}>
              <NounBatchRowCells row={row} index={index} morphology={morphology} autoFocus={index === 0} onChange={(field, value) => updateRow(row.id, field, value)} onRemove={() => removeRow(row.id)} />
            </tr>)}
          </tbody>
        </table>
      </div>
      <BatchFooter error={localError || error} saving={saving} label="Add nouns" onCancel={onCancel} />
    </form>
  );
}

function BatchFooter({ error, saving, label, onCancel }: { error: string; saving: boolean; label: string; onCancel: () => void }) {
  return <>
    {error && <p className="form-error" role="alert">{error}</p>}
    <footer className="sheet-actions">
      <button type="button" className="text-button" onClick={onCancel} disabled={saving}>Cancel</button>
      <button type="submit" className="primary-button" disabled={saving}>{saving ? "Saving…" : label}</button>
    </footer>
  </>;
}

export function BatchVerbs({
  knownSets,
  saving,
  error,
  onSave,
  onCancel,
}: {
  knownSets: string[];
  saving: boolean;
  error: string;
  onSave: (cards: Flashcard[]) => Promise<void>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<BatchDraft<VerbBatchRow>>(() => readBatchDraft("verb", () => Array.from({ length: 3 }, (_, index) => emptyVerbBatchRow(String(index + 1)))));
  const [localError, setLocalError] = useState("");
  const rows = draft.rows;

  useEffect(() => {
    writeBatchDraft("verb", draft);
  }, [draft]);

  function updateRow(id: string, field: keyof VerbBatchRow, value: string) {
    setDraft((currentDraft) => {
      const updated = currentDraft.rows.map((row) => row.id === id ? { ...row, [field]: value } as VerbBatchRow : row);
      const last = updated.at(-1);
      const hasText = last && [last.english, last.infinitive, last.io, last.tu, last.luiLei, last.noi, last.voi, last.loro, last.participle].some((item) => item.trim());
      return { ...currentDraft, rows: hasText ? [...updated, emptyVerbBatchRow(newRowId())] : updated };
    });
  }

  function removeRow(id: string) {
    setDraft((currentDraft) => ({ ...currentDraft, rows: currentDraft.rows.length === 1 ? currentDraft.rows : currentDraft.rows.filter((row) => row.id !== id) }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const setName = draft.setName.trim() || null;
    const tags = parseTags(draft.tags);
    const used = rows.filter((row) => [row.english, row.infinitive, row.io, row.tu, row.luiLei, row.noi, row.voi, row.loro, row.participle].some((item) => item.trim()));
    if (!used.length) {
      setLocalError("Enter at least one verb.");
      return;
    }
    if (used.some((row) => [row.english, row.infinitive, row.io, row.tu, row.luiLei, row.noi, row.voi, row.loro, row.participle].some((item) => !item.trim()))) {
      setLocalError("Every used verb row needs English, infinitive, all six present-tense forms, and the participle.");
      return;
    }
    setLocalError("");
    await onSave(used.map((row, index) => verbCard({
      ...row,
      id: Date.now() + index,
      english: row.english.trim(),
      infinitive: row.infinitive.trim(),
      io: row.io.trim(),
      tu: row.tu.trim(),
      luiLei: row.luiLei.trim(),
      noi: row.noi.trim(),
      voi: row.voi.trim(),
      loro: row.loro.trim(),
      participle: row.participle.trim(),
      setName,
      tags,
    })));
  }

  return (
    <form onSubmit={submit} className="batch-form">
      <div className="batch-meta-fields">
      <SetField knownSets={knownSets} value={draft.setName} onChange={(setName) => setDraft((currentDraft) => ({ ...currentDraft, setName }))} />
      <TagsField value={draft.tags} onChange={(tags) => setDraft((currentDraft) => ({ ...currentDraft, tags }))} />
      </div>
      <p className="batch-help">One verb per row. A fresh row appears automatically when you begin the last one. Progress saves automatically on this device.</p>
      <div className="batch-table-wrap">
        <table className="batch-table verb-batch-table">
          <thead><tr><th>English</th><th>Infinitive</th><th>io</th><th>tu</th><th>lui / lei</th><th>noi</th><th>voi</th><th>loro</th><th>Aux.</th><th>Participle</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>
            {rows.map((row, index) => <tr key={row.id}>
              <VerbRowCells row={row} index={index} autoFocus={index === 0} onChange={(field, value) => updateRow(row.id, field, value)} onRemove={() => removeRow(row.id)} />
            </tr>)}
          </tbody>
        </table>
      </div>
      <BatchFooter error={localError || error} saving={saving} label="Add verbs" onCancel={onCancel} />
    </form>
  );
}

export function BatchAdjectives({
  knownSets,
  saving,
  error,
  onSave,
  onCancel,
}: {
  knownSets: string[];
  saving: boolean;
  error: string;
  onSave: (cards: Flashcard[]) => Promise<void>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<BatchDraft<AdjectiveBatchRow>>(() => readBatchDraft("adjective", () => Array.from({ length: 3 }, (_, index) => emptyAdjectiveBatchRow(String(index + 1)))));
  const [localError, setLocalError] = useState("");
  const rows = draft.rows;

  useEffect(() => {
    writeBatchDraft("adjective", draft);
  }, [draft]);

  function updateRow(id: string, field: keyof AdjectiveBatchRow, value: string) {
    setDraft((currentDraft) => {
      const updated = currentDraft.rows.map((row) => row.id === id ? { ...row, [field]: value } : row);
      const last = updated.at(-1);
      const nextRows = last && [last.english, last.masculineSingular, last.feminineSingular, last.masculinePlural, last.femininePlural].some((item) => item.trim())
        ? [...updated, emptyAdjectiveBatchRow(newRowId())]
        : updated;
      return { ...currentDraft, rows: nextRows };
    });
  }

  function removeRow(id: string) {
    setDraft((currentDraft) => ({ ...currentDraft, rows: currentDraft.rows.length === 1 ? currentDraft.rows : currentDraft.rows.filter((row) => row.id !== id) }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const setName = draft.setName.trim() || null;
    const tags = parseTags(draft.tags);
    const used = rows.filter((row) => [row.english, row.masculineSingular, row.feminineSingular, row.masculinePlural, row.femininePlural].some((item) => item.trim()));
    if (!used.length) {
      setLocalError("Enter at least one adjective.");
      return;
    }
    if (used.some((row) => [row.english, row.masculineSingular, row.feminineSingular, row.masculinePlural, row.femininePlural].some((item) => !item.trim()))) {
      setLocalError("Every used adjective row needs English and all four Italian forms.");
      return;
    }
    setLocalError("");
    await onSave(used.map((row, index) => adjectiveCard({
      ...row,
      id: Date.now() + index,
      english: row.english.trim(),
      masculineSingular: row.masculineSingular.trim(),
      feminineSingular: row.feminineSingular.trim(),
      masculinePlural: row.masculinePlural.trim(),
      femininePlural: row.femininePlural.trim(),
      setName,
      tags,
    })));
  }

  return (
    <form onSubmit={submit} className="batch-form">
      <div className="batch-meta-fields">
      <SetField knownSets={knownSets} value={draft.setName} onChange={(setName) => setDraft((currentDraft) => ({ ...currentDraft, setName }))} />
      <TagsField value={draft.tags} onChange={(tags) => setDraft((currentDraft) => ({ ...currentDraft, tags }))} />
      </div>
      <p className="batch-help">One adjective per row. A fresh row appears automatically when you begin the last one. Progress saves automatically on this device.</p>
      <div className="batch-table-wrap">
        <table className="batch-table adjective-batch-table">
          <thead><tr><th>English</th><th>Masculine singular</th><th>Feminine singular</th><th>Masculine plural</th><th>Feminine plural</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>
            {rows.map((row, index) => <tr key={row.id}>
              <AdjectiveRowCells row={row} index={index} autoFocus={index === 0} onChange={(field, value) => updateRow(row.id, field, value)} onRemove={() => removeRow(row.id)} />
            </tr>)}
          </tbody>
        </table>
      </div>
      <BatchFooter error={localError || error} saving={saving} label="Add adjectives" onCancel={onCancel} />
    </form>
  );
}

export function BatchAdverbs({ knownSets, saving, error, onSave, onCancel }: { knownSets: string[]; saving: boolean; error: string; onSave: (cards: Flashcard[]) => Promise<void>; onCancel: () => void }) {
  const [draft, setDraft] = useState<BatchDraft<AdverbBatchRow>>(() => readBatchDraft("adverb", () => Array.from({ length: 3 }, (_, index) => emptyAdverbBatchRow(String(index + 1)))));
  const [localError, setLocalError] = useState("");
  const rows = draft.rows;

  useEffect(() => { writeBatchDraft("adverb", draft); }, [draft]);

  function updateRow(id: string, field: keyof AdverbBatchRow, value: string) {
    setDraft((currentDraft) => {
      const updated = currentDraft.rows.map((row) => row.id === id ? { ...row, [field]: value } : row);
      const last = updated.at(-1);
      return { ...currentDraft, rows: last && (last.english.trim() || last.form.trim()) ? [...updated, emptyAdverbBatchRow(newRowId())] : updated };
    });
  }

  function removeRow(id: string) {
    setDraft((currentDraft) => ({ ...currentDraft, rows: currentDraft.rows.length === 1 ? currentDraft.rows : currentDraft.rows.filter((row) => row.id !== id) }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const used = rows.filter((row) => row.english.trim() || row.form.trim());
    if (!used.length) { setLocalError("Enter at least one adverb."); return; }
    if (used.some((row) => !row.english.trim() || !row.form.trim())) { setLocalError("Every used adverb row needs English and an Italian form."); return; }
    setLocalError("");
    const setName = draft.setName.trim() || null;
    const tags = parseTags(draft.tags);
    await onSave(used.map((row, index) => adverbCard({ id: Date.now() + index, english: row.english.trim(), form: row.form.trim(), setName, tags })));
  }

  return <form onSubmit={submit} className="batch-form">
    <div className="batch-meta-fields">
    <SetField knownSets={knownSets} value={draft.setName} onChange={(setName) => setDraft((currentDraft) => ({ ...currentDraft, setName }))} />
    <TagsField value={draft.tags} onChange={(tags) => setDraft((currentDraft) => ({ ...currentDraft, tags }))} />
    </div>
    <p className="batch-help">One invariant adverb per row. A fresh row appears automatically when you begin the last one. Progress saves automatically on this device.</p>
    <div className="batch-table-wrap"><table className="batch-table adverb-batch-table"><thead><tr><th>English</th><th>Italian adverb</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>
      {rows.map((row, index) => <tr key={row.id}><AdverbRowCells row={row} index={index} autoFocus={index === 0} onChange={(field, value) => updateRow(row.id, field, value)} onRemove={() => removeRow(row.id)} /></tr>)}
    </tbody></table></div>
    <BatchFooter error={localError || error} saving={saving} label="Add adverbs" onCancel={onCancel} />
  </form>;
}

export function AddWordsSheet({
  knownSets,
  morphology,
  onClose,
  onBatch,
}: {
  knownSets: string[];
  morphology: NounMorphology;
  onClose: () => void;
  onBatch: (cards: Flashcard[]) => Promise<void>;
}) {
  const [type, setType] = useState<CardType>(readCardAdderType);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    writeCardAdderType(type);
  }, [type]);

  async function saveBatch(cards: Flashcard[]) {
    try {
      setSaving(true);
      setError("");
      await onBatch(cards);
      if (cards[0]) clearBatchDraft(cards[0].type);
      onClose();
    } catch (caught) {
      setSaving(false);
      setError(caught instanceof Error ? caught.message : "The batch could not be saved. Try again.");
    }
  }

  return (
    <Sheet title="Add words" size="wide" onClose={onClose} closeDisabled={saving} icon={<Icon name="plus" />}>
      <div className="segmented type-segmented" role="tablist" aria-label="Word type">
        {cardTypes.map((item) => (
          <button type="button" role="tab" aria-selected={type === item} key={item} className={`${item} ${type === item ? "active" : ""}`} onClick={() => { setType(item); setError(""); }}>{typeLabels[item]}s</button>
        ))}
      </div>
      {type === "noun" && <BatchNouns knownSets={knownSets} morphology={morphology} saving={saving} error={error} onSave={saveBatch} onCancel={onClose} />}
      {type === "verb" && <BatchVerbs knownSets={knownSets} saving={saving} error={error} onSave={saveBatch} onCancel={onClose} />}
      {type === "adjective" && <BatchAdjectives knownSets={knownSets} saving={saving} error={error} onSave={saveBatch} onCancel={onClose} />}
      {type === "adverb" && <BatchAdverbs knownSets={knownSets} saving={saving} error={error} onSave={saveBatch} onCancel={onClose} />}
    </Sheet>
  );
}
