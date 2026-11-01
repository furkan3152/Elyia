import type { LanguageChip } from "@elyia/core/api/language";
import { useId, useState } from "react";

import { Ely } from "../../../pixel/Ely";
import { cx, FOCUS_RING } from "../../../ui/cx";
import { FlowCard } from "./FlowCard";
import type { LanguageAnswer, LanguageQuestion, SentenceReading } from "./sentence";
import { useFlowRun } from "./useFlowRun";
import { openQuestions, useSentencePlan } from "./useSentencePlan";

const DOWN = new Set(["short", "sell", "close", "reduce", "flatten", "unstake", "withdraw", "sat", "kapat"]);
const UP = new Set(["long", "buy", "stake", "deposit", "lend", "supply", "al"]);

const KIND_CLASS: Partial<Record<LanguageChip["kind"], string>> = {
  leverage: "bg-signal text-[#16201B]",
  venue: "bg-summit/30 text-ink",
  network: "bg-paper-2 text-ink",
  recipient: "bg-ridge/25 text-ink",
};

/** The chips the reader heard, in the pixel tag style; ▲ / ▼ carry the side, never colour alone. */
export function LiveChips({ chips, className, label = "What Elyia heard" }: { readonly chips: readonly LanguageChip[]; readonly className?: string; readonly label?: string }) {
  const shown = chips.filter((chip) => chip.kind !== "connector" && chip.kind !== "unknown").slice(0, 10);
  if (shown.length === 0) return null;
  return (
    <ul aria-label={label} className={cx("m-0 flex list-none flex-wrap items-center justify-center gap-2", className)}>
      {shown.map((chip, index) => {
        const word = chip.text.toLowerCase();
        const side = chip.kind === "verb" || chip.kind === "side" ? (UP.has(word) ? "up" : DOWN.has(word) ? "down" : null) : null;
        const value = chip.value && chip.value.length <= 28 && chip.value.toLowerCase() !== chip.text.toLowerCase() ? chip.value : null;
        return (
          <li key={`${chip.span[0]}-${index}`} className={cx("inline-flex h-7 items-center gap-1.5 px-2 font-tag text-[11px] uppercase px-frame-thin", KIND_CLASS[chip.kind] ?? "bg-card text-ink", side === "up" && "text-up", side === "down" && "text-down")}>
            <span className="sr-only">{chip.kind}: </span>
            {side === "up" ? <span aria-hidden="true">▲</span> : side === "down" ? <span aria-hidden="true">▼</span> : null}
            {chip.text}
            {value ? <span className="font-mono text-[10px] normal-case opacity-75">= {value}</span> : null}
          </li>
        );
      })}
    </ul>
  );
}

/** One question, answered in place: an option button each, or a typed answer (amounts, addresses, names.ely). */
function Question({ question, onAnswer, busy }: { readonly question: LanguageQuestion; readonly onAnswer: (answer: LanguageAnswer) => void; readonly busy: boolean }) {
  const inputId = useId();
  const [typed, setTyped] = useState("");
  return (
    <li className="flex flex-col items-center gap-3 text-center">
      <p className="font-display text-[19px] font-bold leading-snug text-ink">{question.prompt}</p>
      {question.options.length > 0 ? (
        <ul className="flex flex-wrap justify-center gap-3" aria-label="Answers">
          {question.options.map((option) => (
            <li key={option.id}>
              <button
                type="button"
                disabled={busy}
                onClick={() => onAnswer({ question: question.id, option: option.id })}
                className={cx("px-btn px-btn-thin flex flex-col items-center px-3 py-1.5 text-ink disabled:opacity-60", option.recommended && !question.purpose ? "px-btn-signal text-signal-ink" : "px-btn-paper", FOCUS_RING)}
              >
                <span className="font-tag text-[12px] uppercase">{option.label}</span>
                {option.detail ? <span className="font-mono text-[10px] opacity-75">{option.detail}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {question.allowsText ? (
        <form
          className="flex w-full max-w-[420px] items-stretch gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            const value = typed.trim().slice(0, 80);
            if (value) onAnswer({ question: question.id, text: value });
          }}
        >
          <label htmlFor={inputId} className="sr-only">
            {question.prompt}
          </label>
          <input
            id={inputId}
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            placeholder={question.placeholder ?? (question.field === "recipient" ? "0x… or name.ely" : "type an answer")}
            maxLength={80}
            autoComplete="off"
            spellCheck={false}
            className={cx("h-10 min-w-0 flex-1 bg-card px-3 font-mono text-[14px] text-ink px-frame-thin placeholder:text-ink-3", FOCUS_RING)}
          />
          <button type="submit" disabled={busy || typed.trim().length === 0} className={cx("px-btn px-btn-thin px-btn-ink px-4 font-tag text-[12px] uppercase disabled:opacity-60", FOCUS_RING)}>
            Answer
          </button>
        </form>
      ) : null}
      <p className="font-mono text-[11px] text-ink-3">{question.purpose ? "only you can answer this · nothing is guessed" : "Elyia recommends the highlighted way; any answer works"}</p>
    </li>
  );
}

/** The reader's questions, answered inline; each answer goes back with the signed thread and the sentence is read again. */
export function ClarifyPanel({ reading, questions, onAnswer, busy, className }: { readonly reading: SentenceReading | null; readonly questions: readonly LanguageQuestion[]; readonly onAnswer: (answer: LanguageAnswer) => void; readonly busy: boolean; readonly className?: string }) {
  return (
    <div className={cx("flex w-full flex-col items-center gap-6", className)} aria-live="polite">
      <ol className="flex w-full flex-col gap-6">
        {questions.map((question) => (
          <Question key={question.id} question={question} onAnswer={onAnswer} busy={busy} />
        ))}
      </ol>
      {reading && reading.pendingQuestions > 0 ? <p className="font-tag text-[11px] uppercase text-ink-2">{reading.pendingQuestions} more after this</p> : null}
    </div>
  );
}

/** What the reader filled in on its own (a default network, a resolved name.ely), and its warnings. */
export function ReadingNotes({ reading, className }: { readonly reading: SentenceReading | null; readonly className?: string }) {
  if (!reading || (reading.assumptions.length === 0 && reading.warnings.length === 0)) return null;
  return (
    <ul className={cx("mx-auto flex max-w-[760px] flex-col gap-1.5 text-center font-mono text-[12px] leading-snug", className)} aria-label="How Elyia read it">
      {reading.assumptions.map((item) => (
        <li key={`${item.field}-${item.label}`} className={item.material ? "text-ink" : "text-ink-2"}>
          {item.material ? "◆ " : "· "}
          {item.label}
        </li>
      ))}
      {reading.warnings.map((item) => (
        <li key={item.code + item.message} className="text-warn-ink">
          ⚠ {item.message}
        </li>
      ))}
    </ul>
  );
}

export interface SentenceRouteProps {
  readonly sentence: string;
  readonly account: string | null;
  readonly onExample?: (sentence: string) => void;
  readonly className?: string;
}

/**
 * A whole sentence, end to end: live chips from the reader, its questions
 * answered inline (thread round trip), the planner's dry run as the pixel
 * route card, then prepare, sign and submit step by step when a wallet is
 * connected, the journey followed live and each step stamped as it settles.
 */
export function SentenceRoute({ sentence, account, onExample, className }: SentenceRouteProps) {
  const read = useSentencePlan(sentence, { account, delayMs: 0 });
  const run = useFlowRun(read.ask, read.plan.data ?? null);
  const questions = openQuestions(read);
  const reading = read.reading;
  const unreadable = reading && (reading.status === "unreadable" || reading.status === "control");

  return (
    <div className={cx("flex flex-col gap-8", className)}>
      <div className="flex flex-col items-center gap-3">
        <LiveChips chips={read.chips} />
        <p className="font-tag text-[11px] uppercase text-ink-3" aria-live="polite">
          {read.readerOffline ? "reader offline · the planner reads it directly" : read.readingPending ? "reading…" : reading ? `read by Elyia · ${reading.locale === "tr" ? "Türkçe" : "English"}${reading.canonical && reading.canonical !== sentence ? ` · “${reading.canonical}”` : ""}` : ""}
        </p>
        <ReadingNotes reading={reading} />
      </div>
      {questions.length > 0 ? (
        <div className="mx-auto flex w-full max-w-[720px] flex-col items-center gap-5 bg-card px-6 py-8 text-center px-frame px-drop" role="group" aria-label="Elyia asks before planning">
          <p className="caption">Route card · {questions.length === 1 ? "one question" : `${questions.length} questions`} first</p>
          <Ely state="talk" size={80} label="Ely asks before planning" />
          <p className="font-mono text-[15px] text-ink">“{sentence}”</p>
          <ClarifyPanel reading={reading} questions={questions} onAnswer={read.answer} busy={read.readingPending} />
          {read.answers.length > 0 ? (
            <button type="button" onClick={read.resetAnswers} className={cx("font-tag text-[11px] uppercase text-ink-2 underline decoration-dotted underline-offset-2 hover:text-ink", FOCUS_RING)}>
              start the answers over
            </button>
          ) : null}
        </div>
      ) : unreadable ? (
        <div className="mx-auto flex max-w-[720px] flex-col items-center gap-4 bg-card px-6 py-8 text-center px-frame px-drop" role="status">
          <p className="caption">Route card · not read</p>
          <Ely state="worry" size={80} label="Ely could not read it" />
          <p className="font-mono text-[15px] text-ink">“{sentence}”</p>
          <p className="max-w-[540px] text-[14px] leading-snug text-ink-2 text-pretty">{reading.status === "control" ? "That cancels: there is nothing to plan." : "Some words could not be read, so nothing was guessed. Try one of these:"}</p>
          {reading.examples.length > 0 ? (
            <ul className="flex flex-wrap justify-center gap-3">
              {reading.examples.map((example) => (
                <li key={example}>
                  <button type="button" onClick={() => onExample?.(example)} className={cx("px-btn px-btn-thin px-btn-paper px-3 py-1 font-mono text-[12px] text-ink", FOCUS_RING)}>
                    {example}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : (
        <FlowCard
          ask={read.ask ?? (sentence.trim().length >= 3 ? { key: `pending:${sentence}`, sentence, grade: 2, actions: [] } : null)}
          plan={read.ask ? read.plan.data : undefined}
          planning={read.plan.isFetching}
          updatedAt={read.plan.dataUpdatedAt}
          run={run}
          onExample={onExample}
          fineprint="A dry run until you sign: the planner re-quotes each step at prepare and binds the quote."
          empty={null}
        />
      )}
    </div>
  );
}
