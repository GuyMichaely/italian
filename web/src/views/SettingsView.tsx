import type { ComponentProps } from "react";
import type { NounMorphology } from "../cards/nounMorphology";
import { AnswerKeywordSettings } from "../components/AnswerKeywordSettings";
import { DeclensionDrillSettings } from "../components/DeclensionDrillSettings";
import { StorageSettingsPanel } from "../components/StorageSettingsPanel";
import type { StudyPreferences } from "../study/preferences";

export function SettingsView({ storageProps, morphology, preferences, onPreferences }: {
  storageProps: ComponentProps<typeof StorageSettingsPanel>;
  morphology: NounMorphology;
  preferences: StudyPreferences;
  onPreferences: (preferences: StudyPreferences) => Promise<void>;
}) {
  return <section className="settings-view">
    <header className="page-header"><div><h1>Settings</h1></div></header>
    <StorageSettingsPanel {...storageProps} />
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
        <p>Word mode asks for both the singular and the plural of every noun that uses a checked rule. Uncheck a rule once you know it, and one form will do again.</p>
      </div>
      <DeclensionDrillSettings morphology={morphology} drilling={preferences.fullDeclensionRules} onChange={(fullDeclensionRules) => onPreferences({ ...preferences, fullDeclensionRules })} />
    </section>
  </section>;
}
