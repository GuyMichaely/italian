import type { CardType, Flashcard, NounArticleGroupOverrides, NounDeclension } from "../cards/types";
import { normalizeNounArticleProfile } from "../cards/nounMorphology";
import { normalizeAdjectiveDeclension } from "../cards/adjectiveMorphology";
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

/** A stored text field: it must be text, and non-empty unless `optional`. */
function stringField(value: unknown, label: string, optional = false) {
  if (typeof value !== "string" || (!optional && !value.trim())) throw new Error(`${label} must be ${optional ? "text" : "non-empty text"}.`);
  return value;
}

function normalizeNounDeclension(value: unknown, id: number): NounDeclension {
  const declension = objectValue(value, `Noun card ${id} declension`);
  if (declension.kind === "rule") {
    assertExactKeys(declension, `Noun card ${id} rule declension`, ["kind", "rule", "base"]);
    const rule = stringField(declension.rule, `Noun card ${id}'s declension rule`).trim();
    return { kind: "rule", rule, base: stringField(declension.base, `Noun card ${id}'s base`, true).normalize("NFC") };
  }
  if (declension.kind === "irregular") {
    assertExactKeys(declension, `Noun card ${id} irregular declension`, ["kind", "singular", "plural"]);
    const singular = stringField(declension.singular, `Noun card ${id}'s singular`, true).normalize("NFC").trim();
    const plural = stringField(declension.plural, `Noun card ${id}'s plural`, true).normalize("NFC").trim();
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
    return stringField(raw, `Noun card ${id}'s article group exception`).trim();
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
    if (card.type === "adjective") return { ...card, tags: [...card.tags], details: { declension: { ...card.details.declension } } };
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

function adjectiveIdentity(card: Extract<Flashcard, { type: "adjective" }>) {
  const declension = card.details.declension;
  return declension.kind === "rule"
    ? `rule\u0000${normalizeIdentityText(declension.rule)}\u0000${normalizeIdentityText(declension.base)}`
    : `irregular\u0000${[declension.masculineSingular, declension.feminineSingular, declension.masculinePlural, declension.femininePlural].map(normalizeIdentityText).join("\u0000")}`;
}

export function cardDuplicateKey(card: Flashcard) {
  const italianIdentity = card.type === "noun" ? nounIdentity(card) : card.type === "adjective" ? adjectiveIdentity(card) : normalizeIdentityText(card.italian);
  return `${card.type}\u0000${normalizeIdentityText(card.english)}\u0000${italianIdentity}`;
}

function cardIdentityLabel(card: Flashcard) {
  if (card.type === "adjective") {
    const declension = card.details.declension;
    return declension.kind === "rule" ? `${declension.rule} / base ${declension.base}` : declension.masculineSingular;
  }
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
  const { id, type, english, setName, tags, editedAt } = raw;
  if (typeof id !== "number" || !Number.isSafeInteger(id) || id < 0 || typeof type !== "string" || !cardTypes.includes(type as CardType) || typeof english !== "string" || !english.trim()) {
    throw new Error("Storage returned an incomplete or invalid card.");
  }
  if (typeof editedAt !== "string" || Number.isNaN(Date.parse(editedAt))) throw new Error(`Card ${id} needs the time it was edited (editedAt).`);
  if (setName !== null && (typeof setName !== "string" || !setName.trim())) throw new Error(`Card ${id}'s set must be a name or null.`);
  if (!Array.isArray(tags) || tags.some((tag) => typeof tag !== "string" || !tag.trim())) throw new Error(`Card ${id}'s tags must be a list of names.`);
  if (type === "noun" || type === "adjective") {
    if (Object.prototype.hasOwnProperty.call(raw, "italian")) throw new Error(`${type === "noun" ? "Noun" : "Adjective"} card ${id} must not store a derived italian field.`);
    assertExactKeys(raw, `Card ${id}`, ["id", "type", "english", "setName", "tags", "editedAt", "details"]);
  } else {
    assertExactKeys(raw, `Card ${id}`, ["id", "type", "english", "italian", "setName", "tags", "editedAt", "details"]);
  }
  const common = { id, english, setName: setName as string | null, tags: tags as string[], editedAt };
  const details = objectValue(raw.details, `${type} card ${id} details`);

  if (type === "noun") {
    assertExactKeys(details, `Noun card ${id} details`, ["articleGroups", "articleProfile", "declension", "gender", "genderDiffersWithPlurality"]);
    const gender = details.gender;
    if (gender !== "masculine" && gender !== "feminine") throw new Error(`Noun card ${id} has an invalid gender.`);
    if (typeof details.genderDiffersWithPlurality !== "boolean") throw new Error(`Noun card ${id} genderDiffersWithPlurality must be true or false.`);
    return {
      ...common,
      type: "noun",
      details: {
        declension: normalizeNounDeclension(details.declension, id),
        gender,
        genderDiffersWithPlurality: details.genderDiffersWithPlurality,
        articleProfile: normalizeNounArticleProfile(details.articleProfile, `Noun card ${id} article profile`),
        articleGroups: normalizeArticleGroupOverrides(details.articleGroups, id),
      },
    };
  }

  if (type === "adjective") {
    assertExactKeys(details, `Adjective card ${id} details`, ["declension"]);
    return {
      ...common,
      type: "adjective",
      details: { declension: normalizeAdjectiveDeclension(details.declension, `Adjective card ${id} declension`) },
    };
  }

  const italian = raw.italian;
  if (typeof italian !== "string" || !italian.trim()) throw new Error(`Storage returned a ${type} card without an Italian form.`);

  if (type === "verb") {
    assertExactKeys(details, `Verb card ${id} details`, ["io", "tu", "luiLei", "noi", "voi", "loro", "auxiliary", "participle"]);
    const auxiliary = details.auxiliary;
    if (auxiliary !== "avere" && auxiliary !== "essere") throw new Error(`Verb card ${id} has an invalid auxiliary.`);
    return {
      ...common,
      type: "verb",
      italian,
      details: {
        io: stringField(details.io, `Verb card ${id}'s io`),
        tu: stringField(details.tu, `Verb card ${id}'s tu`),
        luiLei: stringField(details.luiLei, `Verb card ${id}'s luiLei`),
        noi: stringField(details.noi, `Verb card ${id}'s noi`),
        voi: stringField(details.voi, `Verb card ${id}'s voi`),
        loro: stringField(details.loro, `Verb card ${id}'s loro`),
        auxiliary,
        participle: stringField(details.participle, `Verb card ${id}'s participle`),
      },
    };
  }

  assertExactKeys(details, `Adverb card ${id} details`, []);
  return { ...common, type: "adverb", italian, details: {} };
}
