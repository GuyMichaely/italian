import type { ComponentProps } from "react";
import type { NounMorphology } from "../cards/nounMorphology";
import type { AdjectiveMorphology } from "../cards/adjectiveMorphology";
import { AnswerKeywordSettings } from "../components/AnswerKeywordSettings";
import { DeclensionDrillSettings } from "../components/DeclensionDrillSettings";
import { StorageSettingsPanel } from "../components/StorageSettingsPanel";
import type { StudyPreferences } from "../study/preferences";
import { useDictionaryAutofill } from "../lexicon/useDictionary";

function DictionarySettings() {
  const [autofill, setAutofill] = useDictionaryAutofill();
  return <section className="settings-section" aria-labelledby="dictionary-heading">
    <div className="settings-section-heading">
      <h2 id="dictionary-heading">Dictionary</h2>
    </div>
    <label className="check-option">
      <input type="checkbox" checked={autofill} onChange={(event) => setAutofill(event.target.checked)} />
      <span><strong>Fill in words from the dictionary</strong><small>When you type an Italian word in Add words or a new row of the Words grid, the app looks it up and fills in its English, gender, and forms. Rows where you’ve typed the other fields are left alone. Each lookup downloads a few kilobytes of the dictionary.</small></span>
    </label>
    <p className="settings-credit">Dictionary data from <a href="https://en.wiktionary.org/" target="_blank" rel="noreferrer">Wiktionary</a>, available under <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noreferrer">CC BY-SA 4.0</a>.</p>
  </section>;
}

export function SettingsView({ storageProps, morphology, adjectiveMorphology, preferences, onPreferences }: {
  storageProps: ComponentProps<typeof StorageSettingsPanel>;
  morphology: NounMorphology;
  adjectiveMorphology: AdjectiveMorphology;
  preferences: StudyPreferences;
  onPreferences: (preferences: StudyPreferences) => Promise<void>;
}) {
  return <section className="settings-view">
    <header className="page-header"><div><h1>Settings</h1></div></header>
    <StorageSettingsPanel {...storageProps} />
    <DictionarySettings />
    <section className="settings-section" aria-labelledby="keywords-heading">
      <div className="settings-section-heading">
        <h2 id="keywords-heading">Answer keywords</h2>
        <p>Markers you type with a noun in word mode: its gender when no article shows it, or that it only exists in the singular or plural. They’re saved with your inventory, so they sync with it.</p>
      </div>
      <AnswerKeywordSettings keywords={preferences.answerKeywords} onChange={(answerKeywords) => onPreferences({ ...preferences, answerKeywords })} />
    </section>
    <section className="settings-section" aria-labelledby="drilling-heading">
      <div className="settings-section-heading">
        <h2 id="drilling-heading">Declensions you’re drilling</h2>
        <p>Word mode asks for both the singular and the plural of every noun that uses a checked rule, and for all four forms of every adjective that does. Uncheck a rule once you know it, and one form will do again.</p>
      </div>
      <DeclensionDrillSettings
        label="Nouns"
        ruleNames={morphology.declensionRules.filter((rule) => rule.forms.singular && rule.forms.plural).map((rule) => rule.name)}
        drilling={preferences.nounFullDeclensionRules}
        onChange={(nounFullDeclensionRules) => onPreferences({ ...preferences, nounFullDeclensionRules })}
      />
      <DeclensionDrillSettings
        label="Adjectives"
        ruleNames={adjectiveMorphology.declensionRules.map((rule) => rule.name)}
        drilling={preferences.adjectiveFullDeclensionRules}
        onChange={(adjectiveFullDeclensionRules) => onPreferences({ ...preferences, adjectiveFullDeclensionRules })}
      />
    </section>
  </section>;
}
