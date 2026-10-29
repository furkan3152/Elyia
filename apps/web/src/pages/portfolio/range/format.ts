/** Money and quantity formatting for the range (pure). Money never tweens: these only format. */

const MINUS = "−";

/** "$4,978,543" (whole dollars), "$12.40" under $100, "$0.0042" under a cent. */
export function usdFull(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const sign = value < 0 ? MINUS : "";
  const abs = Math.abs(value);
  if (abs >= 100) return `${sign}$${Math.round(abs).toLocaleString("en-US")}`;
  if (abs >= 0.01) return `${sign}$${abs.toFixed(2)}`;
  if (abs === 0) return "$0";
  return `${sign}$${abs.toPrecision(2)}`;
}

/** "$4.98M", "$115k", "$3,411", "$12". */
export function usdShort(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const sign = value < 0 ? MINUS : "";
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(abs >= 1e10 ? 1 : 2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(abs >= 1e7 ? 1 : 2)}M`;
  if (abs >= 1e4) return `${sign}$${(abs / 1e3).toFixed(abs >= 1e5 ? 0 : 1)}k`;
  if (abs >= 10) return `${sign}$${Math.round(abs).toLocaleString("en-US")}`;
  return `${sign}$${abs.toFixed(2)}`;
}

/** Signed money with a chevron: "▲ +$1,204", "▼ −$880". Up/down is never colour alone. */
export function usdSigned(value: number | null | undefined, short = false): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const body = short ? usdShort(Math.abs(value)) : usdFull(Math.abs(value));
  if (value > 0) return `▲ +${body}`;
  if (value < 0) return `▼ ${MINUS}${body}`;
  return `${body}`;
}

/** "22.4%", "4.7%", "0.31%". */
export function pct(fraction: number | null | undefined, digits?: number): string {
  if (fraction === null || fraction === undefined || !Number.isFinite(fraction)) return "—";
  const value = fraction * 100;
  const d = digits ?? (Math.abs(value) >= 10 ? 0 : Math.abs(value) >= 1 ? 1 : 2);
  return `${value < 0 ? MINUS : ""}${Math.abs(value).toFixed(d)}%`;
}

export function pctSigned(fraction: number | null | undefined, digits?: number): string {
  if (fraction === null || fraction === undefined || !Number.isFinite(fraction)) return "—";
  if (fraction > 0) return `▲ +${pct(fraction, digits)}`;
  if (fraction < 0) return `▼ ${pct(fraction, digits)}`;
  return pct(0, digits);
}

/** Token amounts: 5 significant figures, grouped ("1,088.1", "0.00042"). */
export function amount(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs >= 1000) return value.toLocaleString("en-US", { maximumFractionDigits: abs >= 100_000 ? 0 : 1 });
  if (abs >= 1) return value.toLocaleString("en-US", { maximumFractionDigits: 3 });
  if (abs === 0) return "0";
  return value.toPrecision(3);
}

/** Price with 5 significant figures ("105.82", "0.38839", "3,298"). */
export function price(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value) || value <= 0) return "—";
  if (value >= 10_000) return Math.round(value).toLocaleString("en-US");
  return Number(value.toPrecision(5)).toLocaleString("en-US", { maximumFractionDigits: 8 });
}

export function shortAddr(address: string | null | undefined): string {
  if (!address) return "—";
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"] as const;

/** "29 OCT 14:02" in UTC (the log book keeps one clock). */
export function logTime(ms: number): string {
  const date = new Date(ms);
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const mm = String(date.getUTCMinutes()).padStart(2, "0");
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${hh}:${mm}`;
}

/** "SEP 24". */
export function dayLabel(ms: number): string {
  const date = new Date(ms);
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}`;
}

/** "14:02:11" UTC. */
export function clock(ms: number): string {
  return new Date(ms).toISOString().slice(11, 19);
}
