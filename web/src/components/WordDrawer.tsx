import { type FormEvent, useState } from "react";
import type { Flashcard } from "../cards/types";
import type { NounMorphology } from "../cards/nounMorphology";
import { typeLabels } from "../cardTypes";
import {
  adjectiveRowFromCard,
  adverbRowFromCard,
  parseTags,
  verbRowFromCard,
  type AdjectiveBatchRow,
  type AdverbBatchRow,
  type VerbBatchRow,
} from "../cards/editorModel";
import { articleProfileOptions, emptyNounDraft, nounCardFromDraft, nounDraftForEditing, type NounDraft } from "../cards/nounDraft";
import { standardAdjectivePattern } from "../study/logic";
import { NounDerivedPreview, NounRuleSelect, SetField, TagsField } from "./CardEditorFields";
import { Sheet } from "./Sheet";

function TextField({ label, value, onChange, autoFocus = false, placeholder, italian = false }: { label: string; value: string; onChange: (value: string) => void; autoFocus?: boolean; placeholder?: string; italian?: boolean }) {
  return <label className="field">
    <span>{label}</span>
    <input value={value} onChange={(event) => onChange(event.target.value)} autoFocus={autoFocus} placeholder={placeholder} {...(italian ? { autoCapitalize: "none", spellCheck: false, lang: "it" } : {})} />
  </label>;
}

export function WordDrawer({
  card,
  knownSets,
  morphology,
  onClose,
  onSave,
  onRemove,
}: {
  card: Flashcard;
  knownSets: string[];
  morphology: NounMorphology;
  onClose: () => void;
  onSave: (card: Flashcard) => void;
  onRemove: (id: number) => void;
}) {
  const [formError, setFormError] = useState("");
  const [setName, setSetName] = useState(card.setName ?? "");
  const [tags, setTags] = useState(card.tags.join(", "));
  const [noun, setNoun] = useState<NounDraft>(() => card.type === "noun" ? nounDraftForEditing(card, morphology) : emptyNounDraft());
  const [verb, setVerb] = useState<VerbBatchRow | null>(() => card.type === "verb" ? verbRowFromCard(card) : null);
  const [adjective, setAdjective] = useState<AdjectiveBatchRow | null>(() => card.type === "adjective" ? adjectiveRowFromCard(card) : null);
  const [adverb, setAdverb] = useState<AdverbBatchRow | null>(() => card.type === "adverb" ? adverbRowFromCard(card) : null);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const common = { id: card.id, setName: setName.trim() || null, tags: parseTags(tags) };
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
        if ([adjective.english, adjective.masculineSingular, adjective.feminineSingular, adjective.masculinePlural, adjective.femininePlural].some((value) => !value.trim())) throw new Error("English and all four Italian adjective forms are required.");
        updated = { ...common, type: "adjective", english: adjective.english.trim(), italian: adjective.masculineSingular.trim(), details: {
          masculineSingular: adjective.masculineSingular.trim(), feminineSingular: adjective.feminineSingular.trim(),
          masculinePlural: adjective.masculinePlural.trim(), femininePlural: adjective.femininePlural.trim(),
        } };
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
    onSave(updated);
    onClose();
  }

  function remove() {
    if (!window.confirm(`Delete “${card.english}”? This cannot be undone.`)) return;
    onRemove(card.id);
    onClose();
  }

  const regularPattern = adjective ? standardAdjectivePattern(adjective.masculineSingular) : null;
  const regularAdjective = adjective && regularPattern
    && (Object.keys(regularPattern) as (keyof typeof regularPattern)[]).some((field) => adjective[field].trim() !== regularPattern[field])
    ? regularPattern
    : null;

  return (
    <Sheet size="side" title={card.english} subtitle={<span className={`pos-badge ${card.type}`}>{typeLabels[card.type]}</span>} onClose={onClose}>
      <form className="word-editor" onSubmit={submit}>
        {card.type === "noun" && <>
          <TextField label="English" value={noun.english} onChange={(english) => setNoun((draft) => ({ ...draft, english }))} autoFocus />
          <div className="field-row">
            <TextField label="Singular" italian value={noun.singular} onChange={(singular) => setNoun((draft) => ({ ...draft, singular }))} />
            <TextField label="Plural" italian value={noun.plural} onChange={(plural) => setNoun((draft) => ({ ...draft, plural }))} />
          </div>
          <div className="field-row">
            <div className="field">
              <span>Gender</span>
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
          <label className="field">
            <span>Declension rule</span>
            <NounRuleSelect label="Declension rule" value={noun.rule} morphology={morphology} onChange={(rule) => setNoun((draft) => ({ ...draft, rule }))} />
          </label>
          <div className="derived-box"><span className="field-label">Generated forms</span><NounDerivedPreview draft={noun} morphology={morphology} /></div>
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
            <TextField label="Masculine singular" italian value={adjective.masculineSingular} onChange={(masculineSingular) => setAdjective({ ...adjective, masculineSingular })} />
            <TextField label="Feminine singular" italian value={adjective.feminineSingular} onChange={(feminineSingular) => setAdjective({ ...adjective, feminineSingular })} />
          </div>
          <div className="field-row">
            <TextField label="Masculine plural" italian value={adjective.masculinePlural} onChange={(masculinePlural) => setAdjective({ ...adjective, masculinePlural })} />
            <TextField label="Feminine plural" italian value={adjective.femininePlural} onChange={(femininePlural) => setAdjective({ ...adjective, femininePlural })} />
          </div>
          {regularAdjective && <button type="button" className="text-button align-start" onClick={() => setAdjective({ ...adjective, ...regularAdjective })}>Fill regular endings from “{adjective.masculineSingular}”</button>}
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
