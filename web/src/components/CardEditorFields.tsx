import {
  type AdjectiveBatchRow,
  type AdverbBatchRow,
  type NounBatchRow,
  type VerbBatchRow,
} from "../cards/editorModel";
import { articleProfileOptions, irregularRuleValue, nounFormPhrases, resolveNounDraft, type NounDraft } from "../cards/nounDraft";
import { resolveAdjectiveDraft, type AdjectiveDraft } from "../cards/adjectiveDraft";
import { adjectiveFormAbbreviations, adjectiveFormLabels, adjectiveForms, adjectiveFormsArePredictable, followsLessSpecificRule, type AdjectiveMorphology } from "../cards/adjectiveMorphology";
import { irregularDeclensionName, type NounMorphology } from "../cards/nounMorphology";
import type { NounDetails } from "../cards/types";

export function SetField({
  knownSets,
  value,
  onChange,
}: {
  knownSets: string[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="field set-field">
      <span>Set <em>optional</em></span>
      <input
        name="setName"
        list="known-card-sets"
        placeholder="e.g. Unit 2 · Food"
        autoComplete="off"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <datalist id="known-card-sets">
        {knownSets.map((name) => <option key={name} value={name} />)}
      </datalist>
    </label>
  );
}

export function TagsField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <label className="field tags-field">
      <span>Tags <em>comma separated</em></span>
      <input name="tags" placeholder="travel, review, food" value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function nounExceptionNote(details: NounDetails) {
  const overrides = [details.articleGroups.singular && `sg. as ${details.articleGroups.singular}`, details.articleGroups.plural && `pl. as ${details.articleGroups.plural}`].filter(Boolean);
  const gender = details.genderDiffersWithPlurality ? ` · plural ${details.gender === "masculine" ? "feminine" : "masculine"}` : "";
  return `${gender}${overrides.length ? ` · articles: ${overrides.join(", ")}` : ""}`;
}

/** The batch grid's gender cell: the gender, and whether the plural takes the other one. */
const batchGenderOptions = [
  { value: "masculine", label: "M", gender: "masculine", differs: false },
  { value: "feminine", label: "F", gender: "feminine", differs: false },
  { value: "masculine-feminine", label: "M, pl. F", gender: "masculine", differs: true },
  { value: "feminine-masculine", label: "F, pl. M", gender: "feminine", differs: true },
] as const;

export function NounDerivedPreview({ draft, morphology }: { draft: NounDraft; morphology: NounMorphology }) {
  if (!draft.singular.trim() && !draft.plural.trim()) return <span className="derived-preview empty">Forms appear as you type</span>;
  const resolved = resolveNounDraft(draft, morphology);
  if (!resolved.ok) return <span className="derived-preview invalid" role="status">{resolved.error}</span>;
  const phrases = nounFormPhrases(resolved.forms);
  return <span className="derived-preview valid">
    <span className="derived-forms">{phrases.length ? phrases.map((phrase) => phrase.text).join(" · ") : [resolved.forms.singular, resolved.forms.plural].filter(Boolean).join(" · ")}</span>
    <small>{resolved.inferred ? "auto: " : ""}{resolved.forms.rule ?? irregularDeclensionName}{nounExceptionNote(resolved.details)}</small>
  </span>;
}

export function NounRuleSelect({ value, morphology, onChange, label }: { value: string; morphology: NounMorphology; onChange: (value: string) => void; label: string }) {
  return <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>
    <option value="">Auto</option>
    {morphology.declensionRules.map((rule) => <option key={rule.name} value={rule.name}>{rule.name}{rule.gender ? ` (${rule.gender} only)` : ""}</option>)}
    <option value={irregularRuleValue}>{irregularDeclensionName}</option>
  </select>;
}

export function NounBatchRowCells({
  row,
  index,
  morphology,
  onChange,
  onRemove,
  autoFocus = false,
}: {
  row: NounBatchRow;
  index: number;
  morphology: NounMorphology;
  onChange: <K extends keyof NounDraft>(field: K, value: NounDraft[K]) => void;
  onRemove?: () => void;
  autoFocus?: boolean;
}) {
  return <>
    <td data-label="English"><input aria-label={`Row ${index + 1} English`} value={row.english} onChange={(e) => onChange("english", e.target.value)} placeholder="the book" autoFocus={autoFocus} /></td>
    <td data-label="Singular"><input aria-label={`Row ${index + 1} singular`} value={row.singular} onChange={(e) => onChange("singular", e.target.value)} placeholder="libro" autoCapitalize="none" spellCheck={false} /></td>
    <td data-label="Plural"><input aria-label={`Row ${index + 1} plural`} className={row.pluralSuggested ? "suggested" : ""} value={row.plural} onChange={(e) => onChange("plural", e.target.value)} placeholder="libri" autoCapitalize="none" spellCheck={false} /></td>
    <td data-label="Gender"><select aria-label={`Row ${index + 1} gender`} value={batchGenderOptions.find((option) => option.gender === row.gender && option.differs === row.genderDiffersWithPlurality)!.value} onChange={(e) => {
      const option = batchGenderOptions.find((item) => item.value === e.target.value)!;
      onChange("genderDiffersWithPlurality", option.differs);
      onChange("gender", option.gender);
    }}>{batchGenderOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></td>
    <td data-label="Articles"><select aria-label={`Row ${index + 1} articles`} value={row.articles} onChange={(e) => onChange("articles", e.target.value as NounDraft["articles"])}>{articleProfileOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></td>
    <td data-label="Rule"><NounRuleSelect label={`Row ${index + 1} declension rule`} value={row.rule} morphology={morphology} onChange={(value) => onChange("rule", value)} /></td>
    <td data-label="Forms" className="derived-cell"><NounDerivedPreview draft={row} morphology={morphology} /></td>
    {onRemove && <td className="row-action-cell"><button type="button" className="row-remove" tabIndex={-1} onClick={onRemove} aria-label={`Remove row ${index + 1}`}>×</button></td>}
  </>;
}

export function VerbRowCells({ row, index, onChange, onRemove, autoFocus = false }: { row: VerbBatchRow; index: number; onChange: (field: keyof VerbBatchRow, value: string) => void; onRemove?: () => void; autoFocus?: boolean }) {
  return <>
    <td data-label="English"><input aria-label={`Row ${index + 1} English`} value={row.english} onChange={(e) => onChange("english", e.target.value)} placeholder="to understand" autoFocus={autoFocus} /></td>
    <td data-label="Infinitive"><input aria-label={`Row ${index + 1} infinitive`} value={row.infinitive} onChange={(e) => onChange("infinitive", e.target.value)} placeholder="capire" /></td>
    {(["io", "tu", "luiLei", "noi", "voi", "loro"] as const).map((field) => <td key={field} data-label={field === "luiLei" ? "lui / lei" : field}><input aria-label={`Row ${index + 1} ${field === "luiLei" ? "lui or lei" : field}`} value={row[field]} onChange={(e) => onChange(field, e.target.value)} /></td>)}
    <td data-label="Auxiliary"><select aria-label={`Row ${index + 1} auxiliary`} value={row.auxiliary} onChange={(e) => onChange("auxiliary", e.target.value)}><option value="avere">avere</option><option value="essere">essere</option></select></td>
    <td data-label="Participle"><input aria-label={`Row ${index + 1} past participle`} value={row.participle} onChange={(e) => onChange("participle", e.target.value)} placeholder="capito" /></td>
    {onRemove && <td className="row-action-cell"><button type="button" className="row-remove" tabIndex={-1} onClick={onRemove} aria-label={`Remove row ${index + 1}`}>×</button></td>}
  </>;
}

export function AdjectiveDerivedPreview({ draft, morphology }: { draft: AdjectiveDraft; morphology: AdjectiveMorphology }) {
  if (!draft.masculineSingular.trim()) return <span className="derived-preview empty">Forms appear as you type</span>;
  const resolved = resolveAdjectiveDraft(draft, morphology);
  if (!resolved.ok) return <span className="derived-preview invalid" role="status">{resolved.error}</span>;
  const suspicious = resolved.rule !== null && followsLessSpecificRule(resolved.rule, resolved.forms.masculineSingular, morphology);
  const allFour = !adjectiveFormsArePredictable(resolved.forms, morphology);
  return <span className="derived-preview valid">
    <span className="derived-forms">{adjectiveForms.map((form) => resolved.forms[form]).join(" · ")}</span>
    <small>{resolved.inferred ? "auto: " : ""}{resolved.rule ?? irregularDeclensionName}{allFour ? " · answers need all four forms" : ""}</small>
    {suspicious && <small className="derived-warning">A rule with a longer ending also fits “{resolved.forms.masculineSingular}”. Check the forms for typos.</small>}
  </span>;
}

export function AdjectiveRuleSelect({ value, morphology, onChange, label }: { value: string; morphology: AdjectiveMorphology; onChange: (value: string) => void; label: string }) {
  return <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>
    <option value="">Auto</option>
    {morphology.declensionRules.map((rule) => <option key={rule.name} value={rule.name}>{rule.name}</option>)}
    <option value={irregularRuleValue}>{irregularDeclensionName}</option>
  </select>;
}

const adjectivePlaceholders = { masculineSingular: "rosso", feminineSingular: "rossa", masculinePlural: "rossi", femininePlural: "rosse" } as const;

export function AdjectiveRowCells({
  row,
  index,
  morphology,
  onChange,
  onRemove,
  autoFocus = false,
}: {
  row: AdjectiveBatchRow;
  index: number;
  morphology: AdjectiveMorphology;
  onChange: <K extends keyof AdjectiveDraft>(field: K, value: AdjectiveDraft[K]) => void;
  onRemove?: () => void;
  autoFocus?: boolean;
}) {
  return <>
    <td data-label="English"><input aria-label={`Row ${index + 1} English`} value={row.english} onChange={(e) => onChange("english", e.target.value)} placeholder="beautiful" autoFocus={autoFocus} /></td>
    {adjectiveForms.map((form) => <td key={form} data-label={adjectiveFormAbbreviations[form]}><input aria-label={`Row ${index + 1} ${adjectiveFormLabels[form]}`} className={row.suggested && form !== "masculineSingular" ? "suggested" : ""} value={row[form]} onChange={(e) => onChange(form, e.target.value)} placeholder={adjectivePlaceholders[form]} autoCapitalize="none" spellCheck={false} /></td>)}
    <td data-label="Rule"><AdjectiveRuleSelect label={`Row ${index + 1} adjective rule`} value={row.rule} morphology={morphology} onChange={(value) => onChange("rule", value)} /></td>
    <td data-label="Forms" className="derived-cell"><AdjectiveDerivedPreview draft={row} morphology={morphology} /></td>
    {onRemove && <td className="row-action-cell"><button type="button" className="row-remove" tabIndex={-1} onClick={onRemove} aria-label={`Remove row ${index + 1}`}>×</button></td>}
  </>;
}

export function AdverbRowCells({ row, index, onChange, onRemove, autoFocus = false }: { row: AdverbBatchRow; index: number; onChange: (field: keyof AdverbBatchRow, value: string) => void; onRemove?: () => void; autoFocus?: boolean }) {
  return <>
    <td data-label="English"><input aria-label={`Row ${index + 1} English`} value={row.english} onChange={(event) => onChange("english", event.target.value)} placeholder="very; a lot" autoFocus={autoFocus} /></td>
    <td data-label="Italian"><input aria-label={`Row ${index + 1} adverb`} value={row.form} onChange={(event) => onChange("form", event.target.value)} placeholder="molto" /></td>
    {onRemove && <td className="row-action-cell"><button type="button" className="row-remove" tabIndex={-1} onClick={onRemove} aria-label={`Remove row ${index + 1}`}>×</button></td>}
  </>;
}
