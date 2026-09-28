import type { Flashcard, NounCard } from "../cards/types";
import { normalizeText, resolvedNounForms, type NounGender, type NounMorphology } from "../cards/nounMorphology";

function nounHeadword(card: NounCard, morphology: NounMorphology) {
  try {
    const forms = resolvedNounForms(card, morphology);
    return forms.singular || forms.plural;
  } catch {
    return null;
  }
}

/**
 * The gender to show beside a noun prompt, or null when the prompt is unambiguous. A noun that
 * takes both genders is two cards (il collega / la collega), so a prompt shared with a noun of the
 * other gender needs the gender to say which card is meant: the English for English prompts, the
 * Italian headword for Italian ones.
 */
export function promptGender(card: Flashcard, cards: Flashcard[], language: "english" | "italian", morphology: NounMorphology): NounGender | null {
  if (card.type !== "noun") return null;
  const key = (item: NounCard) => language === "english" ? normalizeText(item.english) : normalizeText(nounHeadword(item, morphology) ?? "");
  const own = key(card);
  if (!own) return null;
  const clash = cards.some((other) => other.type === "noun" && other.id !== card.id && other.details.gender !== card.details.gender && key(other) === own);
  return clash ? card.details.gender : null;
}

export const genderAbbreviations: Record<NounGender, string> = { masculine: "m", feminine: "f" };

/**
 * The Italian forms article mode shows: the singular, or the plural for a plural-only noun, plus
 * the plural of an irregular noun, whose plural article can't be worked out from the singular.
 */
export function articlePromptForms(card: NounCard, morphology: NounMorphology) {
  const forms = resolvedNounForms(card, morphology);
  const showsSingular = Boolean(forms.singular && (forms.definiteSingularArticle || forms.indefiniteArticle));
  const showsPlural = Boolean(forms.plural && forms.definitePluralArticle && (!showsSingular || card.details.declension.kind === "irregular"));
  return [showsSingular ? forms.singular : null, showsPlural ? forms.plural : null].filter((form): form is string => Boolean(form));
}
