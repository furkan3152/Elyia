/**
 * Attribution of HyperCore ledger entries (`userNonFundingLedgerUpdates`) to
 * prepared user-signed actions. An entry matches only when its type is one
 * the action produces and every bound field (destination, token, amount,
 * direction, and the nonce where the entry carries one) equals the signed
 * message. An exchange reply is never proof; the ledger is.
 */
import { compareDecimal, isDecimalAmount } from "@elyia/core";
import type { LedgerUpdate } from "../../hyperliquid/types.js";

export interface LedgerExpectation {
  /** Delta types the action can produce (`send`, `spotTransfer`, `accountClassTransfer`...). */
  readonly types: readonly string[];
  readonly nonce?: number;
  readonly destination?: string;
  /** Token name (`HYPE`; `HYPE:0x…` is reduced to its name). */
  readonly token?: string;
  readonly amount?: string;
  /** usdClassTransfer: direction. */
  readonly toPerp?: boolean;
  /** Unix ms: entries older than this are not this action. */
  readonly notBefore: number;
}

function text(value: unknown): string | null {
  return typeof value === "string" ? value : typeof value === "number" ? String(value) : null;
}

function sameAmount(a: unknown, b: string): boolean {
  const left = text(a);
  return left !== null && isDecimalAmount(left.replace(/^-/u, "")) && compareDecimal(left.replace(/^-/u, ""), b) === 0;
}

function tokenName(value: string): string {
  return value.split(":")[0]?.toUpperCase() ?? "";
}

/** The first ledger entry matching the expectation, or null. */
export function matchLedger(entries: readonly LedgerUpdate[], expect: LedgerExpectation): LedgerUpdate | null {
  for (const entry of entries) {
    if (entry.time < expect.notBefore) continue;
    const delta = entry.delta as Record<string, unknown>;
    const type = text(delta.type);
    if (!type || !expect.types.includes(type)) continue;
    if (expect.nonce !== undefined && delta.nonce !== undefined && delta.nonce !== null && Number(delta.nonce) !== expect.nonce) continue;
    if (expect.destination !== undefined && text(delta.destination)?.toLowerCase() !== expect.destination.toLowerCase()) continue;
    if (expect.token !== undefined) {
      const token = text(delta.token);
      if (!token || tokenName(token) !== tokenName(expect.token)) continue;
    }
    if (expect.amount !== undefined) {
      const amount = delta.amount ?? delta.usdc;
      if (!sameAmount(amount, expect.amount)) continue;
    }
    if (expect.toPerp !== undefined && delta.toPerp !== expect.toPerp) continue;
    return entry;
  }
  return null;
}

/** Ledger expectation of a prepared user-signed message (spotSend / usdSend / usdClassTransfer). */
export function expectationFor(actionType: string, message: Readonly<Record<string, string | number | boolean>>, notBefore: number): LedgerExpectation | null {
  switch (actionType) {
    case "spotSend":
      return {
        types: ["spotTransfer", "send"],
        nonce: Number(message.time),
        destination: String(message.destination),
        token: String(message.token),
        amount: String(message.amount),
        notBefore,
      };
    case "usdSend":
      return { types: ["internalTransfer", "send"], nonce: Number(message.time), destination: String(message.destination), amount: String(message.amount), notBefore };
    case "usdClassTransfer":
      return { types: ["accountClassTransfer"], amount: String(message.amount), toPerp: message.toPerp === true, notBefore };
    default:
      return null;
  }
}
