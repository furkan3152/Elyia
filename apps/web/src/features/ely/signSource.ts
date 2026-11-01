/** What a route card's Sign button plans (pure). */
import { primaryCard, PLANNING_TOOLS, type ElyTurn } from "./turn";
import type { IntentActionSpec } from "@elyia/core/intent";

import { sentenceGradeOf } from "../../pages/track/flow/sentence";
import type { FlowAsk } from "../../pages/track/flow/useFlowPlan";

type Rec = Readonly<Record<string, unknown>>;
const isRec = (value: unknown): value is Rec => typeof value === "object" && value !== null && !Array.isArray(value);

/** The proposal's actions, else the dry run's actions (anonymous chat), else the sentence itself. */
export function signSourceOf(turn: ElyTurn, sentence: string): SignSource {
  const primary = primaryCard(turn);
  if (primary?.proposal && primary.proposal.actions.length > 0) return { kind: "actions", actions: primary.proposal.actions, sentence: primary.proposal.title };
  const reading = [...turn.readings].reverse().find((entry) => PLANNING_TOOLS.has(entry.name) && isRec(entry.input) && Array.isArray(entry.input.actions) && entry.input.actions.length > 0);
  if (reading && isRec(reading.input)) return { kind: "actions", actions: reading.input.actions as never, sentence: primary?.card.title ?? sentence };
  return { kind: "text", text: sentence };
}

export type SignSource = { readonly kind: "actions"; readonly actions: readonly IntentActionSpec[]; readonly sentence: string } | { readonly kind: "text"; readonly text: string };

/** The planner ask for a source (pure). */
export function askOf(source: SignSource): FlowAsk {
  if (source.kind === "text") {
    const text = source.text.slice(0, 500);
    return { key: `text:${text}`, sentence: text, grade: sentenceGradeOf(text), actions: [], text };
  }
  const kinds = source.actions.map((action) => action.kind);
  const leverage = source.actions.find((action) => action.leverage)?.leverage?.value;
  const grade = sentenceGradeOf(`${source.sentence}${leverage ? ` ${leverage}x` : ""}`, kinds.includes("order") ? ["trade"] : kinds);
  return { key: `actions:${JSON.stringify(source.actions)}`, sentence: source.sentence.slice(0, 200), grade, actions: source.actions };
}

