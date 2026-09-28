# Noun morphology and noun study

Parola keeps a noun's lexical definition separate from study preferences, which only change what word mode asks for.

## Noun cards

A noun card stores four facts:

- `declension`, how its forms are produced: a declension `rule` and `base`, or an irregular noun's forms;
- `gender`;
- `articleProfile`, an object containing the noun's three article capabilities;
- `articleGroups`, per-form article-group exceptions (`null` means "from spelling").

The article capabilities are `definiteSingular`, `definitePlural`, and `indefiniteSingular`.

A regular noun:

```json
{
  "type": "noun",
  "english": "mirror",
  "details": {
    "declension": { "kind": "rule", "rule": "-chio → -chi", "base": "spec" },
    "gender": "masculine",
    "articleProfile": { "definiteSingular": true, "definitePlural": true, "indefiniteSingular": true },
    "articleGroups": { "singular": null, "plural": null }
  }
}
```

An irregular noun stores its forms outright; an empty form means the noun lacks that number:

```json
{
  "type": "noun",
  "english": "god",
  "details": {
    "declension": { "kind": "irregular", "singular": "dio", "plural": "dei" },
    "gender": "masculine",
    "articleProfile": { "definiteSingular": true, "definitePlural": true, "indefiniteSingular": true },
    "articleGroups": { "singular": null, "plural": "lo" }
  }
}
```

A noun card does not store top-level `italian`, generated forms of a regular noun, or article strings. Articles always come from the article table.

## Declension rules

A declension rule describes how a stored base produces singular and/or plural forms.

```json
{
  "name": "-o → -i",
  "gender": null,
  "forms": {
    "singular": { "suffix": "o" },
    "plural": { "suffix": "i" }
  }
}
```

The presence of form entries defines number availability:

```text
singular + plural entries  -> both numbers
singular entry only        -> singular only
plural entry only          -> plural only
```

A blank suffix means the base itself is the surface form. Generation appends the suffix; recognition removes it.

`gender` limits a rule to nouns of one gender (`"masculine"` or `"feminine"`); `null` applies it to both. The defaults make `-a → -e`, `-ca → -che`, and `-ga → -ghe` feminine and `-a → -i` masculine, so the two `-a` rules never compete for the same noun. A noun cannot use a rule limited to the other gender.

Rule names are unique and serve as references. `Irregular` and names starting with `:` are reserved. Renaming a rule in the grammar editor updates noun cards and the drilled-rule list when saved.

### Predicting the plural

A noun's plural is predictable when the rules settle it from the singular and gender alone. Among the two-number rules allowed for the gender whose singular ending matches, only the most specific ones count (the longest singular ending; an empty ending matches everything and so only counts when nothing longer does). The plural is predictable when those rules agree on one plural and it is the noun's actual plural.

```text
specchio (m)   -chio → -chi beats -o → -i          -> specchi, predictable
amica (f)      -ca → -che beats -a → -e            -> amiche, predictable
cinema (m)     -a → -i beats Unchanged             -> cinemi, but the plural is cinema: not predictable
parco (m) with -co → -chi and -co → -ci both defined -> parchi or parci: not predictable
```

## Articles

Articles come from an editable table of article groups. Each group has a name, spelling patterns, and the masculine and feminine definite singular, definite plural, and indefinite singular articles:

| Group | Starts with | Masc. definite singular | Masc. definite plural | Masc. indefinite singular | Fem. definite singular | Fem. definite plural | Fem. indefinite singular |
| --- | --- | --- | --- | --- | --- | --- | --- |
| lo | sC, z, gn, ps, pn, x, y, iV | lo | gli | uno | la | le | una |
| vowel | V | l’ | gli | un | l’ | le | un’ |
| consonant | C | il | i | un | la | le | una |

In a pattern, `V` stands for any letter in the vowel list and `C` for any letter in the consonant list; every other letter stands for itself, so `sC` is s + consonant and `iV` is i + vowel. Both lists are part of the morphology (`articleLetters`) and editable; by default `h`, `j`, `k`, `w`, `x`, and `y` are consonants. Groups are checked from top to bottom and the first group with a matching pattern wins, so `lo` must stay above `consonant` for `sC` to take effect. There is no catch-all group: a form that needs an article but matches no pattern is an error until a pattern or a noun exception covers it.

Singular and plural forms are grouped separately, which is how `amico` / `amici` gives `l’amico` / `gli amici`.

The table is read in two directions:

- **Which article does this word take?** A form's group plus gender, definiteness, and number gives exactly one article.
- **What does this typed article say?** Every row containing the article. `lo` is masculine singular definite; `l’` is singular definite of either gender, so an answer using it needs a gender marker. Articles ending in an apostrophe are treated as elided and split from the following word (`l’amica` → `l’` + `amica`).

### Exceptions

Where spelling and pronunciation disagree, a noun overrides a form's group:

```text
dio / dei with plural group "lo"   -> il dio, gli dei, un dio
chef with both groups "lo"          -> lo chef, gli chef, uno chef
```

Exceptions change a form's group only, never its gender or number. The Grammar page lists every noun that is irregular or has an exception.

## Number and article availability are independent

A noun can have singular and plural forms while enabling only `definiteSingular`. The structural checks only require an enabled article capability to have the form it needs: `definitePlural` requires a plural form; `definiteSingular` and `indefiniteSingular` require a singular form.

The profile is restricted to four combinations: all three, definite singular only, definite plural only, or none.

## Study preferences

The inventory stores `studyPreferences` next to the cards and morphology, so they sync with them:

```json
{
  "answerKeywords": { "masculine": "m", "feminine": "f", "singularOnly": "s", "pluralOnly": "p" },
  "fullDeclensionRules": ["-chio → -chi"],
  "fullDeclensionCards": [59]
}
```

- `answerKeywords` are the gender and singular-/plural-only markers typed in word mode. They are single lowercase tokens and all different.
- `fullDeclensionRules` are declension rules still being drilled.
- `fullDeclensionCards` are noun ids that always need both forms.

Neither list changes what a word is. References to deleted nouns or rules are dropped whenever the inventory is saved.

## Word mode

Word mode prompts in English and the answer is the noun with an article: `il libro`, `i libri`, `un libro`, or both numbers `il libro i libri`. Keywords can go anywhere in the answer.

- Each form must be one of the noun's forms, preceded by an article the noun takes for that number (per its article profile), or by no article when it takes none.
- **Both forms** are required when the declension is Irregular, when the plural is not predictable (above), when the noun's rule is in `fullDeclensionRules`, or when the noun is in `fullDeclensionCards`. One form is enough otherwise, singular or plural.
- **Singular-/plural-only marker** is required for a noun with only one form and wrong on a noun with both: `p i pantaloni`, `f s Venezia`.
- **Gender marker** is required when the typed articles don't settle the gender (`m l’albero`; `gli alberi` needs none) and when there is no article at all. It is not required when the prompt shows the gender. A marker that disagrees with the noun is wrong.

The live preview reads the answer without looking at the card (markers, articles, and nouns, plus whether an article still needs its noun), so it never reveals the answer. After checking, a wrong answer lists what was wrong.

## Article mode

Article mode is an endless drill over the nouns in scope that take at least one article. It prompts with the Italian form (the singular, or the plural of a plural-only noun, plus the plural of an irregular noun) and the answer is the articles the noun takes, in order: definite singular, definite plural, indefinite. Each article can be followed by its noun form, which must then be right:

```text
specchio   -> lo gli uno   or   lo specchio gli specchi uno specchio
nozze      -> le
dio / dei  -> il gli un
```

Words are drawn by class so that rare article patterns get practice. A class is a gender plus the exact articles taken. A class whose nouns all fall in one article group with several start patterns (masculine `lo / gli / uno`: `sC`, `z`, `gn`, `ps`, …) is split by pattern. Each draw picks a class uniformly, then a pattern within it, then a noun, avoiding an immediate repeat.

## Nouns taking both genders

A noun that takes both genders is two cards (`il collega` / `la collega`, `il cantante` / `la cantante`). When two nouns share an English prompt, or an Italian headword in Italian prompts and article mode, but differ in gender, the prompt shows the gender, e.g. `colleague (m)`.

## Names as references

```text
noun card          -> rule name, article-group names (exceptions)
study preferences  -> declension rule names, noun card ids
```

The editor cascades renames of rules and article groups, and rejects duplicates. A rule used by a noun and an article group used by a noun exception cannot be deleted.

## Inventory state

```json
{
  "cards": [],
  "nounMorphology": {
    "declensionRules": [],
    "articleLetters": { "vowels": [], "consonants": [] },
    "articleGroups": []
  },
  "studyPreferences": {
    "answerKeywords": { "masculine": "m", "feminine": "f", "singularOnly": "s", "pluralOnly": "p" },
    "fullDeclensionRules": [],
    "fullDeclensionCards": []
  }
}
```

The schema is strict. `scripts/migrate-study-modes.mjs` converts inventories from the earlier syntax-rule schema (with `inferenceSets` and `syntaxRules`): it drops both, gives the `-a` rules their genders, and turns the rules the shorthand inference set left out into `fullDeclensionRules`.
