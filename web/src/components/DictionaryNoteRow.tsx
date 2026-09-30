import type { DictionaryNote, DictionaryRows } from "../lexicon/useDictionary";
import { missingMessage, suggestionHeadword } from "../lexicon/useDictionary";
import { describeSuggestion, shortSuggestionLabel } from "../lexicon/suggestions";

/** The dictionary note for one row of a table using useDictionaryRows. */
export function RowDictionaryNote({ dictionary, rowId, english, columns }: { dictionary: DictionaryRows; rowId: string; english: string; columns: number }) {
  return <DictionaryNoteRow
    note={dictionary.notes[rowId]}
    columns={columns}
    english={english}
    onChoose={(index) => dictionary.choose(rowId, index)}
    onEnglish={(value) => dictionary.setEnglish(rowId, value)}
    onDismiss={() => dictionary.dismiss(rowId)}
  />;
}

/** A line under a row saying what the dictionary filled in, with its other readings and meanings to switch to. */
export function DictionaryNoteRow({ note, columns, english, onChoose, onEnglish, onDismiss }: {
  note: DictionaryNote | undefined;
  columns: number;
  english: string;
  onChoose: (index: number) => void;
  onEnglish: (english: string) => void;
  onDismiss: () => void;
}) {
  if (!note || note.state === "loading") return null;
  return <tr className="dictionary-note-row"><td colSpan={columns}><div className={`dictionary-note ${note.state}`}>
    {note.state === "missing" && <span>{missingMessage(note)}</span>}
    {note.state === "failed" && <span>{note.message}</span>}
    {note.state === "found" && <FoundNote note={note} english={english} onChoose={onChoose} onEnglish={onEnglish} />}
    <button type="button" className="dictionary-dismiss" tabIndex={-1} onClick={onDismiss} aria-label="Dismiss" title="Dismiss">×</button>
  </div></td></tr>;
}

function FoundNote({ note, english, onChoose, onEnglish }: {
  note: Extract<DictionaryNote, { state: "found" }>;
  english: string;
  onChoose: (index: number) => void;
  onEnglish: (english: string) => void;
}) {
  const chosen = note.suggestions[note.chosen]!;
  const headword = chosen.reading.headword.word;
  const others = note.suggestions.map((suggestion, index) => ({ suggestion, index })).filter(({ index }) => index !== note.chosen);
  return <>
    <span className="dictionary-summary">
      <a href={`https://en.wiktionary.org/wiki/${encodeURIComponent(headword)}#Italian`} target="_blank" rel="noreferrer" tabIndex={-1}>Wiktionary</a>
      {": "}{describeSuggestion(chosen)}
    </span>
    {!note.applied && <span className="dictionary-review">
      Not filled in, since you’ve typed other fields.{" "}
      <button type="button" className="chip" tabIndex={-1} onClick={() => onChoose(note.chosen)}>Fill in {suggestionHeadword(chosen)}</button>
    </span>}
    {note.applied && chosen.review && <span className="dictionary-review">{chosen.review}</span>}
    {note.applied && chosen.glosses.length > 1 && <span className="dictionary-choices">
      <span>Meanings:</span>
      {chosen.glosses.map((gloss) => <button type="button" key={gloss} className={`chip${gloss === english ? " selected" : ""}`} tabIndex={-1} onClick={() => onEnglish(gloss)}>{gloss}</button>)}
    </span>}
    {others.length > 0 && <span className="dictionary-choices">
      <span>Other readings:</span>
      {others.map(({ suggestion, index }) => <button type="button" key={index} className="chip" tabIndex={-1} onClick={() => onChoose(index)}>{shortSuggestionLabel(suggestion)}</button>)}
    </span>}
  </>;
}
