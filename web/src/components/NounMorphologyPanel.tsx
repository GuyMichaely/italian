import { useEffect, useRef, useState } from "react";
import type { Flashcard } from "../cards/types";
import {
  cloneNounMorphology,
  normalizeNounMorphology,
  nounDefinitionForCard,
  resolvedNounForms,
  type NounDeclensionRule,
  type NounFormNumber,
  type NounMorphology,
  type NounSyntaxField,
  type NounSyntaxMarker,
  type NounSyntaxRule,
} from "../cards/nounMorphology";
import type { InventoryState } from "../storage";

function uniqueName(base: string, existing: string[]) {
  if (!existing.includes(base)) return base;
  let suffix = 2;
  while (existing.includes(`${base} ${suffix}`)) suffix += 1;
  return `${base} ${suffix}`;
}

function newRule(existing: NounDeclensionRule[]): NounDeclensionRule {
  return {
    name: uniqueName("New declension", existing.map((rule) => rule.name)),
    forms: { singular: { suffix: "" }, plural: { suffix: "" } },
  };
}

function newInferenceSet(existing: NounMorphology["inferenceSets"]): NounMorphology["inferenceSets"][number] {
  return {
    name: uniqueName("New inference set", existing.map((set) => set.name)),
    declensionRules: [],
  };
}

function newSyntax(inferenceSet: string, existing: NounSyntaxRule[]): NounSyntaxRule {
  return {
    name: uniqueName("New noun syntax", existing.map((syntax) => syntax.name)),
    markers: [{ kind: "gender", required: false }],
    markerOrder: "any",
    fields: [
      { kind: "article", definiteness: "definite", number: "singular" },
      { kind: "noun", number: "singular" },
    ],
    inferenceSet,
  };
}

function syntaxTokens(syntax: NounSyntaxRule) {
  const markers = syntax.markers.map((marker) => ({
    kind: "marker",
    optional: !marker.required,
    label: marker.kind === "gender" ? "gender" : `${marker.value}-only`,
  }));
  const fields = syntax.fields.map((field) => ({
    kind: field.kind,
    optional: false,
    label: field.kind === "noun" ? `${field.number} noun` : `${field.definiteness === "definite" ? "def." : "indef."} ${field.number === "singular" ? "sg." : "pl."} article`,
  }));
  return [...markers, ...fields];
}

function SyntaxPipeline({ syntax }: { syntax: NounSyntaxRule }) {
  return <div className="syntax-pipeline" aria-label="Accepted input shape">
    {syntaxTokens(syntax).map((token, index) => <span key={index} className={`syntax-token ${token.kind}${token.optional ? " optional" : ""}`}>{token.label}{token.optional ? "?" : ""}</span>)}
  </div>;
}


function syntaxFieldValue(field: NounSyntaxField) {
  if (field.kind === "noun") return `noun:${field.number}`;
  return `article:${field.definiteness}:${field.number}`;
}

function syntaxFieldFromValue(value: string): NounSyntaxField {
  if (value === "noun:singular") return { kind: "noun", number: "singular" };
  if (value === "noun:plural") return { kind: "noun", number: "plural" };
  if (value === "article:definite:singular") return { kind: "article", definiteness: "definite", number: "singular" };
  if (value === "article:definite:plural") return { kind: "article", definiteness: "definite", number: "plural" };
  return { kind: "article", definiteness: "indefinite", number: "singular" };
}

function nounSourceFingerprint(cards: Flashcard[], morphology: NounMorphology) {
  return JSON.stringify({
    morphology,
    nouns: cards
      .filter((card) => card.type === "noun")
      .map((card) => ({ id: card.id, details: card.details })),
  });
}

function identityRuleNames(morphology: NounMorphology) {
  return Object.fromEntries(morphology.declensionRules.map((rule) => [rule.name, rule.name])) as Record<string, string>;
}

export function NounMorphologyPanel({
  cards,
  morphology,
  onSave,
}: {
  cards: Flashcard[];
  morphology: NounMorphology;
  onSave: (state: InventoryState) => Promise<void>;
}) {
  const [draft, setDraft] = useState(() => cloneNounMorphology(morphology));
  const [ruleNamesByOriginal, setRuleNamesByOriginal] = useState(() => identityRuleNames(morphology));
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [sourceChanged, setSourceChanged] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const appliedSourceRef = useRef(nounSourceFingerprint(cards, morphology));

  useEffect(() => {
    const nextFingerprint = nounSourceFingerprint(cards, morphology);
    if (nextFingerprint === appliedSourceRef.current) return;
    if (dirty) {
      setSourceChanged(true);
      return;
    }
    setDraft(cloneNounMorphology(morphology));
    setRuleNamesByOriginal(identityRuleNames(morphology));
    appliedSourceRef.current = nextFingerprint;
    setSourceChanged(false);
  }, [cards, dirty, morphology]);

  function markEdited() {
    setDirty(true);
    setMessage("");
    setError("");
  }

  function changeMorphology(update: (value: NounMorphology) => NounMorphology) {
    setDraft((current) => update(cloneNounMorphology(current)));
    markEdited();
  }

  function renameRule(index: number, name: string) {
    const oldName = draft.declensionRules[index]?.name;
    if (oldName === undefined || oldName === name) return;
    if (draft.declensionRules.some((rule, ruleIndex) => ruleIndex !== index && rule.name === name)) {
      setError(`A declension named ${name} already exists.`);
      return;
    }
    changeMorphology((current) => ({
      ...current,
      declensionRules: current.declensionRules.map((rule, ruleIndex) => ruleIndex === index ? { ...rule, name } : rule),
      inferenceSets: current.inferenceSets.map((set) => ({
        ...set,
        declensionRules: set.declensionRules.map((ruleName) => ruleName === oldName ? name : ruleName),
      })),
    }));
    setRuleNamesByOriginal((current) => Object.fromEntries(
      Object.entries(current).map(([original, currentName]) => [original, currentName === oldName ? name : currentName]),
    ));
  }

  function updateRuleSuffix(index: number, number: NounFormNumber, suffix: string) {
    changeMorphology((current) => ({
      ...current,
      declensionRules: current.declensionRules.map((rule, ruleIndex) => ruleIndex === index ? {
        ...rule,
        forms: { ...rule.forms, [number]: { suffix } },
      } : rule),
    }));
  }

  function toggleRuleForm(index: number, number: NounFormNumber, enabled: boolean) {
    changeMorphology((current) => ({
      ...current,
      declensionRules: current.declensionRules.map((rule, ruleIndex) => {
        if (ruleIndex !== index) return rule;
        const forms = { ...rule.forms };
        if (enabled) forms[number] = { suffix: "" };
        else delete forms[number];
        return { ...rule, forms };
      }),
    }));
  }

  function removeRule(index: number) {
    const name = draft.declensionRules[index]?.name;
    if (!name) return;
    const usedByCard = cards.some((card) => {
      if (card.type !== "noun") return false;
      const originalName = nounDefinitionForCard(card).rule;
      return (ruleNamesByOriginal[originalName] ?? originalName) === name;
    });
    const usedBySet = draft.inferenceSets.some((set) => set.declensionRules.includes(name));
    if (usedByCard || usedBySet) {
      setError("This rule is still used by a noun or inference set. Reassign those references first.");
      return;
    }
    changeMorphology((current) => ({ ...current, declensionRules: current.declensionRules.filter((_, ruleIndex) => ruleIndex !== index) }));
  }

  function renameInferenceSet(index: number, name: string) {
    const oldName = draft.inferenceSets[index]?.name;
    if (oldName === undefined || oldName === name) return;
    if (draft.inferenceSets.some((set, setIndex) => setIndex !== index && set.name === name)) {
      setError(`An inference set named ${name} already exists.`);
      return;
    }
    changeMorphology((current) => ({
      ...current,
      inferenceSets: current.inferenceSets.map((set, setIndex) => setIndex === index ? { ...set, name } : set),
      syntaxRules: current.syntaxRules.map((syntax) => syntax.inferenceSet === oldName ? { ...syntax, inferenceSet: name } : syntax),
    }));
  }

  function removeInferenceSet(index: number) {
    const name = draft.inferenceSets[index]?.name;
    if (!name) return;
    if (draft.syntaxRules.some((syntax) => syntax.inferenceSet === name)) {
      setError("Move every syntax rule to another inference set before removing this one.");
      return;
    }
    changeMorphology((current) => ({ ...current, inferenceSets: current.inferenceSets.filter((_, setIndex) => setIndex !== index) }));
  }

  function toggleInferenceRule(setIndex: number, ruleName: string) {
    changeMorphology((current) => ({
      ...current,
      inferenceSets: current.inferenceSets.map((set, index) => index !== setIndex ? set : {
        ...set,
        declensionRules: set.declensionRules.includes(ruleName)
          ? set.declensionRules.filter((name) => name !== ruleName)
          : [...set.declensionRules, ruleName],
      }),
    }));
  }

  function updateSyntax(index: number, patch: Partial<NounSyntaxRule>) {
    changeMorphology((current) => ({
      ...current,
      syntaxRules: current.syntaxRules.map((syntax, syntaxIndex) => syntaxIndex === index ? { ...syntax, ...patch } : syntax),
    }));
  }

  function renameSyntax(index: number, name: string) {
    if (draft.syntaxRules.some((syntax, syntaxIndex) => syntaxIndex !== index && syntax.name === name)) {
      setError(`A syntax named ${name} already exists.`);
      return;
    }
    updateSyntax(index, { name });
  }

  function addSyntax() {
    const inferenceSet = draft.inferenceSets[0]?.name;
    if (!inferenceSet) {
      setError("Create an inference set before adding a syntax rule.");
      return;
    }
    changeMorphology((current) => ({ ...current, syntaxRules: [...current.syntaxRules, newSyntax(inferenceSet, current.syntaxRules)] }));
  }

  function removeSyntax(index: number) {
    changeMorphology((current) => ({ ...current, syntaxRules: current.syntaxRules.filter((_, syntaxIndex) => syntaxIndex !== index) }));
  }

  function setSyntaxGenderMarker(index: number, value: "none" | "optional" | "required") {
    changeMorphology((current) => ({
      ...current,
      syntaxRules: current.syntaxRules.map((syntax, syntaxIndex) => {
        if (syntaxIndex !== index) return syntax;
        const markers: NounSyntaxMarker[] = syntax.markers.filter((marker) => marker.kind !== "gender");
        if (value !== "none") markers.unshift({ kind: "gender", required: value === "required" });
        return { ...syntax, markers };
      }),
    }));
  }

  function setSyntaxTantumMarker(index: number, value: "none" | "singular" | "plural") {
    changeMorphology((current) => ({
      ...current,
      syntaxRules: current.syntaxRules.map((syntax, syntaxIndex) => {
        if (syntaxIndex !== index) return syntax;
        const markers: NounSyntaxMarker[] = syntax.markers.filter((marker) => marker.kind !== "tantum");
        if (value !== "none") markers.push({ kind: "tantum", required: true, value });
        return { ...syntax, markers };
      }),
    }));
  }

  function updateSyntaxField(syntaxIndex: number, fieldIndex: number, value: string) {
    const field = syntaxFieldFromValue(value);
    changeMorphology((current) => ({
      ...current,
      syntaxRules: current.syntaxRules.map((syntax, index) => index !== syntaxIndex ? syntax : {
        ...syntax,
        fields: syntax.fields.map((item, itemIndex) => itemIndex === fieldIndex ? field : item),
      }),
    }));
  }

  function addSyntaxField(index: number) {
    changeMorphology((current) => ({
      ...current,
      syntaxRules: current.syntaxRules.map((syntax, syntaxIndex) => syntaxIndex === index
        ? { ...syntax, fields: [...syntax.fields, { kind: "noun", number: "singular" }] }
        : syntax),
    }));
  }

  function removeSyntaxField(syntaxIndex: number, fieldIndex: number) {
    const syntax = draft.syntaxRules[syntaxIndex];
    if (!syntax) return;
    const field = syntax.fields[fieldIndex];
    if (field?.kind === "noun" && syntax.fields.filter((item) => item.kind === "noun").length === 1) {
      setError("A syntax rule must keep at least one noun field.");
      return;
    }
    changeMorphology((current) => ({
      ...current,
      syntaxRules: current.syntaxRules.map((item, index) => index === syntaxIndex
        ? { ...item, fields: item.fields.filter((_, itemIndex) => itemIndex !== fieldIndex) }
        : item),
    }));
  }

  function moveSyntaxField(syntaxIndex: number, fieldIndex: number, direction: -1 | 1) {
    const nextIndex = fieldIndex + direction;
    changeMorphology((current) => ({
      ...current,
      syntaxRules: current.syntaxRules.map((syntax, index) => {
        if (index !== syntaxIndex || nextIndex < 0 || nextIndex >= syntax.fields.length) return syntax;
        const fields = [...syntax.fields];
        [fields[fieldIndex], fields[nextIndex]] = [fields[nextIndex]!, fields[fieldIndex]!];
        return { ...syntax, fields };
      }),
    }));
  }

  function reloadCurrentSource() {
    setDraft(cloneNounMorphology(morphology));
    setRuleNamesByOriginal(identityRuleNames(morphology));
    appliedSourceRef.current = nounSourceFingerprint(cards, morphology);
    setDirty(false);
    setSourceChanged(false);
    setMessage("Reloaded current noun morphology.");
    setError("");
  }

  async function save() {
    if (sourceChanged) return;
    setSaving(true);
    setMessage("");
    setError("");
    try {
      const normalized = normalizeNounMorphology(draft);
      const updatedCards = cards.map((card) => {
        if (card.type !== "noun") return card;
        const definition = nounDefinitionForCard(card);
        const rule = ruleNamesByOriginal[definition.rule] ?? definition.rule;
        const nextCard: Flashcard = {
          ...card,
          details: {
            rule,
            base: definition.base,
            gender: definition.gender,
            articleProfile: definition.articleProfile,
          },
        };
        resolvedNounForms(nextCard, normalized);
        return nextCard;
      });
      await onSave({ cards: updatedCards, nounMorphology: normalized });
      setDraft(cloneNounMorphology(normalized));
      setRuleNamesByOriginal(identityRuleNames(normalized));
      appliedSourceRef.current = nounSourceFingerprint(updatedCards, normalized);
      setDirty(false);
      setSourceChanged(false);
      setMessage("Saved noun morphology.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Noun morphology could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  const sections = [
    { id: "declensions", label: "Declensions", count: draft.declensionRules.length },
    { id: "inference-sets", label: "Inference sets", count: draft.inferenceSets.length },
    { id: "answer-syntax", label: "Answer syntax", count: draft.syntaxRules.length },
  ];

  return <section className="noun-patterns-panel" aria-label="Noun morphology">
    <nav className="jump-links" aria-label="Grammar sections">
      {sections.map((section) => <a key={section.id} href={`#/grammar`} onClick={(event) => { event.preventDefault(); document.getElementById(section.id)?.scrollIntoView({ behavior: "smooth", block: "start" }); }}>{section.label} <span className="tab-count">{section.count}</span></a>)}
    </nav>
    <div className="noun-patterns-body">
      {sourceChanged && <div className="sync-warning" role="alert">
        <p>The noun inventory changed while this morphology draft had unsaved edits. The draft was preserved, but it cannot be saved over the newer inventory.</p>
        <button type="button" className="neutral-button" onClick={reloadCurrentSource}>Discard draft and reload current inventory</button>
      </div>}

      <section className="grammar-section" id="declensions" aria-labelledby="declensions-heading">
      <h2 id="declensions-heading">Declensions</h2>
      <p className="section-intro">A rule turns a stored base into singular and/or plural forms. Leaving a form unsupported makes the rule singular-only or plural-only. Renaming a rule updates every noun and inference set that uses it.</p>
      <div className="noun-patterns-table-wrap">
        <table className="noun-patterns-table declension-rules-table">
          <thead><tr><th>Name</th><th>Singular form</th><th>Plural form</th><th /></tr></thead>
          <tbody>{draft.declensionRules.map((rule, index) => <tr key={`rule:${index}`}>
            <td><input value={rule.name} onChange={(event) => renameRule(index, event.target.value)} /></td>
            <td><div className="morphology-form-cell"><label className="morphology-support-toggle"><input type="checkbox" checked={Boolean(rule.forms.singular)} onChange={(event) => toggleRuleForm(index, "singular", event.target.checked)} /><span>Supported</span></label>{rule.forms.singular && <input className="morphology-suffix-input" value={rule.forms.singular.suffix} onChange={(event) => updateRuleSuffix(index, "singular", event.target.value)} placeholder="suffix" />}</div></td>
            <td><div className="morphology-form-cell"><label className="morphology-support-toggle"><input type="checkbox" checked={Boolean(rule.forms.plural)} onChange={(event) => toggleRuleForm(index, "plural", event.target.checked)} /><span>Supported</span></label>{rule.forms.plural && <input className="morphology-suffix-input" value={rule.forms.plural.suffix} onChange={(event) => updateRuleSuffix(index, "plural", event.target.value)} placeholder="suffix" />}</div></td>
            <td><button type="button" className="row-remove" onClick={() => removeRule(index)} aria-label={`Remove declension rule ${rule.name}`}>×</button></td>
          </tr>)}</tbody>
        </table>
      </div>
      <div className="noun-pattern-actions"><button type="button" className="neutral-button" onClick={() => changeMorphology((current) => ({ ...current, declensionRules: [...current.declensionRules, newRule(current.declensionRules)] }))}>Add rule</button></div>
      </section>

      <section className="grammar-section" id="inference-sets" aria-labelledby="inference-heading">
      <h2 id="inference-heading">Inference sets</h2>
      <p className="section-intro">Inference sets decide which declensions a shorthand answer may assume. Leave a rule out of <em>Learned shorthand</em> until you know it, and Parola will insist on the full form for those nouns.</p>
      {draft.inferenceSets.map((set, setIndex) => <div className="morphology-inference-set" key={`set:${setIndex}`}>
        <div className="noun-pattern-actions">
          <input value={set.name} onChange={(event) => renameInferenceSet(setIndex, event.target.value)} aria-label="Inference set name" />
          <button type="button" className="row-remove" onClick={() => removeInferenceSet(setIndex)} aria-label={`Remove inference set ${set.name}`}>×</button>
        </div>
        <div className="morphology-rule-checks">{draft.declensionRules.map((rule) => <label key={rule.name}>
          <input type="checkbox" checked={set.declensionRules.includes(rule.name)} onChange={() => toggleInferenceRule(setIndex, rule.name)} />
          <span>{rule.name}</span>
        </label>)}</div>
      </div>)}
      <div className="noun-pattern-actions"><button type="button" className="neutral-button" onClick={() => changeMorphology((current) => ({ ...current, inferenceSets: [...current.inferenceSets, newInferenceSet(current.inferenceSets)] }))}>Add inference set</button></div>
      </section>

      <section className="grammar-section" id="answer-syntax" aria-labelledby="syntax-heading">
      <h2 id="syntax-heading">Answer syntax</h2>
      <p className="section-intro">Each syntax is one accepted shape for a typed noun answer. Article fields require the noun to take that article; a syntax without articles is for articleless nouns and needs explicit gender and singular/plural-only markers.</p>
      {draft.syntaxRules.map((syntax, syntaxIndex) => {
        const genderMarker = syntax.markers.find((marker) => marker.kind === "gender");
        const tantumMarker = syntax.markers.find((marker) => marker.kind === "tantum");
        const genderValue = !genderMarker ? "none" : genderMarker.required ? "required" : "optional";
        return <div className="morphology-inference-set" key={`syntax:${syntaxIndex}`}>
          <div className="noun-pattern-actions">
            <input value={syntax.name} onChange={(event) => renameSyntax(syntaxIndex, event.target.value)} aria-label="Syntax name" />
            <SyntaxPipeline syntax={syntax} />
            <button type="button" className="row-remove" onClick={() => removeSyntax(syntaxIndex)} aria-label={`Remove syntax ${syntax.name}`}>×</button>
          </div>
          <div className="noun-patterns-table-wrap">
            <table className="noun-patterns-table syntax-settings-table">
              <thead><tr><th>Gender marker</th><th>Tantum marker</th><th>Inference set</th></tr></thead>
              <tbody><tr>
                <td><select value={genderValue} onChange={(event) => setSyntaxGenderMarker(syntaxIndex, event.target.value as "none" | "optional" | "required")}><option value="none">None</option><option value="optional">Optional</option><option value="required">Required</option></select></td>
                <td><select value={tantumMarker?.kind === "tantum" ? tantumMarker.value : "none"} onChange={(event) => setSyntaxTantumMarker(syntaxIndex, event.target.value as "none" | "singular" | "plural")}><option value="none">None</option><option value="singular">Required singular-only</option><option value="plural">Required plural-only</option></select></td>
                <td><select value={syntax.inferenceSet} onChange={(event) => updateSyntax(syntaxIndex, { inferenceSet: event.target.value })}>{draft.inferenceSets.map((set) => <option key={set.name} value={set.name}>{set.name}</option>)}</select></td>
              </tr></tbody>
            </table>
          </div>
          <div className="noun-patterns-table-wrap">
            <table className="noun-patterns-table syntax-fields-table">
              <thead><tr><th>#</th><th>Input field</th><th /></tr></thead>
              <tbody>{syntax.fields.map((field, fieldIndex) => <tr key={`${syntaxIndex}:${fieldIndex}`}>
                <td>{fieldIndex + 1}</td>
                <td><select value={syntaxFieldValue(field)} onChange={(event) => updateSyntaxField(syntaxIndex, fieldIndex, event.target.value)}>
                  <option value="noun:singular">Singular noun</option>
                  <option value="noun:plural">Plural noun</option>
                  <option value="article:definite:singular">Definite singular article</option>
                  <option value="article:definite:plural">Definite plural article</option>
                  <option value="article:indefinite:singular">Indefinite singular article</option>
                </select></td>
                <td><div className="noun-pattern-actions">
                  <button type="button" className="neutral-button" onClick={() => moveSyntaxField(syntaxIndex, fieldIndex, -1)} disabled={fieldIndex === 0}>↑</button>
                  <button type="button" className="neutral-button" onClick={() => moveSyntaxField(syntaxIndex, fieldIndex, 1)} disabled={fieldIndex === syntax.fields.length - 1}>↓</button>
                  <button type="button" className="row-remove" onClick={() => removeSyntaxField(syntaxIndex, fieldIndex)}>×</button>
                </div></td>
              </tr>)}</tbody>
            </table>
          </div>
          <div className="noun-pattern-actions"><button type="button" className="neutral-button" onClick={() => addSyntaxField(syntaxIndex)}>Add field</button></div>
        </div>;
      })}
      <div className="noun-pattern-actions"><button type="button" className="neutral-button" onClick={addSyntax}>Add syntax rule</button></div>
      </section>
    </div>
    {(dirty || message || error) && <div className="grid-save-bar" role="region" aria-label="Grammar changes">
      {error ? <p className="form-error" role="alert">{error}</p> : message ? <p className="success-message" role="status">{message}</p> : <p>Unsaved grammar changes</p>}
      {dirty && <button type="button" className="text-button" onClick={reloadCurrentSource} disabled={saving}>Discard</button>}
      {dirty && <button type="button" className="primary-button" onClick={() => void save()} disabled={saving || sourceChanged}>{saving ? "Saving…" : "Save grammar"}</button>}
    </div>}
  </section>;
}
