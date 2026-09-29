import type { AdjectiveDeclension, AdjectiveForm, AdjectiveForms, Flashcard } from "./types";
import {
  assertExactKeys,
  assertUniqueNames,
  irregularDeclensionName,
  nonEmptyString,
  normalizeText,
  objectValue,
} from "./nounMorphology";

export type { AdjectiveDeclension, AdjectiveForm, AdjectiveForms } from "./types";

/** An adjective declension rule: the ending each of the four forms adds to the stored base. */
export type AdjectiveDeclensionRule = {
  name: string;
  endings: AdjectiveForms;
};

export type AdjectiveMorphology = {
  declensionRules: AdjectiveDeclensionRule[];
};

export const adjectiveForms: AdjectiveForm[] = ["masculineSingular", "feminineSingular", "masculinePlural", "femininePlural"];

export const adjectiveFormLabels: Record<AdjectiveForm, string> = {
  masculineSingular: "masculine singular",
  feminineSingular: "feminine singular",
  masculinePlural: "masculine plural",
  femininePlural: "feminine plural",
};

export const adjectiveFormAbbreviations: Record<AdjectiveForm, string> = {
  masculineSingular: "masc. sg.",
  feminineSingular: "fem. sg.",
  masculinePlural: "masc. pl.",
  femininePlural: "fem. pl.",
};

function endings(masculineSingular: string, feminineSingular: string, masculinePlural: string, femininePlural: string): AdjectiveForms {
  return { masculineSingular, feminineSingular, masculinePlural, femininePlural };
}

export const defaultAdjectiveMorphology: AdjectiveMorphology = {
  declensionRules: [
    { name: "-o/-a/-i/-e", endings: endings("o", "a", "i", "e") },
    { name: "-e/-e/-i/-i", endings: endings("e", "e", "i", "i") },
    { name: "-co/-ca/-chi/-che", endings: endings("co", "ca", "chi", "che") },
    { name: "-co/-ca/-ci/-che", endings: endings("co", "ca", "ci", "che") },
    { name: "-go/-ga/-ghi/-ghe", endings: endings("go", "ga", "ghi", "ghe") },
    { name: "-io/-ia/-i/-ie", endings: endings("io", "ia", "i", "ie") },
    { name: "-cio/-cia/-ci/-ce", endings: endings("cio", "cia", "ci", "ce") },
    { name: "-ista/-ista/-isti/-iste", endings: endings("ista", "ista", "isti", "iste") },
    { name: "Invariable", endings: endings("", "", "", "") },
  ],
};

export function cloneAdjectiveMorphology(value: AdjectiveMorphology): AdjectiveMorphology {
  return JSON.parse(JSON.stringify(value)) as AdjectiveMorphology;
}

export function generateAdjectiveForms(rule: AdjectiveDeclensionRule, base: string): AdjectiveForms {
  const stem = base.normalize("NFC");
  return endings(
    `${stem}${rule.endings.masculineSingular}`,
    `${stem}${rule.endings.feminineSingular}`,
    `${stem}${rule.endings.masculinePlural}`,
    `${stem}${rule.endings.femininePlural}`,
  );
}

/** The base a rule reads from a masculine singular, or null when the form doesn't end in the rule's ending. */
export function recognizeAdjectiveBase(rule: AdjectiveDeclensionRule, masculineSingular: string) {
  const value = masculineSingular.normalize("NFC").trim();
  const ending = rule.endings.masculineSingular.normalize("NFC");
  if (!ending) return value || null;
  if (!normalizeText(value).endsWith(normalizeText(ending)) || value.length <= ending.length) return null;
  return value.slice(0, value.length - ending.length);
}

export function adjectiveFormsEqual(left: AdjectiveForms, right: AdjectiveForms) {
  return adjectiveForms.every((form) => normalizeText(left[form]) === normalizeText(right[form]));
}

/** The four forms a declension produces; throws when a rule declension names an unknown rule. */
export function resolveAdjectiveDeclension(declension: AdjectiveDeclension, morphology: AdjectiveMorphology, label = "Adjective"): { forms: AdjectiveForms; rule: string | null } {
  if (declension.kind === "irregular") {
    const forms = endings(declension.masculineSingular, declension.feminineSingular, declension.masculinePlural, declension.femininePlural);
    const missing = adjectiveForms.find((form) => !forms[form].trim());
    if (missing) throw new Error(`${label} is irregular but has no ${adjectiveFormLabels[missing]}.`);
    return { forms, rule: null };
  }
  const rule = morphology.declensionRules.find((item) => item.name === declension.rule);
  if (!rule) throw new Error(`${label} references unknown adjective rule ${declension.rule}.`);
  if (!declension.base.trim()) throw new Error(`${label} has an empty base.`);
  return { forms: generateAdjectiveForms(rule, declension.base), rule: rule.name };
}

export function resolvedAdjectiveForms(card: Flashcard, morphology: AdjectiveMorphology) {
  if (card.type !== "adjective") throw new Error("Only adjective cards have adjective forms.");
  return resolveAdjectiveDeclension(card.details.declension, morphology, `Adjective card ${card.id}`);
}

/**
 * The form sets the rules predict from a masculine singular: among rules whose masculine singular
 * ending matches, only the most specific (longest ending) count. More than one entry means equally
 * specific rules disagree.
 */
export function predictedAdjectiveForms(masculineSingular: string, morphology: AdjectiveMorphology) {
  let best = -1;
  let predictions: AdjectiveForms[] = [];
  for (const rule of morphology.declensionRules) {
    const base = recognizeAdjectiveBase(rule, masculineSingular);
    if (base === null) continue;
    const specificity = [...rule.endings.masculineSingular].length;
    if (specificity < best) continue;
    if (specificity > best) {
      best = specificity;
      predictions = [];
    }
    const forms = generateAdjectiveForms(rule, base);
    if (!predictions.some((item) => adjectiveFormsEqual(item, forms))) predictions.push(forms);
  }
  return predictions;
}

/** Whether all four forms follow from the masculine singular alone. */
export function adjectiveFormsArePredictable(forms: AdjectiveForms, morphology: AdjectiveMorphology) {
  const predictions = predictedAdjectiveForms(forms.masculineSingular, morphology);
  return predictions.length === 1 && adjectiveFormsEqual(predictions[0]!, forms);
}

/** The most specific rule that produces exactly these forms; null when none does or two tie. */
export function inferAdjectiveDeclension(forms: AdjectiveForms, morphology: AdjectiveMorphology): Extract<AdjectiveDeclension, { kind: "rule" }> | null {
  const matches: { rule: string; base: string; specificity: number }[] = [];
  for (const rule of morphology.declensionRules) {
    const base = recognizeAdjectiveBase(rule, forms.masculineSingular);
    if (base === null || !adjectiveFormsEqual(generateAdjectiveForms(rule, base), forms)) continue;
    matches.push({ rule: rule.name, base, specificity: [...rule.endings.masculineSingular].length });
  }
  matches.sort((left, right) => right.specificity - left.specificity || left.rule.localeCompare(right.rule));
  const match = matches[0];
  if (!match || matches[1]?.specificity === match.specificity) return null;
  return { kind: "rule", rule: match.rule, base: match.base };
}

export function normalizeAdjectiveDeclension(value: unknown, label = "Adjective declension"): AdjectiveDeclension {
  const declension = objectValue(value, label);
  if (declension.kind === "rule") {
    assertExactKeys(declension, label, ["kind", "rule", "base"]);
    return { kind: "rule", rule: nonEmptyString(declension.rule, `${label} rule`), base: nonEmptyString(declension.base, `${label} base`).normalize("NFC") };
  }
  if (declension.kind === "irregular") {
    assertExactKeys(declension, label, ["kind", ...adjectiveForms]);
    const forms = Object.fromEntries(adjectiveForms.map((form) => [form, nonEmptyString(declension[form], `${label} ${adjectiveFormLabels[form]}`).normalize("NFC")])) as AdjectiveForms;
    return { kind: "irregular", ...forms };
  }
  throw new Error(`${label} kind must be "rule" or "irregular".`);
}

export function normalizeAdjectiveMorphology(value: unknown): AdjectiveMorphology {
  const payload = objectValue(value, "Adjective morphology");
  assertExactKeys(payload, "Adjective morphology", ["declensionRules"]);
  if (!Array.isArray(payload.declensionRules)) throw new Error("Adjective morphology needs a declensionRules array.");
  const declensionRules = payload.declensionRules.map((raw): AdjectiveDeclensionRule => {
    const rule = objectValue(raw, "Adjective rule");
    assertExactKeys(rule, "Adjective rule", ["name", "endings"]);
    const name = nonEmptyString(rule.name, "Adjective rule name");
    if (name === irregularDeclensionName || name.startsWith(":")) throw new Error(`“${name}” is reserved; choose another adjective rule name.`);
    const raws = objectValue(rule.endings, `Adjective rule ${name} endings`);
    assertExactKeys(raws, `Adjective rule ${name} endings`, adjectiveForms);
    const ruleEndings = Object.fromEntries(adjectiveForms.map((form) => [form, String(raws[form] ?? "").normalize("NFC").trim()])) as AdjectiveForms;
    return { name, endings: ruleEndings };
  });
  assertUniqueNames(declensionRules, "adjective rule");
  return { declensionRules };
}

/**
 * Whether a rule-built adjective follows a rule with a shorter masculine singular ending than another
 * rule that fits the word (bianco / bianci under -o/-a/-i/-e while the -co rules fit): usually a typo.
 */
export function followsLessSpecificRule(ruleName: string, masculineSingular: string, morphology: AdjectiveMorphology) {
  const rule = morphology.declensionRules.find((item) => item.name === ruleName);
  if (!rule) return false;
  const longest = Math.max(...morphology.declensionRules
    .filter((item) => recognizeAdjectiveBase(item, masculineSingular) !== null)
    .map((item) => [...item.endings.masculineSingular].length));
  return [...rule.endings.masculineSingular].length < longest;
}
