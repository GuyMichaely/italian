import { type FormEvent, useState } from "react";
import type { AdjectiveCard, AdverbCard, Flashcard, NounCard, VerbCard } from "../cards/types";
import { irregularDeclensionName, resolvedNounForms, type NounMorphology } from "../cards/nounMorphology";
import { nounFormPhrases } from "../cards/nounDraft";
import type { StudyPreferences } from "../study/preferences";
import { AnswerParsePreview, analyzeAnswerSyntax } from "./AnswerParsePreview";
import { checkTypedAnswer, type StudyItem } from "../study/logic";

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

/** What was wrong with a typed noun answer, listed under the answer after checking. */
export function AnswerProblems({ problems }: { problems: string[] }) {
  if (!problems.length) return null;
  return <ul className="answer-problems">{problems.map((problem) => <li key={problem}>{problem}</li>)}</ul>;
}

export function ItalianVerificationForm({ item, preferences, morphology, onResult }: { item: StudyItem; preferences: StudyPreferences; morphology: NounMorphology; onResult: (correct: boolean, answer: string, problems: string[]) => void }) {
  const { card } = item;
  const [answer, setAnswer] = useState("");
  const [syntaxRejected, setSyntaxRejected] = useState(false);
  const syntax = analyzeAnswerSyntax(item, answer, preferences.answerKeywords, morphology);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!syntax.checkable) {
      setSyntaxRejected(true);
      return;
    }
    setSyntaxRejected(false);
    const check = checkTypedAnswer(item, answer, morphology, preferences);
    onResult(check.correct, answer, check.problems);
  }

  const placeholder = item.mode === "article" ? "il i un"
    : item.mode === "wordWithArticles" ? "il libro i un"
        : card.type === "noun" ? "il libro"
          : card.type === "verb" ? "parlare parlo parli parla …"
            : card.type === "adjective" ? "bello" : "molto";

  return (
    <form className={`answer-form${syntaxRejected ? " syntax-rejected" : ""}`} onSubmit={submit}>
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
      <AnswerParsePreview item={item} value={answer} keywords={preferences.answerKeywords} morphology={morphology} />
      {syntaxRejected && <p className="form-error" role="alert">Finish the answer first: Parola can only check a complete answer.</p>}
      <button className="primary-button check-answer-button" type="submit" disabled={!answer.trim()}>Check answer <kbd>Enter</kbd></button>
    </form>
  );
}
