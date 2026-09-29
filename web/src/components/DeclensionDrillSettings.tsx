import { useState } from "react";

/** Declension rules still being drilled: word answers ask for every form of each word that uses one. */
export function DeclensionDrillSettings({ label, ruleNames, drilling, onChange }: { label: string; ruleNames: string[]; drilling: string[]; onChange: (rules: string[]) => Promise<void> }) {
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function toggle(name: string, checked: boolean) {
    setError("");
    setSaving(true);
    try {
      await onChange(checked ? [...drilling, name] : drilling.filter((item) => item !== name));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That change could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  return <div className="drill-settings" role="group" aria-label={label}>
    <h3>{label}</h3>
    <div className="morphology-rule-checks">{ruleNames.map((name) => <label key={name}>
      <input type="checkbox" checked={drilling.includes(name)} disabled={saving} onChange={(event) => void toggle(name, event.target.checked)} />
      <span>{name}</span>
    </label>)}</div>
    {error && <p className="form-error" role="alert">{error}</p>}
  </div>;
}
