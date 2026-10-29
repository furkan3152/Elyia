/**
 * Pure conversion of a raw `eth_getBlockByNumber` result (Nitro header) into a
 * PulseBlock, matching the API's definitions: `txCount` counts user
 * transactions only (Nitro's first transaction in every block is ArbOS's
 * internal start-block message), and the base fee is converted to gwei.
 */
import type { NetworkKey } from "@elyia/core/networks";
import type { PulseBlock } from "@elyia/core/pulse";

const HEX_QUANTITY = /^0x[0-9a-fA-F]{1,64}$/u;
const HASH = /^0x[0-9a-fA-F]{64}$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function hexToSafeNumber(hex: unknown): number | null {
  if (typeof hex !== "string" || !HEX_QUANTITY.test(hex)) return null;
  const value = Number.parseInt(hex, 16);
  return Number.isSafeInteger(value) ? value : null;
}

/** wei (hex) -> gwei with up to 9 decimals. */
export function weiHexToGwei(hex: unknown): number | null {
  if (typeof hex !== "string" || !HEX_QUANTITY.test(hex)) return null;
  const wei = BigInt(hex);
  const whole = wei / 1_000_000_000n;
  const fraction = wei % 1_000_000_000n;
  return Number(`${whole}.${fraction.toString().padStart(9, "0")}`);
}

export function rpcBlockToPulseBlock(raw: unknown, network: NetworkKey, seenAt: number): PulseBlock | null {
  if (!isRecord(raw)) return null;
  const number = hexToSafeNumber(raw.number);
  const timestamp = hexToSafeNumber(raw.timestamp);
  if (number === null || timestamp === null) return null;
  if (typeof raw.hash !== "string" || !HASH.test(raw.hash)) return null;
  if (!Array.isArray(raw.transactions)) return null;
  if (typeof raw.gasUsed !== "string" || !HEX_QUANTITY.test(raw.gasUsed)) return null;
  const baseFeeGwei = raw.baseFeePerGas === undefined || raw.baseFeePerGas === null ? 0 : weiHexToGwei(raw.baseFeePerGas);
  if (baseFeeGwei === null) return null;
  const l1BlockNumber = raw.l1BlockNumber === undefined || raw.l1BlockNumber === null ? null : hexToSafeNumber(raw.l1BlockNumber);
  return {
    network,
    number,
    hash: raw.hash,
    timestamp,
    txCount: Math.max(0, raw.transactions.length - 1),
    gasUsed: BigInt(raw.gasUsed).toString(),
    baseFeeGwei,
    l1BlockNumber,
    seenAt,
  };
}

/** Block numbers to fetch after `known` up to `head`, newest last, at most `max` (older gaps are skipped). */
export function missingBlockNumbers(known: number | null, head: number, max: number): number[] {
  if (known !== null && head <= known) return [];
  const from = known === null ? head : Math.max(known + 1, head - max + 1);
  const out: number[] = [];
  for (let n = from; n <= head; n += 1) out.push(n);
  return out;
}

/** JSON-RPC error codes and messages that mean "slow down". */
export function isRateLimited(error: unknown): boolean {
  if (!isRecord(error)) return false;
  const code = error.code;
  const message = typeof error.message === "string" ? error.message.toLowerCase() : "";
  return code === -32005 || code === -32017 || code === 429 || message.includes("rate limit") || message.includes("too many requests");
}
