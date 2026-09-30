import type { NounGender } from "../cards/types";
import type { NounMorphology } from "../cards/nounMorphology";
import type { AdjectiveMorphology } from "../cards/adjectiveMorphology";
import type { AdverbBatchRow, VerbBatchRow } from "../cards/editorModel";
import { emptyNounDraft, irregularRuleValue, resolveNounDraft, suggestedPlural, type NounDraft } from "../cards/nounDraft";
import { resolveAdjectiveDraft, type AdjectiveDraft } from "../cards/adjectiveDraft";
import type { LexiconAdjective, LexiconGender, LexiconNoun, LexiconVerb } from "./format";
import type { LexiconReading } from "./lookup";

export type VerbFields = Omit<VerbBatchRow, "id">;
export type AdverbFields = Omit<AdverbBatchRow, "id">;

type SuggestionBase = {
  reading: LexiconReading;
  /** The dictionary's English glosses, shortened; the first one fills the English field. */
  glosses: string[];
  /** Why the learner should look at this word before trusting it, or null. */
  review: string | null;
};

/** A word the dictionary suggests, as the fields the Add words rows and the Words grid edit. */
export type LexiconSuggestion = SuggestionBase & (
  | { type: "noun"; fields: NounDraft }
  | { type: "verb"; fields: VerbFields }
  | { type: "adjective"; fields: AdjectiveDraft }
  | { type: "adverb"; fields: AdverbFields }
);

export type SuggestionMorphology = { noun: NounMorphology; adjective: AdjectiveMorphology };

const genderNames: Record<LexiconGender, NounGender> = { m: "masculine", f: "feminine" };

/**
 * Leaves the rule on Auto when one of the learner's rules makes the forms, and otherwise marks
 * the noun Irregular: the forms come from the dictionary, so they're right even when no rule is.
 */
function fittedNoun(draft: NounDraft, morphology: NounMorphology): { fields: NounDraft; review: string | null } {
  const automatic = resolveNounDraft(draft, morphology);
  if (automatic.ok) return { fields: draft, review: null };
  const irregular = { ...draft, rule: irregularRuleValue };
  if (resolveNounDraft(irregular, morphology).ok) return { fields: irregular, review: "No declension rule makes these forms, so it's Irregular." };
  return { fields: draft, review: automatic.error };
}

function nounSuggestions(reading: LexiconReading, noun: LexiconNoun, morphology: NounMorphology): LexiconSuggestion[] {
  const english = noun.glosses[0] ?? "";
  const drafts: NounDraft[] = [];
  for (const gender of noun.genders) {
    const base = { ...emptyNounDraft(), english, gender: genderNames[gender] };
    if (noun.number === "plural") {
      drafts.push({ ...base, plural: noun.word, articles: "definite-plural" });
      continue;
    }
    if (noun.number === "singular") {
      drafts.push({ ...base, singular: noun.word, articles: "definite-singular" });
      continue;
    }
    const plurals = noun.genders.length > 1 ? noun.plurals.filter((plural) => !plural.gender || plural.gender === gender) : noun.plurals;
    if (!plurals.length) drafts.push({ ...base, singular: noun.word, plural: suggestedPlural({ ...base, singular: noun.word }, morphology) });
    for (const plural of plurals) {
      drafts.push({ ...base, singular: noun.word, plural: plural.form, genderDiffersWithPlurality: Boolean(plural.gender && plural.gender !== gender) });
    }
  }
  const twoGenders = noun.genders.length > 1;
  return drafts.map((draft) => {
    const fitted = fittedNoun(draft, morphology);
    const unlisted = noun.number === "both" && !noun.plurals.length;
    const review = unlisted
      ? draft.plural ? "The dictionary doesn't give a plural; this is the one your rules predict." : "The dictionary doesn't give a plural."
      : fitted.review;
    return {
      type: "noun",
      reading,
      glosses: noun.glosses,
      fields: fitted.fields,
      review: review ?? (twoGenders ? "This noun takes either gender; check the gender." : null),
    };
  });
}

function verbSuggestions(reading: LexiconReading, verb: LexiconVerb): LexiconSuggestion[] {
  const [io, tu, luiLei, noi, voi, loro] = verb.present;
  const missing = !verb.participle || verb.present.some((form) => !form);
  const auxiliaries = verb.auxiliaries.length ? verb.auxiliaries : (["avere"] as const);
  return auxiliaries.map((auxiliary) => ({
    type: "verb",
    reading,
    glosses: verb.glosses,
    fields: { english: verb.glosses[0] ?? "", infinitive: verb.word, io, tu, luiLei, noi, voi, loro, auxiliary, participle: verb.participle },
    review: missing
      ? "The dictionary is missing some of this verb's forms."
      : !verb.auxiliaries.length ? "The dictionary doesn't give an auxiliary."
      : auxiliaries.length > 1 ? "This verb takes avere or essere depending on the sentence."
      : null,
  }));
}

function adjectiveSuggestion(reading: LexiconReading, adjective: LexiconAdjective, morphology: AdjectiveMorphology): LexiconSuggestion {
  const [feminineSingular, masculinePlural, femininePlural] = adjective.forms;
  const draft: AdjectiveDraft = { english: adjective.glosses[0] ?? "", masculineSingular: adjective.word, feminineSingular, masculinePlural, femininePlural, rule: "" };
  const base = { type: "adjective" as const, reading, glosses: adjective.glosses };
  if (resolveAdjectiveDraft(draft, morphology).ok) return { ...base, fields: draft, review: null };
  const irregular = { ...draft, rule: irregularRuleValue };
  if (resolveAdjectiveDraft(irregular, morphology).ok) return { ...base, fields: irregular, review: "No adjective rule makes these forms, so it's Irregular." };
  return { ...base, fields: draft, review: "The dictionary doesn't give all four forms." };
}

/** The ways to add a looked-up reading; usually one, more for nouns of either gender or with two plurals, or verbs with either auxiliary. */
export function suggestionsForReading(reading: LexiconReading, morphology: SuggestionMorphology): LexiconSuggestion[] {
  const headword = reading.headword;
  switch (headword.pos) {
    case "noun":
      return nounSuggestions(reading, headword, morphology.noun);
    case "verb":
      return verbSuggestions(reading, headword);
    case "adj":
      return [adjectiveSuggestion(reading, headword, morphology.adjective)];
    case "adv":
      return [{ type: "adverb", reading, glosses: headword.glosses, fields: { english: headword.glosses[0] ?? "", form: headword.word }, review: null }];
  }
}

export function suggestionsForReadings(readings: LexiconReading[], morphology: SuggestionMorphology) {
  return readings.flatMap((reading) => suggestionsForReading(reading, morphology));
}

/** A one-line description for choosing between suggestions: “libro (m.), libri — plural of libro”. */
export function describeSuggestion(suggestion: LexiconSuggestion) {
  const via = suggestion.reading.via ? ` — ${suggestion.reading.via.description} of ${suggestion.reading.via.of}` : "";
  switch (suggestion.type) {
    case "noun": {
      const noun = suggestion.fields;
      const gender = noun.gender === "masculine" ? "m." : "f.";
      const pluralGender = noun.genderDiffersWithPlurality ? (noun.gender === "masculine" ? " (f.)" : " (m.)") : "";
      return `${[noun.singular, noun.plural && `${noun.plural}${pluralGender}`].filter(Boolean).join(" / ")} (${gender} noun)${via}`;
    }
    case "verb":
      return `${suggestion.fields.infinitive} (verb, with ${suggestion.fields.auxiliary})${via}`;
    case "adjective":
      return `${suggestion.fields.masculineSingular} (adjective)${via}`;
    case "adverb":
      return `${suggestion.fields.form} (adverb)${via}`;
  }
}
