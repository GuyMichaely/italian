import type { ComponentProps } from "react";
import { AnswerKeywordSettings } from "../components/AnswerKeywordSettings";
import { StorageSettingsPanel } from "../components/StorageSettingsPanel";
import type { AnswerKeywords } from "../study/setup";

export function SettingsView({ storageProps, keywords, onKeywords, onCopyProduction }: { storageProps: ComponentProps<typeof StorageSettingsPanel>; keywords: AnswerKeywords; onKeywords: (keywords: AnswerKeywords) => void; onCopyProduction?: () => void }) {
  return <section className="settings-view">
    <header className="page-header"><div><h1>Settings</h1></div></header>
    {onCopyProduction && <section className="settings-section prototype-note" aria-labelledby="prototype-heading">
      <div className="settings-section-heading">
        <h2 id="prototype-heading">Prototype data</h2>
        <p>This prototype stores words in a new format, so it keeps them separately from the current Parola app. Copying converts your current words into the new format; the current app keeps its own copy untouched. Leave sync off here until the new format ships.</p>
      </div>
      <div className="button-row start"><button type="button" className="neutral-button" onClick={onCopyProduction}>Copy words from current Parola</button></div>
    </section>}
    <StorageSettingsPanel {...storageProps} />
    <section className="settings-section" aria-labelledby="keywords-heading">
      <div className="settings-section-heading">
        <h2 id="keywords-heading">Answer keywords</h2>
        <p>Markers you type before a noun to state its gender, or that it only exists in the singular or plural.</p>
      </div>
      <AnswerKeywordSettings keywords={keywords} onChange={onKeywords} />
    </section>
  </section>;
}
