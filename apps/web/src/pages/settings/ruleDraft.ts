/**
 * The Rule Book editor's form model (pure): the user's overrides as text
 * fields and back, and which changes loosen the book. The same overrides
 * drive the terminal, the Guide and the trading key's guard.
 */
import { loosenedRules } from "@elyia/core/policy";

import { effectiveRuleBook, type GuardOverrides } from "../../features/trading/guard";

export interface RuleDraft {
  readonly maxLeverage: string;
  readonly maxNotionalUsd: string;
  readonly maxSlippagePct: string;
  readonly dailyVolumeUsd: string;
  readonly dailyLossUsd: string;
  readonly confirmAboveUsd: string;
  readonly markets: string;
  readonly reduceOnly: boolean;
  readonly paused: boolean;
  readonly allowMainnet: boolean;
}

export function toDraft(overrides: GuardOverrides): RuleDraft {
  const book = effectiveRuleBook(overrides).book;
  return {
    maxLeverage: String(book.trading?.maxLeverage ?? ""),
    maxNotionalUsd: book.trading?.maxNotionalUsd ?? "",
    maxSlippagePct: book.trading?.maxSlippageBps !== undefined ? String(book.trading.maxSlippageBps / 100) : "",
    dailyVolumeUsd: book.trading?.dailyVolumeUsd ?? "",
    dailyLossUsd: book.trading?.dailyLossUsd ?? "",
    confirmAboveUsd: book.confirm?.aboveUsd ?? "",
    markets: (book.trading?.markets?.allow ?? []).join(", "),
    reduceOnly: book.trading?.reduceOnly === true,
    paused: book.mode === "paused",
    allowMainnet: (book.networks?.environments ?? []).includes("mainnet"),
  };
}

export function toOverrides(draft: RuleDraft): GuardOverrides {
  const usd = (value: string) => (value.trim() === "" || !Number.isFinite(Number(value)) ? undefined : String(Math.round(Number(value) * 100) / 100));
  const markets = draft.markets
    .split(/[\s,]+/u)
    .map((entry) => entry.trim().toUpperCase())
    .filter(Boolean);
  const leverage = Math.round(Number(draft.maxLeverage));
  const slippage = Math.round(Number(draft.maxSlippagePct) * 100);
  return {
    ...(draft.maxLeverage && Number.isFinite(leverage) ? { maxLeverage: Math.max(1, leverage) } : {}),
    ...(usd(draft.maxNotionalUsd) ? { maxNotionalUsd: usd(draft.maxNotionalUsd) } : {}),
    ...(draft.maxSlippagePct && Number.isFinite(slippage) ? { maxSlippageBps: Math.max(1, slippage) } : {}),
    ...(usd(draft.dailyVolumeUsd) ? { dailyVolumeUsd: usd(draft.dailyVolumeUsd) } : {}),
    ...(usd(draft.dailyLossUsd) ? { dailyLossUsd: usd(draft.dailyLossUsd) } : {}),
    ...(usd(draft.confirmAboveUsd) ? { confirmAboveUsd: usd(draft.confirmAboveUsd) } : {}),
    ...(markets.length > 0 ? { markets } : {}),
    ...(draft.reduceOnly ? { reduceOnly: true } : {}),
    ...(draft.paused ? { paused: true } : {}),
    ...(draft.allowMainnet ? { allowMainnet: true } : {}),
  };
}

const RULE_NAMES: Readonly<Record<string, string>> = {
  mode: "kill switch off",
  "networks.environments": "mainnet allowed",
  "trading.maxLeverage": "higher leverage",
  "trading.maxNotionalUsd": "bigger orders",
  "trading.maxSlippageBps": "more slippage",
  "limits.maxSlippageBps": "more slippage",
  "trading.dailyVolumeUsd": "more daily volume",
  "trading.dailyLossUsd": "a later loss stop",
  "confirm.aboveUsd": "fewer confirmations",
  "trading.markets.allow": "more markets",
  "trading.reduceOnly": "new risk allowed",
};

/** What a draft would loosen against the current overrides, in words (empty = only tighter or equal). */
export function loosenedBy(current: GuardOverrides, draft: RuleDraft): string[] {
  const before = effectiveRuleBook(current).book;
  const after = effectiveRuleBook(toOverrides(draft)).book;
  return [...new Set(loosenedRules(before, after).map((path) => RULE_NAMES[path] ?? path))];
}

/** True when the draft differs from what is saved. */
export function draftChanged(current: GuardOverrides, draft: RuleDraft): boolean {
  return JSON.stringify(toDraft(current)) !== JSON.stringify(draft);
}
