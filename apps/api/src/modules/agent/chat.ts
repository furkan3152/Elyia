/**
 * One chat turn: picks the mode (Claude when ANTHROPIC_API_KEY is set and
 * the `agentLlm` flag is on, else deterministic), streams events through
 * `emit`, and stores the turn in the owner's thread (signed-in users only).
 * When the model call fails the turn falls back to the deterministic
 * planner and says so in a note.
 */
import { getEvmNetwork } from "@elyia/core";
import type { ChatDoneEvent, RouteCard } from "@elyia/core/api/agent";
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
  input.emit("thread", { threadId, mode, model: useLlm ? ctx.config.agent.model : null });

  const tools: ToolContext = { ctx, owner, address: input.address.toLowerCase(), integratorFee: input.integratorFee, proposals: [], drafts: [], cards: [] };
  const stateLine = `[elyia-state] mode=${ctx.config.mode} wallet=${tools.address} signed_in=${input.owner ? "yes" : "no"} elysium=${elysiumNetworkFor(ctx.config.mode)}(${getEvmNetwork(elysiumNetworkFor(ctx.config.mode)).chainId}) hypercore=${hypercoreNetworkFor(ctx.config.mode)} prices=${ctx.config.mode === "testnet" ? "reference" : "market"} risk=${memory?.riskProfile ?? "unknown"} goals=${(memory?.goals ?? []).join("|").slice(0, 200) || "none"} locale=${locale}`;

  let text: string;
  let stopReason = "end_turn";
  if (useLlm) {
    try {
      const result = await runLlmTurn({ ctx, history: (thread?.messages ?? []).map((message) => ({ role: message.role, text: message.text })), message: input.message, stateLine, tools, emit: input.emit, ...(input.client ? { client: input.client } : {}) });
      text = result.text;
      stopReason = result.stopReason;
    } catch (error) {
      ctx.log.warn("agent model turn failed; deterministic fallback", { error: error instanceof Error ? error.message.slice(0, 160) : String(error) });
      input.emit("note", { text: locale === "tr" ? "Model şu an yanıt vermiyor; deterministik planlayıcı devrede." : "The model is unavailable right now; the deterministic planner answered." });
      const result = await runDeterministicTurn({ ctx, message: input.message, locale, tools, emit: input.emit });
      for (const piece of chunks(result.text)) input.emit("token", { text: piece });
      text = result.text;
      stopReason = "fallback";
    }
  } else {
    const result = await runDeterministicTurn({ ctx, message: input.message, locale, tools, emit: input.emit });
    for (const piece of chunks(result.text)) input.emit("token", { text: piece });
    text = result.text;
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
      { role: "user", text: input.message, at: now },
      { role: "assistant", text, at: now, proposals: tools.proposals.map((proposal) => proposal.id) },
    ]);
    savedThread = view.id;
  }
  const done: ChatDoneEvent = { threadId: savedThread ?? "", text, proposals: tools.proposals.map((proposal) => proposal.id), stopReason };
  input.emit("done", done);
  return done;
}
