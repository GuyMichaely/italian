import { type FormEvent, useState } from "react";
import type { Flashcard } from "../cards/types";
import type { NounMorphology } from "../cards/nounMorphology";
import { typeLabels } from "../cardTypes";
import {
  adverbRowFromCard,
  parseTags,
  verbRowFromCard,
  type AdverbBatchRow,
  type VerbBatchRow,
} from "../cards/editorModel";
import { adjectiveCardFromDraft, adjectiveDraftForEditing, resolveAdjectiveDraft, suggestedAdjectiveForms, type AdjectiveDraft } from "../cards/adjectiveDraft";
import { adjectiveFormLabels, adjectiveForms, adjectiveFormsEqual, type AdjectiveMorphology } from "../cards/adjectiveMorphology";
import { articleProfileOptions, draftFormNumbers, emptyNounDraft, irregularRuleValue, nounCardFromDraft, nounDraftForEditing, nounDraftWithRule, resolveNounDraft, spellingGroup, type NounDraft } from "../cards/nounDraft";
import { adjectiveFullFormsReasonLabels, adjectiveFullFormsReasons, fullDeclensionReasonLabels, fullDeclensionReasons, type StudyPreferences } from "../study/preferences";
import { AdjectiveDerivedPreview, AdjectiveRuleSelect, NounDerivedPreview, NounRuleSelect, SetField, TagsField } from "./CardEditorFields";
import { Sheet } from "./Sheet";

function TextField({ label, value, onChange, autoFocus = false, placeholder, italian = false, disabled = false }: { label: string; value: string; onChange: (value: string) => void; autoFocus?: boolean; placeholder?: string; italian?: boolean; disabled?: boolean }) {
  return <label className="field">
    <span>{label}</span>
    <input value={value} onChange={(event) => onChange(event.target.value)} autoFocus={autoFocus} placeholder={placeholder} disabled={disabled} {...(italian ? { autoCapitalize: "none", spellCheck: false, lang: "it" } : {})} />
  </label>;
}

export function WordDrawer({
  card,
  knownSets,
  morphology,
  adjectiveMorphology,
  studyPreferences,
  onClose,
  onSave,
  onRemove,
}: {
  card: Flashcard;
  knownSets: string[];
  morphology: NounMorphology;
  adjectiveMorphology: AdjectiveMorphology;
  studyPreferences: StudyPreferences;
  onClose: () => void;
  /** `fullDeclension` is whether a word answer should always ask for every form of this noun or adjective. */
  onSave: (card: Flashcard, fullDeclension: boolean) => void;
  onRemove: (id: number) => void;
}) {
  const [formError, setFormError] = useState("");
  const [setName, setSetName] = useState(card.setName ?? "");
  const [tags, setTags] = useState(card.tags.join(", "));
  const [noun, setNoun] = useState<NounDraft>(() => card.type === "noun" ? nounDraftForEditing(card, morphology) : emptyNounDraft());
  const [verb, setVerb] = useState<VerbBatchRow | null>(() => card.type === "verb" ? verbRowFromCard(card) : null);
  const [adjective, setAdjective] = useState<AdjectiveDraft | null>(() => card.type === "adjective" ? adjectiveDraftForEditing(card, adjectiveMorphology) : null);
  const [adverb, setAdverb] = useState<AdverbBatchRow | null>(() => card.type === "adverb" ? adverbRowFromCard(card) : null);
  const [fullDeclension, setFullDeclension] = useState(() => studyPreferences.fullDeclensionCards.includes(card.id));

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const common = { id: card.id, setName: setName.trim() || null, tags: parseTags(tags), editedAt: card.editedAt };
    let updated: Flashcard;
    try {
      if (card.type === "noun") {
        updated = nounCardFromDraft(noun, common, morphology);
      } else if (verb) {
        if ([verb.english, verb.infinitive, verb.io, verb.tu, verb.luiLei, verb.noi, verb.voi, verb.loro, verb.participle].some((value) => !value.trim())) throw new Error("English, infinitive, all six present-tense forms, and the participle are required.");
        updated = { ...common, type: "verb", english: verb.english.trim(), italian: verb.infinitive.trim(), details: {
          io: verb.io.trim(), tu: verb.tu.trim(), luiLei: verb.luiLei.trim(), noi: verb.noi.trim(),
          voi: verb.voi.trim(), loro: verb.loro.trim(), auxiliary: verb.auxiliary, participle: verb.participle.trim(),
        } };
      } else if (adjective) {
        updated = adjectiveCardFromDraft(adjective, common, adjectiveMorphology);
      } else if (adverb) {
        if (!adverb.english.trim() || !adverb.form.trim()) throw new Error("English and the Italian adverb are required.");
        updated = { ...common, type: "adverb", english: adverb.english.trim(), italian: adverb.form.trim(), details: {} };
      } else {
        return;
      }
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : "This word could not be saved.");
      return;
    }
    setFormError("");
    onSave(updated, fullDeclension);
    onClose();
  }

  function remove() {
    if (!window.confirm(`Delete “${card.english}”? This cannot be undone.`)) return;
    onRemove(card.id);
    onClose();
  }

  const nounNumbers = draftFormNumbers(noun.rule, morphology);
  // Whether the edited noun has both forms, and what already makes word mode ask for both.
  const resolvedNoun = card.type === "noun" ? resolveNounDraft(noun, morphology) : null;
  const hasBothForms = Boolean(resolvedNoun?.ok && resolvedNoun.forms.singular && resolvedNoun.forms.plural);
  const otherReasons = resolvedNoun?.ok && card.type === "noun"
    ? fullDeclensionReasons({ ...card, details: resolvedNoun.details }, morphology, { ...studyPreferences, fullDeclensionCards: [] })
    : [];

  // The forms the rules suggest, offered when they differ from what's typed; and what already asks for all four.
  const suggestion = adjective ? suggestedAdjectiveForms(adjective.masculineSingular, adjectiveMorphology) : null;
  const offeredSuggestion = adjective && suggestion && !adjectiveFormsEqual(suggestion, adjective) ? suggestion : null;
  const resolvedAdjective = adjective ? resolveAdjectiveDraft(adjective, adjectiveMorphology) : null;
  const adjectiveReasons = resolvedAdjective?.ok && card.type === "adjective"
    ? adjectiveFullFormsReasons({ ...card, details: { declension: resolvedAdjective.declension } }, adjectiveMorphology, { ...studyPreferences, fullDeclensionCards: [] })
    : [];

  return (
    <Sheet size="side" title={card.english} subtitle={<span className={`pos-badge ${card.type}`}>{typeLabels[card.type]}</span>} onClose={onClose}>
      <form className="word-editor" onSubmit={submit}>
        {card.type === "noun" && <>
          <TextField label="English" value={noun.english} onChange={(english) => setNoun((draft) => ({ ...draft, english }))} autoFocus />
          <div className="field-row">
            <TextField label="Singular" italian value={noun.singular} disabled={!nounNumbers.singular} placeholder={nounNumbers.singular ? undefined : "none"} onChange={(singular) => setNoun((draft) => ({ ...draft, singular }))} />
            <TextField label="Plural" italian value={noun.plural} disabled={!nounNumbers.plural} placeholder={nounNumbers.plural ? undefined : "none"} onChange={(plural) => setNoun((draft) => ({ ...draft, plural }))} />
          </div>
          <div className="field-row">
            <div className="field">
              <span>{noun.genderDiffersWithPlurality ? "Singular gender" : "Gender"}</span>
              <div className="segmented compact" role="radiogroup" aria-label="Gender">
                {(["masculine", "feminine"] as const).map((gender) => <button type="button" role="radio" aria-checked={noun.gender === gender} key={gender} className={noun.gender === gender ? "active" : ""} onClick={() => setNoun((draft) => ({ ...draft, gender }))}>{gender === "masculine" ? "Masculine" : "Feminine"}</button>)}
              </div>
            </div>
            <label className="field">
              <span>Articles</span>
              <select value={noun.articles} onChange={(event) => setNoun((draft) => ({ ...draft, articles: event.target.value as NounDraft["articles"] }))}>
                {articleProfileOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
          </div>
          <label className="check-option">
            <input type="checkbox" checked={noun.genderDiffersWithPlurality} onChange={(event) => setNoun((draft) => ({ ...draft, genderDiffersWithPlurality: event.target.checked }))} />
            <span><strong>Gender differs with plurality</strong><small>{noun.genderDiffersWithPlurality ? `The plural is ${noun.gender === "masculine" ? "feminine" : "masculine"}, as in l’uovo / le uova.` : "Like l’uovo / le uova: the plural takes the other gender."}</small></span>
          </label>
          <label className="field">
            <span>Declension rule{noun.rule === irregularRuleValue ? " · forms are stored exactly as typed" : ""}</span>
            <NounRuleSelect label="Declension rule" value={noun.rule} morphology={morphology} onChange={(rule) => setNoun((draft) => nounDraftWithRule(draft, rule, morphology))} />
          </label>
          <details className="exceptions-box" open={Boolean(noun.singularGroup || noun.pluralGroup)}>
            <summary>Article exceptions{noun.singularGroup || noun.pluralGroup ? " · on" : ""}</summary>
            <p className="field-hint">Articles normally follow the spelling rules in Grammar → Articles. Override a form’s group when a word breaks them, e.g. plural “dei” in the “lo / gli” group gives “gli dei”.</p>
            <div className="field-row">
              {(["singular", "plural"] as const).map((number) => {
                const form = number === "singular" ? noun.singular : noun.plural;
                const field = number === "singular" ? "singularGroup" : "pluralGroup";
                const automatic = spellingGroup(form, morphology);
                return <label className="field" key={number}>
                  <span>{number === "singular" ? "Singular" : "Plural"} group</span>
                  <select value={noun[field]} disabled={!form.trim()} onChange={(event) => setNoun((draft) => ({ ...draft, [field]: event.target.value }))}>
                    <option value="">Automatic{automatic ? ` (${automatic})` : ""}</option>
                    {morphology.articleGroups.map((group) => <option key={group.name} value={group.name}>{group.name}</option>)}
                  </select>
                </label>;
              })}
            </div>
          </details>
          <div className="derived-box"><span className="field-label">Generated forms</span><NounDerivedPreview draft={noun} morphology={morphology} /></div>
          {hasBothForms && <div className="study-options">
            <span className="field-label">Study</span>
            <label className="check-option">
              <input type="checkbox" checked={fullDeclension} onChange={(event) => setFullDeclension(event.target.checked)} />
              <span>Always ask for the singular and plural in word mode</span>
            </label>
            {otherReasons.length > 0 && <p className="field-hint">Already asked for both: {otherReasons.map((reason) => fullDeclensionReasonLabels[reason]).join("; ")}.</p>}
          </div>}
        </>}
        {verb && <>
          <TextField label="English" value={verb.english} onChange={(english) => setVerb({ ...verb, english })} autoFocus />
          <TextField label="Infinitive" italian value={verb.infinitive} onChange={(infinitive) => setVerb({ ...verb, infinitive })} />
          <div className="conjugation-fields">
            {([["io", "io"], ["tu", "tu"], ["luiLei", "lui / lei"], ["noi", "noi"], ["voi", "voi"], ["loro", "loro"]] as const).map(([field, label]) => <TextField key={field} label={label} italian value={verb[field]} onChange={(value) => setVerb({ ...verb, [field]: value })} />)}
          </div>
          <div className="field-row">
            <label className="field"><span>Auxiliary</span><select value={verb.auxiliary} onChange={(event) => setVerb({ ...verb, auxiliary: event.target.value as VerbBatchRow["auxiliary"] })}><option value="avere">avere</option><option value="essere">essere</option></select></label>
            <TextField label="Participle" italian value={verb.participle} onChange={(participle) => setVerb({ ...verb, participle })} />
          </div>
        </>}
        {adjective && <>
          <TextField label="English" value={adjective.english} onChange={(english) => setAdjective({ ...adjective, english })} autoFocus />
          <div className="field-row">
            {adjectiveForms.slice(0, 2).map((form) => <TextField key={form} label={adjectiveFormLabels[form][0]!.toUpperCase() + adjectiveFormLabels[form].slice(1)} italian value={adjective[form]} onChange={(value) => setAdjective({ ...adjective, [form]: value })} />)}
          </div>
          <div className="field-row">
            {adjectiveForms.slice(2).map((form) => <TextField key={form} label={adjectiveFormLabels[form][0]!.toUpperCase() + adjectiveFormLabels[form].slice(1)} italian value={adjective[form]} onChange={(value) => setAdjective({ ...adjective, [form]: value })} />)}
          </div>
          {offeredSuggestion && <button type="button" className="text-button align-start" onClick={() => setAdjective({ ...adjective, ...offeredSuggestion })}>Fill the forms the rules give “{adjective.masculineSingular.trim()}”</button>}
          <label className="field">
            <span>Adjective rule{adjective.rule === irregularRuleValue ? " · forms are stored exactly as typed" : ""}</span>
            <AdjectiveRuleSelect label="Adjective rule" value={adjective.rule} morphology={adjectiveMorphology} onChange={(rule) => setAdjective({ ...adjective, rule })} />
          </label>
          <div className="derived-box"><span className="field-label">Generated forms</span><AdjectiveDerivedPreview draft={adjective} morphology={adjectiveMorphology} /></div>
          <div className="study-options">
            <span className="field-label">Study</span>
            <label className="check-option">
              <input type="checkbox" checked={fullDeclension} onChange={(event) => setFullDeclension(event.target.checked)} />
              <span>Always ask for all four forms</span>
            </label>
            {adjectiveReasons.length > 0 && <p className="field-hint">Already asked for all four: {adjectiveReasons.map((reason) => adjectiveFullFormsReasonLabels[reason]).join("; ")}.</p>}
          </div>
        </>}
        {adverb && <>
          <TextField label="English" value={adverb.english} onChange={(english) => setAdverb({ ...adverb, english })} autoFocus />
          <TextField label="Italian" italian value={adverb.form} onChange={(form) => setAdverb({ ...adverb, form })} />
        </>}
        <div className="field-divider" />
        <SetField knownSets={knownSets} value={setName} onChange={setSetName} />
        <TagsField value={tags} onChange={setTags} />
        {formError && <p className="form-error" role="alert">{formError}</p>}
        <footer className="sheet-actions">
          <button type="button" className="danger-text-button" onClick={remove}>Delete</button>
          <span className="spacer" />
          <button type="button" className="text-button" onClick={onClose}>Cancel</button>
          <button type="submit" className="primary-button">Save</button>
        </footer>
      </form>
    </Sheet>
  );
}
