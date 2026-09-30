# Adjective declensions

Adjectives work like nouns: a card stores how its forms are produced, and the forms themselves are derived from editable rules.

## Adjective cards

An adjective card stores one fact beside its English, set, and tags: a `declension`, either a rule and base or, for an irregular adjective, its four forms.

```json
{
  "type": "adjective",
  "english": "white",
  "details": { "declension": { "kind": "rule", "rule": "-co/-ca/-chi/-che", "base": "bian" } }
}
```

```json
{
  "type": "adjective",
  "english": "Belgian",
  "details": {
    "declension": { "kind": "irregular", "masculineSingular": "belga", "feminineSingular": "belga", "masculinePlural": "belgi", "femininePlural": "belghe" }
  }
}
```

The card does not store a top-level `italian` value; its headword is the masculine singular.

## Adjective rules

The inventory's `adjectiveMorphology` holds the rules. Each rule gives the ending that each of the four forms adds to the base:

```json
{ "name": "-co/-ca/-chi/-che", "endings": { "masculineSingular": "co", "feminineSingular": "ca", "masculinePlural": "chi", "femininePlural": "che" } }
```

| Rule | Example |
|---|---|
| `-o/-a/-i/-e` | rosso, rossa, rossi, rosse |
| `-e/-e/-i/-i` | verde, verde, verdi, verdi |
| `-co/-ca/-chi/-che` | bianco, bianca, bianchi, bianche |
| `-co/-ca/-ci/-che` | economico, economica, economici, economiche |
| `-go/-ga/-ghi/-ghe` | lungo, lunga, lunghi, lunghe |
| `-io/-ia/-i/-ie` | vecchio, vecchia, vecchi, vecchie |
| `-cio/-cia/-ci/-ce` | marcio, marcia, marci, marce |
| `-ista/-ista/-isti/-iste` | ottimista, ottimista, ottimisti, ottimiste |
| `Invariable` | blu, rosa, viola |

These are the defaults; the Grammar page edits them. Rule names are unique references; `Irregular` and names starting with `:` are reserved. Renaming a rule updates the adjectives and the drilled-rule list that use it, and a rule still used by an adjective can't be removed.

## Prediction

The rules predict an adjective's forms from any one of them: among the rules whose ending for that form fits, only the longest ending counts. A single prediction that matches the adjective's forms means that form predicts the rest. Two equally specific rules that disagree predict nothing.

| Form | Rules that fit, longest ending | Predicts |
|---|---|---|
| bella (fem. sg.) | -o/-a/-i/-e | bello, bella, belli, belle |
| rossi (masc. pl.) | -o, -e, and -io all end in -i | nothing |
| verdi (fem. pl.) | only -e/-e/-i/-i has a feminine plural in -i | verde, verde, verdi, verdi |
| vecchie (fem. pl.) | -io/-ia/-i/-ie | vecchio, vecchia, vecchi, vecchie |
| bianco, bianca, bianche | both -co rules | nothing |
| bianchi (masc. pl.) | only -co/-ca/-chi/-che | bianco, bianca, bianchi, bianche |

The editor uses this to suggest the other three forms as the masculine singular is typed, and Auto picks the most specific rule that makes exactly the typed forms. When a rule with a longer ending also fits the word (`bianco` with `bianci` / `biance` under `-o/-a/-i/-e`), the editor and the Grammar page flag it as a likely typo.

## Study answers

A typed adjective answer is either one form or all four forms in order: masculine singular, feminine singular, masculine plural, feminine plural. One form is enough when it predicts the rest (above) and none of these applies:

- the adjective is irregular;
- no form predicts the rest;
- its rule is in `studyPreferences.adjectiveFullDeclensionRules` (a rule being drilled, set in Settings);
- its id is in `studyPreferences.fullDeclensionCards` (“Always ask for all four forms” in the word editor).

A wrong answer lists what was wrong, for example “The feminine plural isn’t “rossi”.”

## Not modeled

Before a noun, `bello` and `quello` take forms that depend on how the next word starts, like the definite article (bel ragazzo, bello specchio, bell’amico, bei ragazzi, begli specchi); `buono` follows the indefinite article (buon amico, buono studente, buon’amica); and `grande` and `santo` shorten (gran signore, San Marco, Sant’Antonio). Parole stores only the ordinary forms used after a noun.

## Migration

`scripts/migrate-adjective-declensions.mjs` converts inventories from before adjective rules: it adds the default `adjectiveMorphology`, turns each adjective's stored forms into the most specific rule that makes them (or Irregular), drops the stored `italian`, and renames `studyPreferences.fullDeclensionRules` to `nounFullDeclensionRules` beside an empty `adjectiveFullDeclensionRules`. It lists irregular adjectives and those that follow a less specific rule than their ending suggests.
