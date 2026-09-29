export type CardType = "noun" | "verb" | "adjective" | "adverb";

export type NounGender = "masculine" | "feminine";

export type NounArticleProfile =
  | { definiteSingular: true; definitePlural: true; indefiniteSingular: true }
  | { definiteSingular: true; definitePlural: false; indefiniteSingular: false }
  | { definiteSingular: false; definitePlural: true; indefiniteSingular: false }
  | { definiteSingular: false; definitePlural: false; indefiniteSingular: false };

/** How a noun's forms are produced: from a declension rule and base, or listed outright. */
export type NounDeclension =
  | { kind: "rule"; rule: string; base: string }
  /** An empty form means the noun does not have that number. At least one form is non-empty. */
  | { kind: "irregular"; singular: string; plural: string };

/**
 * Per-form article-group exceptions. `null` means the group is chosen from the form's spelling
 * using the morphology's article groups; a name forces that group (e.g. plural "dei" → "lo" gives "gli dei").
 */
export type NounArticleGroupOverrides = {
  singular: string | null;
  plural: string | null;
};

export type NounDetails = {
  declension: NounDeclension;
  /** The singular's gender; also the plural's unless genderDiffersWithPlurality. */
  gender: NounGender;
  /** The plural takes the other gender (l’uovo / le uova). Only for nouns with both forms. */
  genderDiffersWithPlurality: boolean;
  articleProfile: NounArticleProfile;
  articleGroups: NounArticleGroupOverrides;
};

export type VerbDetails = {
  io: string;
  tu: string;
  luiLei: string;
  noi: string;
  voi: string;
  loro: string;
  auxiliary: "avere" | "essere";
  participle: string;
};

export type AdjectiveForm = "masculineSingular" | "feminineSingular" | "masculinePlural" | "femininePlural";
export type AdjectiveForms = Record<AdjectiveForm, string>;

/** How an adjective's four forms are produced: a declension rule and base, or the forms themselves. */
export type AdjectiveDeclension =
  | { kind: "rule"; rule: string; base: string }
  | ({ kind: "irregular" } & AdjectiveForms);

export type AdjectiveDetails = {
  declension: AdjectiveDeclension;
};

export type AdverbDetails = Record<string, never>;

type CardBase<Type extends CardType, Details> = {
  id: number;
  type: Type;
  english: string;
  setName: string | null;
  tags: string[];
  details: Details;
};

type ItalianCardBase<Type extends Exclude<CardType, "noun" | "adjective">, Details> = CardBase<Type, Details> & {
  italian: string;
};

export type NounCard = CardBase<"noun", NounDetails>;
export type VerbCard = ItalianCardBase<"verb", VerbDetails>;
export type AdjectiveCard = CardBase<"adjective", AdjectiveDetails>;
export type AdverbCard = ItalianCardBase<"adverb", AdverbDetails>;

export type Flashcard = NounCard | VerbCard | AdjectiveCard | AdverbCard;
