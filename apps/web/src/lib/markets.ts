/**
 * Market summaries for the Lyre (pure). `GET /v1/markets` is parsed
 * defensively (the field names of HyperCore's meta + asset contexts and the
 * API's own summary are both accepted); rows that cannot be read are dropped.
 * When nothing usable arrives the caller shows a deterministic demo set and
 * says so ("demo").
 */
import type { LyreString } from "../visuals/lyre/Lyre";
import { formatChangeCompact } from "./format";

export interface MarketSummary {
  readonly coin: string;
  /** 24 h notional volume in USD. */
  readonly volumeUsd: number;
  /** 24 h change as a fraction (0.042 = +4.2%); null when unknown. */
  readonly change: number | null;
  readonly markPx: number | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function num(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function first(record: Record<string, unknown>, keys: readonly string[]): unknown {
  for (const key of keys) if (record[key] !== undefined && record[key] !== null) return record[key];
  return undefined;
}

/** One row, or null when it has no coin or no volume. */
export function parseMarketRow(row: unknown): MarketSummary | null {
  if (!isRecord(row)) return null;
  const ctx = isRecord(row.ctx) ? row.ctx : isRecord(row.context) ? row.context : {};
  const merged: Record<string, unknown> = { ...ctx, ...row };
  const coin = first(merged, ["coin", "name", "symbol", "market"]);
  if (typeof coin !== "string" || !/^[A-Za-z0-9:@/_-]{1,24}$/u.test(coin)) return null;
  const volume = num(first(merged, ["volume24hUsd", "volume24h", "dayNtlVlm", "volumeUsd", "volume"]));
  if (volume === null || volume < 0) return null;
  const markPx = num(first(merged, ["markPx", "mark", "midPx", "mid", "price"]));
  const prev = num(first(merged, ["prevDayPx", "prevDay", "open24h"]));
  let change = num(first(merged, ["change24h", "dayChange", "change"]));
  const changePct = num(first(merged, ["change24hPct", "changePct"]));
  if (change === null && changePct !== null) change = changePct / 100;
  if (change === null && markPx !== null && prev !== null && prev > 0) change = markPx / prev - 1;
  return { coin, volumeUsd: volume, change, markPx };
}

/** All readable rows from any accepted response shape. */
export function parseMarkets(body: unknown): MarketSummary[] {
  const rows: unknown[] = Array.isArray(body)
    ? body
    : isRecord(body)
      ? [...(Array.isArray(body.perps) ? body.perps : []), ...(Array.isArray(body.markets) ? body.markets : []), ...(Array.isArray(body.data) ? body.data : [])]
      : [];
  const out: MarketSummary[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const market = parseMarketRow(row);
    if (!market || seen.has(market.coin)) continue;
    seen.add(market.coin);
    out.push(market);
  }
  return out;
}

/** The `count` most traded markets, by 24 h volume. */
export function hottestMarkets(markets: readonly MarketSummary[], count = 7): MarketSummary[] {
  return [...markets].sort((a, b) => b.volumeUsd - a.volumeUsd).slice(0, count);
}

/**
 * Lyre strings for markets: tint by the sign of the 24 h change, hum by its
 * size (|change| of 8% or more hums fully), thickness by volume (square root,
 * so the biggest market does not dwarf the rest).
 */
export function marketStrings(markets: readonly MarketSummary[]): LyreString[] {
  const maxVolume = Math.max(1, ...markets.map((market) => market.volumeUsd));
  return markets.map((market) => {
    const change = market.change;
    return {
      id: market.coin,
      label: market.coin.length > 6 ? market.coin.slice(0, 5) : market.coin,
      sublabel: formatChangeCompact(change, 1),
      amplitude: change === null ? 0.1 : Math.min(1, 0.12 + Math.abs(change) / 0.08),
      tint: change === null || Math.abs(change) < 0.0005 ? "violet" : change > 0 ? "mint" : "rose",
      thickness: Math.sqrt(market.volumeUsd / maxVolume),
    };
  });
}

/** Deterministic demo markets, shown (and labelled "demo") only when live data is unavailable. */
export const DEMO_MARKETS: readonly MarketSummary[] = Object.freeze([
  { coin: "HYPE", volumeUsd: 412_000_000, change: 0.042, markPx: null },
  { coin: "BTC", volumeUsd: 1_900_000_000, change: 0.011, markPx: null },
  { coin: "ETH", volumeUsd: 980_000_000, change: -0.023, markPx: null },
  { coin: "SOL", volumeUsd: 310_000_000, change: 0.002, markPx: null },
  { coin: "PURR", volumeUsd: 41_000_000, change: 0.098, markPx: null },
  { coin: "kPEPE", volumeUsd: 66_000_000, change: -0.054, markPx: null },
  { coin: "FARTCOIN", volumeUsd: 88_000_000, change: -0.12, markPx: null },
]);
