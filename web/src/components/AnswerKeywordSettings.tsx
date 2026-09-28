import { useEffect, useState } from "react";
import { defaultAnswerKeywords, normalizeAnswerKeywords, type AnswerKeywords } from "../study/preferences";

const fields: { key: keyof AnswerKeywords; label: string; example: (keywords: AnswerKeywords) => string }[] = [
  { key: "masculine", label: "Masculine", example: (keywords) => `${keywords.masculine} l’amico` },
  { key: "feminine", label: "Feminine", example: (keywords) => `${keywords.feminine} l’amica` },
  { key: "singularOnly", label: "Singular-only", example: (keywords) => `${keywords.feminine} ${keywords.singularOnly} Venezia` },
  { key: "pluralOnly", label: "Plural-only", example: (keywords) => `${keywords.pluralOnly} i pantaloni` },
];

export function AnswerKeywordSettings({ keywords, onChange }: { keywords: AnswerKeywords; onChange: (keywords: AnswerKeywords) => Promise<void> }) {
  const [draft, setDraft] = useState(keywords);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => setDraft(keywords), [keywords]);

  async function save(next: AnswerKeywords, success: string) {
    setMessage("");
    setError("");
    setSaving(true);
    try {
      const normalized = normalizeAnswerKeywords(next);
      await onChange(normalized);
      setDraft(normalized);
      setMessage(success);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The keywords could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  return <div className="keyword-settings">
    <div className="keyword-grid">
      {fields.map((field) => <label className="field" key={field.key}>
        <span>{field.label}</span>
        <input value={draft[field.key]} onChange={(event) => { setDraft((current) => ({ ...current, [field.key]: event.target.value })); setMessage(""); setError(""); }} autoCapitalize="none" spellCheck={false} />
        <small className="field-hint">e.g. <code>{field.example(draft)}</code></small>
      </label>)}
    </div>
    {error && <p className="form-error" role="alert">{error}</p>}
    {message && <p className="success-message" role="status">{message}</p>}
    <div className="button-row">
      <button type="button" className="text-button" disabled={saving} onClick={() => void save(defaultAnswerKeywords, "Defaults restored.")}>Restore defaults</button>
      <button type="button" className="neutral-button" disabled={saving} onClick={() => void save(draft, "Keywords saved.")}>Save keywords</button>
    </div>
  </div>;
}
