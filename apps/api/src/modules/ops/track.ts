/**
 * Transaction tracker: follow any Elysium / HyperEVM transaction or
 * HyperCore order/action until it lands.
 *
 * - EVM: receipt + status through the engine's EVM port (raw JSON-RPC,
 *   Nitro types kept); every log's emitter is labelled from the protocol
 *   registry (and the Swap of ElyiaRouter, Elyia's own contracts).
 * - HyperCore: `hc:cloid:<user>:<cloid>` via `orderStatus`; `hc:nonce:...`
 *   cannot be looked up by the info API, so it is marked honestly.
 * - A worker re-checks pending tracks with backoff (5 s doubling to 5 min),
 *   gives up after 24 h (`expired`), and publishes `track.updated` on the
 *   bus for the SSE stream.
 */
import { explorerTxUrl, NETWORKS, parseReference, protocolsTouching, type NetworkKey } from "@elyia/core";
import type { TrackKind, TrackStatus, TrackView, TrackedLog } from "@elyia/core/api/ops";
import type { Hex } from "viem";
import type { AppContext } from "../../context.js";

import { ChainsEvmPort, type EvmPort } from "../../engine/ports/evm.js";
import { elyiaRouterDeployment } from "../../engine/adapters/elyiaRouter.js";
import { ElyiaHttpError } from "../../http/errors.js";
import { registerStats } from "../admin/stats.js";
import { sha256Hex } from "./auth/crypto.js";
import { docs, iso, PLATFORM_COLLECTIONS } from "./docs.js";

export const TRACK_WORKER_MS = 5_000;
export const TRACK_MAX_AGE_MS = 24 * 60 * 60_000;
const BACKOFF_MAX_MS = 5 * 60_000;

declare module "../../bus.js" {
  interface ElyiaEvents {
    "track.updated": TrackView;
  }
}

interface TrackRecord {
  readonly id: string;
  readonly kind: TrackKind;
  readonly network: NetworkKey;
  readonly reference: string;
  readonly label: string | null;
  readonly status: TrackStatus;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly checks: number;
  readonly nextCheckAt: number | null;
  readonly detail: TrackView["detail"];
}

function view(record: TrackRecord): TrackView {
  return { ...record, createdAt: new Date(record.createdAt).toISOString(), updatedAt: new Date(record.updatedAt).toISOString(), nextCheckAt: iso(record.nextCheckAt) };
}

function tracks(ctx: AppContext) {
  return docs<TrackRecord>(ctx, PLATFORM_COLLECTIONS.tracks);
}

const ports = new WeakMap<AppContext, EvmPort>();

export function setTrackPort(ctx: AppContext, port: EvmPort): void {
  ports.set(ctx, port);
}

function portOf(ctx: AppContext): EvmPort {
  let port = ports.get(ctx);
  if (!port) {
    port = new ChainsEvmPort(ctx.chains, ctx.clock);
    ports.set(ctx, port);
  }
  return port;
}

function contractLabel(network: NetworkKey, address: string): string | null {
  const router = elyiaRouterDeployment(network);
  if (router && router.address === address.toLowerCase()) return "ElyiaRouter";
  const touch = protocolsTouching(address, network)[0];
  return touch ? `${touch.protocol.name}: ${touch.contract.role}` : null;
}

const KNOWN_TOPICS: Readonly<Record<string, string>> = Object.freeze({
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef": "Transfer",
  "0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925": "Approval",
  "0xe1fffcc4923d04b559f4d29a8bfc6cda04eb5b0d3c460751c2402c5c5cc9109c": "Deposit",
  "0x7fcf532c15f0a6db0bd6d0e038bea71d30d808c7d98cb3bf7268a95bf5081b65": "Withdrawal",
  "0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67": "Swap (V3)",
  "0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822": "Swap (V2)",
});

/** One check: returns the updated record. */
export async function checkTrack(ctx: AppContext, record: TrackRecord): Promise<TrackRecord> {
  const now = ctx.clock.now();
  let status: TrackStatus;
  let detail = record.detail;
  if (record.kind === "evm-tx") {
    const observed = await portOf(ctx).observeTransaction(record.network, record.reference as Hex);
    if (observed.state === "landed") {
      const logs: TrackedLog[] = observed.logs.slice(0, 50).map((log) => ({ address: log.address, contract: contractLabel(record.network, log.address), event: KNOWN_TOPICS[log.topics[0] ?? ""] ?? null }));
      status = observed.status === "success" ? "confirmed" : "failed";
      detail = { blockNumber: observed.blockNumber.toString(), from: observed.from, to: observed.to, toContract: observed.to ? contractLabel(record.network, observed.to) : null, logs, explorerUrl: explorerTxUrl(record.network, record.reference), note: observed.status === "success" ? null : "The transaction reverted." };
    } else {
      status = observed.state === "pending" ? "pending" : now - record.createdAt > 10 * 60_000 ? "not_found" : "pending";
      detail = { ...detail, note: observed.state === "pending" ? "In the mempool, not in a block yet." : "Not seen by the RPC yet." };
    }
  } else {
    const parsed = parseReference(record.reference);
    if (parsed?.kind === "hc-cloid") {
      const result = (await ctx.hyperliquid.info(record.network).orderStatus(parsed.user, parsed.cloid)) as unknown as { status?: string; order?: { status?: string; order?: { coin?: string } } };
      const orderStatus = result.order?.status ?? result.status ?? "unknown";
      status = orderStatus === "filled" ? "confirmed" : /canceled|rejected|Canceled|Rejected/u.test(orderStatus) ? "failed" : orderStatus === "unknownOid" ? (now - record.createdAt > 10 * 60_000 ? "not_found" : "pending") : "pending";
      detail = { ...detail, note: `Order status: ${orderStatus}${result.order?.order?.coin ? ` (${result.order.order.coin})` : ""}.` };
    } else {
      status = "not_found";
      detail = { ...detail, note: "HyperCore actions referenced by nonce cannot be looked up through the info API; check the account's fills or ledger." };
    }
  }
  const checks = record.checks + 1;
  const terminal = status === "confirmed" || status === "failed" || status === "not_found";
  const expired = !terminal && now - record.createdAt > TRACK_MAX_AGE_MS;
  const delay = Math.min(BACKOFF_MAX_MS, TRACK_WORKER_MS * 2 ** Math.min(checks, 10));
  return { ...record, status: expired ? "expired" : status, detail, checks, updatedAt: now, nextCheckAt: terminal || expired ? null : now + delay };
}

export async function createTrack(ctx: AppContext, input: { readonly network: NetworkKey; readonly reference: string; readonly label?: string }): Promise<TrackView> {
  const network = NETWORKS[input.network];
  const parsed = parseReference(input.reference);
  if (!parsed) throw new ElyiaHttpError("INVALID_REQUEST", 400, "The reference is not a 0x transaction hash, hc:cloid:<user>:<cloid> or hc:nonce:<signer>:<nonce>.");
  const kind: TrackKind = parsed.kind === "evm-tx" ? "evm-tx" : parsed.kind === "hc-cloid" ? "hypercore-order" : "hypercore-action";
  if ((kind === "evm-tx") !== (network.vm === "evm")) throw new ElyiaHttpError("INVALID_REQUEST", 400, `A ${kind} reference does not belong on ${network.name}.`);
  if (kind === "evm-tx" && !ctx.chains.isAvailable(input.network)) throw new ElyiaHttpError("NETWORK_UNAVAILABLE", 503, `${network.name} has no RPC configured.`, { network: input.network });
  const reference = parsed.kind === "evm-tx" ? parsed.hash : input.reference.toLowerCase();
  const id = `trk_${sha256Hex(`${input.network}:${reference}`).slice(0, 24)}`;
  const existing = (await tracks(ctx).get(id))?.value;
  if (existing) return view(existing);
  const now = ctx.clock.now();
  const record: TrackRecord = { id, kind, network: input.network, reference, label: input.label ?? null, status: "pending", createdAt: now, updatedAt: now, checks: 0, nextCheckAt: now, detail: { blockNumber: null, from: null, to: null, toContract: null, logs: [], explorerUrl: kind === "evm-tx" ? explorerTxUrl(input.network, reference) : null, note: null } };
  const checked = await checkTrack(ctx, record).catch(() => record);
  await tracks(ctx).put(id, checked, { ttlMs: 7 * 24 * 60 * 60_000 });
  return view(checked);
}

export async function getTrack(ctx: AppContext, id: string): Promise<TrackView> {
  const record = (await tracks(ctx).get(id))?.value;
  if (!record) throw new ElyiaHttpError("NOT_FOUND", 404, "No such track.");
  return view(record);
}

interface WorkerState {
  timer: NodeJS.Timeout | null;
  running: boolean;
  lastRunAt: number | null;
  lastError: string | null;
  pending: number;
}

const workers = new WeakMap<AppContext, WorkerState>();

export async function trackerPass(ctx: AppContext, state: Pick<WorkerState, "pending">): Promise<number> {
  const now = ctx.clock.now();
  const due = (await tracks(ctx).list({ limit: 1_000 })).map((doc) => doc.value).filter((record) => record.nextCheckAt !== null);
  state.pending = due.length;
  let updated = 0;
  for (const record of due.filter((entry) => (entry.nextCheckAt ?? 0) <= now).slice(0, 25)) {
    const next = await checkTrack(ctx, record).catch(() => ({ ...record, nextCheckAt: now + BACKOFF_MAX_MS }));
    await tracks(ctx).put(record.id, next, { ttlMs: 7 * 24 * 60 * 60_000 });
    if (next.status !== record.status || next.checks !== record.checks) ctx.bus.emit("track.updated", view(next));
    updated += 1;
  }
  return updated;
}

export function startTracker(ctx: AppContext, intervalMs = TRACK_WORKER_MS): void {
  if (workers.has(ctx)) return;
  const state: WorkerState = { timer: null, running: false, lastRunAt: null, lastError: null, pending: 0 };
  state.timer = setInterval(() => {
    if (state.running) return;
    state.running = true;
    trackerPass(ctx, state)
      .then(() => {
        state.lastRunAt = ctx.clock.now();
      })
      .catch((error: unknown) => {
        state.lastError = error instanceof Error ? error.message.slice(0, 160) : "tracker failed";
      })
      .finally(() => {
        state.running = false;
      });
  }, intervalMs);
  state.timer.unref();
  workers.set(ctx, state);
  registerStats(ctx, "tracker", () => ({ running: true, lastRunAt: state.lastRunAt, lastError: state.lastError, pending: state.pending }));
}

export function stopTracker(ctx: AppContext): void {
  const state = workers.get(ctx);
  if (state?.timer) clearInterval(state.timer);
  workers.delete(ctx);
}


