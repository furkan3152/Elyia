/**
 * A traced transaction as a route card and a ticket-watch strip (pure):
 * the waypoints it crossed, which are settled (stamped), which are still
 * climbing, and the one thing the user may need to do (redeem a stalled
 * ticket, wait for the claim).
 */
import { layersFor, NETWORKS, type NetworkKey } from "@elyia/core/networks";
import { formatEther } from "viem";

import type { RouteStepState } from "../../topo/RouteCard";
import { formatEta, layerOf, type FlowStepView } from "./flow/routeModel";
import type { Trace } from "./flow/trace";

export interface Stage {
  readonly label: string;
  readonly state: "done" | "now" | "todo" | "alert";
}

export interface TraceRoute {
  readonly headline: string;
  readonly detail: string;
  readonly steps: readonly FlowStepView[];
  readonly stages: readonly Stage[];
  readonly action: "redeem" | null;
  /** Unix seconds the claim opens (descents). */
  readonly claimableAt: number | null;
  /** Ticket id to redeem. */
  readonly ticketId: `0x${string}` | null;
}

function hhmm(sec: number): string {
  return sec > 0 ? new Date(sec * 1000).toISOString().slice(11, 16) : "";
}

function hype(value: bigint): string {
  const text = formatEther(value);
  const [whole, fraction = ""] = text.split(".");
  return `${whole}${fraction ? `.${fraction.slice(0, 4).replace(/0+$/u, "")}` : ""}`.replace(/\.$/u, "");
}

function step(input: Omit<FlowStepView, "id" | "stepId" | "fee" | "signer" | "estimatedSeconds" | "title"> & { readonly index: number; readonly seconds?: number; readonly title?: string }): FlowStepView {
  return {
    id: `W${input.index + 1}`,
    stepId: `t${input.index + 1}`,
    title: input.title ?? input.action,
    network: input.network,
    layer: input.layer,
    toLayer: input.toLayer,
    action: input.action,
    venue: input.venue,
    inOut: input.inOut,
    fee: "—",
    eta: input.eta,
    state: input.state,
    block: input.block,
    time: input.time,
    signer: "none",
    estimatedSeconds: input.seconds ?? null,
  };
}

const TICKET_STAGE: Readonly<Record<string, Stage["state"][]>> = {
  unknown: ["done", "now", "todo", "todo"],
  created: ["done", "done", "now", "todo"],
  "needs-redeem": ["done", "done", "alert", "todo"],
  redeemed: ["done", "done", "done", "done"],
  expired: ["done", "done", "alert", "alert"],
};

export function traceRoute(trace: Trace, nowSec: number): TraceRoute {
  if (trace.kind === "not-found") {
    return { headline: "Not on the map yet", detail: `No receipt for this hash on ${trace.searched.map((key) => NETWORKS[key].shortName).join(" or ")}. A transaction just sent can take a moment; Elyia keeps looking.`, steps: [], stages: [], action: null, claimableAt: null, ticketId: null };
  }
  const found = trace.found;
  const layer = layerOf(found.network);
  const ok = found.receipt.status === "success";
  const first = step({ index: 0, network: found.network, layer, action: ok ? "included" : "reverted", venue: NETWORKS[found.network].shortName, inOut: `block ${found.receipt.blockNumber.toLocaleString("en-US")}`, eta: hhmm(found.timestamp) || "—", state: ok ? "settled" : "failed", block: found.receipt.blockNumber.toString(), time: hhmm(found.timestamp) });

  if (trace.kind === "plain") {
    return { headline: ok ? `Settled on the ${layer === "summit" ? "Summit" : layer === "ridge" ? "Ridge" : "Floor"}` : "Reverted", detail: ok ? `Included in block ${found.receipt.blockNumber.toLocaleString("en-US")} on ${NETWORKS[found.network].name}. Nothing else to follow.` : "The transaction reverted: nothing moved except gas.", steps: [first], stages: [], action: null, claimableAt: null, ticketId: null };
  }

  if (trace.kind === "ascent") {
    const landedOk = trace.landed?.receipt.status === "success";
    if (trace.child.kind === "deposit") {
      const state: RouteStepState = trace.landed ? (landedOk ? "settled" : "failed") : "climbing";
      return {
        headline: trace.landed ? "On the Summit" : "On the cable car",
        detail: trace.landed ? `HYPE credited on Elysium in block ${trace.landed.receipt.blockNumber.toLocaleString("en-US")}.` : "The deposit is in the delayed inbox; Elysium credits the same address in about two minutes.",
        steps: [first, step({ index: 1, network: trace.landed?.network ?? found.network, layer: "ridge", toLayer: "summit", action: "ascend", venue: "canonical bridge", inOut: "kind-12 deposit", eta: trace.landed ? hhmm(trace.landed.timestamp) : formatEta(120), state, block: trace.landed?.receipt.blockNumber.toString(), time: trace.landed ? hhmm(trace.landed.timestamp) : undefined })],
        stages: [
          { label: "HyperEVM", state: "done" },
          { label: "Delayed inbox", state: trace.landed ? "done" : "now" },
          { label: "On the Summit", state: trace.landed ? "done" : "todo" },
        ],
        action: null,
        claimableAt: null,
        ticketId: null,
      };
    }
    const ticket = trace.ticket ?? "unknown";
    return ticketRoute(layersFor(NETWORKS[found.network].environment).elysium.key, first, ticket, trace.child.id, trace.ticketTimeout, trace.landed ? hhmm(trace.landed.timestamp) : undefined, trace.landed?.receipt.blockNumber.toString());
  }

  if (trace.kind === "ticket") {
    const created = step({ index: 0, network: found.network, layer: "summit", action: "ticket", venue: "ArbRetryableTx", inOut: "retryable created", eta: hhmm(found.timestamp) || "—", state: "settled", block: found.receipt.blockNumber.toString(), time: hhmm(found.timestamp) });
    return ticketRoute(found.network, null, trace.ticket, found.receipt.transactionHash, trace.ticketTimeout, hhmm(found.timestamp), found.receipt.blockNumber.toString(), created);
  }

  // descent
  const open = nowSec >= trace.claimableAt;
  const what = trace.value > 0n ? `${hype(trace.value)} HYPE` : "tokens (gateway withdrawal)";
  return {
    headline: open ? "At the Ridge hut: claim open" : "On the long trail down",
    detail: open ? `The rollup has confirmed this withdrawal of ${what}: it can be claimed on HyperEVM with one signature.` : `${what} descending. The claim opens after the confirm period (${trace.confirmBlocks.toLocaleString("en-US")} blocks plus the assertion cadence).`,
    steps: [
      { ...first, action: "descend", toLayer: "ridge", venue: "ArbSys", inOut: `${trace.value > 0n ? `${hype(trace.value)} HYPE` : "tokens"} → outbox` },
      step({ index: 1, network: found.network, layer: "ridge", action: "claim", venue: "outbox", inOut: `outbox → ${trace.value > 0n ? `${hype(trace.value)} HYPE` : "tokens"}`, eta: open ? "open" : formatEta(trace.claimableAt - nowSec), state: open ? "next" : "waiting" }),
    ],
    stages: [
      { label: "Withdrawn", state: "done" },
      { label: "Confirm period", state: open ? "done" : "now" },
      { label: "Claim at the Ridge", state: open ? "now" : "todo" },
    ],
    action: null,
    claimableAt: trace.claimableAt,
    ticketId: null,
  };
}

function ticketRoute(elysium: NetworkKey, first: FlowStepView | null, ticket: string, id: `0x${string}`, timeout: number | null, time: string | undefined, block: string | undefined, created?: FlowStepView): TraceRoute {
  const stages = TICKET_STAGE[ticket] ?? TICKET_STAGE.unknown!;
  const index = first ? 1 : 0;
  const ticketStep = created ?? step({ index, network: elysium, layer: "ridge", toLayer: "summit", action: "ascend", venue: "retryable ticket", inOut: "ERC-20 deposit", eta: time ?? formatEta(180), state: ticket === "unknown" ? "climbing" : "settled", block, time });
  const redeem = step({ index: index + 1, network: elysium, layer: "summit", action: "redeem", venue: "ArbRetryableTx", inOut: "ticket → tokens", eta: ticket === "redeemed" ? "done" : "1 tap", state: ticket === "redeemed" ? "settled" : ticket === "needs-redeem" ? "next" : ticket === "expired" ? "failed" : "waiting" });
  const headline = ticket === "redeemed" ? "On the Summit" : ticket === "needs-redeem" ? "Ticket stalled: redeem it" : ticket === "expired" ? "Ticket expired" : ticket === "created" ? "Ticket created" : "In the delayed inbox";
  const until = timeout ? new Date(timeout * 1000).toISOString().slice(0, 16).replace("T", " ") : null;
  const detail =
    ticket === "redeemed"
      ? "The ticket was redeemed: the tokens are on Elysium."
      : ticket === "needs-redeem"
        ? `The auto-redeem did not run (as for 5 of 6 tickets surveyed). One redeem transaction on Elysium delivers the tokens${until ? `; it must land before ${until} UTC` : ""}.`
        : ticket === "expired"
          ? "The ticket expired unredeemed. Its call value went to the refund address on Elysium."
          : "Waiting for the ticket to be created and auto-redeemed on Elysium.";
  return {
    headline,
    detail,
    steps: [...(first ? [first] : []), ticketStep, redeem],
    stages: [
      { label: "Delayed inbox", state: stages[0]! },
      { label: "Ticket", state: stages[1]! },
      { label: "Auto-redeem", state: stages[2]! },
      { label: "On the Summit", state: stages[3]! },
    ],
    action: ticket === "needs-redeem" ? "redeem" : null,
    claimableAt: null,
    ticketId: id,
  };
}
