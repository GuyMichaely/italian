import type { NounCard } from "./types";
import {
  articleProfileCompatibleWithRule,
  articleProfilesEqual,
  generateNounForm,
  inferNounDefinitionFromForms,
  nounArticleProfiles,
  nounDefinitionForCard,
  recognizeNounForm,
  resolvedNounForms,
  ruleSupportsFormNumber,
  suggestedNounArticles,
  type NounArticleProfile,
  type NounDefinition,
  type NounGender,
  type NounMorphology,
  type ResolvedNounForms,
} from "./nounMorphology";

export const articleProfileOptions = [
  { value: "all", label: "All three", profile: nounArticleProfiles.all },
  { value: "definite-singular", label: "Definite singular only", profile: nounArticleProfiles.definiteSingularOnly },
  { value: "definite-plural", label: "Definite plural only", profile: nounArticleProfiles.definitePluralOnly },
  { value: "none", label: "No articles", profile: nounArticleProfiles.none },
] as const;

export type ArticleProfileOption = typeof articleProfileOptions[number]["value"];

export function articleProfileOption(profile: NounArticleProfile): ArticleProfileOption {
  return articleProfileOptions.find((option) => articleProfilesEqual(option.profile, profile))?.value ?? "none";
}

export function articleProfileForOption(value: ArticleProfileOption): NounArticleProfile {
  return articleProfileOptions.find((option) => option.value === value)?.profile ?? nounArticleProfiles.none;
}

/**
 * The one noun-entry model shared by batch creation and single-card editing.
 * The learner types surface forms; the stored rule and base are derived from them.
 * An empty `rule` means "infer the declension rule automatically".
 */
export type NounDraft = {
  english: string;
  gender: NounGender;
  singular: string;
  plural: string;
  articles: ArticleProfileOption;
  rule: string;
};

export type ResolvedNounDraft =
  | { ok: true; definition: NounDefinition; forms: ResolvedNounForms; inferred: boolean }
  | { ok: false; error: string };

export function emptyNounDraft(): NounDraft {
  return { english: "", gender: "masculine", singular: "", plural: "", articles: "all", rule: "" };
}

function formsForDefinition(definition: NounDefinition, morphology: NounMorphology) {
  const card: NounCard = { id: 0, type: "noun", english: "", setName: null, tags: [], details: definition };
  return resolvedNounForms(card, morphology);
}

export function resolveNounDraft(draft: NounDraft, morphology: NounMorphology): ResolvedNounDraft {
  const singular = draft.singular.normalize("NFC").trim();
  const plural = draft.plural.normalize("NFC").trim();
  if (!singular && !plural) return { ok: false, error: "Enter the singular or plural form." };
  const articleProfile = articleProfileForOption(draft.articles);
  if (!singular && (articleProfile.definiteSingular || articleProfile.indefiniteSingular)) {
    return { ok: false, error: "Singular articles need a singular form." };
  }
  if (!plural && articleProfile.definitePlural && !draft.rule) {
    return { ok: false, error: "A plural article needs a plural form." };
  }

  let definition: NounDefinition | null;
  if (!draft.rule) {
    definition = inferNounDefinitionFromForms({
      singular,
      plural,
      gender: draft.gender,
      ...suggestedNounArticles(draft.gender, singular, plural, articleProfile),
    }, morphology);
    if (!definition) {
      return {
        ok: false,
        error: singular && plural
          ? `No declension rule turns “${singular}” into “${plural}”. Pick a rule or add one in Grammar.`
          : "No single declension rule fits. Pick a rule or add one in Grammar.",
      };
    }
  } else {
    const rule = morphology.declensionRules.find((item) => item.name === draft.rule);
    if (!rule) return { ok: false, error: `The rule “${draft.rule}” no longer exists.` };
    if (singular && !ruleSupportsFormNumber(rule, "singular")) return { ok: false, error: `“${rule.name}” has no singular form.` };
    if (plural && !ruleSupportsFormNumber(rule, "plural")) return { ok: false, error: `“${rule.name}” has no plural form.` };
    const base = singular ? recognizeNounForm(rule, singular, "singular") : recognizeNounForm(rule, plural, "plural");
    if (base === null) return { ok: false, error: `“${singular || plural}” does not fit “${rule.name}”.` };
    const generatedPlural = generateNounForm(rule, base, "plural") ?? "";
    if (singular && plural && generatedPlural.toLocaleLowerCase("it-IT") !== plural.toLocaleLowerCase("it-IT")) {
      return { ok: false, error: `“${rule.name}” makes the plural “${generatedPlural}”, not “${plural}”.` };
    }
    if (!articleProfileCompatibleWithRule(articleProfile, rule)) {
      return { ok: false, error: `Those articles need a form that “${rule.name}” does not have.` };
    }
    definition = { rule: rule.name, base, gender: draft.gender, articleProfile };
  }

  try {
    return { ok: true, definition, forms: formsForDefinition(definition, morphology), inferred: !draft.rule };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "This noun cannot be generated." };
  }
}

export function nounCardFromDraft(
  draft: NounDraft,
  common: { id: number; setName: string | null; tags: string[] },
  morphology: NounMorphology,
): NounCard {
  const english = draft.english.trim();
  if (!english) throw new Error("Every noun needs an English prompt.");
  const resolved = resolveNounDraft(draft, morphology);
  if (!resolved.ok) throw new Error(`${english}: ${resolved.error}`);
  return { ...common, type: "noun", english, details: resolved.definition };
}

export function nounDraftFromCard(card: NounCard, morphology: NounMorphology): NounDraft {
  const definition = nounDefinitionForCard(card);
  const forms = resolvedNounForms(card, morphology);
  const draft: NounDraft = {
    english: card.english,
    gender: definition.gender,
    singular: forms.singular,
    plural: forms.plural,
    articles: articleProfileOption(definition.articleProfile),
    rule: "",
  };
  const automatic = resolveNounDraft(draft, morphology);
  const automaticMatches = automatic.ok
    && automatic.definition.rule === definition.rule
    && automatic.definition.base === definition.base;
  return automaticMatches ? draft : { ...draft, rule: definition.rule };
}

/** Suggests a plural from the most specific two-number rule whose singular suffix matches. */
export function suggestedPlural(singular: string, morphology: NounMorphology) {
  const word = singular.normalize("NFC").trim();
  if (!word) return "";
  let best: { suffix: string; plural: string } | null = null;
  for (const rule of morphology.declensionRules) {
    const singularSuffix = rule.forms.singular?.suffix;
    if (!singularSuffix || !rule.forms.plural) continue;
    const base = recognizeNounForm(rule, word, "singular");
    if (base === null || (best && best.suffix.length >= singularSuffix.length)) continue;
    best = { suffix: singularSuffix, plural: generateNounForm(rule, base, "plural") ?? "" };
  }
  return best?.plural ?? "";
}

export function joinArticle(article: string, noun: string) {
  if (!article) return noun;
  return article.endsWith("’") || article.endsWith("'") ? `${article}${noun}` : `${article} ${noun}`;
}

export function nounFormPhrases(forms: ResolvedNounForms) {
  return [
    forms.singular && forms.definiteSingularArticle ? { label: "def. sg.", text: joinArticle(forms.definiteSingularArticle, forms.singular) } : null,
    forms.plural && forms.definitePluralArticle ? { label: "def. pl.", text: joinArticle(forms.definitePluralArticle, forms.plural) } : null,
    forms.singular && forms.indefiniteArticle ? { label: "indef.", text: joinArticle(forms.indefiniteArticle, forms.singular) } : null,
  ].filter((item): item is { label: string; text: string } => Boolean(item));
}
