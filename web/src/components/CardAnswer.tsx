import { type FormEvent, useState } from "react";
import type { AdjectiveCard, AdverbCard, Flashcard, NounCard, VerbCard } from "../cards/types";
import { irregularDeclensionName, resolvedNounForms, type NounMorphology } from "../cards/nounMorphology";
import { nounFormPhrases } from "../cards/nounDraft";
import type { AnswerKeywords } from "../study/setup";
import { AnswerParsePreview, analyzeAnswerSyntax } from "./AnswerParsePreview";
import { verifyPowerAnswer } from "../study/logic";
import { evaluateNounAnswer, type NounSyntaxCandidate } from "../study/nounSyntax";
import { Icon } from "./Icons";

/** The single Italian headword shown for a card in prompts, lists, and answers. */
export function italianHeadword(card: Flashcard, morphology: NounMorphology) {
  if (card.type !== "noun") return card.italian;
  try {
    const forms = resolvedNounForms(card, morphology);
    return forms.singular || forms.plural;
  } catch {
    const declension = card.details.declension;
    return declension.kind === "rule" ? declension.base : declension.singular || declension.plural;
  }
}

function NounAnswer({ card, morphology }: { card: NounCard; morphology: NounMorphology }) {
  const forms = resolvedNounForms(card, morphology);
  const rule = forms.rule ?? irregularDeclensionName;
  const phrases = nounFormPhrases(forms);
  return (
    <div className="answer-block">
      <p className="answer-meta">{forms.gender} · {rule}</p>
      <p className="italian-word">{forms.singular || forms.plural}</p>
      {phrases.length
        ? <dl className="form-list">{phrases.map((phrase) => <div key={phrase.label}><dt>{phrase.label}</dt><dd lang="it">{phrase.text}</dd></div>)}</dl>
        : <p className="answer-note">No articles{forms.singular && forms.plural ? ` · plural ${forms.plural}` : ""}</p>}
    </div>
  );
}

function VerbAnswer({ card }: { card: VerbCard }) {
  const d = card.details;
  return (
    <div className="answer-block">
      <p className="answer-meta">present tense</p>
      <p className="italian-word">{card.italian}</p>
      <dl className="conjugation-grid">
        {[["io", d.io], ["tu", d.tu], ["lui / lei", d.luiLei], ["noi", d.noi], ["voi", d.voi], ["loro", d.loro]].map(([label, value]) => (
          <div key={label}><dt>{label}</dt><dd lang="it">{value}</dd></div>
        ))}
      </dl>
      <p className="answer-note">{d.auxiliary} + <span lang="it">{d.participle}</span></p>
    </div>
  );
}

function AdjectiveAnswer({ card }: { card: AdjectiveCard }) {
  const d = card.details;
  return (
    <div className="answer-block">
      <p className="answer-meta">adjective</p>
      <p className="italian-word">{card.italian}</p>
      <dl className="conjugation-grid two-columns">
        <div><dt>masc. sg.</dt><dd lang="it">{d.masculineSingular}</dd></div>
        <div><dt>fem. sg.</dt><dd lang="it">{d.feminineSingular}</dd></div>
        <div><dt>masc. pl.</dt><dd lang="it">{d.masculinePlural}</dd></div>
        <div><dt>fem. pl.</dt><dd lang="it">{d.femininePlural}</dd></div>
      </dl>
    </div>
  );
}

function AdverbAnswer({ card }: { card: AdverbCard }) {
  return <div className="answer-block"><p className="answer-meta">adverb · invariant</p><p className="italian-word">{card.italian}</p></div>;
}

export function CardAnswer({ card, morphology }: { card: Flashcard; morphology: NounMorphology }) {
  if (card.type === "noun") return <NounAnswer card={card} morphology={morphology} />;
  if (card.type === "verb") return <VerbAnswer card={card} />;
  if (card.type === "adverb") return <AdverbAnswer card={card} />;
  return <AdjectiveAnswer card={card} />;
}

function candidateDescription(candidate: NounSyntaxCandidate) {
  const definition = candidate.definition;
  const shape = definition.kind === "rule"
    ? `base ${definition.base || "∅"}`
    : [definition.singular, definition.plural].filter((form): form is string => form !== null).join(" / ");
  return `${shape} · ${definition.gender} · ${candidate.syntaxName}`;
}

export function NounAnswerDiagnostic({ card, answer, keywords, morphology }: { card: Flashcard; answer: string; keywords: AnswerKeywords; morphology: NounMorphology }) {
  if (card.type !== "noun") return null;
  const evaluation = evaluateNounAnswer(card, answer, morphology, keywords);
  if (evaluation.result === "correct") return null;

  const uniqueCandidates = Array.from(new Map(evaluation.candidates.map((candidate) => {
    return [candidateDescription(candidate), candidate] as const;
  })).values());

  return <details className="diagnostic">
    <summary>How Parola read your answer</summary>
    {uniqueCandidates.length
      ? <ul>{uniqueCandidates.map((candidate) => <li key={candidateDescription(candidate)}>
          <strong>{candidate.declensionRule}</strong>
          {` · ${candidateDescription(candidate)}`}
        </li>)}</ul>
      : <p>No allowed declension rule recognized the completed noun syntax.</p>}
  </details>;
}

function AnswerFormatHelp({ keywords }: { keywords: AnswerKeywords }) {
  return <div className="format-help">
    <p><strong>Noun</strong> <code>il libro</code> · full form <code>lo specchio gli specchi uno</code>. Nouns taking <code>lo</code> need the full form. Articleless: <code>{keywords.feminine} {keywords.singularOnly} Venezia</code>.</p>
    <p><strong>Verb</strong> <code>infinitive io tu lui/lei noi voi loro auxiliary participle</code></p>
    <p><strong>Adjective</strong> <code>bello</code> or <code>bello bella belli belle</code></p>
    <p><strong>Adverb</strong> <code>molto</code></p>
    <p>Separate fields with spaces; wrap a multi-word field in "double quotes". Gender markers: <code>{keywords.masculine}</code> / <code>{keywords.feminine}</code>.</p>
  </div>;
}

export function ItalianVerificationForm({ card, keywords, morphology, onResult }: { card: Flashcard; keywords: AnswerKeywords; morphology: NounMorphology; onResult: (correct: boolean, answer: string) => void }) {
  const [answer, setAnswer] = useState("");
  const [syntaxRejected, setSyntaxRejected] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const syntax = analyzeAnswerSyntax(card, answer, keywords, morphology);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!syntax.checkable) {
      setSyntaxRejected(true);
      return;
    }
    setSyntaxRejected(false);
    onResult(verifyPowerAnswer(card, answer, keywords, morphology), answer);
  }

  const placeholder = card.type === "noun" ? "il libro"
    : card.type === "verb" ? "parlare parlo parli parla …"
      : card.type === "adjective" ? "bello" : "molto";

  return (
    <form className={`answer-form${syntaxRejected ? " syntax-rejected" : ""}`} onSubmit={submit}>
      <div className="answer-input-row">
        <input
          className="answer-input"
          name="answer"
          aria-label="Answer"
          lang="it"
          value={answer}
          onChange={(event) => { setAnswer(event.target.value); setSyntaxRejected(false); }}
          aria-invalid={syntaxRejected || syntax.status === "invalid"}
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          autoFocus
          placeholder={placeholder}
          enterKeyHint="done"
        />
        <button type="button" className={`icon-button help-toggle${helpOpen ? " active" : ""}`} aria-expanded={helpOpen} aria-label="Answer format" title="Answer format" onClick={() => setHelpOpen((open) => !open)}><Icon name="help" /></button>
      </div>
      {helpOpen && <AnswerFormatHelp keywords={keywords} />}
      <AnswerParsePreview card={card} value={answer} keywords={keywords} morphology={morphology} />
      {syntaxRejected && <p className="form-error" role="alert">Finish the answer first: Parola can only check a complete answer.</p>}
      <button className="primary-button check-answer-button" type="submit" disabled={!answer.trim()}>Check answer <kbd>Enter</kbd></button>
    </form>
  );
}
