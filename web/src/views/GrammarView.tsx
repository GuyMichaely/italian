import type { Flashcard } from "../cards/types";
import type { NounMorphology } from "../cards/nounMorphology";
import type { AdjectiveMorphology } from "../cards/adjectiveMorphology";
import { NounMorphologyPanel } from "../components/NounMorphologyPanel";
import type { InventoryState } from "../storage";
import type { StudyPreferences } from "../study/preferences";

export function GrammarView({ cards, morphology, adjectiveMorphology, studyPreferences, onSave, onOpenCard }: { cards: Flashcard[]; morphology: NounMorphology; adjectiveMorphology: AdjectiveMorphology; studyPreferences: StudyPreferences; onSave: (state: InventoryState) => Promise<void>; onOpenCard: (card: Flashcard) => void }) {
  return <section className="grammar-view">
    <header className="page-header">
      <div>
        <h1>Grammar</h1>
        <p>How the app builds noun and adjective forms, and noun articles, from each word.</p>
      </div>
    </header>
    <NounMorphologyPanel cards={cards} morphology={morphology} adjectiveMorphology={adjectiveMorphology} studyPreferences={studyPreferences} onSave={onSave} onOpenCard={onOpenCard} />
  </section>;
}
