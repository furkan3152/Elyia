/**
 * Runs a planned route, one step per click. Nothing signs on a timer: each
 * step starts only when the user presses its button, and every request
 * goes to their wallet (EVM transactions, or EIP-712 for HyperCore
 * user-signed actions). The server never signs and never sees a key.
 *
 * - planner routes: store the intent, `prepare` the step (fresh quote and
 *   quote binding), sign, `submit` only the references, then follow the
 *   journey the planner verifies from chain;
 * - offline routes: send the browser-built requests and follow receipts
 *   (and, for an Orbit deposit, the kind-12 tx id on Elysium) directly.
 *
 * Every signed step is written to the journey store so /app/track follows it.
 */
import type { CreateIntentResponse, PrepareStepResponse, SubmitStepResponse } from "@elyia/core/api/intents";
import { buildExchangeRequest } from "@elyia/core/hypercore/signing";
import type { EvmTransactionRequest, HyperCoreUserSignedRequest, TransactionRequest } from "@elyia/core/intent";
import type { Journey } from "@elyia/core/journey";
import { getEvmNetwork, layersFor, NETWORKS, type NetworkKey } from "@elyia/core/networks";
import { formatEvmReference, formatNonceReference } from "@elyia/core/references";
import { useEffect, useRef, useState } from "react";
import type { Address, Hex } from "viem";
import { useConfig } from "wagmi";
import { getAccount, getPublicClient, sendTransaction, signTypedData, switchChain, waitForTransactionReceipt } from "wagmi/actions";

import { useUiStore } from "../../../app/state/uiStore";
import { linkProposal } from "../../../features/ely/proposalLink";
import { ApiError, apiGet, apiPost, apiUrl } from "../../../lib/api";
import { openEventStream } from "../../../lib/sse";
import { hyperCoreEndpoints } from "../../../lib/hypercore/endpoints";
import { exchangeError, postExchange } from "../../../lib/hypercore/exchangeClient";
import type { RouteStepState } from "../../../topo/RouteCard";
import { addLeg, saveJourney, type JourneyRecord } from "./journeyStore";
import type { LocalRequest } from "./localPlanner";
import { childIdOf, deliveredMessages } from "./orbit";
import { preflight, type PreflightClient } from "./preflight";
import { phaseState } from "./routeModel";
import { hasRoute, planBody, type FlowAsk, type FlowPlan } from "./useFlowPlan";

export type StepRunState = "idle" | "preparing" | "signing" | "sent" | "settling" | "settled" | "failed";

export interface StepRun {
  readonly state: StepRunState;
  readonly message?: string;
  readonly reference?: string;
  readonly block?: string;
  readonly time?: string;
}

export interface FlowRun {
  readonly runs: Readonly<Record<string, StepRun>>;
  /** Step states for the route card (run state over the plan's). */
  readonly states: Readonly<Record<string, RouteStepState>>;
  readonly journeyId: string | null;
  readonly busy: boolean;
  readonly error: string | null;
  /** The step the next click signs, or null when nothing is left to sign. */
  readonly nextStepId: string | null;
  /** Sign the next step. `confirmed`: the user ticked what the Rule Book asked to confirm. */
  readonly start: (options?: { readonly confirmed?: boolean }) => Promise<void>;
  readonly reset: () => void;
}

type IntentStreamParsers = Readonly<Record<"intent.snapshot" | "intent.created" | "intent.status_changed" | "intent.step_updated", unknown>>;
/** Stream events only wake the journey poll; their bodies are never trusted for state. */
const anyEvent = (data: unknown): unknown => (typeof data === "object" && data !== null ? data : null);

const STATE_FOR_RUN: Readonly<Record<StepRunState, RouteStepState | null>> = {
  idle: null,
  preparing: "next",
  signing: "next",
  sent: "climbing",
  settling: "climbing",
  settled: "settled",
  failed: "failed",
};

function hhmm(at: number): string {
  return new Date(at).toISOString().slice(11, 16);
}

/** Plain words for wallet refusals and API errors. */
export function explainRunError(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  const text = error instanceof Error ? error.message : String(error);
  if (/user rejected|user denied|rejected the request/iu.test(text)) return "You declined in your wallet. Nothing was sent.";
  if (/insufficient funds/iu.test(text)) return "Not enough HYPE for this amount plus gas on that network.";
  if (/chain mismatch|switch chain|unrecognized chain/iu.test(text)) return "Your wallet is on another network. Switch it and try again.";
  return text.length > 220 ? `${text.slice(0, 220)}…` : text;
}

export function useFlowRun(ask: FlowAsk | null, plan: FlowPlan | null): FlowRun {
  const config = useConfig();
  const mode = useUiStore((state) => state.mode);
  const [runs, setRuns] = useState<Record<string, StepRun>>({});
  const [journey, setJourney] = useState<Journey | null>(null);
  const [intentId, setIntentId] = useState<string | null>(null);
  const [record, setRecord] = useState<JourneyRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recordRef = useRef<JourneyRecord | null>(null);

  const reset = () => {
    recordRef.current = null;
    setRuns({});
    setJourney(null);
    setIntentId(null);
    setRecord(null);
    setError(null);
  };

  const patch = (stepId: string, next: StepRun) => setRuns((previous) => ({ ...previous, [stepId]: next }));

  const remember = (next: JourneyRecord) => {
    recordRef.current = next;
    setRecord(next);
    saveJourney(next);
  };

  // Follow a stored planner intent: the journey is verified by the planner from chain.
  // The intent's SSE stream wakes the poll the moment a step changes; the poll stays as the fallback.
  useEffect(() => {
    if (!intentId) return undefined;
    let stopped = false;
    let timer: number | undefined;
    let streaming = false;
    const poll = async () => {
      if (timer) window.clearTimeout(timer);
      try {
        const next = await apiGet<Journey>(`/v1/intents/${intentId}/journey`, { timeoutMs: 10_000 });
        if (stopped) return;
        setJourney(next);
        const moving = next.stops.some((stop) => stop.phase === "in-flight" || stop.phase === "waiting");
        timer = window.setTimeout(poll, moving ? (streaming ? 8_000 : 2_500) : 15_000);
      } catch {
        if (!stopped) timer = window.setTimeout(poll, 6_000);
      }
    };
    const wake = () => {
      if (!stopped) void poll();
    };
    const stream = openEventStream<IntentStreamParsers>({
      url: apiUrl(`/v1/intents/${intentId}/stream`),
      parsers: { "intent.snapshot": anyEvent, "intent.created": anyEvent, "intent.status_changed": anyEvent, "intent.step_updated": anyEvent },
      onEvent: wake,
      onStateChange: (state) => {
        streaming = state === "open";
      },
      maxAttempts: 6,
    });
    void poll();
    return () => {
      stopped = true;
      stream.close();
      if (timer) window.clearTimeout(timer);
    };
  }, [intentId]);

  const ensureChain = async (chainId: number) => {
      const account = getAccount(config);
      if (account.chainId !== chainId) await switchChain(config, { chainId });
    };

  const sendEvm = async (request: { readonly chainId: number; readonly to: string; readonly data: string; readonly value: string | bigint; readonly gas?: string }, from: Address): Promise<Hex> => {
      await ensureChain(request.chainId);
      const value = typeof request.value === "bigint" ? request.value : BigInt(request.value);
      // Simulate first: a transaction that would revert is never handed to the wallet.
      const where = Object.values(NETWORKS).find((network) => (network as { chainId?: number }).chainId === request.chainId)?.name ?? `chain ${request.chainId}`;
      await preflight(getPublicClient(config, { chainId: request.chainId }) as PreflightClient | undefined, { from, to: request.to as Address, data: request.data as Hex, value }, where);
      return sendTransaction(config, {
        account: from,
        chainId: request.chainId,
        to: request.to as Address,
        data: request.data as Hex,
        value,
        ...(request.gas ? { gas: BigInt(request.gas) } : {}),
      });
    };

  const signUserAction = async (typedData: { domain: unknown; types: unknown; primaryType: string; message: unknown }, from: Address): Promise<Hex> =>
      signTypedData(config, {
        account: from,
        domain: { ...(typedData.domain as object) },
        types: typedData.types as Record<string, { name: string; type: string }[]>,
        primaryType: typedData.primaryType,
        message: { ...(typedData.message as object) },
      });

  /** Planner request -> reference (EVM hash or hc:nonce). */
  const executeRequest = async (request: TransactionRequest, from: Address): Promise<string> => {
      if (request.vm === "evm") {
        const evm = request as EvmTransactionRequest;
        const hash = await sendEvm(evm, from);
        await waitForTransactionReceipt(config, { hash, chainId: evm.chainId, timeout: 120_000 });
        return formatEvmReference(hash);
      }
      if (request.kind === "user-signed") {
        const signed = request as HyperCoreUserSignedRequest;
        const before = getAccount(config).chainId;
        const signature = await signUserAction(signed.typedData as never, from);
        if (getAccount(config).chainId !== before) throw new Error("Your wallet switched networks while signing. Try again on one network.");
        const endpoints = hyperCoreEndpoints(NETWORKS[signed.network].environment);
        const response = await postExchange(endpoints.exchangeUrl, buildExchangeRequest({ action: signed.action, nonce: Number(signed.nonce), signature }));
        if (response.status === "err") throw exchangeError(response.response);
        return formatNonceReference(from, signed.nonce);
      }
      throw new Error("This step is signed by the trading key. Open the terminal to enable trading, then run it there.");
    };

  /** Offline request -> reference. */
  const executeLocal = async (request: LocalRequest, from: Address): Promise<{ reference: string; hash?: Hex }> => {
      if (request.kind === "evm") {
        const hash = await sendEvm({ chainId: request.chainId, to: request.to, data: request.data, value: request.value }, from);
        return { reference: formatEvmReference(hash), hash };
      }
      const chainId = getAccount(config).chainId;
      if (chainId === undefined) throw new Error("Your wallet did not report its network. Reconnect it and try again.");
      const nonce = Date.now();
      const built = request.build(chainId, nonce);
      const signature = await signUserAction(built.typedData as never, from);
      const endpoints = hyperCoreEndpoints(NETWORKS[request.network].environment);
      const response = await postExchange(endpoints.exchangeUrl, buildExchangeRequest({ action: built.action, nonce, signature }));
      if (response.status === "err") throw exchangeError(response.response);
      return { reference: formatNonceReference(from, nonce) };
    };

  const startPlanner = async (planned: Extract<FlowPlan, { kind: "planner" }>, from: Address, confirmed: boolean) => {
      if (!ask) return;
      let id = intentId;
      let current: string | null = journey?.current ?? null;
      if (!id) {
        // A proposal's card: approving the proposal stores the one intent and links it back.
        const link = ask.proposal ? await linkProposal(ask.proposal) : null;
        if (link?.kind === "linked") {
          id = link.intentId;
          const linked = await apiGet<Journey>(`/v1/intents/${id}/journey`, { timeoutMs: 10_000 });
          current = linked.current;
          setJourney(linked);
        } else {
          if (link?.kind === "fallback") setError(link.reason);
          const created = await apiPost<CreateIntentResponse>("/v1/intents", planBody(ask, from, mode, false), { timeoutMs: 20_000 });
          id = created.intent.id;
          current = created.journey.current;
          setJourney(created.journey);
        }
        setIntentId(id);
        remember({ id, source: "planner", intentId: id, routeId: planned.route.id, sentence: ask.sentence, createdAt: Date.now(), layers: [...new Set(planned.route.steps.flatMap((step) => [step.layer, step.toLayer].filter((layer): layer is NonNullable<typeof layer> => Boolean(layer))))], legs: [] });
      }
      const stepId = current ?? planned.route.steps.find((step) => runs[step.stepId]?.state !== "settled")?.stepId;
      if (!stepId) return;
      patch(stepId, { state: "preparing" });
      const prepared = await apiPost<PrepareStepResponse>(`/v1/intents/${id}/steps/${stepId}/prepare`, { signatureChainId: getAccount(config).chainId, ...(confirmed ? { confirmed: true } : {}) }, { timeoutMs: 20_000 });
      patch(stepId, { state: "signing", message: prepared.payload.requests[0]?.description });
      const references: string[] = [];
      for (const request of prepared.payload.requests) {
        references.push(await executeRequest(request, from));
        patch(stepId, { state: "signing", message: `${references.length} of ${prepared.payload.requests.length} signed` });
      }
      patch(stepId, { state: "sent", reference: references.at(-1) });
      const step = planned.route.steps.find((item) => item.stepId === stepId);
      let next = recordRef.current;
      for (const reference of references) {
        if (next) next = addLeg(next, { stepId, network: step?.network ?? planned.route.steps[0]!.network, reference, label: step?.title ?? stepId, at: Date.now() });
      }
      if (next) remember(next);
      const submitted = await apiPost<SubmitStepResponse>(`/v1/intents/${id}/steps/${stepId}/submit`, { references }, { timeoutMs: 20_000 });
      patch(stepId, { state: submitted.verification === "confirmed" ? "settled" : submitted.verification === "failed" ? "failed" : "settling", reference: references.at(-1), time: hhmm(Date.now()), message: submitted.verification === "failed" ? submitted.step.failure?.message : undefined });
    };

  const startOffline = async (planned: Extract<FlowPlan, { kind: "offline" }>, from: Address) => {
      if (!ask) return;
      const step = planned.local.steps.find((item) => (runs[item.view.stepId]?.state ?? "idle") !== "settled" && runs[item.view.stepId]?.state !== "settling");
      if (!step) return;
      if (step.offlineOnly) {
        patch(step.view.stepId, { state: "idle", message: step.offlineOnly });
        throw new Error(step.offlineOnly);
      }
      let next = recordRef.current ?? { id: `j_${planned.route.id}_${Date.now().toString(36)}`, source: "offline" as const, routeId: planned.route.id, sentence: ask.sentence, createdAt: Date.now(), layers: [...new Set(planned.route.steps.flatMap((item) => [item.layer, item.toLayer].filter((layer): layer is NonNullable<typeof layer> => Boolean(layer))))], legs: [] };
      const id = step.view.stepId;
      patch(id, { state: "signing", message: step.requests[0]?.description });
      let lastHash: Hex | undefined;
      let lastReference = "";
      for (const request of step.requests) {
        const sent = await executeLocal(request, from);
        lastReference = sent.reference;
        next = addLeg(next, { stepId: id, network: request.network, reference: sent.reference, label: request.description, at: Date.now() });
        remember(next);
        if (sent.hash && request.kind === "evm") {
          patch(id, { state: "sent", reference: sent.reference, message: "waiting for the receipt" });
          const receipt = await waitForTransactionReceipt(config, { hash: sent.hash, chainId: request.chainId, timeout: 120_000 });
          if (receipt.status !== "success") throw new Error(`The transaction reverted on ${NETWORKS[request.network].name}. Nothing moved.`);
          lastHash = sent.hash;
          if (step.settle === "orbit-deposit") {
            const elysium = getEvmNetwork(layersFor(mode).elysium.key);
            const bridge = elysium.elysiumBridge!;
            const message = deliveredMessages(receipt.logs, { bridge: bridge.parent.bridge, inbox: bridge.parent.inbox })[0];
            const child = message ? childIdOf(message, elysium.chainId) : null;
            if (child) {
              next = addLeg(next, { stepId: id, network: elysium.key, reference: formatEvmReference(child.id), label: child.kind === "deposit" ? "deposit on Elysium (kind 12)" : "retryable ticket on Elysium", at: Date.now() });
              remember(next);
              patch(id, { state: "settling", reference: child.id, message: "on the cable car: waiting for Elysium to credit it" });
              const client = getPublicClient(config, { chainId: elysium.chainId });
              if (client) {
                const credited = await client.waitForTransactionReceipt({ hash: child.id, timeout: 10 * 60_000, pollingInterval: 2_000 }).catch(() => null);
                if (credited) {
                  patch(id, { state: "settled", reference: child.id, block: credited.blockNumber.toString(), time: hhmm(Date.now()) });
                  return;
                }
              }
              patch(id, { state: "settling", reference: child.id, message: "still in flight: follow it on the track page" });
              return;
            }
          }
          if (step.settle === "orbit-withdrawal") {
            patch(id, { state: "settling", reference: sent.reference, block: receipt.blockNumber.toString(), message: "descending: the claim opens after the confirm period" });
            return;
          }
        }
      }
      patch(id, { state: "settled", reference: lastHash ?? lastReference, time: hhmm(Date.now()) });
    };

  const start = async (options: { readonly confirmed?: boolean } = {}) => {
    if (!hasRoute(plan) || busy) return;
    const account = getAccount(config);
    if (!account.address) {
      setError("Connect a wallet first. Your key never leaves it.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (plan.kind === "planner") await startPlanner(plan, account.address, options.confirmed === true);
      else await startOffline(plan, account.address);
    } catch (problem) {
      const message = explainRunError(problem);
      setError(message);
      setRuns((previous) => {
        const pending = Object.entries(previous).find(([, run]) => run.state === "preparing" || run.state === "signing");
        return pending ? { ...previous, [pending[0]]: { state: "failed", message } } : previous;
      });
    } finally {
      setBusy(false);
    }
  };

  // Route card states: the planner's journey when following one, the local run otherwise.
  const states: Record<string, RouteStepState> = {};
  if (hasRoute(plan)) {
    for (const step of plan.route.steps) {
      const stop = journey?.stops.find((item) => item.stepId === step.stepId);
      const run = runs[step.stepId];
      const fromRun = run ? STATE_FOR_RUN[run.state] : null;
      states[step.stepId] = stop && intentId ? (fromRun === "failed" ? "failed" : phaseState(stop.phase)) : (fromRun ?? step.state);
    }
  }
  const nextStepId = hasRoute(plan) ? (plan.route.steps.find((step) => states[step.stepId] === "next" || states[step.stepId] === "waiting" || states[step.stepId] === "failed")?.stepId ?? null) : null;

  return { runs, states, journeyId: record?.id ?? null, busy, error, nextStepId, start, reset };
}

/** Networks a route signs on, for the "switch to" hint. */
export function signingNetworks(plan: FlowPlan | null): NetworkKey[] {
  if (!hasRoute(plan)) return [];
  return [...new Set(plan.route.steps.filter((step) => step.signer === "wallet").map((step) => step.network))];
}
