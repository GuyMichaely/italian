import type { CardType, Flashcard, NounArticleGroupOverrides, NounDeclension } from "../cards/types";
import { normalizeNounArticleProfile } from "../cards/nounMorphology";
import { cardTypes } from "../cardTypes";

function objectValue(value: unknown, label: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function assertExactKeys(value: Record<string, unknown>, label: string, expected: string[]) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`${label} must contain exactly: ${wanted.join(", ")}.`);
  }
}

function stringField(value: unknown) {
  return String(value ?? "");
}

function normalizeNounDeclension(value: unknown, id: number): NounDeclension {
  const declension = objectValue(value, `Noun card ${id} declension`);
  if (declension.kind === "rule") {
    assertExactKeys(declension, `Noun card ${id} rule declension`, ["kind", "rule", "base"]);
    const rule = String(declension.rule ?? "").trim();
    if (!rule) throw new Error(`Noun card ${id} needs a declension rule name.`);
    return { kind: "rule", rule, base: String(declension.base ?? "").normalize("NFC") };
  }
  if (declension.kind === "irregular") {
    assertExactKeys(declension, `Noun card ${id} irregular declension`, ["kind", "singular", "plural"]);
    const singular = String(declension.singular ?? "").normalize("NFC").trim();
    const plural = String(declension.plural ?? "").normalize("NFC").trim();
    if (!singular && !plural) throw new Error(`Irregular noun card ${id} needs a singular or plural form.`);
    return { kind: "irregular", singular, plural };
  }
  throw new Error(`Noun card ${id} declension must be a rule or irregular declension.`);
}

function normalizeArticleGroupOverrides(value: unknown, id: number): NounArticleGroupOverrides {
  const overrides = objectValue(value, `Noun card ${id} article groups`);
  assertExactKeys(overrides, `Noun card ${id} article groups`, ["singular", "plural"]);
  const group = (raw: unknown) => {
    if (raw === null) return null;
    const name = String(raw ?? "").trim();
    if (!name) throw new Error(`Noun card ${id} article group exceptions must be a group name or null.`);
    return name;
  };
  return { singular: group(overrides.singular), plural: group(overrides.plural) };
}

export function cloneCards(cards: Flashcard[]): Flashcard[] {
  return cards.map((card) => {
    if (card.type === "noun") {
      return {
        ...card,
        tags: [...card.tags],
        details: {
          ...card.details,
          declension: { ...card.details.declension },
          articleProfile: { ...card.details.articleProfile },
          articleGroups: { ...card.details.articleGroups },
        },
      };
    }
    return { ...card, tags: [...card.tags], details: { ...card.details } } as Flashcard;
  });
}

function normalizeIdentityText(value: string) {
  return value.normalize("NFC").trim().toLocaleLowerCase("it-IT").replace(/\s+/g, " ");
}

function nounIdentity(card: Extract<Flashcard, { type: "noun" }>) {
  const declension = card.details.declension;
  return declension.kind === "rule"
    ? `rule\u0000${normalizeIdentityText(declension.rule)}\u0000${normalizeIdentityText(declension.base)}`
    : `irregular\u0000${normalizeIdentityText(declension.singular)}\u0000${normalizeIdentityText(declension.plural)}`;
}

export function cardDuplicateKey(card: Flashcard) {
  const italianIdentity = card.type === "noun" ? nounIdentity(card) : normalizeIdentityText(card.italian);
  return `${card.type}\u0000${normalizeIdentityText(card.english)}\u0000${italianIdentity}`;
}

function cardIdentityLabel(card: Flashcard) {
  if (card.type !== "noun") return card.italian;
  const declension = card.details.declension;
  return declension.kind === "rule" ? `${declension.rule} / base ${declension.base || "∅"}` : [declension.singular, declension.plural].filter(Boolean).join(" / ");
}

export function assertNoDuplicateCards(existing: Flashcard[], incoming: Flashcard[]) {
  const keys = new Set(existing.map(cardDuplicateKey));
  for (const card of incoming) {
    const key = cardDuplicateKey(card);
    if (keys.has(key)) throw new Error(`A ${card.type} card for “${cardIdentityLabel(card)}” / “${card.english}” already exists.`);
    keys.add(key);
  }
}

export function normalizeCard(value: unknown): Flashcard {
  const raw = objectValue(value, "Card");
  const id = Number(raw.id);
  const type = raw.type;
  const english = String(raw.english ?? "");
  if (!Number.isFinite(id) || typeof type !== "string" || !cardTypes.includes(type as CardType) || !english) {
    throw new Error("Storage returned an incomplete or invalid card.");
  }

  const common = {
    id,
    english,
    setName: typeof raw.setName === "string" && raw.setName ? raw.setName : null,
    tags: Array.isArray(raw.tags) ? raw.tags.map(String) : [],
  };
  const details = objectValue(raw.details, `${type} card ${id} details`);

  if (type === "noun") {
    if (Object.prototype.hasOwnProperty.call(raw, "italian")) {
      throw new Error(`Noun card ${id} must not store a derived italian field.`);
    }
    assertExactKeys(details, `Noun card ${id} details`, ["articleGroups", "articleProfile", "declension", "gender"]);
    const gender = details.gender;
    if (gender !== "masculine" && gender !== "feminine") throw new Error(`Noun card ${id} has an invalid gender.`);
    return {
      ...common,
      type: "noun",
      details: {
        declension: normalizeNounDeclension(details.declension, id),
        gender,
        articleProfile: normalizeNounArticleProfile(details.articleProfile, `Noun card ${id} article profile`),
        articleGroups: normalizeArticleGroupOverrides(details.articleGroups, id),
      },
    };
  }

  const italian = String(raw.italian ?? "");
  if (!italian) throw new Error(`Storage returned a ${type} card without an Italian form.`);

  if (type === "verb") {
    assertExactKeys(details, `Verb card ${id} details`, ["io", "tu", "luiLei", "noi", "voi", "loro", "auxiliary", "participle"]);
    const auxiliary = details.auxiliary;
    if (auxiliary !== "avere" && auxiliary !== "essere") throw new Error(`Verb card ${id} has an invalid auxiliary.`);
    return {
      ...common,
      type: "verb",
      italian,
      details: {
        io: stringField(details.io),
        tu: stringField(details.tu),
        luiLei: stringField(details.luiLei),
        noi: stringField(details.noi),
        voi: stringField(details.voi),
        loro: stringField(details.loro),
        auxiliary,
        participle: stringField(details.participle),
      },
    };
  }

  if (type === "adjective") {
    assertExactKeys(details, `Adjective card ${id} details`, ["masculineSingular", "feminineSingular", "masculinePlural", "femininePlural"]);
    return {
      ...common,
      type: "adjective",
      italian,
      details: {
        masculineSingular: stringField(details.masculineSingular),
        feminineSingular: stringField(details.feminineSingular),
        masculinePlural: stringField(details.masculinePlural),
        femininePlural: stringField(details.femininePlural),
      },
    };
  }

  assertExactKeys(details, `Adverb card ${id} details`, []);
  return { ...common, type: "adverb", italian, details: {} };
}
