import { useEffect, useRef, useState } from "react";
import type { Flashcard, NounCard } from "../cards/types";
import { nounFormPhrases } from "../cards/nounDraft";
import {
  cloneNounMorphology,
  normalizeNounMorphology,
  nounDefinitionForCard,
  resolvedNounForms,
  type NounArticleGroup,
  type NounArticleSet,
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
    excludedArticleGroups: [],
  };
}

function newArticleGroup(existing: NounArticleGroup[]): NounArticleGroup {
  return {
    name: uniqueName("New group", existing.map((group) => group.name)),
    startsWith: [],
    masculine: { definiteSingular: "il", definitePlural: "i", indefiniteSingular: "un" },
    feminine: { definiteSingular: "la", definitePlural: "le", indefiniteSingular: "una" },
  };
}

const articleColumns: { gender: "masculine" | "feminine"; key: keyof NounArticleSet; label: string }[] = [
  { gender: "masculine", key: "definiteSingular", label: "definite singular" },
  { gender: "masculine", key: "definitePlural", label: "definite plural" },
  { gender: "masculine", key: "indefiniteSingular", label: "indefinite singular" },
  { gender: "feminine", key: "definiteSingular", label: "definite singular" },
  { gender: "feminine", key: "definitePlural", label: "definite plural" },
  { gender: "feminine", key: "indefiniteSingular", label: "indefinite singular" },
];

function parsePatterns(text: string) {
  return text.split(",").map((pattern) => pattern.trim()).filter(Boolean);
}

/** Comma-separated patterns, edited as text so a trailing comma survives while typing. */
function PatternInput({ value, onChange, label }: { value: string[]; onChange: (patterns: string[]) => void; label: string }) {
  const [text, setText] = useState(() => value.join(", "));
  useEffect(() => {
    setText((current) => JSON.stringify(parsePatterns(current)) === JSON.stringify(value) ? current : value.join(", "));
  }, [value]);
  return <input className="morphology-suffix-input" value={text} onChange={(event) => { setText(event.target.value); onChange(parsePatterns(event.target.value)); }} aria-label={label} placeholder="sC, z, gn" spellCheck={false} />;
}

/** Letter lists are edited as free text; every non-space, non-comma character is one letter. */
function lettersFromText(value: string) {
  return [...value.normalize("NFC").toLocaleLowerCase("it-IT")].filter((character) => !/[\s,]/u.test(character));
}

/** Nouns with an irregular declension or an article-group exception, for the Exceptions list. */
function exceptionalNouns(cards: Flashcard[]) {
  return cards.filter((card): card is NounCard => card.type === "noun"
    && (card.details.declension.kind === "irregular" || Boolean(card.details.articleGroups.singular || card.details.articleGroups.plural)));
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

function identityGroupNames(morphology: NounMorphology) {
  return Object.fromEntries(morphology.articleGroups.map((group) => [group.name, group.name])) as Record<string, string>;
}

export function NounMorphologyPanel({
  cards,
  morphology,
  onSave,
  onOpenCard,
}: {
  cards: Flashcard[];
  morphology: NounMorphology;
  onSave: (state: InventoryState) => Promise<void>;
  onOpenCard: (card: Flashcard) => void;
}) {
  const [draft, setDraft] = useState(() => cloneNounMorphology(morphology));
  const [ruleNamesByOriginal, setRuleNamesByOriginal] = useState(() => identityRuleNames(morphology));
  const [groupNamesByOriginal, setGroupNamesByOriginal] = useState(() => identityGroupNames(morphology));
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
    setGroupNamesByOriginal(identityGroupNames(morphology));
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
      if (card.type !== "noun" || card.details.declension.kind !== "rule") return false;
      const originalName = card.details.declension.rule;
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

  function renameArticleGroup(index: number, name: string) {
    const oldName = draft.articleGroups[index]?.name;
    if (oldName === undefined || oldName === name) return;
    if (draft.articleGroups.some((group, groupIndex) => groupIndex !== index && group.name === name)) {
      setError(`An article group named ${name} already exists.`);
      return;
    }
    changeMorphology((current) => ({
      ...current,
      articleGroups: current.articleGroups.map((group, groupIndex) => groupIndex === index ? { ...group, name } : group),
      syntaxRules: current.syntaxRules.map((syntax) => ({
        ...syntax,
        excludedArticleGroups: syntax.excludedArticleGroups.map((groupName) => groupName === oldName ? name : groupName),
      })),
    }));
    setGroupNamesByOriginal((current) => Object.fromEntries(
      Object.entries(current).map(([original, currentName]) => [original, currentName === oldName ? name : currentName]),
    ));
  }

  function updateArticleGroup(index: number, patch: Partial<NounArticleGroup>) {
    changeMorphology((current) => ({
      ...current,
      articleGroups: current.articleGroups.map((group, groupIndex) => groupIndex === index ? { ...group, ...patch } : group),
    }));
  }

  function updateArticle(index: number, gender: "masculine" | "feminine", key: keyof NounArticleSet, value: string) {
    const group = draft.articleGroups[index];
    if (group) updateArticleGroup(index, { [gender]: { ...group[gender], [key]: value } });
  }

  function updateArticleLetters(kind: "vowels" | "consonants", value: string) {
    changeMorphology((current) => ({ ...current, articleLetters: { ...current.articleLetters, [kind]: lettersFromText(value) } }));
  }

  function removeArticleGroup(index: number) {
    const name = draft.articleGroups[index]?.name;
    if (!name) return;
    if (draft.articleGroups.length === 1) {
      setError("Keep at least one article group.");
      return;
    }
    const usedByCard = cards.some((card) => card.type === "noun" && [card.details.articleGroups.singular, card.details.articleGroups.plural]
      .some((original) => original !== null && (groupNamesByOriginal[original] ?? original) === name));
    if (usedByCard) {
      setError(`Some nouns use ${name} as an article exception. Change those nouns first.`);
      return;
    }
    changeMorphology((current) => ({
      ...current,
      articleGroups: current.articleGroups.filter((_, groupIndex) => groupIndex !== index),
      syntaxRules: current.syntaxRules.map((syntax) => ({ ...syntax, excludedArticleGroups: syntax.excludedArticleGroups.filter((groupName) => groupName !== name) })),
    }));
  }

  function toggleSyntaxExclusion(syntaxIndex: number, groupName: string) {
    changeMorphology((current) => ({
      ...current,
      syntaxRules: current.syntaxRules.map((syntax, index) => index !== syntaxIndex ? syntax : {
        ...syntax,
        excludedArticleGroups: syntax.excludedArticleGroups.includes(groupName)
          ? syntax.excludedArticleGroups.filter((name) => name !== groupName)
          : [...syntax.excludedArticleGroups, groupName],
      }),
    }));
  }

  function reloadCurrentSource() {
    setDraft(cloneNounMorphology(morphology));
    setRuleNamesByOriginal(identityRuleNames(morphology));
    setGroupNamesByOriginal(identityGroupNames(morphology));
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
        const renameGroup = (name: string | null) => name === null ? null : groupNamesByOriginal[name] ?? name;
        const declension = definition.declension.kind === "rule"
          ? { ...definition.declension, rule: ruleNamesByOriginal[definition.declension.rule] ?? definition.declension.rule }
          : definition.declension;
        const nextCard: Flashcard = {
          ...card,
          details: {
            ...definition,
            declension,
            articleGroups: { singular: renameGroup(definition.articleGroups.singular), plural: renameGroup(definition.articleGroups.plural) },
          },
        };
        resolvedNounForms(nextCard, normalized);
        return nextCard;
      });
      await onSave({ cards: updatedCards, nounMorphology: normalized });
      setDraft(cloneNounMorphology(normalized));
      setRuleNamesByOriginal(identityRuleNames(normalized));
      setGroupNamesByOriginal(identityGroupNames(normalized));
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

  const exceptions = exceptionalNouns(cards);
  const sections = [
    { id: "declensions", label: "Declensions", count: draft.declensionRules.length },
    { id: "articles", label: "Articles", count: draft.articleGroups.length },
    { id: "inference-sets", label: "Inference sets", count: draft.inferenceSets.length },
    { id: "answer-syntax", label: "Answer syntax", count: draft.syntaxRules.length },
    { id: "noun-exceptions", label: "Exceptions", count: exceptions.length },
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

      <section className="grammar-section" id="articles" aria-labelledby="articles-heading">
      <h2 id="articles-heading">Articles</h2>
      <p className="section-intro">Each group lists patterns for how a word starts. In a pattern, <code>V</code> stands for any vowel and <code>C</code> for any consonant from the lists below; every other letter stands for itself, so <code>sC</code> is s + consonant and <code>iV</code> is i + vowel. Groups are checked from top to bottom and the first match wins. Singular and plural forms are grouped separately, and a noun can override its group under Article exceptions in the word editor.</p>
      <div className="letter-sets">
        <label className="field"><span>Vowels (<code>V</code>)</span><input lang="it" value={draft.articleLetters.vowels.join(" ")} onChange={(event) => updateArticleLetters("vowels", event.target.value)} spellCheck={false} /></label>
        <label className="field"><span>Consonants (<code>C</code>)</span><input lang="it" value={draft.articleLetters.consonants.join(" ")} onChange={(event) => updateArticleLetters("consonants", event.target.value)} spellCheck={false} /></label>
      </div>
      <div className="noun-patterns-table-wrap">
        <table className="noun-patterns-table article-groups-table">
          <thead>
            <tr><th rowSpan={3}>Group</th><th rowSpan={3}>Starts with</th><th colSpan={3} className="grouped-heading">Masculine</th><th colSpan={3} className="grouped-heading">Feminine</th><th rowSpan={3} /></tr>
            <tr><th colSpan={2} className="grouped-heading">Definite</th><th className="grouped-heading">Indefinite</th><th colSpan={2} className="grouped-heading">Definite</th><th className="grouped-heading">Indefinite</th></tr>
            <tr><th>Singular</th><th>Plural</th><th>Singular</th><th>Singular</th><th>Plural</th><th>Singular</th></tr>
          </thead>
          <tbody>{draft.articleGroups.map((group, index) => <tr key={`group:${index}`}>
            <td><input value={group.name} onChange={(event) => renameArticleGroup(index, event.target.value)} aria-label="Article group name" /></td>
            <td><PatternInput value={group.startsWith} onChange={(startsWith) => updateArticleGroup(index, { startsWith })} label={`Patterns for ${group.name}`} /></td>
            {articleColumns.map((column) => <td key={`${column.gender}:${column.key}`}><input className="article-input" lang="it" value={group[column.gender][column.key]} onChange={(event) => updateArticle(index, column.gender, column.key, event.target.value)} aria-label={`${group.name} ${column.gender} ${column.label}`} /></td>)}
            <td><button type="button" className="row-remove" onClick={() => removeArticleGroup(index)} aria-label={`Remove article group ${group.name}`}>×</button></td>
          </tr>)}</tbody>
        </table>
      </div>
      <div className="noun-pattern-actions"><button type="button" className="neutral-button" onClick={() => changeMorphology((current) => ({ ...current, articleGroups: [newArticleGroup(current.articleGroups), ...current.articleGroups] }))}>Add group at top</button></div>
      </section>

      <section className="grammar-section" id="inference-sets" aria-labelledby="inference-heading">
      <h2 id="inference-heading">Inference sets</h2>
      <p className="section-intro">Inference sets decide which declensions a shorthand answer may assume. Leave a rule out of <em>Learned shorthand</em> until you know it, and Parola will insist on the full form for those nouns. Irregular nouns belong to every set, but an answer only counts when it gives every form the noun has.</p>
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
          {syntax.fields.some((field) => field.kind === "article") && <div className="syntax-exclusions">
            <span>Not for nouns in</span>
            <div className="morphology-rule-checks">{draft.articleGroups.map((group) => <label key={group.name}>
              <input type="checkbox" checked={syntax.excludedArticleGroups.includes(group.name)} onChange={() => toggleSyntaxExclusion(syntaxIndex, group.name)} />
              <span>{group.name}</span>
            </label>)}</div>
          </div>}
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

      <section className="grammar-section" id="noun-exceptions" aria-labelledby="exceptions-heading">
      <h2 id="exceptions-heading">Exceptions</h2>
      <p className="section-intro">Nouns that are irregular or override their article group. Set these in the word editor under Rule and Exceptions.</p>
      {exceptions.length ? <ul className="exception-list">{exceptions.map((card) => {
        let forms: ReturnType<typeof resolvedNounForms> | null = null;
        try { forms = resolvedNounForms(card, morphology); } catch { /* shown as-is */ }
        const notes = [
          card.details.declension.kind === "irregular" ? "irregular" : null,
          card.details.articleGroups.singular ? `singular as ${card.details.articleGroups.singular}` : null,
          card.details.articleGroups.plural ? `plural as ${card.details.articleGroups.plural}` : null,
        ].filter(Boolean);
        return <li key={card.id}><button type="button" className="exception-item" onClick={() => onOpenCard(card)}>
          <strong lang="it">{forms ? nounFormPhrases(forms).map((phrase) => phrase.text).join(" · ") || [forms.singular, forms.plural].filter(Boolean).join(" / ") : card.english}</strong>
          <span>{card.english}</span>
          <small>{notes.join(" · ")}</small>
        </button></li>;
      })}</ul> : <p className="filter-empty">No exceptions yet.</p>}
      </section>
    </div>
    {(dirty || message || error) && <div className="grid-save-bar" role="region" aria-label="Grammar changes">
      {error ? <p className="form-error" role="alert">{error}</p> : message ? <p className="success-message" role="status">{message}</p> : <p>Unsaved grammar changes</p>}
      {dirty && <button type="button" className="text-button" onClick={reloadCurrentSource} disabled={saving}>Discard</button>}
      {dirty && <button type="button" className="primary-button" onClick={() => void save()} disabled={saving || sourceChanged}>{saving ? "Saving…" : "Save grammar"}</button>}
    </div>}
  </section>;
}
