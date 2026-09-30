import type {
  AdverbCard,
  CardType,
  VerbCard,
} from "./types";
import { cardTypes } from "../cardTypes";
import { storageKey } from "../storage/keys";
import { emptyNounDraft, type NounDraft } from "./nounDraft";
import { emptyAdjectiveDraft, type AdjectiveDraft } from "./adjectiveDraft";

export type NounBatchRow = NounDraft & {
  id: string;
  /** True while the plural still holds Parole's suggestion rather than typed text. */
  pluralSuggested: boolean;
};

export type VerbBatchRow = {
  id: string;
  english: string;
  infinitive: string;
  io: string;
  tu: string;
  luiLei: string;
  noi: string;
  voi: string;
  loro: string;
  auxiliary: "avere" | "essere";
  participle: string;
};

export type AdjectiveBatchRow = AdjectiveDraft & {
  id: string;
  /** True while the other three forms still hold Parole's suggestion rather than typed text. */
  suggested: boolean;
};

export type AdverbBatchRow = {
  id: string;
  english: string;
  form: string;
};

export type BatchDraft<Row> = {
  setName: string;
  tags: string;
  rows: Row[];
};

const cardAdderTypeKey = storageKey("add-words:type");

export function cardAdderDraftKey(type: CardType) {
  return storageKey(`add-words:${type}`);
}

export function readCardAdderType(): CardType {
  if (typeof window === "undefined") return "noun";
  try {
    const stored = window.localStorage.getItem(cardAdderTypeKey);
    return cardTypes.includes(stored as CardType) ? stored as CardType : "noun";
  } catch {
    return "noun";
  }
}

export function readBatchDraft<Row>(type: CardType, createRows: () => Row[]): BatchDraft<Row> {
  const fallback = { setName: "", tags: "", rows: createRows() };
  if (typeof window === "undefined") return fallback;
  try {
    const stored = window.localStorage.getItem(cardAdderDraftKey(type));
    if (!stored) return fallback;
    const parsed = JSON.parse(stored) as Partial<BatchDraft<Row>>;
    return {
      setName: typeof parsed.setName === "string" ? parsed.setName : "",
      tags: typeof parsed.tags === "string" ? parsed.tags : "",
      rows: Array.isArray(parsed.rows) && parsed.rows.length ? parsed.rows : createRows(),
    };
  } catch {
    return fallback;
  }
}

export function clearBatchDraft(type: CardType) {
  try {
    window.localStorage.removeItem(cardAdderDraftKey(type));
  } catch {
    // Draft persistence is optional.
  }
}

export function writeBatchDraft<Row>(type: CardType, draft: BatchDraft<Row>) {
  try {
    window.localStorage.setItem(cardAdderDraftKey(type), JSON.stringify(draft));
  } catch {
    // Keep the editor usable when local storage is unavailable.
  }
}

export function writeCardAdderType(type: CardType) {
  try {
    window.localStorage.setItem(cardAdderTypeKey, type);
  } catch {
    // Keep the editor usable when local storage is unavailable.
  }
}

let nextRowId = 0;

export function newRowId() {
  nextRowId += 1;
  return `${Date.now()}-${nextRowId}`;
}

export function parseTags(value: string) {
  return Array.from(new Set(value.split(",").map((tag) => tag.trim()).filter(Boolean)));
}

export function localDateStamp() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function emptyNounBatchRow(id: string): NounBatchRow {
  return { ...emptyNounDraft(), id, pluralSuggested: false };
}

export function emptyVerbBatchRow(id: string): VerbBatchRow {
  return { id, english: "", infinitive: "", io: "", tu: "", luiLei: "", noi: "", voi: "", loro: "", auxiliary: "avere", participle: "" };
}

export function emptyAdjectiveBatchRow(id: string): AdjectiveBatchRow {
  return { ...emptyAdjectiveDraft(), id, suggested: false };
}

export function emptyAdverbBatchRow(id: string): AdverbBatchRow {
  return { id, english: "", form: "" };
}

export function verbCard(input: Omit<VerbBatchRow, "id"> & { id: number; setName: string | null; tags: string[] }): VerbCard {
  return {
    id: input.id,
    type: "verb",
    english: input.english,
    italian: input.infinitive,
    setName: input.setName,
    tags: input.tags,
    details: { io: input.io, tu: input.tu, luiLei: input.luiLei, noi: input.noi, voi: input.voi, loro: input.loro, auxiliary: input.auxiliary, participle: input.participle },
  };
}

export function adverbCard(input: Omit<AdverbBatchRow, "id"> & { id: number; setName: string | null; tags: string[] }): AdverbCard {
  return { id: input.id, type: "adverb", english: input.english, italian: input.form, setName: input.setName, tags: input.tags, details: {} };
}

export function verbRowFromCard(card: VerbCard): VerbBatchRow {
  return { id: String(card.id), english: card.english, infinitive: card.italian, io: card.details.io, tu: card.details.tu, luiLei: card.details.luiLei, noi: card.details.noi, voi: card.details.voi, loro: card.details.loro, auxiliary: card.details.auxiliary, participle: card.details.participle };
}

export function adverbRowFromCard(card: AdverbCard): AdverbBatchRow {
  return { id: String(card.id), english: card.english, form: card.italian };
}
