# Noun morphology and answer syntax

Parola keeps a noun's lexical definition separate from the study syntax used to recognize typed answers.

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

Rule names are unique and serve as references. `Irregular` and names starting with `:` are reserved. Renaming a rule in the grammar editor updates inference-set references and noun-card references when saved.

## Articles

Articles come from an editable table of article groups. Each group has a name, spelling patterns, and the three masculine and three feminine articles:

| Group | Starts with | Masc. the (sg.) | Masc. the (pl.) | Masc. a | Fem. the (sg.) | Fem. the (pl.) | Fem. a |
| --- | --- | --- | --- | --- | --- | --- | --- |
| lo | sC, z, gn, ps, pn, x, y, iV | lo | gli | uno | la | le | una |
| vowel | V | l’ | gli | un | l’ | le | un’ |
| consonant | everything else | il | i | un | la | le | una |

A form belongs to the first group with a matching pattern; a form matching none belongs to the last group. Patterns are letters plus `C` (any consonant) and `V` (any vowel), so `sC` is s + consonant and `iV` is i + vowel. Singular and plural forms are grouped separately, which is how `amico` / `amici` gives `l’amico` / `gli amici`.

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

## Inference sets

An inference set is a named learning-policy group of declension-rule names. A syntax can infer only rules in its selected inference set. A noun can use a rule that is not currently available to a shorthand syntax, in which case only a syntax whose set includes that rule can match it.

Irregular nouns belong to every inference set implicitly, but an irregular form cannot be inferred from another form. A reading of an answer as an irregular noun is therefore offered only when the answer supplies every form: both numbers, or one number together with a singular-only or plural-only marker.

## Syntax rules

A syntax rule stores:

- `name`;
- optional or required markers;
- ordered input fields;
- `inferenceSet`;
- `excludedArticleGroups`, article groups whose nouns this syntax does not accept.

### Article-bearing syntax

Each article field declares its definiteness and number, and the typed article must be one the table allows for that combination. The field also asserts the matching article capability:

```text
<definite singular article> <singular noun>     requires articleProfile.definiteSingular
<definite plural article> <plural noun>         requires articleProfile.definitePlural
<indefinite singular article> <singular noun>   requires articleProfile.indefiniteSingular
```

This does not require exact profile equality: `il libro` matches a noun with all three capabilities or with definite singular only.

### Articleless syntax

A syntax with no article field asserts that all three article capabilities are false. It must require an explicit gender marker and a singular-only or plural-only marker, for example `f s Venezia`.

### Article-group exclusions

The default shorthand syntaxes exclude the `lo` group, so `lo specchio` and `lo zaino` must be answered with the full declension (`lo specchio gli specchi uno`). This replaces the former hardcoded "lo nouns need the full declension" policy and can be edited per syntax. Exclusions are checked against the card's own group (including exceptions) when grading; the preview also uses the typed word's spelling to steer toward a non-excluded syntax.

## Verification

For each typed noun answer Parola:

1. Tries every syntax against the typed tokens and parses gender and singular/plural-only markers.
2. Reads each typed article through the article table: it must fit its field's definiteness and number, and together the articles (or a marker) must settle the gender.
3. For each rule in the syntax's inference set, recovers a base from the typed noun form or forms. Several noun fields must agree on one base. It also adds an `Irregular` reading when the answer supplies every form.
4. Only then compares these readings with the prompted card. A reading matches when:
   - its rule and base (or, for irregular nouns, every form) equal the card's;
   - its gender equals the card's;
   - the card's article profile allows the syntax's article fields;
   - the card's article group is not excluded by the syntax;
   - each typed article equals the article the table gives for the card's form group (with exceptions), gender, definiteness, and number.

Steps 1–3 never consult the card, so the live preview can show the selected syntax, the fields read so far, article-derived gender, missing fields, and possible declensions without revealing the answer.

The result rules are:

- Any matching reading means correct.
- If nothing matches but at least one syntax is complete, the answer is wrong.
- If no syntax is complete, the input is invalid or incomplete and cannot be submitted.

## Examples

`il libro` for `-o → -i` / `libr` / masculine: `il` fits the definite singular field and says masculine; `-o → -i` recovers `libr`; the card's `libro` is in the consonant group, which gives `il`. Correct. `lo libro` reads the same declension but the expected article is `il`, so it is wrong; the preview still lists the possible declensions.

`gli dei` for the irregular `dio` / `dei`: the preview lists every rule whose plural ending fits `dei`, but the shorthand does not supply the singular, so no irregular reading is offered and the answer is wrong. `il dio gli dei un` gives an irregular reading whose forms match, and the plural exception makes `gli` the expected plural article. Correct.

`f s Venezia` for an articleless, singular-only feminine card is correct; `f Venezia` is incomplete; `la Venezia` is complete but wrong because the card allows no articles.

## Names as references

```text
noun card          -> rule name, article-group names (exceptions)
inference set      -> declension rule names
syntax rule        -> inference-set name, article-group names (exclusions)
```

The editor cascades renames of rules, inference sets, and article groups, and rejects duplicates. An article group used by a noun exception cannot be deleted.

## Inventory state

```json
{
  "cards": [],
  "nounMorphology": {
    "declensionRules": [],
    "inferenceSets": [],
    "syntaxRules": [],
    "articleGroups": []
  }
}
```

The schema is strict. The earlier noun shape `{ rule, base, gender, articleProfile }` is retired; `scripts/migrate-noun-declensions.mjs` converts inventories that use it, adding the default article groups and the `lo` shorthand exclusions.
