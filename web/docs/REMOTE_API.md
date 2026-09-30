# Italian synchronization API

The app can synchronize its inventory through any HTTP service that implements the snapshot contract below. The service may be hosted anywhere and may use any persistence mechanism.

If the user configures a base endpoint such as:

```text
https://api.example.com
```

The app uses:

```text
https://api.example.com/state
```

## Inventory snapshot

A synchronization snapshot contains the complete inventory plus its last-change timestamp:

```json
{
  "cards": [
    {
      "id": 123,
      "type": "noun",
      "english": "umbrella",
      "setName": null,
      "tags": [],
      "details": {
        "declension": { "kind": "rule", "rule": "-o → -i", "base": "ombrell" },
        "gender": "masculine",
        "genderDiffersWithPlurality": false,
        "articleProfile": {
          "definiteSingular": true,
          "definitePlural": true,
          "indefiniteSingular": true
        },
        "articleGroups": { "singular": null, "plural": null }
      }
    }
  ],
  "nounMorphology": {
    "declensionRules": [
      {
        "name": "-o → -i",
        "gender": null,
        "forms": {
          "singular": { "suffix": "o" },
          "plural": { "suffix": "i" }
        }
      }
    ],
    "articleLetters": { "vowels": ["a", "e", "i", "o", "u"], "consonants": ["b", "c", "d", "…"] },
    "articleGroups": [
      {
        "name": "consonant",
        "startsWith": ["C"],
        "masculine": { "definiteSingular": "il", "definitePlural": "i", "indefiniteSingular": "un" },
        "feminine": { "definiteSingular": "la", "definitePlural": "le", "indefiniteSingular": "una" }
      }
    ]
  },
  "adjectiveMorphology": {
    "declensionRules": [
      {
        "name": "-o/-a/-i/-e",
        "endings": { "masculineSingular": "o", "feminineSingular": "a", "masculinePlural": "i", "femininePlural": "e" }
      }
    ]
  },
  "studyPreferences": {
    "answerKeywords": { "masculine": "m", "feminine": "f", "singularOnly": "s", "pluralOnly": "p" },
    "nounFullDeclensionRules": [],
    "adjectiveFullDeclensionRules": [],
    "fullDeclensionCards": [123]
  },
  "updatedAt": "2026-08-20T03:00:00.000Z"
}
```

Noun and adjective cards do not contain a top-level `italian` property. Their Italian surface forms are generated from `details.declension` and the accompanying noun or adjective morphology. An adjective's `details` is exactly `{ "declension": … }`: `{ "kind": "rule", "rule", "base" }` naming an adjective rule, or `{ "kind": "irregular" }` with all four forms (see `docs/ADJECTIVE_DECLENSIONS.md`).

Noun `articleProfile` has three named Boolean properties: `definiteSingular`, `definitePlural`, and `indefiniteSingular`. The accepted combinations are all three `true`, definite singular only, definite plural only, or all three `false`.

Declension-rule names and article-group names are references and must be unique within their collections. Noun number availability is derived from the referenced rule's `forms`: both entries means both numbers; only one entry means singular-only or plural-only. Article availability is independent from that number availability. A rule's `gender` is `"masculine"`, `"feminine"`, or `null`; a noun cannot use a rule limited to the other gender.

`studyPreferences` holds the answer keywords (four distinct single tokens), the noun and adjective rule names being drilled, and the noun and adjective card ids that always need every form. Every name and id must exist; deleting a card through `DELETE /cards` removes its id.

`updatedAt` must be a valid timestamp. The app uses it for snapshot-level last-write-wins synchronization. It does not merge individual cards or morphology definitions.

## Read state

```text
GET /state
```

Return the current complete snapshot as JSON.

## Write state

```text
PUT /state
Content-Type: application/json
```

The request body is the complete snapshot.

If the incoming `updatedAt` is newer than the current server state, persist and return it.

If the server state is newer, return HTTP `409` with the current server snapshot:

```json
{
  "error": "Remote inventory is newer.",
  "state": {
    "cards": [ ... ],
    "nounMorphology": { ... },
    "studyPreferences": { ... },
    "updatedAt": "2026-08-20T03:05:00.000Z"
  }
}
```

If timestamps are equal but snapshots differ, also return `409` rather than arbitrarily overwriting one copy.

The service should reject a noun card whose `details.declension.rule` does not match a declension-rule name in the accompanying `nounMorphology.declensionRules` collection. It should also reject an article capability that requires a noun form the referenced rule does not provide.

The canonical schema is strict. Stored noun `italian`, retired noun `articleMode`, string article-profile encodings, and the retired `inferenceSets`/`syntaxRules` morphology collections are not accepted.

## Errors

Use a non-2xx HTTP status. If the JSON response contains an `error` string, the app can surface that detail.

## CORS

Because the app is a static browser application, a synchronization service on another origin must permit requests from the origin hosting it.

At minimum it needs to support `GET`, `PUT`, and `OPTIONS`, plus the `Content-Type: application/json` request header.

## Authentication

The app does not prescribe an authentication mechanism. Avoid embedding permanent secret API keys in the static frontend because anyone who can load the site can inspect them.
