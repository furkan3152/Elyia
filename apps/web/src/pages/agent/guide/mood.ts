/**
 * Ely's mood at the Guide's table (pure). The big Ely on the stage says the
 * state of the conversation and of the range before you read a word:
 * climbing while the range is surveyed, talking while an answer streams,
 * the crown right after you sign, on watch while the kill switch is on,
 * holding on when a rope is under 10% to its crevasse, asleep when there is
 * nothing out, idle otherwise. One mood at a time, in that order of weight.
 */
import type { ElyState } from "../../../pixel/states";
import { pct, ropesByRisk, type GuideRope } from "./planner";

export interface MoodInput {
  /** The range is still being surveyed (no snapshot yet). */
  readonly surveying: boolean;
  /** An answer is streaming in. */
  readonly speaking: boolean;
  readonly killSwitch: boolean;
  readonly ropes: readonly GuideRope[];
  /** ms of the latest signed (or armed) outcome, if any. A clock a little behind it still counts as "just now". */
  readonly lastWin: number | null;
  readonly now: number;
  readonly sample: boolean;
}

export interface Mood {
  readonly state: ElyState;
  /** Silkscreen word on the name plate ("HOLDING ON"). */
  readonly word: string;
  /** One line of why, in plain words. */
  readonly line: string;
}

/** How long the crown stays on after a signature. */
export const WIN_MS = 12_000;
/** A rope closer than this to its crevasse worries Ely. */
export const WORRY_AT = 0.1;

export function elyMood(input: MoodInput): Mood {
  const weakest = ropesByRisk(input.ropes)[0];
  const sampleWord = input.sample ? " (sample range)" : "";
  if (input.surveying) return { state: "climb", word: "Surveying", line: "Reading your ropes, exposure and funding…" };
  if (input.killSwitch) return { state: "watch", word: "On watch", line: "Kill switch on: nothing new signs. Closing and cancelling still work." };
  if (input.lastWin !== null && input.now - input.lastWin < WIN_MS) return { state: "summit", word: "Summit", line: "Done, and it is on the log." };
  if (input.speaking) return { state: "talk", word: "Talking", line: weakest && weakest.distance !== null && weakest.distance < WORRY_AT ? `About your ${weakest.coin} rope${sampleWord}.` : `Reading the range out loud${sampleWord}.` };
  if (weakest && weakest.distance !== null && weakest.distance < WORRY_AT) {
    return { state: "worry", word: "Holding on", line: `${weakest.coin} ${weakest.leverage}× ${weakest.side} is ${pct(weakest.distance, 1)} from the crevasse${sampleWord}.` };
  }
  if (input.ropes.length === 0) return { state: "sleep", word: "All quiet", line: `No ropes out${sampleWord}. Say where to and I draft the route.` };
  return { state: "idle", word: "Listening", line: `${input.ropes.length} rope${input.ropes.length === 1 ? "" : "s"} out, all with slack${sampleWord}. Ask me anything.` };
}
