import { useState } from "react";
import type { NounMorphology } from "../cards/nounMorphology";

/** Declension rules still being drilled: word mode asks for both forms of every noun that uses one. */
export function DeclensionDrillSettings({ morphology, drilling, onChange }: { morphology: NounMorphology; drilling: string[]; onChange: (rules: string[]) => Promise<void> }) {
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const rules = morphology.declensionRules.filter((rule) => rule.forms.singular && rule.forms.plural);

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

  return <div className="drill-settings">
    <div className="morphology-rule-checks">{rules.map((rule) => <label key={rule.name}>
      <input type="checkbox" checked={drilling.includes(rule.name)} disabled={saving} onChange={(event) => void toggle(rule.name, event.target.checked)} />
      <span>{rule.name}</span>
    </label>)}</div>
    {error && <p className="form-error" role="alert">{error}</p>}
  </div>;
}
