/**
 * Optimistic order rows and their reconciliation (pure). A row appears the
 * moment the user's order is signed and sent; the live feeds then decide
 * what it became:
 *
 * - `orderUpdates` (pushed per order, keyed by cloid): open -> resting,
 *   filled -> filled, any terminal non-fill status (canceled, rejected,
 *   margin-canceled...) -> the row goes;
 * - the open-orders and fills feeds: once the real order or its fill is
 *   listed, the optimistic row has done its job and goes;
 * - a row nothing has confirmed within `timeoutMs` goes too (the exchange
 *   reply already told the user what happened).
 *
 * The exchange reply is a hint, the feeds are the truth.
 */
import { isTerminalOrderStatus } from "@elyia/core/hypercore/info";

import type { PendingOrder } from "./tradeStore";

export interface OrderUpdate {
  readonly coin: string;
  readonly oid: number;
  readonly cloid: string | null;
  readonly status: string;
  readonly statusTimestamp: number;
}

/** `orderUpdates` channel data (an array of `{order, status, statusTimestamp}`) -> updates; malformed entries are skipped. */
export function parseOrderUpdates(data: unknown): OrderUpdate[] {
  if (!Array.isArray(data)) return [];
  const out: OrderUpdate[] = [];
  for (const entry of data) {
    const record = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : null;
    const order = record?.order && typeof record.order === "object" ? (record.order as Record<string, unknown>) : null;
    if (!record || !order || typeof order.oid !== "number" || typeof record.status !== "string") continue;
    out.push({
      coin: typeof order.coin === "string" ? order.coin : "",
      oid: order.oid,
      cloid: typeof order.cloid === "string" ? order.cloid.toLowerCase() : null,
      status: record.status,
      statusTimestamp: typeof record.statusTimestamp === "number" ? record.statusTimestamp : 0,
    });
  }
  return out;
}

export interface PendingChanges {
  /** Rows to remove. */
  readonly drop: readonly string[];
  /** Rows whose status moves on. */
  readonly update: readonly { readonly cloid: string; readonly status: PendingOrder["status"] }[];
}

const NO_CHANGES: PendingChanges = Object.freeze({ drop: [], update: [] });

/** What a batch of order updates does to the optimistic rows. */
export function applyOrderUpdates(pending: readonly PendingOrder[], updates: readonly OrderUpdate[]): PendingChanges {
  if (pending.length === 0 || updates.length === 0) return NO_CHANGES;
  const byCloid = new Map(pending.map((row) => [row.cloid.toLowerCase(), row]));
  const drop: string[] = [];
  const update: { cloid: string; status: PendingOrder["status"] }[] = [];
  for (const change of updates) {
    const row = change.cloid ? byCloid.get(change.cloid) : undefined;
    if (!row) continue;
    if (change.status === "open" || change.status === "triggered") {
      if (row.status !== "resting") update.push({ cloid: row.cloid, status: "resting" });
    } else if (change.status === "filled") {
      if (row.status !== "filled") update.push({ cloid: row.cloid, status: "filled" });
    } else if (isTerminalOrderStatus(change.status) || /canceled|rejected/iu.test(change.status)) {
      drop.push(row.cloid);
    }
  }
  return drop.length === 0 && update.length === 0 ? NO_CHANGES : { drop, update };
}

/** Rows the open-orders or fills feeds now show for real, or that waited longer than `timeoutMs`. */
export function settledPending(
  pending: readonly PendingOrder[],
  feeds: { readonly openOrders: readonly { readonly cloid?: string | null }[] | null; readonly fills: readonly { readonly cloid?: string | null }[] | null },
  now: number,
  timeoutMs = 20_000,
): string[] {
  if (pending.length === 0) return [];
  const seen = new Set<string>();
  for (const order of feeds.openOrders ?? []) if (order.cloid) seen.add(order.cloid.toLowerCase());
  for (const fill of feeds.fills ?? []) if (fill.cloid) seen.add(fill.cloid.toLowerCase());
  return pending.filter((row) => seen.has(row.cloid.toLowerCase()) || now - row.at > timeoutMs).map((row) => row.cloid);
}
