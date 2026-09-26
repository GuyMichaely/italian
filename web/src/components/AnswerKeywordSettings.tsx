import { useState } from "react";
import { defaultAnswerKeywords, type AnswerKeywords } from "../study/setup";

const fields: { key: keyof AnswerKeywords; label: string; example: (keywords: AnswerKeywords) => string }[] = [
  { key: "masculine", label: "Masculine", example: (keywords) => `${keywords.masculine} l’amico` },
  { key: "feminine", label: "Feminine", example: (keywords) => `${keywords.feminine} l’amica` },
  { key: "singularOnly", label: "Singular-only", example: (keywords) => `${keywords.feminine} ${keywords.singularOnly} Venezia` },
  { key: "pluralOnly", label: "Plural-only", example: (keywords) => `${keywords.feminine} ${keywords.pluralOnly} nozze` },
];

export function AnswerKeywordSettings({ keywords, onChange }: { keywords: AnswerKeywords; onChange: (keywords: AnswerKeywords) => void }) {
  const [draft, setDraft] = useState(keywords);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  function applyKeywords() {
    const normalized = Object.fromEntries(Object.entries(draft).map(([key, value]) => [key, value.trim().toLocaleLowerCase("it-IT")])) as AnswerKeywords;
    const values = Object.values(normalized);
    setMessage("");
    if (values.some((value) => !value || /\s|[|:"]/u.test(value))) {
      setError("Each keyword must be one token without spaces or punctuation separators.");
      return;
    }
    if (new Set(values).size !== values.length) {
      setError("Each keyword must be different.");
      return;
    }
    setError("");
    onChange(normalized);
    setDraft(normalized);
    setMessage("Saved on this device.");
  }

  function resetKeywords() {
    setDraft(defaultAnswerKeywords);
    onChange(defaultAnswerKeywords);
    setError("");
    setMessage("Defaults restored.");
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
      <button type="button" className="text-button" onClick={resetKeywords}>Restore defaults</button>
      <button type="button" className="neutral-button" onClick={applyKeywords}>Save keywords</button>
    </div>
  </div>;
}
