import { useState } from "react";
import type { Flashcard } from "../cards/types";
import { typeLabels } from "../cardTypes";
import { partLabels, type InventoryConflict, type InventoryConflictError, type InventoryPart, type MergeChoices, type Side } from "../storage/merge";
import type { InventoryState } from "../storage/types";
import { italianHeadword } from "./CardAnswer";
import { Sheet } from "./Sheet";

/** Where the other version came from, as the screen names it. */
export type ConflictSource = "window" | "device";

function headword(card: Flashcard, state: InventoryState) {
  try {
    return italianHeadword(card, state.nounMorphology, state.adjectiveMorphology);
  } catch {
    return card.english;
  }
}

type Field = { label: string; value: string };

function cardFields(card: Flashcard, state: InventoryState): Field[] {
  return [
    { label: "Italian", value: headword(card, state) },
    { label: "English", value: card.english },
    { label: "Set", value: card.setName ?? "—" },
    { label: "Tags", value: card.tags.length ? card.tags.join(", ") : "—" },
    { label: "Details", value: JSON.stringify(card.details) },
  ];
}

/** A word as each side has it, with the fields that differ marked. */
function CardSide({ card, other, state, otherState }: { card: Flashcard | null; other: Flashcard | null; state: InventoryState; otherState: InventoryState }) {
  if (!card) return <p className="conflict-deleted">Deleted</p>;
  const otherFields = other ? cardFields(other, otherState) : null;
  return <dl className="conflict-fields">
    {cardFields(card, state).map((field, index) => {
      // Details only show when they're what differs, since they aren't readable.
      const differs = Boolean(otherFields && otherFields[index]!.value !== field.value);
      if (field.label === "Details") return differs ? <div key={field.label} className="changed"><dt>Forms</dt><dd>changed</dd></div> : null;
      return <div key={field.label} className={differs ? "changed" : undefined}><dt>{field.label}</dt><dd>{field.value}</dd></div>;
    })}
  </dl>;
}

function named(items: unknown): Map<string, string> {
  return new Map(Array.isArray(items) ? items.map((item: { name?: string }, index) => [item?.name ?? String(index), JSON.stringify(item)]) : []);
}

/** What differs between the two versions of a part, in a line each. */
function partDifferences(part: InventoryPart, mine: InventoryState, theirs: InventoryState) {
  const lines: string[] = [];
  const compare = (label: string, mineItems: unknown, theirItems: unknown) => {
    const here = named(mineItems);
    const there = named(theirItems);
    for (const [name, value] of here) {
      if (!there.has(name)) lines.push(`${label} “${name}” is only in this one`);
      else if (there.get(name) !== value) lines.push(`${label} “${name}” differs`);
    }
    for (const name of there.keys()) if (!here.has(name)) lines.push(`${label} “${name}” is only in the other`);
  };
  if (part === "nounMorphology") {
    compare("Rule", mine.nounMorphology.declensionRules, theirs.nounMorphology.declensionRules);
    compare("Article group", mine.nounMorphology.articleGroups, theirs.nounMorphology.articleGroups);
    if (JSON.stringify(mine.nounMorphology.articleLetters) !== JSON.stringify(theirs.nounMorphology.articleLetters)) lines.push("The vowel and consonant lists differ");
  } else if (part === "adjectiveMorphology") {
    compare("Rule", mine.adjectiveMorphology.declensionRules, theirs.adjectiveMorphology.declensionRules);
  } else {
    const labels: Record<string, string> = {
      answerKeywords: "Answer keywords",
      nounFullDeclensionRules: "Noun rules asked in full",
      adjectiveFullDeclensionRules: "Adjective rules asked in full",
      fullDeclensionCards: "Words asked in full",
    };
    for (const [key, label] of Object.entries(labels)) {
      if (JSON.stringify((mine.studyPreferences as Record<string, unknown>)[key]) !== JSON.stringify((theirs.studyPreferences as Record<string, unknown>)[key])) lines.push(`${label} differ`);
    }
  }
  return lines;
}

function conflictTitle(conflict: InventoryConflict, error: InventoryConflictError) {
  if (conflict.kind === "part") return partLabels[conflict.part];
  const card = conflict.mine ?? conflict.theirs!;
  const state = conflict.mine ? error.mine : error.theirs;
  return `“${headword(card, state)}” · ${typeLabels[card.type].toLowerCase()}`;
}

function conflictReason(conflict: InventoryConflict, otherPlace: string) {
  if (conflict.kind === "duplicate") return `Added here and ${otherPlace}. Keep one.`;
  if (conflict.kind === "card") {
    if (!conflict.mine) return `Deleted here, changed ${otherPlace}.`;
    if (!conflict.theirs) return `Changed here, deleted ${otherPlace}.`;
    return `Changed differently here and ${otherPlace}.`;
  }
  return conflict.changedInBoth ? `Changed differently here and ${otherPlace}.` : `Some words no longer fit one version of these rules.`;
}

function SideBody({ conflict, side, error }: { conflict: InventoryConflict; side: Side; error: InventoryConflictError }) {
  const [state, otherState] = side === "mine" ? [error.mine, error.theirs] : [error.theirs, error.mine];
  if (conflict.kind !== "part") {
    const other = side === "mine" ? conflict.theirs : conflict.mine;
    return <CardSide card={conflict[side]} other={other} state={state} otherState={otherState} />;
  }
  const removes = conflict.removes[side];
  return <>
    {removes.length > 0 && <p className="conflict-removes">Removes {removes.map((card) => `“${headword(card, error.mine.cards.includes(card) ? error.mine : error.theirs)}”`).join(", ")}, which {removes.length === 1 ? "doesn’t" : "don’t"} fit these rules.</p>}
  </>;
}

/**
 * Lists what changed both here and elsewhere, side by side, and asks which version to keep of
 * each. Applying merges again with those choices.
 */
export function ConflictSheet({ error, source, onResolve, onClose }: {
  error: InventoryConflictError;
  source: ConflictSource;
  onResolve: (choices: MergeChoices) => Promise<void>;
  onClose: () => void;
}) {
  const [choices, setChoices] = useState<MergeChoices>({});
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const otherPlace = source === "window" ? "in another window" : "on another device";
  const otherName = source === "window" ? "Other window" : "Other device";
  const complete = error.conflicts.every((conflict) => choices[conflict.key]);

  const chooseAll = (side: Side) => setChoices(Object.fromEntries(error.conflicts.map((conflict) => [conflict.key, side])));

  async function apply() {
    setBusy(true);
    setFailure("");
    try {
      await onResolve(choices);
    } catch (caught) {
      setFailure(caught instanceof Error ? caught.message : "That couldn't be applied.");
    } finally {
      setBusy(false);
    }
  }

  return <Sheet
    title={`Changed ${otherPlace} too`}
    subtitle={`${error.conflicts.length} ${error.conflicts.length === 1 ? "change clashes" : "changes clash"}. Pick which version to keep of each; everything else is already merged.`}
    closeDisabled={busy}
    onClose={onClose}
  >
    <div className="conflict-sheet">
      <div className="button-row start">
        <button type="button" className="neutral-button small" onClick={() => chooseAll("mine")} disabled={busy}>Keep all from here</button>
        <button type="button" className="neutral-button small" onClick={() => chooseAll("theirs")} disabled={busy}>Keep all from the other {source}</button>
      </div>
      {error.conflicts.map((conflict) => <section key={conflict.key} className="conflict-row">
        <header>
          <h3>{conflictTitle(conflict, error)}</h3>
          <p>{conflictReason(conflict, otherPlace)}</p>
        </header>
        {conflict.kind === "part" && <ul className="conflict-differences">{partDifferences(conflict.part, error.mine, error.theirs).map((line) => <li key={line}>{line}</li>)}</ul>}
        <div className="conflict-sides">
          {(["mine", "theirs"] as const).map((side) => <label key={side} className={`conflict-side${choices[conflict.key] === side ? " selected" : ""}`}>
            <input type="radio" name={conflict.key} checked={choices[conflict.key] === side} onChange={() => setChoices((current) => ({ ...current, [conflict.key]: side }))} disabled={busy} />
            <strong>{side === "mine" ? "This one" : otherName}</strong>
            <SideBody conflict={conflict} side={side} error={error} />
          </label>)}
        </div>
      </section>)}
      {failure && <p className="form-error" role="alert">{failure}</p>}
      <footer className="sheet-actions">
        <button type="button" className="text-button" onClick={onClose} disabled={busy}>{source === "window" ? "Discard my change" : "Later"}</button>
        <button type="button" className="primary-button" onClick={() => void apply()} disabled={busy || !complete}>{busy ? "Applying…" : "Apply"}</button>
      </footer>
    </div>
  </Sheet>;
}
