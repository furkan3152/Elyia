/**
 * Router controls, pure: the protocol fee (capped by the contract), the typed
 * pause confirmation and the calldata the owner's wallet will sign.
 */
import { encodeFunctionData, type Abi, type Address } from "viem";

/** ElyiaRouter.MAX_PROTOCOL_FEE_BPS when the live read is missing (manifest: "Hard cap 30 bps"). */
export const FALLBACK_PROTOCOL_FEE_CAP = 30;

/** The cap from the router's own read, else the manifest's. */
export function protocolFeeCap(reads: Readonly<Record<string, string | null>> | undefined): number {
  const raw = reads?.MAX_PROTOCOL_FEE_BPS;
  const value = raw === null || raw === undefined ? Number.NaN : Number(raw);
  return Number.isInteger(value) && value >= 0 && value <= 10_000 ? value : FALLBACK_PROTOCOL_FEE_CAP;
}

export function clampFee(value: number, cap: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(cap, Math.round(value)));
}

/** What the owner types to pause (or resume) the router on a chain. */
export function confirmPhrase(action: "pause" | "unpause", chainId: number): string {
  return `${action === "pause" ? "PAUSE" : "RESUME"} ${chainId}`;
}

export function phraseMatches(typed: string, expected: string): boolean {
  return typed.trim().replace(/\s+/gu, " ").toUpperCase() === expected;
}

export function setProtocolFeeData(abi: Abi, feeBps: number, recipient: string): `0x${string}` {
  return encodeFunctionData({ abi, functionName: "setProtocolFee", args: [feeBps, recipient as Address] });
}

export function pauseData(abi: Abi, action: "pause" | "unpause"): `0x${string}` {
  return encodeFunctionData({ abi, functionName: action, args: [] });
}

/** "true" / "false" / null -> boolean | null (the API returns every read as a string). */
export function readBool(value: string | null | undefined): boolean | null {
  return value === "true" ? true : value === "false" ? false : null;
}
