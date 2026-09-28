import type { Flashcard } from "../cards/types";
import type { NounMorphology } from "../cards/nounMorphology";
import { NounMorphologyPanel } from "../components/NounMorphologyPanel";
import type { InventoryState } from "../storage";
import type { StudyPreferences } from "../study/preferences";

export function GrammarView({ cards, morphology, studyPreferences, onSave, onOpenCard }: { cards: Flashcard[]; morphology: NounMorphology; studyPreferences: StudyPreferences; onSave: (state: InventoryState) => Promise<void>; onOpenCard: (card: Flashcard) => void }) {
  return <section className="grammar-view">
    <header className="page-header">
      <div>
        <h1>Grammar</h1>
        <p>How Parola builds noun forms and articles from each word.</p>
      </div>
    </header>
    <NounMorphologyPanel cards={cards} morphology={morphology} studyPreferences={studyPreferences} onSave={onSave} onOpenCard={onOpenCard} />
  </section>;
}
