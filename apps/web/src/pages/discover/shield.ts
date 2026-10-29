/**
 * Shield, browser edition (pure): the route condition of a token from what
 * the public RPC can prove right now (code, ERC-20 metadata, supply, owner,
 * EIP-1967 proxy slot) plus Elyia's verified token list. Liquidity, holder
 * concentration and a sell simulation need the discovery API; until it
 * answers they are reported as "not checked", and an unverified token can
 * never read OPEN on browser checks alone.
 */
import type { TokenTrust } from "@elyia/core/assets";
import { decodeFunctionResult, encodeFunctionData, erc20Abi, hexToString, type Hex } from "viem";

import { conditionFromScore, type Condition } from "../../topo/geometry/conditions";

export const EIP1967_IMPLEMENTATION_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
const OWNER_ABI = [{ type: "function", name: "owner", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] }] as const;
const BYTES32_SYMBOL_ABI = [{ type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "bytes32" }] }] as const;
const ZERO = "0x0000000000000000000000000000000000000000";

export type CallName = "name" | "symbol" | "decimals" | "totalSupply" | "owner";

/** The JSON-RPC calls one check needs, in order: code, proxy slot, then the five eth_calls. */
export function shieldCalls(address: string): Array<{ method: string; params: unknown[] }> {
  const call = (data: Hex) => ({ method: "eth_call", params: [{ to: address, data }, "latest"] });
  return [
    { method: "eth_getCode", params: [address, "latest"] },
    { method: "eth_getStorageAt", params: [address, EIP1967_IMPLEMENTATION_SLOT, "latest"] },
    call(encodeFunctionData({ abi: erc20Abi, functionName: "name" })),
    call(encodeFunctionData({ abi: erc20Abi, functionName: "symbol" })),
    call(encodeFunctionData({ abi: erc20Abi, functionName: "decimals" })),
    call(encodeFunctionData({ abi: erc20Abi, functionName: "totalSupply" })),
    call(encodeFunctionData({ abi: OWNER_ABI, functionName: "owner" })),
  ];
}

/** A call's raw answer: the hex result, or null when it reverted / was absent. */
export type RawAnswer = string | null;

export interface TokenFacts {
  readonly hasCode: boolean;
  readonly codeBytes: number;
  readonly implementation: string | null;
  readonly name: string | null;
  readonly symbol: string | null;
  readonly decimals: number | null;
  readonly totalSupply: bigint | null;
  /** null: no owner() function; ZERO: renounced. */
  readonly owner: string | null;
}

function isHex(value: RawAnswer): value is Hex {
  return typeof value === "string" && /^0x[0-9a-fA-F]*$/u.test(value);
}

function decodeText(raw: RawAnswer, functionName: "name" | "symbol"): string | null {
  if (!isHex(raw) || raw.length <= 2) return null;
  try {
    const text = decodeFunctionResult({ abi: erc20Abi, functionName, data: raw });
    return typeof text === "string" && text.trim().length > 0 ? text.trim().slice(0, 64) : null;
  } catch {
    // Old tokens return bytes32.
    try {
      const bytes = decodeFunctionResult({ abi: BYTES32_SYMBOL_ABI, functionName: "symbol", data: raw });
      const text = hexToString(bytes).replace(/\0+$/u, "").trim();
      return text.length > 0 ? text.slice(0, 64) : null;
    } catch {
      return null;
    }
  }
}

function decodeUint(raw: RawAnswer, functionName: "decimals" | "totalSupply"): bigint | null {
  if (!isHex(raw) || raw.length < 66) return null;
  try {
    const value = decodeFunctionResult({ abi: erc20Abi, functionName, data: raw });
    return BigInt(value);
  } catch {
    return null;
  }
}

export function factsFrom(answers: readonly RawAnswer[]): TokenFacts {
  const [code, slot, name, symbol, decimals, supply, owner] = answers;
  const hasCode = isHex(code ?? null) && (code as string).length > 2;
  const implementationWord = isHex(slot ?? null) && (slot as string).length >= 42 ? `0x${(slot as string).slice(-40)}` : null;
  const implementation = implementationWord && implementationWord !== ZERO ? implementationWord.toLowerCase() : null;
  let ownerAddress: string | null = null;
  if (isHex(owner ?? null) && (owner as string).length >= 66) {
    try {
      ownerAddress = decodeFunctionResult({ abi: OWNER_ABI, functionName: "owner", data: owner as Hex }).toLowerCase();
    } catch {
      ownerAddress = null;
    }
  }
  const decimalsValue = decodeUint(decimals ?? null, "decimals");
  return {
    hasCode,
    codeBytes: hasCode ? ((code as string).length - 2) / 2 : 0,
    implementation,
    name: decodeText(name ?? null, "name"),
    symbol: decodeText(symbol ?? null, "symbol"),
    decimals: decimalsValue !== null && decimalsValue <= 255n ? Number(decimalsValue) : null,
    totalSupply: decodeUint(supply ?? null, "totalSupply"),
    owner: ownerAddress,
  };
}

export type CheckResult = "pass" | "warn" | "fail" | "unknown";

export interface ShieldCheck {
  readonly id: string;
  readonly label: string;
  readonly result: CheckResult;
  readonly detail: string;
}

export interface ShieldReport {
  readonly score: number;
  readonly condition: Condition;
  /** One line for the sign. */
  readonly reason: string;
  readonly checks: readonly ShieldCheck[];
  readonly facts: TokenFacts;
}

function formatSupply(supply: bigint, decimals: number | null): string {
  const scale = 10n ** BigInt(decimals ?? 0);
  const whole = supply / scale;
  const text = whole.toString();
  if (text.length > 15) return `${text.slice(0, text.length - 12)}T+`;
  return Number(whole).toLocaleString("en-US");
}

/** Score and condition from the facts and the registry verdict. */
export function shieldReport(facts: TokenFacts, trust: TokenTrust): ShieldReport {
  const checks: ShieldCheck[] = [];
  if (!facts.hasCode) {
    checks.push({ id: "code", label: "Contract on chain", result: "fail", detail: "No contract code at this address on this network." });
    return { score: 0, condition: "closed", reason: "no contract here: wrong network or a wallet address", checks, facts };
  }
  checks.push({ id: "code", label: "Contract on chain", result: "pass", detail: `${facts.codeBytes.toLocaleString("en-US")} bytes of code` });

  const erc20 = facts.symbol !== null && facts.decimals !== null && facts.totalSupply !== null;
  checks.push({
    id: "erc20",
    label: "Speaks ERC-20",
    result: erc20 ? "pass" : "fail",
    detail: erc20 ? `${facts.name ?? facts.symbol} · ${facts.symbol} · ${facts.decimals} decimals` : "symbol(), decimals() or totalSupply() did not answer",
  });

  let registry: ShieldCheck;
  if (trust.status === "verified") registry = { id: "registry", label: "Elyia's verified list", result: "pass", detail: `pinned as ${trust.token.symbol}, read back on chain` };
  else if (trust.status === "lookalike") registry = { id: "registry", label: "Elyia's verified list", result: "fail", detail: `look-alike of ${trust.lookalikeOf.symbol}: same name, different contract` };
  else registry = { id: "registry", label: "Elyia's verified list", result: "warn", detail: "not listed: unknown is not the same as unsafe, but check before you climb" };
  checks.push(registry);

  checks.push(
    facts.implementation
      ? { id: "proxy", label: "Fixed code", result: "warn", detail: `upgradeable proxy: logic at ${facts.implementation.slice(0, 10)}… can be swapped` }
      : { id: "proxy", label: "Fixed code", result: "pass", detail: "no EIP-1967 implementation slot" },
  );

  checks.push(
    facts.owner === null
      ? { id: "owner", label: "Owner powers", result: "unknown", detail: "no owner() function; other roles may exist" }
      : facts.owner === ZERO
        ? { id: "owner", label: "Owner powers", result: "pass", detail: "ownership renounced" }
        : { id: "owner", label: "Owner powers", result: "warn", detail: `owned by ${facts.owner.slice(0, 6)}…${facts.owner.slice(-4)}` },
  );

  if (facts.totalSupply !== null) {
    checks.push(facts.totalSupply > 0n ? { id: "supply", label: "Supply", result: "pass", detail: `${formatSupply(facts.totalSupply, facts.decimals)} minted` } : { id: "supply", label: "Supply", result: "warn", detail: "nothing minted yet" });
  }
  checks.push({ id: "liquidity", label: "Liquidity, holders, sell test", result: "unknown", detail: "needs the discovery API: not checked" });

  let score: number;
  if (trust.status === "lookalike") score = 8;
  else if (!erc20) score = 22;
  else {
    score = trust.status === "verified" ? 88 : 56;
    if (facts.implementation) score -= trust.status === "verified" ? 6 : 14;
    if (facts.owner && facts.owner !== ZERO) score -= trust.status === "verified" ? 4 : 10;
    if (facts.owner === ZERO) score += 6;
    if (facts.totalSupply === 0n) score -= 16;
    // Browser checks alone never open an unlisted token.
    if (trust.status !== "verified") score = Math.min(score, 64);
  }
  score = Math.max(0, Math.min(100, score));
  const condition = conditionFromScore(score);
  const reason =
    trust.status === "lookalike"
      ? `look-alike of ${trust.lookalikeOf.symbol}`
      : !erc20
        ? "not a standard token"
        : trust.status === "verified"
          ? facts.implementation
            ? "verified · upgradeable"
            : "verified token"
          : facts.implementation
            ? "unlisted · upgradeable"
            : "unlisted · liquidity not checked";
  return { score, condition, reason, checks, facts };
}
