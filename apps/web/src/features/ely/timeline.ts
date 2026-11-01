/**
 * Pacing for one turn (pure). Events keep their arrival times; this decides
 * when each piece is shown so a burst (the deterministic planner answers in
 * a few milliseconds) still reads as a climb: a reading chip every 0.3 s,
 * each settling no sooner than half a second after it appeared, then the
 * text at ~55 characters a second (faster for long answers, never slower
 * than the stream), then the route card, then the clarify choices. Live
 * streams are never delayed beyond these minimums. Reduced motion shows the
 * end state (`now = Infinity`).
 */
import type { ElyTurn } from "./turn";

export interface TimelineOptions {
  /** Before the first chip (ms). */
  readonly firstDelay: number;
  /** Between chips (ms). */
  readonly chipGap: number;
  /** A chip spins at least this long (ms). */
  readonly settleMin: number;
  /** Characters per second of the reveal. */
  readonly cps: number;
  /** A long answer reveals within this many seconds. */
  readonly maxRevealSeconds: number;
  /** After the text, before the card and choices (ms). */
  readonly afterText: number;
}

export const DEFAULT_TIMELINE: TimelineOptions = { firstDelay: 350, chipGap: 300, settleMin: 500, cps: 55, maxRevealSeconds: 4, afterText: 300 };

export interface ReadingSlot {
  readonly id: string;
  readonly showAt: number;
  /** null while the call is in flight. */
  readonly settleAt: number | null;
}

export interface TurnTimeline {
  readonly readings: readonly ReadingSlot[];
  /** When the reveal starts (null: no text yet). */
  readonly textStart: number | null;
  /** Characters per second for this turn's text. */
  readonly cps: number;
  /** When the last character shows (null until the turn is done). */
  readonly textEnd: number | null;
  readonly cardsAt: readonly number[];
  readonly clarifyAt: number | null;
  /** Everything shown (null while anything is pending). */
  readonly endAt: number | null;
}

export function revealCps(length: number, options: TimelineOptions = DEFAULT_TIMELINE): number {
  return Math.max(options.cps, length / options.maxRevealSeconds);
}

export function turnTimeline(turn: ElyTurn, options: TimelineOptions = DEFAULT_TIMELINE): TurnTimeline {
  const readings: ReadingSlot[] = [];
  let previous = turn.startedAt + options.firstDelay - options.chipGap;
  for (const reading of turn.readings) {
    const showAt = Math.max(reading.at, previous + options.chipGap);
    previous = showAt;
    readings.push({ id: reading.id, showAt, settleAt: reading.settledAt === null ? null : Math.max(reading.settledAt, showAt + options.settleMin) });
  }
  const unsettled = readings.some((slot) => slot.settleAt === null);
  const lastSettle = readings.reduce((max, slot) => Math.max(max, slot.settleAt ?? 0), 0);

  const cps = revealCps(turn.text.length, options);
  let textStart: number | null = null;
  if (turn.textAt !== null && turn.text.length > 0) {
    // Text that arrives after the readings waits for the last chip to settle; a model that talks first is not held back.
    const afterReadings = turn.textAt >= (turn.readings.at(-1)?.at ?? -Infinity) && !unsettled ? lastSettle + 250 : 0;
    textStart = Math.max(turn.textAt, turn.startedAt + options.firstDelay, afterReadings);
  }
  const finished = turn.doneAt !== null || turn.error !== null;
  const textEnd = finished ? (textStart === null ? lastSettle || turn.startedAt : textStart + (turn.text.length / cps) * 1000) : null;
  const base = textEnd ?? textStart ?? lastSettle;
  const cardsAt = turn.cards.map((card) => Math.max(card.at, base + options.afterText));
  const clarifyAt = turn.clarify && turn.clarify.status === "ready" ? Math.max(turn.clarify.at, (textEnd ?? base) + options.afterText) : null;
  const pendingClarify = turn.clarify?.status === "loading";
  const endAt = finished && !unsettled && !pendingClarify ? Math.max(textEnd ?? 0, lastSettle, ...cardsAt, clarifyAt ?? 0) : null;
  return { readings, textStart, cps, textEnd, cardsAt, clarifyAt, endAt };
}

/** Characters of the text visible at `now`. */
export function visibleChars(timeline: TurnTimeline, length: number, now: number): number {
  if (timeline.textStart === null || now < timeline.textStart) return 0;
  if (!Number.isFinite(now)) return length;
  return Math.min(length, Math.floor(((now - timeline.textStart) / 1000) * timeline.cps));
}

export type TurnPhase = "surveying" | "drafting" | "streaming" | "ready" | "answered" | "error";

/** What Ely is doing at `now` (drives the avatar and the status line). */
export function turnPhase(turn: ElyTurn, timeline: TurnTimeline, now: number): TurnPhase {
  if (turn.error && now >= turn.error.at) return "error";
  if (timeline.readings.some((slot) => slot.showAt <= now && (slot.settleAt === null || slot.settleAt > now))) return "surveying";
  const shown = visibleChars(timeline, turn.text.length, now);
  if (timeline.textStart !== null && now >= timeline.textStart && shown < turn.text.length) return "streaming";
  if (turn.error) return "drafting";
  if (turn.doneAt === null) return turn.readings.length === 0 && turn.text === "" ? "surveying" : "drafting";
  if (timeline.endAt === null || now < timeline.endAt) return "drafting";
  return turn.cards.length > 0 || turn.proposals.some((proposal) => proposal.card) ? "ready" : "answered";
}

export const AVATAR_FOR_PHASE = { surveying: "climb", drafting: "climb", streaming: "talk", ready: "summit", answered: "idle", error: "worry" } as const satisfies Record<TurnPhase, string>;
