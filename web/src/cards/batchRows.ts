import type { NounMorphology } from "./nounMorphology";
import type { AdjectiveMorphology } from "./adjectiveMorphology";
import { nounDraftWithRule, suggestedPlural, type NounDraft } from "./nounDraft";
import { suggestedAdjectiveForms, type AdjectiveDraft } from "./adjectiveDraft";
import { newRowId, type AdjectiveBatchRow, type AdverbBatchRow, type NounBatchRow, type VerbBatchRow } from "./editorModel";

/** Ends the rows with exactly one empty row, so there's always a row to type the next word into. */
export function withSpareRows<Row>(rows: Row[], used: (row: Row) => boolean, emptyRow: (id: string) => Row): Row[] {
  let end = rows.length;
  while (end > 0 && !used(rows[end - 1]!)) end -= 1;
  // An emptied last row stays (it may be the one being typed in); empty rows after it go.
  return end < rows.length ? rows.slice(0, end + 1) : [...rows, emptyRow(newRowId())];
}

export function withoutRow<Row extends { id: string }>(rows: Row[], id: string, used: (row: Row) => boolean, emptyRow: (id: string) => Row): Row[] {
  return withSpareRows(rows.filter((row) => row.id !== id), used, emptyRow);
}

/** Refreshes the plural suggestion unless the learner typed a plural. */
function withSuggestedPlural<Row extends NounBatchRow>(row: Row, morphology: NounMorphology): Row {
  if (!row.pluralSuggested && row.plural.trim()) return row;
  const plural = suggestedPlural(row, morphology);
  return { ...row, plural, pluralSuggested: Boolean(plural) };
}

export function updateNounBatchRow<Row extends NounBatchRow, K extends keyof NounDraft>(row: Row, field: K, value: NounDraft[K], morphology: NounMorphology): Row {
  if (field === "rule") {
    // A suggested plural isn't the learner's, so it neither blocks a rule without a plural nor survives the change.
    const typed = row.pluralSuggested ? { ...row, plural: "", pluralSuggested: false } : row;
    return withSuggestedPlural(nounDraftWithRule(typed, value as string, morphology), morphology);
  }
  const next = { ...row, [field]: value } as Row;
  if (field === "plural") return { ...next, pluralSuggested: false };
  if (field === "singular" || field === "gender") return withSuggestedPlural(next, morphology);
  return next;
}

export function updateAdjectiveBatchRow<Row extends AdjectiveBatchRow, K extends keyof AdjectiveDraft>(row: Row, field: K, value: AdjectiveDraft[K], morphology: AdjectiveMorphology): Row {
  const next = { ...row, [field]: value } as Row;
  if (field === "feminineSingular" || field === "masculinePlural" || field === "femininePlural") return { ...next, suggested: false };
  const othersEmpty = !row.feminineSingular.trim() && !row.masculinePlural.trim() && !row.femininePlural.trim();
  if (field === "masculineSingular" && (row.suggested || othersEmpty)) {
    const suggestion = suggestedAdjectiveForms(next.masculineSingular, morphology);
    return suggestion
      ? { ...next, feminineSingular: suggestion.feminineSingular, masculinePlural: suggestion.masculinePlural, femininePlural: suggestion.femininePlural, suggested: true }
      : { ...next, feminineSingular: "", masculinePlural: "", femininePlural: "", suggested: false };
  }
  return next;
}

export const verbRowFields = ["english", "infinitive", "io", "tu", "luiLei", "noi", "voi", "loro", "participle"] as const;

export function verbRowUsed(row: VerbBatchRow) {
  return verbRowFields.some((field) => row[field].trim());
}

export function adverbRowUsed(row: AdverbBatchRow) {
  return Boolean(row.english.trim() || row.form.trim());
}

export function nounRowUsed(row: NounBatchRow) {
  return Boolean(row.english.trim() || row.singular.trim() || (!row.pluralSuggested && row.plural.trim()));
}

export function adjectiveRowUsed(row: AdjectiveBatchRow) {
  return Boolean(row.english.trim() || row.masculineSingular.trim() || (!row.suggested && [row.feminineSingular, row.masculinePlural, row.femininePlural].some((form) => form.trim())));
}
