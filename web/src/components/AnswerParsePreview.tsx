import type { NounMorphology } from "../cards/nounMorphology";
import {
  standardAdjectivePattern,
  whitespaceParts,
  type StudyItem,
} from "../study/logic";
import { parseNounAnswer, type NounAnswerMode } from "../study/nounAnswers";
import type { AnswerKeywords } from "../study/preferences";

type ParsePiece = {
  label: string;
  value: string;
};

export type AnswerSyntaxStatus = "empty" | "partial" | "complete" | "invalid";

export type AnswerSyntaxAnalysis = {
  pieces: ParsePiece[];
  message: string;
  status: AnswerSyntaxStatus;
  checkable: boolean;
  missing: string[];
  syntaxName: string | null;
};

function displayValue(value: string) {
  return value || "—";
}

function labeledPieces(values: string[], labels: string[]) {
  return values.map((value, index) => ({
    label: labels[index] ?? `Extra token ${index - labels.length + 1}`,
    value: displayValue(value),
  }));
}

const nounSyntaxNames: Record<NounAnswerMode, string> = {
  word: "Noun",
  article: "Articles",
  wordWithArticles: "Noun with every article",
};

const nounAnswerHints: Record<NounAnswerMode, string> = {
  word: "Type the Italian. The fields Parola recognizes will appear here.",
  article: "Type every article the noun takes, in any order: definite singular, definite plural, indefinite.",
  wordWithArticles: "Type the noun with every article it takes, in any order: definite singular, definite plural, indefinite.",
};

/** How the typed answer reads so far, without revealing anything about the prompted card. */
export function analyzeAnswerSyntax(item: Pick<StudyItem, "card" | "mode">, rawValue: string, keywords: AnswerKeywords, morphology: NounMorphology): AnswerSyntaxAnalysis {
  const { card } = item;
  const trimmed = rawValue.normalize("NFC").trim();
  if (!trimmed) {
    return {
      pieces: [],
      message: "Start typing an answer to see how Parola parses it.",
      status: "empty",
      checkable: false,
      missing: [],
      syntaxName: null,
    };
  }

  const unclosedQuote = (trimmed.match(/"/g)?.length ?? 0) % 2 === 1;

  if (card.type === "noun") {
    const parsed = parseNounAnswer(trimmed, morphology, keywords, item.mode);
    const status: AnswerSyntaxStatus = parsed.status === "incomplete" ? "partial" : parsed.status === "empty" ? "empty" : parsed.status;
    return {
      pieces: parsed.pieces,
      message: parsed.message,
      status,
      checkable: status === "complete",
      missing: [],
      syntaxName: nounSyntaxNames[item.mode],
    };
  }

  if (card.type === "verb") {
    const labels = ["Infinitive", "io", "tu", "lui / lei", "noi", "voi", "loro", "Auxiliary", "Participle"];
    const values = whitespaceParts(trimmed);
    const status: AnswerSyntaxStatus = values.length > labels.length ? "invalid" : values.length === labels.length ? "complete" : "partial";
    const finalStatus = unclosedQuote && status !== "invalid" ? "partial" : status;
    return {
      pieces: labeledPieces(values, labels),
      message: status === "invalid" ? `Too many verb fields were supplied; expected ${labels.length}.` : status === "complete" ? "Verb syntax is complete." : "Verb syntax is valid so far but incomplete.",
      status: finalStatus,
      checkable: finalStatus === "complete",
      missing: unclosedQuote ? [...labels.slice(values.length), "Closing quote"] : labels.slice(values.length),
      syntaxName: "Full verb",
    };
  }

  if (card.type === "adjective") {
    const labels = ["Masculine singular", "Feminine singular", "Masculine plural", "Feminine plural"];
    const values = whitespaceParts(trimmed);
    const shorthand = values.length === 1 ? standardAdjectivePattern(values[0] ?? "") : null;
    if (shorthand) {
      const status: AnswerSyntaxStatus = unclosedQuote ? "partial" : "complete";
      return {
        pieces: [{ label: "Regular adjective base", value: values[0] ?? "" }],
        message: "Regular adjective shorthand is syntactically complete.",
        status,
        checkable: status === "complete",
        missing: unclosedQuote ? ["Closing quote"] : [],
        syntaxName: "Regular adjective shorthand",
      };
    }
    const status: AnswerSyntaxStatus = values.length > labels.length ? "invalid" : values.length === labels.length ? "complete" : "partial";
    const finalStatus = unclosedQuote && status !== "invalid" ? "partial" : status;
    return {
      pieces: labeledPieces(values, labels),
      message: status === "invalid" ? `Too many adjective fields were supplied; expected ${labels.length}.` : status === "complete" ? "Adjective syntax is complete." : "Adjective syntax is valid so far but incomplete.",
      status: finalStatus,
      checkable: finalStatus === "complete",
      missing: unclosedQuote ? [...labels.slice(values.length), "Closing quote"] : labels.slice(values.length),
      syntaxName: "Full adjective",
    };
  }

  const values = whitespaceParts(trimmed);
  const status: AnswerSyntaxStatus = values.length > 1 ? "invalid" : values.length === 1 ? "complete" : "partial";
  const finalStatus = unclosedQuote && status !== "invalid" ? "partial" : status;
  return {
    pieces: labeledPieces(values, ["Invariant form"]),
    message: status === "invalid" ? "An adverb answer accepts one invariant form. Quote a stored multi-word form." : status === "complete" ? "Adverb syntax is complete." : "Adverb syntax is incomplete.",
    status: finalStatus,
    checkable: finalStatus === "complete",
    missing: unclosedQuote ? ["Closing quote"] : [],
    syntaxName: "Invariant adverb",
  };
}

const statusLabels: Record<AnswerSyntaxStatus, string> = {
  empty: "Waiting",
  partial: "In progress",
  complete: "Ready to check",
  invalid: "Not recognized",
};

export function AnswerParsePreview({ item, value, keywords, morphology }: { item: Pick<StudyItem, "card" | "mode">; value: string; keywords: AnswerKeywords; morphology: NounMorphology }) {
  const preview = analyzeAnswerSyntax(item, value, keywords, morphology);
  if (preview.status === "empty") return <div className="parse-preview syntax-empty" aria-live="polite"><p className="parse-hint">{item.card.type === "noun" ? nounAnswerHints[item.mode] : nounAnswerHints.word}</p></div>;
  return (
    <div className={`parse-preview syntax-${preview.status}`} aria-live="polite">
      {preview.pieces.length > 0 && <div className="parse-tokens">
        {preview.pieces.map((piece, index) => <span className="parse-token answer-parse-piece" key={`${piece.label}:${index}`}>
          <small>{piece.label}</small>
          <code>{piece.value}</code>
        </span>)}
      </div>}
      <p className="parse-status">
        <span className="parse-status-label"><i aria-hidden="true" />{statusLabels[preview.status]}</span>
        {preview.syntaxName && <span className="parse-syntax">{preview.syntaxName}</span>}
      </p>
      {(preview.status === "invalid" || (preview.status === "partial" && !preview.missing.length)) && preview.message && <p className="parse-line answer-parse-message">{preview.message}</p>}
      {preview.missing.length > 0 && <p className="parse-line answer-parse-message"><strong>Still needed:</strong> {preview.missing.join(" · ")}</p>}
    </div>
  );
}
