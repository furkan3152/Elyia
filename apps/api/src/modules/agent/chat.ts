/**
 * One chat turn: picks the mode (Claude when ANTHROPIC_API_KEY is set and
 * the `agentLlm` flag is on, else deterministic), streams events through
 * `emit`, and stores the turn in the owner's thread (signed-in users only).
 * When the model call fails the turn falls back to the deterministic
 * planner and says so in a note.
 */
import { getEvmNetwork } from "@elyia/core";
import type { ChatClarifyAnswers, ChatClarifyEvent, ChatDoneEvent, RouteCard } from "@elyia/core/api/agent";
import type { ReadResult } from "../../language/index.js";
import { readSentenceFor } from "../intents/language.js";
import type { AppContext } from "../../context.js";
import { elysiumNetworkFor, hypercoreNetworkFor } from "../../config.js";
import { flagOn } from "../admin/index.js";
import { runDeterministicTurn } from "./deterministic.js";
import { clientFor, runLlmTurn, type LlmTurnInput } from "./llm.js";
import { appendToThread, memoryOf, threadOf } from "./memory.js";
import type { ToolContext } from "./tools.js";

export interface ChatTurnInput {
  readonly ctx: AppContext;
  /** Signed-in address, or null for an anonymous read-only chat. */
  readonly owner: string | null;
  readonly address: string;
  readonly message: string;
  readonly threadId: string | null;
  readonly locale: "en" | "tr" | null;
  readonly integratorFee: RouteCard["integratorFee"];
  readonly emit: (event: string, data: unknown) => void;
  readonly client?: LlmTurnInput["client"];
  /** Answers to the previous turn's `clarify` questions about `message`. */
  readonly clarify?: ChatClarifyAnswers | null;
}

/** Questions a person can answer in the UI (a choice or a typed value). */
function answerable(reading: ReadResult): ReadResult["questions"] {
  return reading.status === "needs_input" ? reading.questions.filter((question) => question.options.length > 0 || question.allowsText) : [];
}

/** A turn that ended on a question, with nothing planned. */
function endsAsking(text: string, tools: ToolContext): boolean {
  return tools.proposals.length === 0 && tools.cards.length === 0 && /\?\s*$/u.test(text.trim());
}

export function detectLocale(text: string): "en" | "tr" {
  return /[çğıöşüÇĞİÖŞÜ]|\b(ve|bir|ne|nedir|mi|mı|portföy|pozisyon|koru|düşerse|kaç)\b/iu.test(text) ? "tr" : "en";
}

function chunks(text: string): string[] {
  return text.match(/\S+\s*/gu) ?? [];
}

export async function chatTurn(input: ChatTurnInput): Promise<ChatDoneEvent> {
  const { ctx } = input;
  const owner = input.owner ?? "anonymous";
  const memory = input.owner ? await memoryOf(ctx, input.owner) : null;
  const locale = input.locale ?? (memory?.updatedAt ? memory.locale : detectLocale(input.message));
  const thread = input.owner && input.threadId ? await threadOf(ctx, input.owner, input.threadId) : null;
  const useLlm = Boolean(clientFor(ctx) || input.client) && (await flagOn(ctx, "agentLlm"));
  const mode = useLlm ? "ai" : "deterministic";
  const threadId = thread?.id ?? input.threadId ?? null;
  input.emit("thread", { threadId, mode, model: null });

  const tools: ToolContext = { ctx, owner, address: input.address.toLowerCase(), integratorFee: input.integratorFee, proposals: [], drafts: [], cards: [] };
  const stateLine = `[elyia-state] mode=${ctx.config.mode} wallet=${tools.address} signed_in=${input.owner ? "yes" : "no"} elysium=${elysiumNetworkFor(ctx.config.mode)}(${getEvmNetwork(elysiumNetworkFor(ctx.config.mode)).chainId}) hypercore=${hypercoreNetworkFor(ctx.config.mode)} prices=${ctx.config.mode === "testnet" ? "reference" : "market"} risk=${memory?.riskProfile ?? "unknown"} goals=${(memory?.goals ?? []).join("|").slice(0, 200) || "none"} locale=${locale}`;

  let text: string;
  let stopReason = "end_turn";
  // Clarify answers: the reader re-reads the same sentence with them (and its signed thread).
  let message = input.message;
  let reading: ReadResult | null = null;
  if (input.clarify && input.clarify.answers.length > 0) {
    reading = await readSentenceFor(ctx, { text: input.message, locale, answers: input.clarify.answers, ...(input.clarify.thread ? { thread: input.clarify.thread } : {}), account: tools.address });
    if (reading.status === "ready" && reading.canonical) message = reading.canonical;
  }
  let clarify: ReadResult | null = reading && answerable(reading).length > 0 ? reading : null;
  if (clarify) {
    // Still asking: the next questions, no model call and no plan.
    text = clarify.questions.map((question) => question.prompt).join("\n");
    for (const piece of chunks(text)) input.emit("token", { text: piece });
  } else if (reading && reading.status !== "ready") {
    text = reading.unsupported ?? (locale === "tr" ? "Bu cevaplarla cümleyi tamamlayamadım. Kendi sözlerinle tekrar yaz." : "I could not finish the sentence with those answers. Type it again in your own words.");
    for (const piece of chunks(text)) input.emit("token", { text: piece });
  } else if (useLlm) {
    try {
      const result = await runLlmTurn({ ctx, history: (thread?.messages ?? []).map((entry) => ({ role: entry.role, text: entry.text })), message, stateLine, tools, emit: input.emit, ...(input.client ? { client: input.client } : {}) });
      text = result.text;
      stopReason = result.stopReason;
    } catch (error) {
      ctx.log.warn("agent model turn failed; deterministic fallback", { error: error instanceof Error ? error.message.slice(0, 160) : String(error) });
      input.emit("note", { text: locale === "tr" ? "Model şu an yanıt vermiyor; deterministik planlayıcı devrede." : "The model is unavailable right now; the deterministic planner answered." });
      const result = await runDeterministicTurn({ ctx, message, locale, tools, emit: input.emit, ...(reading?.status === "ready" ? { reading } : {}) });
      for (const piece of chunks(result.text)) input.emit("token", { text: piece });
      text = result.text;
      clarify = result.clarify ?? null;
      stopReason = "fallback";
    }
    if (!clarify && stopReason !== "fallback" && !reading && endsAsking(text, tools)) {
      // The model asked a question: offer the reader's options for the same sentence as choices.
      const asked = await readSentenceFor(ctx, { text: message, locale, account: tools.address }).catch(() => null);
      if (asked && answerable(asked).length > 0) clarify = asked;
    }
  } else {
    const result = await runDeterministicTurn({ ctx, message, locale, tools, emit: input.emit, ...(reading?.status === "ready" ? { reading } : {}) });
    for (const piece of chunks(result.text)) input.emit("token", { text: piece });
    text = result.text;
    clarify = result.clarify ?? null;
  }
  for (const proposal of tools.proposals) {
    input.emit("proposal", proposal);
    if (proposal.card) input.emit("route_card", { proposalId: proposal.id, card: proposal.card });
  }
  for (const card of tools.cards) input.emit("route_card", { proposalId: null, card });
  for (const draft of tools.drafts) input.emit("note", { text: `draft:${draft.kind}`, draft: draft.body });

  let savedThread = threadId;
  if (input.owner) {
    const now = new Date(ctx.clock.now()).toISOString();
    const view = await appendToThread(ctx, input.owner, threadId, [
      { role: "user", text: message, at: now },
      { role: "assistant", text, at: now, proposals: tools.proposals.map((proposal) => proposal.id) },
    ]);
    savedThread = view.id;
  }
  const questions = clarify ? answerable(clarify) : [];
  if (clarify && questions.length > 0) {
    const event: ChatClarifyEvent = { threadId: savedThread, sentence: message, thread: clarify.thread, questions, locale };
    input.emit("clarify", event);
  }
  const done: ChatDoneEvent = { threadId: savedThread ?? "", text, proposals: tools.proposals.map((proposal) => proposal.id), stopReason };
  input.emit("done", done);
  return done;
}
