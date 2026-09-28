import type { Flashcard, NounCard } from "../cards/types";
import { articlePatternForWord, normalizeText, resolvedNounForms, type NounMorphology } from "../cards/nounMorphology";
import { articleSlots } from "./nounAnswers";

/** Classes of nouns by the articles they take, each split into sub-buckets by start pattern where that matters. */
export type ArticleDrillPool = NounCard[][][];

type Classified = { card: NounCard; classKey: string; group: string | null; pattern: string };

function classify(card: NounCard, morphology: NounMorphology): Classified | null {
  let slots;
  let forms;
  try {
    slots = articleSlots(card, morphology);
    forms = resolvedNounForms(card, morphology);
  } catch {
    return null;
  }
  if (!slots.length) return null;
  const classKey = `${card.details.gender}|${slots.map((slot) => `${slot.key}:${normalizeText(slot.article)}`).join(",")}`;
  const primary = slots.some((slot) => slot.key !== "definitePlural") ? "singular" : "plural";
  const group = primary === "singular" ? forms.singularGroup : forms.pluralGroup;
  const override = card.details.articleGroups[primary];
  const pattern = override ? "exception" : articlePatternForWord(forms[primary], morphology)?.pattern ?? "none";
  return { card, classKey, group, pattern };
}

/**
 * Groups the nouns that take at least one article into classes by gender and the exact articles
 * they take. Where a class is one article group with several start patterns (masculine lo/gli/uno:
 * sC, z, gn, ps, …), it is split by pattern so each pattern gets an equal share of that class.
 */
export function articleDrillPool(cards: Flashcard[], morphology: NounMorphology): ArticleDrillPool {
  const classes = new Map<string, Classified[]>();
  for (const card of cards) {
    if (card.type !== "noun") continue;
    const entry = classify(card, morphology);
    if (!entry) continue;
    classes.set(entry.classKey, [...(classes.get(entry.classKey) ?? []), entry]);
  }
  return [...classes.values()].map((entries) => {
    const groups = new Set(entries.map((entry) => entry.group));
    const onlyGroup = groups.size === 1 ? morphology.articleGroups.find((group) => group.name === [...groups][0]) : undefined;
    if (!onlyGroup || onlyGroup.startsWith.length < 2) return [entries.map((entry) => entry.card)];
    const byPattern = new Map<string, NounCard[]>();
    for (const entry of entries) byPattern.set(entry.pattern, [...(byPattern.get(entry.pattern) ?? []), entry.card]);
    return [...byPattern.values()];
  });
}

export function articleDrillSize(pool: ArticleDrillPool) {
  return pool.reduce((total, buckets) => total + buckets.reduce((sum, bucket) => sum + bucket.length, 0), 0);
}

function pick<T>(items: T[], random: () => number) {
  return items[Math.floor(random() * items.length)]!;
}

/** Draws a class uniformly, then a sub-bucket, then a noun; avoids repeating the previous noun when it can. */
export function drawArticleCard(pool: ArticleDrillPool, previousId: number | null, random: () => number = Math.random): NounCard | null {
  if (!pool.length) return null;
  const canAvoid = articleDrillSize(pool) > 1;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const card = pick(pick(pick(pool, random), random), random);
    if (!canAvoid || card.id !== previousId) return card;
  }
  return pick(pool.flat(2).filter((card) => card.id !== previousId), random);
}
