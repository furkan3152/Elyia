import type { LanguageQuestion } from "@elyia/core/api/language";
import { useMemo, useState, type ReactNode } from "react";

import { pickedLabel } from "./clarify";
import { venueLabel, compactAmount } from "./cardModel";
import { readingLabel, phaseLabel } from "./labels";
import { RouteCardInline } from "./RouteArtifact";
import { inlineStates, useCardStates } from "./cardStates";
import { AVATAR_FOR_PHASE, turnPhase, turnTimeline, visibleChars } from "./timeline";
import { planning, primaryCard, PLANNING_TOOLS, type ElyTurn, type Reading } from "./turn";
import { useTurnClock } from "./hooks";
import { ElyAvatar, ReadingMark } from "./ui";
import { cx, FOCUS_RING } from "../../ui/cx";

export function UserMessage({ text }: { readonly text: string }) {
  return <div className="msg-u stepin">{text}</div>;
}

export interface ElyMessageProps {
  readonly turn: ElyTurn;
  readonly phone: boolean;
  /** Whether this turn's card is the one open in the panel. */
  readonly opened: boolean;
  readonly onOpenCard: () => void;
  readonly onAnswer: (questionId: string, value: string) => void;
  /** Shown under a card that has no proposal (anonymous chat): sign in to file proposals. */
  readonly signInHint?: ReactNode;
}

/** Inline text with `code` spans and **bold** (plain text otherwise; nothing is rendered as markup). */
function RichText({ text }: { readonly text: string }) {
  const parts = text.split(/(`[^`\n]+`|\*\*[^*\n]+\*\*)/gu);
  return (
    <>
      {parts.map((part, index) =>
        part.startsWith("`") && part.endsWith("`") && part.length > 2 ? (
          <code key={index} className="bg-paper-2 px-1 font-mono text-[12.5px]">
            {part.slice(1, -1)}
          </code>
        ) : part.startsWith("**") && part.endsWith("**") && part.length > 4 ? (
          <b key={index}>{part.slice(2, -2)}</b>
        ) : (
          <span key={index}>{part}</span>
        ),
      )}
    </>
  );
}

/**
 * Ely's message: avatar by phase, `Ely · status`, the survey readings as
 * chips (spinner → check), the streamed text with a block cursor, the
 * clarify choices, notes, and the inline route card. Pacing comes from the
 * turn's timeline; reduced motion shows the end state.
 */
export function ElyMessage({ turn, phone, opened, onOpenCard, onAnswer, signInHint }: ElyMessageProps) {
  const timeline = useMemo(() => turnTimeline(turn), [turn]);
  const now = useTurnClock(timeline.endAt);
  const phase = turnPhase(turn, timeline, now);
  const shownReadings = turn.readings.filter((_, index) => (timeline.readings[index]?.showAt ?? Infinity) <= now);
  const chars = visibleChars(timeline, turn.text.length, now);
  // When the reader's choices stand in for the question lines, Ely says it once, as choices.
  const questionsOnly = turn.clarify?.status === "ready" && turn.text.split("\n").every((line) => line.trim() === "" || turn.clarify!.questions.some((question) => question.prompt === line.trim()));
  const text = questionsOnly ? (chars > 0 ? (turn.clarify!.questions.length === 1 ? "One question first:" : "A few things first:").slice(0, chars) : "") : turn.text.slice(0, chars);
  const streaming = chars < turn.text.length && chars > 0;
  const primary = primaryCard(turn);
  const published = useCardStates((state) => state.byKey[turn.id]);
  const liveStates = primary ? inlineStates(published, primary.card.steps.length, primary.proposal?.status ?? null) : undefined;
  const cardShown = primary !== null && (timeline.cardsAt.at(-1) ?? Infinity) <= now;
  const clarifyShown = turn.clarify?.status === "ready" && timeline.clarifyAt !== null && timeline.clarifyAt <= now;
  const seconds = turn.doneAt ? (turn.doneAt - turn.startedAt) / 1000 : 0;
  const status = phaseLabel(phase, { readings: turn.readings.length, seconds, planning: planning(turn), mode: turn.mode, asking: turn.clarify?.status === "ready" });
  const [openReading, setOpenReading] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(true);
  const settledIds = new Set(timeline.readings.filter((slot) => slot.settleAt !== null && slot.settleAt <= now).map((slot) => slot.id));
  const errorShown = turn.error && (Number.isFinite(now) ? now >= turn.error.at : true);

  return (
    <div className="msg-e stepin">
      <ElyAvatar state={AVATAR_FOR_PHASE[phase]} label={`Ely: ${status}`} />
      <div className="bd" aria-live={turn.doneAt === null ? "polite" : undefined} aria-busy={turn.doneAt === null && !turn.error}>
        <div className="who">
          <b>Ely</b> · <span>{status}</span>
          {turn.mode === "deterministic" && phase !== "surveying" ? <span className="pill mute">planner</span> : null}
        </div>
        {shownReadings.length > 0 ? (
          phone && collapsed && shownReadings.length > 1 ? (
            <div className="readings">
              <button type="button" className={cx("rd", FOCUS_RING)} onClick={() => setCollapsed(false)} aria-expanded="false">
                <ReadingMark done={shownReadings.every((reading) => settledIds.has(reading.id))} ok={shownReadings.every((reading) => reading.ok !== false)} />
                {shownReadings.length} survey readings <span className="ms">▾</span>
              </button>
            </div>
          ) : (
            <ul className="readings" aria-label="Survey readings">
              {shownReadings.map((reading) => (
                <ReadingChip key={reading.id} reading={reading} turn={turn} settled={settledIds.has(reading.id)} open={openReading === reading.id} onToggle={() => setOpenReading((current) => (current === reading.id ? null : reading.id))} />
              ))}
            </ul>
          )
        ) : null}
        {openReading ? <ReadingDetail reading={turn.readings.find((reading) => reading.id === openReading) ?? null} turn={turn} /> : null}
        {text ? (
          <p>
            <RichText text={text} />
            {streaming ? <span className="cur" aria-hidden="true" /> : null}
          </p>
        ) : null}
        {turn.notes.map((note) => (
          <p key={`${note.at}-${note.text}`} className="note">
            {note.text}
          </p>
        ))}
        {turn.drafts.length > 0 && turn.doneAt !== null ? (
          <p className="note">
            Ely drafted {turn.drafts.map((draft) => `an ${draft.kind}`).join(" and ")}: confirm it under Alerts or Portfolio · Automations. Nothing runs until you do.
          </p>
        ) : null}
        {clarifyShown && turn.clarify ? <ClarifyChoices questions={turn.clarify.questions} picked={turn.clarify.picked} sent={turn.clarify.sent} onAnswer={onAnswer} phone={phone} /> : null}
        {errorShown && turn.error ? (
          <p role="alert" className="note" style={{ color: "rgb(var(--down))" }}>
            {turn.error.message}
          </p>
        ) : null}
        {cardShown && primary ? (
          <>
            <RouteCardInline card={primary.card} {...(liveStates ? { states: liveStates } : {})} onOpen={onOpenCard} compact={phone} opened={opened} />
            {!primary.proposal && signInHint ? signInHint : null}
          </>
        ) : null}
      </div>
    </div>
  );
}

function ReadingChip({ reading, turn, settled, open, onToggle }: { readonly reading: Reading; readonly turn: ElyTurn; readonly settled: boolean; readonly open: boolean; readonly onToggle: () => void }) {
  const card = PLANNING_TOOLS.has(reading.name) ? (primaryCard(turn)?.card ?? null) : null;
  const label = readingLabel(reading, settled ? card : null);
  const expandable = settled && card !== null && card.venues.length > 0;
  const body = (
    <>
      <ReadingMark done={settled} ok={reading.ok !== false} />
      {label}
      {expandable ? <span className="ms">{open ? "▴" : "▾"}</span> : null}
    </>
  );
  return (
    <li className="flex">
      {expandable ? (
        <button type="button" className={cx("rd stepin", open && "open", FOCUS_RING)} onClick={onToggle} aria-expanded={open}>
          {body}
        </button>
      ) : (
        <span className={cx("rd stepin", settled && reading.ok === false && "bad")} title={settled && reading.summary ? reading.summary : undefined}>
          {body}
          {settled && reading.ok === false ? <span className="sr-only">: failed, {reading.summary}</span> : null}
        </span>
      )}
    </li>
  );
}

function ReadingDetail({ reading, turn }: { readonly reading: Reading | null; readonly turn: ElyTurn }) {
  const card = reading && PLANNING_TOOLS.has(reading.name) ? (primaryCard(turn)?.card ?? null) : null;
  if (!card) return null;
  const symbol = card.outputs.at(-1)?.symbol ?? "";
  return (
    <div className="rd-detail stepin" role="table" aria-label="Venue quotes">
      <span className="h" role="columnheader">
        Venue
      </span>
      <span className="h" role="columnheader">
        Auction
      </span>
      <span className="h text-right" role="columnheader">
        You get
      </span>
      {card.venues.map((venue) => (
        <Row key={venue.protocol} name={venueLabel(venue.protocol)} note={venue.winner ? "best quote" : (venue.note?.split(":")[0] ?? "quoted")} value={`${compactAmount(venue.expected)}${venue.winner ? ` ${symbol} ✓` : ""}`} winner={venue.winner} />
      ))}
    </div>
  );
}

function Row({ name, note, value, winner }: { readonly name: string; readonly note: string; readonly value: string; readonly winner: boolean }) {
  return (
    <>
      <span role="cell">{name}</span>
      <span role="cell" className="truncate">
        {note}
      </span>
      <span role="cell" className={cx("num text-right", winner && "ok")}>
        {value}
      </span>
    </>
  );
}

/** The reader's questions as choice chips: the tapped one fills with accent, the others dim. Purpose questions pre-pick nothing. */
function ClarifyChoices({ questions, picked, sent, onAnswer, phone }: { readonly questions: readonly LanguageQuestion[]; readonly picked: Readonly<Record<string, string>>; readonly sent: string | null; readonly onAnswer: (questionId: string, value: string) => void; readonly phone: boolean }) {
  return (
    <div className="flex flex-col gap-3 stepin">
      {questions.map((question) => {
        const value = picked[question.id];
        const answered = value !== undefined;
        return (
          <div key={question.id} className="flex flex-col gap-2" role="group" aria-label={question.prompt}>
            <p className="font-semibold">{question.prompt}</p>
            <div className="choices">
              {question.options.map((option) => {
                const on = value === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    disabled={Boolean(sent)}
                    aria-pressed={on}
                    onClick={() => onAnswer(question.id, option.id)}
                    className={cx("choice", on && "picked", answered && !on && "dim", !answered && option.recommended && !question.purpose && "rec", FOCUS_RING)}
                    title={option.detail}
                  >
                    {option.label}
                    {!phone && option.detail && option.detail !== option.label ? <span className="ml-2 text-[10.5px] opacity-75">{option.detail}</span> : null}
                  </button>
                );
              })}
              {question.allowsText ? <TypedAnswer question={question} disabled={Boolean(sent)} onAnswer={onAnswer} current={value?.startsWith("text:") ? pickedLabel(question, value) : null} /> : null}
            </div>
            <p className="t-tag t-faint">{question.purpose ? "only you can answer this · nothing is guessed" : "Ely recommends the outlined one · any answer works"}</p>
          </div>
        );
      })}
      {sent ? <p className="t-tag t-acc">Sent: “{sent}”</p> : null}
    </div>
  );
}

function TypedAnswer({ question, disabled, onAnswer, current }: { readonly question: LanguageQuestion; readonly disabled: boolean; readonly onAnswer: (questionId: string, value: string) => void; readonly current: string | null }) {
  const [value, setValue] = useState(current ?? "");
  return (
    <form
      className="flex items-stretch gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const typed = value.trim().slice(0, 80);
        if (typed) onAnswer(question.id, `text:${typed}`);
      }}
    >
      <label className="sr-only" htmlFor={`ans-${question.id}`}>
        {question.prompt}
      </label>
      <input
        id={`ans-${question.id}`}
        value={value}
        disabled={disabled}
        onChange={(event) => setValue(event.target.value)}
        placeholder={question.placeholder ?? "type it"}
        maxLength={80}
        autoComplete="off"
        className={cx("w-[120px] bg-card px-2 font-mono text-[12.5px] text-ink px-frame-thin placeholder:text-ink-3", current && "outline outline-2 outline-accent", FOCUS_RING)}
      />
      <button type="submit" disabled={disabled || value.trim() === ""} className={cx("b xs ink", FOCUS_RING)}>
        OK
      </button>
    </form>
  );
}
