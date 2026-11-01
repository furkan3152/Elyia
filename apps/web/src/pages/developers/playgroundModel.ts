/**
 * The playground's pure side: what a parse or a dry-run plan means for the
 * route card an integrator's users see. Node tests load this file.
 */
import type { CreateIntentResponse } from "@elyia/core/api/intents";
import type { ParseIntentResponse } from "@elyia/core/api/language";

/** Base units ("1412080000", 6) -> "1,412.08" (at most `digits` decimals, trailing zeros dropped). */
export function formatUnits(baseUnits: string, decimals: number, digits = 4): string {
  if (!/^\d+$/u.test(baseUnits)) return baseUnits;
  const padded = baseUnits.padStart(decimals + 1, "0");
  const whole = padded.slice(0, padded.length - decimals) || "0";
  const fraction = decimals > 0 ? padded.slice(padded.length - decimals).slice(0, digits).replace(/0+$/u, "") : "";
  const grouped = whole.replace(/^0+(?=\d)/u, "").replace(/\B(?=(\d{3})+(?!\d))/gu, ",");
  return fraction ? `${grouped}.${fraction}` : grouped;
}

const LAYER: Readonly<Record<string, string>> = {
  "elysium-testnet": "Summit",
  "elysium-mainnet": "Summit",
  "hyperevm-testnet": "Ridge",
  "hyperevm-mainnet": "Ridge",
  "hypercore-testnet": "Floor",
  "hypercore-mainnet": "Floor",
};

export function layerOf(network: string): string {
  return LAYER[network] ?? network;
}

export interface UserCard {
  readonly title: string;
  /** "Summit · 1 camp". */
  readonly where: string;
  readonly send: string | null;
  readonly get: string | null;
  readonly venue: string | null;
  readonly steps: readonly { readonly title: string; readonly layer: string }[];
  readonly feeUsd: number | null;
  /** True when the card comes from a priced plan; false for a reading only. */
  readonly priced: boolean;
}

function amount(list: CreateIntentResponse["intent"]["summary"]["inputs"]): string | null {
  const first = list[0];
  return first ? `${formatUnits(first.expected, first.decimals)} ${first.symbol}` : null;
}

/** A goal's kind in one word ("swap", "rule", "query"). */
export function goalWord(goal: ParseIntentResponse["goals"][number]): string {
  if (goal.t === "value" || goal.t === "trade") return String((goal.goal as { readonly kind?: unknown }).kind ?? goal.t);
  return goal.t;
}

/** The route card from a dry-run plan (priced) or, failing that, from the reading. */
export function userCard(parse: ParseIntentResponse | null, plan: CreateIntentResponse | null): UserCard | null {
  if (plan) {
    const { intent, quotes } = plan;
    const layers = [...new Set(intent.steps.map((step) => layerOf(step.network)))];
    const winners = quotes.filter((quote) => quote.winner);
    const counted = new Set(quotes.filter((quote) => !quote.excluded).map((quote) => quote.protocol)).size;
    const usd = intent.summary.inputs.reduce<number | null>((sum, input) => (input.usd ? (sum ?? 0) + Number(input.usd) : sum), null);
    return {
      title: intent.summary.title,
      where: `${layers.join(" → ") || "—"} · ${intent.steps.length} camp${intent.steps.length === 1 ? "" : "s"}`,
      send: amount(intent.summary.inputs),
      get: amount(intent.summary.outputs),
      venue: winners[0] ? `${winners[0].protocol}${counted > 1 ? ` · 1 of ${counted}` : ""}` : null,
      steps: intent.steps.map((step) => ({ title: step.title, layer: layerOf(step.network) })),
      feeUsd: usd,
      priced: true,
    };
  }
  if (parse && parse.goals.length > 0) {
    return {
      title: parse.canonical ?? parse.goals.map(goalWord).join(" + "),
      where: parse.status === "ready" ? "reading ready · plan to price it" : `reading ${parse.status}`,
      send: null,
      get: null,
      venue: null,
      steps: parse.goals.map((goal) => ({ title: goalWord(goal), layer: "" })),
      feeUsd: null,
      priced: false,
    };
  }
  return null;
}

/** The integrator fee in USD on the card's input value, when it is priced. */
export function integratorFeeUsd(card: Pick<UserCard, "feeUsd">, bps: number): number | null {
  if (card.feeUsd === null || !Number.isFinite(card.feeUsd)) return null;
  return Math.round(card.feeUsd * bps) / 100 / 100;
}

/** Pretty JSON for the console, trimmed so a huge response never freezes the typing. */
export function consoleJson(value: unknown, maxChars = 6_000): string {
  const text = JSON.stringify(value, null, 2) ?? "null";
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n… (${text.length - maxChars} more characters)` : text;
}

/** CAIP-10 account for the plan call: the signed-in wallet on Elysium testnet. */
export function planAccount(address: string | null, chainId = 99801): string | null {
  return address && /^0x[0-9a-fA-F]{40}$/u.test(address) ? `eip155:${chainId}:${address}` : null;
}
