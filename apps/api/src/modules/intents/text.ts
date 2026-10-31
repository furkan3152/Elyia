/**
 * Sentence -> structured actions through the language reader
 * (apps/api/src/language, owned by the language engineer: `readIntent`).
 * The reader is loaded lazily so the engine still serves `actions` and
 * `goals` bodies if it is missing (400 TEXT_NOT_SUPPORTED_YET).
 *
 * The reading's status decides:
 * - ready: value and trade goals compile to actions (planner/goals.ts);
 *   rules go to the Elysium Agent and queries to the language/market
 *   endpoints, so neither is planned here;
 * - needs_input: 422 INTENT_CLARIFY with the questions and the signed thread;
 * - unreadable / control: 422 INTENT_UNSUPPORTED (with examples).
 */
import type { AccountId, GoalItem, IntentActionSpec, LanguageGoal, NetworkEnvironment } from "@elyia/core";
import { z } from "zod";
import type { AppContext } from "../../context.js";
import { engineError } from "../../engine/errors.js";
import { goalsToActions } from "../../engine/planner/goals.js";
import { actionSchema } from "./schemas.js";

/** Kept in a variable so the compiler does not require the module. */
const LANGUAGE_MODULE = "../../language/index.js";

interface ReaderOptions {
  readonly environment: NetworkEnvironment;
  readonly now: number;
  readonly ctx: AppContext;
  readonly thread?: string;
}

type ReadIntent = (text: string, options: ReaderOptions) => Promise<unknown>;

let loaded: Promise<ReadIntent | null> | null = null;

async function loadReader(): Promise<ReadIntent | null> {
  loaded ??= import(LANGUAGE_MODULE)
    .then((module: unknown) => {
      const read = (module as { readIntent?: unknown } | null)?.readIntent;
      return typeof read === "function" ? (read as ReadIntent) : null;
    })
    .catch(() => null);
  return loaded;
}

const questionSchema = z.object({ id: z.string(), prompt: z.string(), field: z.string().optional(), options: z.array(z.unknown()).optional() }).passthrough();

const readingSchema = z
  .object({
    status: z.enum(["ready", "needs_input", "unreadable", "control"]),
    goals: z.array(z.object({ t: z.enum(["value", "trade", "rule", "query"]) }).passthrough()).max(12),
    questions: z.array(questionSchema).max(10).default([]),
    thread: z.string().nullable().optional(),
    canonical: z.string().nullable().optional(),
    examples: z.array(z.string()).optional(),
    unsupported: z.string().optional(),
  })
  .passthrough();

const legacySchema = z.object({ actions: z.array(actionSchema).min(1).max(12) }).passthrough();

export interface TextActions {
  readonly actions: IntentActionSpec[];
  /** The reader's canonical sentence (shown as the intent's text). */
  readonly canonical: string | null;
}

export async function actionsFromText(text: string, input: { readonly environment: NetworkEnvironment; readonly accounts: readonly AccountId[]; readonly now: number; readonly ctx: AppContext; readonly thread?: string }): Promise<TextActions> {
  const read = await loadReader();
  if (!read) {
    throw engineError("TEXT_NOT_SUPPORTED_YET", "Sentences are not read on this server: send `actions` (IntentActionSpec[]) or `goals` instead.");
  }
  const raw = await read(text, { environment: input.environment, now: input.now, ctx: input.ctx, ...(input.thread ? { thread: input.thread } : {}) });
  const legacy = legacySchema.safeParse(raw);
  if (legacy.success) return { actions: legacy.data.actions as IntentActionSpec[], canonical: null };
  const parsed = readingSchema.safeParse(raw);
  if (!parsed.success) throw engineError("INTENT_UNSUPPORTED", "The language reader returned something the engine cannot plan.");
  const reading = parsed.data;
  switch (reading.status) {
    case "needs_input": {
      const questions = reading.questions.map((question) => ({ id: question.id, prompt: question.prompt, ...(question.field ? { field: question.field } : {}) }));
      throw engineError("INTENT_CLARIFY", questions[0]?.prompt ?? "Elyia needs a detail before planning this.", { questions, thread: reading.thread ?? null });
    }
    case "control":
      throw engineError("INTENT_UNSUPPORTED", "Nothing to plan: the sentence cancels.");
    case "unreadable":
      throw engineError("INTENT_UNSUPPORTED", reading.unsupported ?? "Elyia could not read that sentence.", reading.examples ? { examples: reading.examples.slice(0, 5) } : undefined);
    case "ready":
      break;
  }
  const goals = reading.goals as unknown as LanguageGoal[];
  if (goals.some((goal) => goal.t === "rule")) throw engineError("ROUTE_UNSUPPORTED", "Schedules, conditions and alerts are Elysium Agent rules (POST /v1/agent/automations), not a one-off intent.");
  if (goals.some((goal) => goal.t === "query")) throw engineError("INTENT_UNSUPPORTED", "That is a question, not a move: ask it through POST /v1/language/parse or the market endpoints.");
  if (goals.length === 0) throw engineError("INTENT_UNSUPPORTED");
  return { actions: goalsToActions(goals as GoalItem[], input.environment), canonical: reading.canonical ?? null };
}
