import type { CardCommon, NounCard, NounDetails } from "./types";
import {
  articleGroupForWord,
  articleProfileCompatibleWithForms,
  articleProfilesEqual,
  generateNounForm,
  inferRuleDeclension,
  nounArticleProfiles,
  predictedPlurals,
  recognizeNounForm,
  resolveNounDetails,
  ruleAllowsGender,
  ruleSupportsFormNumber,
  type NounArticleProfile,
  type NounDeclension,
  type NounFormNumber,
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

/** Rule-select value for an irregular noun. Rule names cannot start with ":", so it never collides. */
export const irregularRuleValue = ":irregular";

/**
 * The one noun-entry model shared by batch creation, the word drawer, and the words grid.
 * The learner types surface forms; the stored declension is derived from them.
 * `rule` is "" to infer a rule automatically, a rule name, or `irregularRuleValue`.
 * `singularGroup` / `pluralGroup` are "" for "from spelling" or an article-group name (an exception).
 */
export type NounDraft = {
  english: string;
  gender: NounGender;
  genderDiffersWithPlurality: boolean;
  singular: string;
  plural: string;
  articles: ArticleProfileOption;
  rule: string;
  singularGroup: string;
  pluralGroup: string;
};

export type ResolvedNounDraft =
  | { ok: true; details: NounDetails; forms: ResolvedNounForms; inferred: boolean }
  | { ok: false; error: string };

export function emptyNounDraft(): NounDraft {
  return { english: "", gender: "masculine", genderDiffersWithPlurality: false, singular: "", plural: "", articles: "all", rule: "", singularGroup: "", pluralGroup: "" };
}

function draftDeclension(draft: NounDraft, singular: string, plural: string, morphology: NounMorphology): { declension: NounDeclension } | { error: string } {
  if (draft.rule === irregularRuleValue) return { declension: { kind: "irregular", singular, plural } };

  if (!draft.rule) {
    const inferred = inferRuleDeclension({ singular, plural }, draft.gender, morphology);
    if (inferred) return { declension: inferred };
    return {
      error: singular && plural
        ? `No declension rule turns “${singular}” into “${plural}”. Pick a rule or choose Irregular.`
        : "No single declension rule fits. Pick a rule or choose Irregular.",
    };
  }

  const rule = morphology.declensionRules.find((item) => item.name === draft.rule);
  if (!rule) return { error: `The rule “${draft.rule}” no longer exists.` };
  if (!ruleAllowsGender(rule, draft.gender)) return { error: `“${rule.name}” is only for ${rule.gender} nouns.` };
  if (singular && !ruleSupportsFormNumber(rule, "singular")) return { error: `“${rule.name}” has no singular form.` };
  if (plural && !ruleSupportsFormNumber(rule, "plural")) return { error: `“${rule.name}” has no plural form.` };
  const base = singular ? recognizeNounForm(rule, singular, "singular") : recognizeNounForm(rule, plural, "plural");
  if (base === null) return { error: `“${singular || plural}” does not fit “${rule.name}”.` };
  const generatedPlural = generateNounForm(rule, base, "plural") ?? "";
  if (singular && plural && generatedPlural.toLocaleLowerCase("it-IT") !== plural.toLocaleLowerCase("it-IT")) {
    return { error: `“${rule.name}” makes the plural “${generatedPlural}”, not “${plural}”.` };
  }
  return { declension: { kind: "rule", rule: rule.name, base } };
}

export function resolveNounDraft(draft: NounDraft, morphology: NounMorphology): ResolvedNounDraft {
  const singular = draft.singular.normalize("NFC").trim();
  const plural = draft.plural.normalize("NFC").trim();
  if (!singular && !plural) return { ok: false, error: "Enter the singular or plural form." };
  const articleProfile = articleProfileForOption(draft.articles);

  const result = draftDeclension(draft, singular, plural, morphology);
  if ("error" in result) return { ok: false, error: result.error };
  const details: NounDetails = {
    declension: result.declension,
    gender: draft.gender,
    genderDiffersWithPlurality: draft.genderDiffersWithPlurality,
    articleProfile,
    articleGroups: { singular: draft.singularGroup || null, plural: draft.pluralGroup || null },
  };

  try {
    const forms = resolveNounDetails(details, morphology);
    if (!articleProfileCompatibleWithForms(articleProfile, forms)) {
      return { ok: false, error: !forms.singular ? "Singular articles need a singular form." : "A plural article needs a plural form." };
    }
    return { ok: true, details, forms, inferred: !draft.rule };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "This noun cannot be generated." };
  }
}

export function nounCardFromDraft(
  draft: NounDraft,
  common: CardCommon,
  morphology: NounMorphology,
): NounCard {
  const english = draft.english.trim();
  if (!english) throw new Error("Every noun needs an English prompt.");
  const resolved = resolveNounDraft(draft, morphology);
  if (!resolved.ok) throw new Error(`${english}: ${resolved.error}`);
  return { ...common, type: "noun", english, details: resolved.details };
}

export function nounDraftFromCard(card: NounCard, morphology: NounMorphology): NounDraft {
  const details = card.details;
  const forms = resolveNounDetails(details, morphology, `Noun card ${card.id}`);
  const draft: NounDraft = {
    english: card.english,
    gender: details.gender,
    genderDiffersWithPlurality: details.genderDiffersWithPlurality,
    singular: forms.singular,
    plural: forms.plural,
    articles: articleProfileOption(details.articleProfile),
    rule: irregularRuleValue,
    singularGroup: details.articleGroups.singular ?? "",
    pluralGroup: details.articleGroups.plural ?? "",
  };
  if (details.declension.kind === "irregular") return draft;
  const declension = details.declension;
  const automatic = inferRuleDeclension({ singular: forms.singular, plural: forms.plural }, details.gender, morphology);
  const automaticMatches = automatic?.rule === declension.rule && automatic.base === declension.base;
  return { ...draft, rule: automaticMatches ? "" : declension.rule };
}

/** Like nounDraftFromCard, but still returns an editable draft for a noun whose stored rule is broken. */
export function nounDraftForEditing(card: NounCard, morphology: NounMorphology): NounDraft {
  try {
    return nounDraftFromCard(card, morphology);
  } catch {
    const declension = card.details.declension;
    return {
      ...emptyNounDraft(),
      english: card.english,
      gender: card.details.gender,
      genderDiffersWithPlurality: card.details.genderDiffersWithPlurality,
      singular: declension.kind === "rule" ? declension.base : declension.singular,
      plural: declension.kind === "rule" ? "" : declension.plural,
      rule: declension.kind === "rule" ? declension.rule : irregularRuleValue,
    };
  }
}

/** The article group a form would get from its spelling alone, for "Automatic (…)" labels. */
export function spellingGroup(word: string, morphology: NounMorphology) {
  return word.trim() ? articleGroupForWord(word, morphology) ?? "no match" : null;
}

/**
 * Suggests the plural for a typed singular: the chosen rule's plural, or under Auto the plural the
 * rules predict; empty when the rules don't agree on one or the rule has no plural.
 */
export function suggestedPlural(draft: Pick<NounDraft, "singular" | "gender" | "rule">, morphology: NounMorphology) {
  const singular = draft.singular.normalize("NFC").trim();
  if (!singular || draft.rule === irregularRuleValue) return "";
  if (!draft.rule) {
    const plurals = predictedPlurals(singular, draft.gender, morphology);
    return plurals.length === 1 ? plurals[0]! : "";
  }
  const rule = morphology.declensionRules.find((item) => item.name === draft.rule);
  if (!rule || !ruleAllowsGender(rule, draft.gender) || !ruleSupportsFormNumber(rule, "singular") || !ruleSupportsFormNumber(rule, "plural")) return "";
  const base = recognizeNounForm(rule, singular, "singular");
  return base === null ? "" : generateNounForm(rule, base, "plural") ?? "";
}

/** Which forms a rule-select value leaves room for: a rule without a plural (or singular) form has nothing to type there. */
export function draftFormNumbers(rule: string, morphology: NounMorphology): Record<NounFormNumber, boolean> {
  const chosen = morphology.declensionRules.find((item) => item.name === rule);
  return {
    singular: !chosen || ruleSupportsFormNumber(chosen, "singular"),
    plural: !chosen || ruleSupportsFormNumber(chosen, "plural"),
  };
}

/**
 * Picks a rule and fits the draft to it. A form typed where the rule has none moves to the other
 * form when that one is empty (“forbici” typed as a singular, then a plural-only rule), and is
 * otherwise dropped; articles needing the missing form narrow to the ones the other form takes,
 * and widen back to all three when a rule with both forms replaces it.
 */
export function nounDraftWithRule<Draft extends NounDraft>(draft: Draft, rule: string, morphology: NounMorphology): Draft {
  const numbers = draftFormNumbers(rule, morphology);
  const previous = draftFormNumbers(draft.rule, morphology);
  let { singular, plural, articles } = draft;
  if (!numbers.plural) {
    if (!singular.trim()) singular = plural;
    plural = "";
    if (articles === "all" || articles === "definite-plural") articles = "definite-singular";
  }
  if (!numbers.singular) {
    if (!plural.trim()) plural = singular;
    singular = "";
    if (articles === "all" || articles === "definite-singular") articles = "definite-plural";
  }
  const narrowed = previous.plural ? "definite-plural" : "definite-singular";
  if (numbers.singular && numbers.plural && !(previous.singular && previous.plural) && articles === narrowed) articles = "all";
  return { ...draft, rule, singular, plural, articles };
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
