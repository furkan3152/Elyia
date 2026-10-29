import type { TradeMarket } from "../../lib/hypercore/marketCatalog";

/** "ETH-PERP", "HYPE/USDC", "xyz:TSLA". */
export function marketTitle(market: TradeMarket | null): string {
  if (!market) return "—";
  if (market.kind === "perp") return `${market.base}-PERP`;
  return market.displayName;
}

/** "+2.14%" / "−0.80%" (true minus sign), or "—". */
export function signedPercent(fraction: number | null | undefined, digits = 2): string {
  if (fraction === null || fraction === undefined || !Number.isFinite(fraction)) return "—";
  return `${fraction >= 0 ? "+" : "−"}${Math.abs(fraction * 100).toFixed(digits)}%`;
}

/** "+$66.20" / "−$61.00". */
export function signedUsd(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return `${value >= 0 ? "+" : "−"}$${abs}`;
}

/** "$1,234.56". */
export function usd(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

/** "14:02:11" local time. */
export function clock(ms: number, withMs = false): string {
  const date = new Date(ms);
  const pad = (value: number, size = 2) => String(value).padStart(size, "0");
  const base = `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  return withMs ? `${base}.${pad(date.getMilliseconds(), 3)}` : base;
}

/** "Oct 29 14:02". */
export function dateTime(ms: number): string {
  const date = new Date(ms);
  return `${date.toLocaleDateString("en-US", { month: "short", day: "numeric" })} ${clock(ms).slice(0, 5)}`;
}
