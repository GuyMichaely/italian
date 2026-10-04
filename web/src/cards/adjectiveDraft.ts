import type { AdjectiveCard, AdjectiveDeclension, AdjectiveForms, CardCommon } from "./types";
import {
  adjectiveFormAbbreviations,
  adjectiveForms,
  generateAdjectiveForms,
  inferAdjectiveDeclension,
  predictedAdjectiveForms,
  recognizeAdjectiveBase,
  resolveAdjectiveDeclension,
  type AdjectiveMorphology,
} from "./adjectiveMorphology";
import { normalizeText } from "./nounMorphology";
import { irregularRuleValue } from "./nounDraft";

/**
 * The adjective-entry model shared by batch creation, the word drawer, and the words grid. The
 * learner types forms; the stored declension is derived from them. `rule` is "" to infer a rule,
 * a rule name, or `irregularRuleValue`.
 */
export type AdjectiveDraft = AdjectiveForms & {
  english: string;
  rule: string;
};

export type ResolvedAdjectiveDraft =
  | { ok: true; declension: AdjectiveDeclension; forms: AdjectiveForms; rule: string | null; inferred: boolean }
  | { ok: false; error: string };

export function emptyAdjectiveDraft(): AdjectiveDraft {
  return { english: "", masculineSingular: "", feminineSingular: "", masculinePlural: "", femininePlural: "", rule: "" };
}

function typedForms(draft: AdjectiveDraft): AdjectiveForms {
  return Object.fromEntries(adjectiveForms.map((form) => [form, draft[form].normalize("NFC").trim()])) as AdjectiveForms;
}

function draftDeclension(draft: AdjectiveDraft, forms: AdjectiveForms, morphology: AdjectiveMorphology): { declension: AdjectiveDeclension } | { error: string } {
  const others = adjectiveForms.filter((form) => form !== "masculineSingular");
  const typedOthers = others.filter((form) => forms[form]);

  if (draft.rule === irregularRuleValue) {
    const missing = adjectiveForms.find((form) => !forms[form]);
    if (missing) return { error: `An irregular adjective needs all four forms; the ${adjectiveFormAbbreviations[missing]} is empty.` };
    return { declension: { kind: "irregular", ...forms } };
  }

  if (!draft.rule) {
    if (!typedOthers.length) {
      const predictions = predictedAdjectiveForms(forms.masculineSingular, morphology);
      if (predictions.length !== 1) return { error: `More than one rule fits “${forms.masculineSingular}”. Type the other forms or pick a rule.` };
      const inferred = inferAdjectiveDeclension(predictions[0]!, morphology);
      return inferred ? { declension: inferred } : { error: "No single adjective rule fits. Pick a rule or choose Irregular." };
    }
    if (typedOthers.length !== others.length) return { error: "Type all four forms, or only the masculine singular." };
    const inferred = inferAdjectiveDeclension(forms, morphology);
    return inferred ? { declension: inferred } : { error: "No adjective rule makes these forms. Pick a rule or choose Irregular." };
  }

  const rule = morphology.declensionRules.find((item) => item.name === draft.rule);
  if (!rule) return { error: `The rule “${draft.rule}” no longer exists.` };
  const base = recognizeAdjectiveBase(rule, forms.masculineSingular);
  if (base === null) return { error: `“${forms.masculineSingular}” does not fit “${rule.name}”.` };
  const generated = generateAdjectiveForms(rule, base);
  const mismatch = typedOthers.find((form) => normalizeText(generated[form]) !== normalizeText(forms[form]));
  if (mismatch) return { error: `“${rule.name}” makes the ${adjectiveFormAbbreviations[mismatch]} “${generated[mismatch]}”, not “${forms[mismatch]}”.` };
  return { declension: { kind: "rule", rule: rule.name, base } };
}

export function resolveAdjectiveDraft(draft: AdjectiveDraft, morphology: AdjectiveMorphology): ResolvedAdjectiveDraft {
  const forms = typedForms(draft);
  if (!forms.masculineSingular) return { ok: false, error: "Enter the masculine singular." };
  const result = draftDeclension(draft, forms, morphology);
  if ("error" in result) return { ok: false, error: result.error };
  try {
    const resolved = resolveAdjectiveDeclension(result.declension, morphology);
    return { ok: true, declension: result.declension, forms: resolved.forms, rule: resolved.rule, inferred: !draft.rule };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "This adjective cannot be generated." };
  }
}

export function adjectiveCardFromDraft(
  draft: AdjectiveDraft,
  common: CardCommon,
  morphology: AdjectiveMorphology,
): AdjectiveCard {
  const english = draft.english.trim();
  if (!english) throw new Error("Every adjective needs an English prompt.");
  const resolved = resolveAdjectiveDraft(draft, morphology);
  if (!resolved.ok) throw new Error(`${english}: ${resolved.error}`);
  return { ...common, type: "adjective", english, details: { declension: resolved.declension } };
}

export function adjectiveDraftFromCard(card: AdjectiveCard, morphology: AdjectiveMorphology): AdjectiveDraft {
  const declension = card.details.declension;
  const { forms } = resolveAdjectiveDeclension(declension, morphology, `Adjective card ${card.id}`);
  const draft: AdjectiveDraft = { english: card.english, ...forms, rule: irregularRuleValue };
  if (declension.kind === "irregular") return draft;
  const automatic = inferAdjectiveDeclension(forms, morphology);
  return { ...draft, rule: automatic?.rule === declension.rule && automatic.base === declension.base ? "" : declension.rule };
}

/** Like adjectiveDraftFromCard, but still returns an editable draft for an adjective whose stored rule is broken. */
export function adjectiveDraftForEditing(card: AdjectiveCard, morphology: AdjectiveMorphology): AdjectiveDraft {
  try {
    return adjectiveDraftFromCard(card, morphology);
  } catch {
    const declension = card.details.declension;
    return declension.kind === "rule"
      ? { ...emptyAdjectiveDraft(), english: card.english, masculineSingular: declension.base, rule: declension.rule }
      : { english: card.english, masculineSingular: declension.masculineSingular, feminineSingular: declension.feminineSingular, masculinePlural: declension.masculinePlural, femininePlural: declension.femininePlural, rule: irregularRuleValue };
  }
}

/** The other three forms the rules predict from a masculine singular; null when they don't agree on one set. */
export function suggestedAdjectiveForms(masculineSingular: string, morphology: AdjectiveMorphology) {
  if (!masculineSingular.trim()) return null;
  const predictions = predictedAdjectiveForms(masculineSingular, morphology);
  return predictions.length === 1 ? predictions[0]! : null;
}
