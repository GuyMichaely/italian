import type { Flashcard } from "../cards/types";
import type { NounMorphology } from "../cards/nounMorphology";
import { NounMorphologyPanel } from "../components/NounMorphologyPanel";
import type { InventoryState } from "../storage";

export function GrammarView({ cards, morphology, onSave, onOpenCard }: { cards: Flashcard[]; morphology: NounMorphology; onSave: (state: InventoryState) => Promise<void>; onOpenCard: (card: Flashcard) => void }) {
  return <section className="grammar-view">
    <header className="page-header">
      <div>
        <h1>Grammar</h1>
        <p>How Parola builds noun forms from each word, and which typed noun answers it accepts.</p>
      </div>
    </header>
    <NounMorphologyPanel cards={cards} morphology={morphology} onSave={onSave} onOpenCard={onOpenCard} />
  </section>;
}
