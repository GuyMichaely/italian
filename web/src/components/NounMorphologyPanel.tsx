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
  type NounGender,
  type NounMorphology,
} from "../cards/nounMorphology";
import type { InventoryState } from "../storage";
import type { StudyPreferences } from "../study/preferences";

function uniqueName(base: string, existing: string[]) {
  if (!existing.includes(base)) return base;
  let suffix = 2;
  while (existing.includes(`${base} ${suffix}`)) suffix += 1;
  return `${base} ${suffix}`;
}

function newRule(existing: NounDeclensionRule[]): NounDeclensionRule {
  return {
    name: uniqueName("New declension", existing.map((rule) => rule.name)),
    gender: null,
    forms: { singular: { suffix: "" }, plural: { suffix: "" } },
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

/** Nouns that are irregular, change gender with plurality, or have an article-group exception, for the Exceptions list. */
function exceptionalNouns(cards: Flashcard[]) {
  return cards.filter((card): card is NounCard => card.type === "noun"
    && (card.details.declension.kind === "irregular" || card.details.genderDiffersWithPlurality || Boolean(card.details.articleGroups.singular || card.details.articleGroups.plural)));
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
  studyPreferences,
  onSave,
  onOpenCard,
}: {
  cards: Flashcard[];
  morphology: NounMorphology;
  studyPreferences: StudyPreferences;
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

  function updateRuleGender(index: number, gender: NounGender | null) {
    changeMorphology((current) => ({
      ...current,
      declensionRules: current.declensionRules.map((rule, ruleIndex) => ruleIndex === index ? { ...rule, gender } : rule),
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
    if (usedByCard) {
      setError("This rule is still used by a noun. Reassign those nouns first.");
      return;
    }
    changeMorphology((current) => ({ ...current, declensionRules: current.declensionRules.filter((_, ruleIndex) => ruleIndex !== index) }));
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
      // Drilled rules follow renames; a removed rule simply stops being drilled.
      const fullDeclensionRules = studyPreferences.fullDeclensionRules.map((name) => ruleNamesByOriginal[name] ?? name);
      await onSave({ cards: updatedCards, nounMorphology: normalized, studyPreferences: { ...studyPreferences, fullDeclensionRules } });
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
    { id: "noun-exceptions", label: "Exceptions", count: exceptions.length },
  ];

  return <section className="noun-patterns-panel" aria-label="Noun morphology">
    <nav className="jump-links" aria-label="Grammar sections">
      {sections.map((section) => <a key={section.id} href={`#/grammar`} onClick={(event) => { event.preventDefault(); document.getElementById(section.id)?.scrollIntoView({ behavior: "instant", block: "start" }); }}>{section.label} <span className="tab-count">{section.count}</span></a>)}
    </nav>
    <div className="noun-patterns-body">
      {sourceChanged && <div className="sync-warning" role="alert">
        <p>The noun inventory changed while this morphology draft had unsaved edits. The draft was preserved, but it cannot be saved over the newer inventory.</p>
        <button type="button" className="neutral-button" onClick={reloadCurrentSource}>Discard draft and reload current inventory</button>
      </div>}

      <section className="grammar-section" id="declensions" aria-labelledby="declensions-heading">
      <h2 id="declensions-heading">Declensions</h2>
      <p className="section-intro">A rule turns a stored base into singular and/or plural forms. Leaving a form unsupported makes the rule singular-only or plural-only. A rule limited to one gender is only used for nouns of that gender. Renaming a rule updates every noun that uses it.</p>
      <p className="section-intro">In word mode, one form is enough when the rules predict the plural from the singular: the rule with the longest matching singular ending wins. When equally specific rules disagree, or a noun doesn’t follow the winning rule, word mode asks for both forms.</p>
      <div className="noun-patterns-table-wrap">
        <table className="noun-patterns-table declension-rules-table">
          <thead><tr><th>Name</th><th>Gender</th><th>Singular form</th><th>Plural form</th><th /></tr></thead>
          <tbody>{draft.declensionRules.map((rule, index) => <tr key={`rule:${index}`}>
            <td><input value={rule.name} onChange={(event) => renameRule(index, event.target.value)} /></td>
            <td><select value={rule.gender ?? ""} onChange={(event) => updateRuleGender(index, (event.target.value || null) as NounGender | null)} aria-label={`${rule.name} gender`}>
              <option value="">Any</option>
              <option value="masculine">Masculine</option>
              <option value="feminine">Feminine</option>
            </select></td>
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

      <section className="grammar-section" id="noun-exceptions" aria-labelledby="exceptions-heading">
      <h2 id="exceptions-heading">Exceptions</h2>
      <p className="section-intro">Nouns that are irregular, whose gender differs with plurality, or that override their article group. Set these in the word editor.</p>
      {exceptions.length ? <ul className="exception-list">{exceptions.map((card) => {
        let forms: ReturnType<typeof resolvedNounForms> | null = null;
        try { forms = resolvedNounForms(card, morphology); } catch { /* shown as-is */ }
        const notes = [
          card.details.declension.kind === "irregular" ? "irregular" : null,
          card.details.genderDiffersWithPlurality ? `gender differs with plurality (plural ${card.details.gender === "masculine" ? "feminine" : "masculine"})` : null,
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
