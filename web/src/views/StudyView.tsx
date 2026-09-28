import { useState } from "react";
import type { Flashcard } from "../cards/types";
import type { NounMorphology } from "../cards/nounMorphology";
import { typeLabels } from "../cardTypes";
import { AnswerProblems, CardAnswer, ItalianVerificationForm, italianHeadword } from "../components/CardAnswer";
import { Icon } from "../components/Icons";
import type { StudyItem } from "../study/logic";
import type { StudyPreferences } from "../study/preferences";
import { articlePromptForms, genderAbbreviations } from "../study/prompts";
import type { MistakeReviewSet } from "../study/reviews";
import {
  scopeKeyLabel,
  studyItemCount,
  type PromptMode,
  type ScopeMode,
  type StudyMode,
  type StudySetup,
} from "../study/setup";

export type StudyScopeOption = { key: string; label: string; kind: "type" | "set" | "tag" };
export type SessionCounts = { right: number; wrong: number; skipped: number };

const promptModeLabels: Record<PromptMode, string> = {
  english: "English → Italian",
  italian: "Italian → English",
  both: "Both directions",
};

function setupSummary(setup: StudySetup) {
  const labels = setup.selectedScopes.map((key) => scopeKeyLabel(key, typeLabels));
  const scope = setup.scopeMode === "all" || !labels.length
    ? setup.scopeMode === "only" ? "Nothing selected" : "All words"
    : `${setup.scopeMode === "only" ? "" : "All except "}${labels.join(", ")}`;
  if (setup.studyMode === "articles") return [scope, "Articles", setup.typeToVerify ? "Typing" : "Flip cards"];
  const prompt = setup.promptMode === "both" && setup.oneDirectionPerWord ? "Mixed directions" : promptModeLabels[setup.promptMode];
  const answer = setup.promptMode === "italian" || !setup.typeToVerify ? "Flip cards" : setup.promptMode === "both" ? "Typing (EN prompts)" : "Typing";
  return [scope, prompt, answer];
}

type Option<T extends string> = { value: T; label: string; short?: string; description?: string };

function OptionList<T extends string>({ value, options, onChange, label }: { value: T; options: Option<T>[]; onChange: (value: T) => void; label: string }) {
  return <div className="option-list" role="radiogroup" aria-label={label}>
    {options.map((option) => <button type="button" role="radio" aria-checked={value === option.value} key={option.value} className={value === option.value ? "active" : ""} onClick={() => onChange(option.value)}>
      <span className="option-radio" aria-hidden="true" />
      <span className="option-text"><span className="label-long">{option.label}</span><span className="label-short" aria-hidden="true">{option.short ?? option.label}</span>{option.description && <small>{option.description}</small>}</span>
    </button>)}
  </div>;
}

function sessionShape(setup: StudySetup) {
  const { typeToVerify: _answerMode, ...shape } = setup;
  return JSON.stringify(shape);
}

function StudySetupPanel({
  cards,
  morphology,
  setup,
  options,
  inProgress,
  onApply,
  onAnswerMode,
  onClose,
}: {
  cards: Flashcard[];
  morphology: NounMorphology;
  setup: StudySetup;
  options: StudyScopeOption[];
  inProgress: boolean;
  onApply: (setup: StudySetup) => void;
  onAnswerMode: (typeToVerify: boolean) => void;
  onClose: () => void;
}) {
  // Mid-session changes are staged so the current session is never reset silently.
  const [staged, setStaged] = useState<StudySetup | null>(null);
  const shown = staged ? { ...staged, typeToVerify: setup.typeToVerify } : setup;
  const count = studyItemCount(cards, shown, morphology);
  const articles = shown.studyMode === "articles";
  const groups = (["type", "set", "tag"] as const).map((kind) => ({ kind, options: options.filter((option) => option.kind === kind) })).filter((group) => group.options.length);
  const groupLabels = { type: "Parts of speech", set: "Sets", tag: "Tags" };

  function change(patch: Partial<StudySetup>) {
    const next = { ...shown, ...patch };
    if (sessionShape(next) === sessionShape(setup)) setStaged(null);
    else if (inProgress) setStaged(next);
    else {
      setStaged(null);
      onApply(next);
    }
  }

  function toggleScope(key: string) {
    change({ selectedScopes: shown.selectedScopes.includes(key) ? shown.selectedScopes.filter((item) => item !== key) : [...shown.selectedScopes, key] });
  }

  return <section className="setup-panel" aria-label="Study setup">
    <header className="setup-header">
      <h2>Session</h2>
      <span className="setup-count"><strong>{count}</strong> {articles ? count === 1 ? "noun" : "nouns" : count === 1 ? "card" : "cards"}</span>
      <button type="button" className="text-button small narrow-only" onClick={onClose}>Done</button>
    </header>

    <div className="setup-group">
      <h3>Mode</h3>
      <OptionList<StudyMode> label="Study mode" value={shown.studyMode} onChange={(studyMode) => change({ studyMode })} options={[
        { value: "words", label: "Words", description: "Recall each word from its prompt" },
        { value: "articles", label: "Articles", description: "Endless drill of noun articles" },
      ]} />
    </div>

    <div className="setup-group">
      <h3>Words</h3>
      <OptionList<ScopeMode> label="Which words" value={shown.scopeMode} onChange={(scopeMode) => change({ scopeMode })} options={[
        { value: "all", label: "All words", short: "All" },
        { value: "only", label: "Only selected", short: "Only…" },
        { value: "exclude", label: "All except selected", short: "Except…" },
      ]} />
      {shown.scopeMode !== "all" && <div className="scope-groups">
        {groups.map((group) => <div className="scope-group" key={group.kind}>
          <span className="scope-group-label">{groupLabels[group.kind]}</span>
          <div className="chip-row">
            {group.options.map((option) => <button type="button" key={option.key} className={`chip ${option.kind} ${option.kind === "type" ? option.key.slice(5) : ""} ${shown.selectedScopes.includes(option.key) ? "selected" : ""}`} aria-pressed={shown.selectedScopes.includes(option.key)} onClick={() => toggleScope(option.key)}>
              {option.kind === "tag" ? `#${option.label}` : option.label}
            </button>)}
          </div>
        </div>)}
      </div>}
    </div>

    {!articles && <div className="setup-group">
      <h3>Prompt</h3>
      <OptionList<PromptMode> label="Prompt direction" value={shown.promptMode} onChange={(promptMode) => change({ promptMode })} options={[
        { value: "english", label: "English → Italian", short: "EN → IT" },
        { value: "italian", label: "Italian → English", short: "IT → EN" },
        { value: "both", label: "Both directions", short: "Both" },
      ]} />
      {shown.promptMode === "both" && <div className="setup-sub">
        <OptionList label="Directions per word" value={shown.oneDirectionPerWord ? "one" : "both"} onChange={(value) => change({ oneDirectionPerWord: value === "one" })} options={[
          { value: "both", label: "Each word both ways", short: "Both ways" },
          { value: "one", label: "One random direction per word", short: "One random" },
        ]} />
        {!shown.oneDirectionPerWord && <label className="check-option">
          <input type="checkbox" checked={shown.englishFirstWhenBoth} onChange={(event) => change({ englishFirstWhenBoth: event.target.checked })} />
          <span>English prompt before Italian prompt</span>
        </label>}
      </div>}
    </div>}

    <div className="setup-group">
      <h3>Answer</h3>
      <OptionList label="Answer mode" value={setup.typeToVerify ? "type" : "flip"} onChange={(value) => onAnswerMode(value === "type")} options={[
        { value: "type", label: articles ? "Type the articles" : "Type the Italian", short: "Type", description: articles || setup.promptMode === "english" ? "Checked and parsed as you type" : "Italian prompts stay flip cards" },
        { value: "flip", label: "Flip cards", short: "Flip", description: "Reveal, then mark right or wrong" },
      ]} />
    </div>

    {staged && <footer className="setup-pending" role="status">
      <p>{inProgress ? "These changes start a new session." : "Apply these changes?"}</p>
      <div className="button-row">
        <button type="button" className="text-button small" onClick={() => setStaged(null)}>Revert</button>
        <button type="button" className="primary-button small" disabled={!count} onClick={() => { onApply(staged); setStaged(null); }}>{inProgress ? "Restart" : "Apply"}</button>
      </div>
    </footer>}
  </section>;
}

function ProgressHeader({ current, total, session, onAdjust, onRestart, setup }: { current: number; total: number | null; session: SessionCounts; onAdjust: () => void; onRestart: () => void; setup: StudySetup }) {
  return <div className="study-header">
    <button type="button" className="setup-summary narrow-only" onClick={onAdjust} aria-label="Adjust study setup">
      <Icon name="sliders" size={16} />
      <span className="setup-summary-text">{setupSummary(setup).map((part, index) => <span key={index}>{part}</span>)}</span>
    </button>
    <div className="progress-row">
      <span className="progress-tally" aria-label={`${session.right} right, ${session.wrong} wrong`}><b className="right">{session.right}</b><b className="wrong">{session.wrong}</b></span>
      <span className="progress-count">{total === null ? `#${current + 1}` : `${Math.min(current + 1, total)} / ${total}`}</span>
      <button type="button" className="icon-button" onClick={onRestart} aria-label="Reshuffle and restart" title="Reshuffle and restart"><Icon name="restart" size={16} /></button>
    </div>
  </div>;
}

function CardTop({ item }: { item: StudyItem }) {
  return <div className="study-card-top">
    <span className={`pos-badge ${item.card.type}`}>{typeLabels[item.card.type]}</span>
    <span className="card-direction">{item.mode === "article" ? "Articles" : item.promptLanguage === "english" ? "English → Italian" : "Italian → English"}</span>
    {item.card.setName && <span className="card-set">{item.card.setName}</span>}
  </div>;
}

/** The prompt line: English, the Italian headword, or the forms whose articles are asked, plus a gender when it's ambiguous. */
function PromptWord({ item, morphology }: { item: StudyItem; morphology: NounMorphology }) {
  const gender = item.promptGender ? <span className="prompt-gender"> ({genderAbbreviations[item.promptGender]})</span> : null;
  if (item.mode === "article" && item.card.type === "noun") {
    return <h2 className="prompt-word italian-word" lang="it">{articlePromptForms(item.card, morphology).join(" / ")}{gender}</h2>;
  }
  if (item.promptLanguage === "english") return <h2 className="prompt-word">{item.card.english}{gender}</h2>;
  return <h2 className="prompt-word italian-word" lang="it">{italianHeadword(item.card, morphology)}{gender}</h2>;
}

export type StudyViewProps = {
  loading: boolean;
  cards: Flashcard[];
  morphology: NounMorphology;
  preferences: StudyPreferences;
  setup: StudySetup;
  setupOpen: boolean;
  onSetupOpen: (open: boolean) => void;
  onApplySetup: (setup: StudySetup) => void;
  onAnswerMode: (typeToVerify: boolean) => void;
  scopeOptions: StudyScopeOption[];
  /** Null for the endless articles drill. */
  total: number | null;
  current: number;
  studyItem: StudyItem | null;
  typing: boolean;
  revealed: boolean;
  onReveal: (revealed: boolean) => void;
  verificationResult: "correct" | "wrong" | null;
  submittedAnswer: string;
  submittedProblems: string[];
  onVerify: (correct: boolean, answer: string, problems: string[]) => void;
  onAdvance: () => void;
  onRate: (result: "right" | "wrong" | "skipped") => void;
  session: SessionCounts;
  sessionComplete: boolean;
  activeReviewSetId: number | null;
  reviewSets: MistakeReviewSet[];
  missedItems: StudyItem[];
  onRestart: () => void;
  onReturnToOriginal: () => void;
  onStudyMistakes: (id: number) => void;
  mistakeTagName: string;
  onMistakeTagName: (value: string) => void;
  onCreateMistakeTag: () => void;
  createdMistakeTagName: string;
  savingTag: boolean;
  warning: string;
  onAddWords: () => void;
};

export function StudyView(props: StudyViewProps) {
  const { studyItem, morphology } = props;
  const answered = props.session.right + props.session.wrong + props.session.skipped;

  if (props.loading) return <section className="study-view"><div className="empty-state" role="status"><p>Loading your words…</p></div></section>;

  if (!props.cards.length) return <section className="study-view">
    {props.warning && <p className="sync-warning" role="status">{props.warning}</p>}
    <div className="empty-state">
      <h2>No words yet</h2>
      <p>Add a few words and they’ll show up here as cards.</p>
      <button type="button" className="primary-button" onClick={props.onAddWords}><Icon name="plus" size={16} /> Add words</button>
    </div>
  </section>;

  const { total } = props;
  const scored = props.session.right + props.session.wrong;

  return <section className={`study-layout${props.setupOpen ? " setup-open" : ""}`}>
    <aside className="study-sidebar">
      <StudySetupPanel cards={props.cards} morphology={morphology} setup={props.setup} options={props.scopeOptions} inProgress={answered > 0 && !props.sessionComplete} onApply={props.onApplySetup} onAnswerMode={props.onAnswerMode} onClose={() => props.onSetupOpen(false)} />
    </aside>
    <div className="study-view">
    {props.warning && <p className="sync-warning" role="status">{props.warning}</p>}
    {props.activeReviewSetId !== null && !props.sessionComplete && <p className="review-round-label">Review set {props.activeReviewSetId}</p>}
    {(total === null ? Boolean(studyItem) : total > 0) && !props.sessionComplete && <ProgressHeader current={props.current} total={total} session={props.session} setup={props.setup} onAdjust={() => props.onSetupOpen(!props.setupOpen)} onRestart={props.onRestart} />}

    {props.sessionComplete ? (
      <div className="session-complete">
        {scored > 0 && <div className="score-ring" style={{ ["--score" as string]: `${(props.session.right / scored) * 360}deg` }}><span>{Math.round((props.session.right / scored) * 100)}%</span></div>}
        <h2>{props.activeReviewSetId !== null ? `Review set ${props.activeReviewSetId} complete` : "Session complete"}</h2>
        <p className="score-breakdown"><b className="right">{props.session.right} right</b> · <b className="wrong">{props.session.wrong} wrong</b> · {props.session.skipped} skipped</p>
        {props.missedItems.length > 0 && <div className="missed-list">
          <h3>Mistakes this round</h3>
          <ul>{props.missedItems.map((item) => <li key={item.key}><span className="italian" lang="it">{italianHeadword(item.card, morphology)}</span><span className="english">{item.card.english}</span></li>)}</ul>
        </div>}
        {props.reviewSets.length > 0 && <section className="review-sets" aria-label="Mistake review sets">
          <h3>Review sets</h3>
          <p>Each round’s mistakes stay available until you change the session setup or reload.</p>
          <ul>{props.reviewSets.map((set, index) => <li key={set.id}>
            <div><strong>Set {set.id} · {set.items.length} {set.items.length === 1 ? "card" : "cards"}</strong><small>{set.sourceSetId === null ? "From the full session" : `From review set ${set.sourceSetId}`}</small></div>
            <button type="button" className={`${index === props.reviewSets.length - 1 ? "primary-button" : "neutral-button"} small`} disabled={!set.items.length} aria-label={`Review set ${set.id}, ${set.items.length} ${set.items.length === 1 ? "card" : "cards"}`} onClick={() => props.onStudyMistakes(set.id)}>Review{set.id === props.activeReviewSetId ? " again" : ""}</button>
          </li>)}</ul>
        </section>}
        <div className="completion-actions">
          {props.activeReviewSetId !== null
            ? <button className="neutral-button" onClick={props.onReturnToOriginal}>Back to full session</button>
            : <button className={props.reviewSets.length ? "neutral-button" : "primary-button"} onClick={props.onRestart}>Study again</button>}
          <button className="text-button narrow-only" onClick={() => props.onSetupOpen(true)}>Change setup</button>
        </div>
        {props.missedItems.length > 0 && <div className="mistake-tag-creator">
          {props.createdMistakeTagName
            ? <p className="success-message" role="status">Tagged your mistakes <strong>#{props.createdMistakeTagName}</strong></p>
            : <>
              <label className="field"><span>Tag these mistakes</span><input value={props.mistakeTagName} onChange={(event) => props.onMistakeTagName(event.target.value)} /></label>
              <button className="neutral-button" onClick={props.onCreateMistakeTag} disabled={!props.mistakeTagName.trim() || props.savingTag}><Icon name="tag" size={16} /> Create tag</button>
            </>}
        </div>}
      </div>
    ) : studyItem ? <>
      {props.typing ? (
        <article className={`study-card typing pos-${studyItem.card.type}${props.verificationResult ? ` result-${props.verificationResult}` : ""}`}>
          <CardTop item={studyItem} />
          <PromptWord item={studyItem} morphology={morphology} />
          {!props.verificationResult
            ? <ItalianVerificationForm key={studyItem.key} item={studyItem} preferences={props.preferences} morphology={morphology} onResult={props.onVerify} />
            : <div className="result-body">
              <div className={`result-banner ${props.verificationResult}`} role="status">
                <Icon name={props.verificationResult === "correct" ? "check" : "cross"} />
                <strong>{props.verificationResult === "correct" ? "Correct" : "Not quite"}</strong>
              </div>
              <div className="result-compare">
                <div className="you-typed">
                  <span className="field-label">You typed</span>
                  <code lang="it">{props.submittedAnswer}</code>
                  <AnswerProblems problems={props.submittedProblems} />
                </div>
                <div className="expected"><span className="field-label">Answer</span><CardAnswer card={studyItem.card} morphology={morphology} /></div>
              </div>
            </div>}
        </article>
      ) : (
        <article className={`study-card flip pos-${studyItem.card.type}${props.revealed ? " revealed" : ""}`}>
          <CardTop item={studyItem} />
          <button type="button" className="flip-surface" onClick={() => props.onReveal(!props.revealed)} aria-label={props.revealed ? "Hide answer" : "Show answer"}>
            <PromptWord item={studyItem} morphology={morphology} />
            {props.revealed && <div className="flip-answer">
              {studyItem.mode === "article" || studyItem.promptLanguage === "english"
                ? <CardAnswer card={studyItem.card} morphology={morphology} />
                : <div className="answer-block"><p className="answer-meta">English · {typeLabels[studyItem.card.type].toLowerCase()}</p><p className="english-answer">{studyItem.card.english}</p></div>}
            </div>}
            {!props.revealed && <span className="tap-hint">Tap to reveal</span>}
          </button>
        </article>
      )}

      <div className={`study-actions${props.typing ? " typing" : ""}`} key={`${studyItem.key}:${props.typing}:${props.verificationResult}:${props.revealed}`}>
        {props.typing ? (
          props.verificationResult
            ? <button className="primary-button wide" onClick={props.onAdvance}>Continue <kbd>Enter</kbd></button>
            : <button className="text-button" onClick={() => props.onRate("skipped")}><Icon name="skip" size={16} /> Skip</button>
        ) : !props.revealed ? <>
          <button className="text-button" onClick={() => props.onRate("skipped")}><Icon name="skip" size={16} /> Skip</button>
          <button className="primary-button wide" onClick={() => props.onReveal(true)}>Reveal <kbd>Space</kbd></button>
        </> : <>
          <button className="wrong-button" onClick={() => props.onRate("wrong")}><Icon name="cross" size={16} /> Wrong <kbd>1</kbd></button>
          <button className="right-button" onClick={() => props.onRate("right")}><Icon name="check" size={16} /> Right <kbd>2</kbd></button>
        </>}
      </div>
    </> : (
      <div className="empty-state">
        <h2>{props.setup.studyMode === "articles" ? "No nouns with articles match this setup" : "No cards match this setup"}</h2>
        <p>{props.setup.scopeMode === "only" && !props.setup.selectedScopes.length ? "Choose at least one part of speech, set, or tag." : "Widen the selection or add words."}</p>
        <button type="button" className="primary-button narrow-only" onClick={() => props.onSetupOpen(true)}><Icon name="sliders" size={16} /> Adjust setup</button>
      </div>
    )}
    </div>
  </section>;
}
