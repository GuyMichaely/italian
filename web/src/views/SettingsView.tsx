import type { ComponentProps } from "react";
import { AnswerKeywordSettings } from "../components/AnswerKeywordSettings";
import { StorageSettingsPanel } from "../components/StorageSettingsPanel";
import type { AnswerKeywords } from "../study/setup";

export function SettingsView({ storageProps, keywords, onKeywords }: { storageProps: ComponentProps<typeof StorageSettingsPanel>; keywords: AnswerKeywords; onKeywords: (keywords: AnswerKeywords) => void }) {
  return <section className="settings-view">
    <header className="page-header"><div><h1>Settings</h1></div></header>
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
