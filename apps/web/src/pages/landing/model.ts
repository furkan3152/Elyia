/**
 * Pure model of the landing page (node:test loads this file):
 *
 * - a public testnet trader's balance sheet (GET /v1/portfolio/:address)
 *   turned into Relief holdings, three ropes and a layer split;
 * - what a typed sentence touches: its chips, its layers, its grade.
 *
 * No I/O. Unknown stays null, never zero.
 */
import { gradeFor, type Grade } from "../../topo/geometry/conditions";
import type { Layer, ReliefHolding } from "../../topo/geometry/relief";
import type { TerrainHolding } from "../../pixel/terrain";
import { previewChips, type ChipKind } from "../../oracle/preview";

/* ------------------------------------------------------------ the trader */

/** The slice of @elyia/core/api/portfolio's PortfolioSnapshot the landing reads. */
export interface TraderPosition {
  readonly id: string;
  readonly coin: string;
  readonly side: "long" | "short";
  readonly entryPx: string;
  readonly markPx: number;
  readonly liquidationPx: string | null;
  readonly liquidationDistancePct: number | null;
  readonly leverage: { readonly value: number };
  readonly positionValue: number;
  readonly positionValueUsd: number | null;
  readonly unrealizedPnl: number;
}

export interface TraderLine {
  readonly id: string;
  readonly asset: string;
  readonly account: string;
  readonly usd: number | null;
}

export interface TraderLayer {
  readonly layer: "hypercore" | "hyperevm" | "elysium";
  readonly totalUsd: number;
  readonly lines: readonly TraderLine[];
}

export interface TraderSnapshot {
  readonly address: string;
  readonly mode: "testnet" | "mainnet";
  readonly generatedAt: number;
  readonly totals: {
    readonly netWorthUsd: number;
    readonly byLayer: Readonly<Record<"hypercore" | "hyperevm" | "elysium", number>>;
    readonly unrealizedPnlUsd: number;
  };
  readonly layers: readonly TraderLayer[];
  readonly positions: readonly TraderPosition[];
}

const LAYER_OF: Readonly<Record<TraderLayer["layer"], Layer>> = { hypercore: "floor", hyperevm: "ridge", elysium: "summit" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/** The trader slice from untrusted JSON, or null when the shape is not a portfolio snapshot. */
export function parseTrader(value: unknown): TraderSnapshot | null {
  if (!isRecord(value) || typeof value.address !== "string" || !isRecord(value.totals) || !Array.isArray(value.positions) || !Array.isArray(value.layers)) return null;
  const totals = value.totals;
  if (!finite(totals.netWorthUsd) || !isRecord(totals.byLayer)) return null;
  const positions: TraderPosition[] = [];
  for (const raw of value.positions as unknown[]) {
    if (!isRecord(raw) || typeof raw.coin !== "string" || (raw.side !== "long" && raw.side !== "short") || !finite(raw.markPx) || !isRecord(raw.leverage)) continue;
    const entry = Number(raw.entryPx);
    if (!Number.isFinite(entry) || entry <= 0) continue;
    positions.push({
      id: typeof raw.id === "string" ? raw.id : raw.coin,
      coin: raw.coin,
      side: raw.side,
      entryPx: String(raw.entryPx),
      markPx: raw.markPx,
      liquidationPx: typeof raw.liquidationPx === "string" ? raw.liquidationPx : null,
      liquidationDistancePct: finite(raw.liquidationDistancePct) ? raw.liquidationDistancePct : null,
      leverage: { value: finite(raw.leverage.value) ? raw.leverage.value : 1 },
      positionValue: finite(raw.positionValue) ? raw.positionValue : 0,
      positionValueUsd: finite(raw.positionValueUsd) ? raw.positionValueUsd : null,
      unrealizedPnl: finite(raw.unrealizedPnl) ? raw.unrealizedPnl : 0,
    });
  }
  const layers: TraderLayer[] = [];
  for (const raw of value.layers as unknown[]) {
    if (!isRecord(raw) || (raw.layer !== "hypercore" && raw.layer !== "hyperevm" && raw.layer !== "elysium") || !Array.isArray(raw.lines)) continue;
    const lines: TraderLine[] = [];
    for (const line of raw.lines as unknown[]) {
      if (!isRecord(line) || typeof line.asset !== "string") continue;
      lines.push({ id: typeof line.id === "string" ? line.id : line.asset, asset: line.asset, account: typeof line.account === "string" ? line.account : "wallet", usd: finite(line.usd) ? line.usd : null });
    }
    layers.push({ layer: raw.layer, totalUsd: finite(raw.totalUsd) ? raw.totalUsd : 0, lines });
  }
  const by = totals.byLayer;
  return {
    address: value.address,
    mode: value.mode === "mainnet" ? "mainnet" : "testnet",
    generatedAt: finite(value.generatedAt) ? value.generatedAt : 0,
    totals: {
      netWorthUsd: totals.netWorthUsd,
      byLayer: { hypercore: finite(by.hypercore) ? by.hypercore : 0, hyperevm: finite(by.hyperevm) ? by.hyperevm : 0, elysium: finite(by.elysium) ? by.elysium : 0 },
      unrealizedPnlUsd: finite(totals.unrealizedPnlUsd) ? totals.unrealizedPnlUsd : 0,
    },
    layers,
    positions,
  };
}

/** A trader worth drawing: at least one open position. */
export function hasTerrain(snapshot: TraderSnapshot | null): snapshot is TraderSnapshot {
  return snapshot !== null && snapshot.positions.length > 0;
}

const positionUsd = (position: TraderPosition) => Math.abs(position.positionValueUsd ?? position.positionValue);

/**
 * Relief holdings: every perp position is a hill (shorts a basin) on the
 * Floor with its leverage and rope; every priced balance line is a hill on
 * its own layer (perp margin reads "USDC · margin"). The `max` largest only,
 * so the sheet stays readable.
 */
export function reliefHoldings(snapshot: TraderSnapshot, max = 8): ReliefHolding[] {
  const out: ReliefHolding[] = [];
  for (const position of snapshot.positions) {
    const usd = positionUsd(position);
    if (!(usd > 0)) continue;
    const rope = position.liquidationDistancePct;
    out.push({
      id: `pos:${position.id}`,
      symbol: position.coin,
      usd,
      layer: "floor",
      side: position.side,
      leverage: position.leverage.value,
      note: rope !== null ? `rope ${Math.round(rope)}%` : undefined,
    });
  }
  for (const layer of snapshot.layers) {
    for (const line of layer.lines) {
      if (line.usd === null || !(line.usd > 0)) continue;
      out.push({ id: `line:${line.id}`, symbol: line.asset, usd: line.usd, layer: LAYER_OF[layer.layer], side: "spot", note: line.account === "perp" ? "margin" : undefined });
    }
  }
  const sorted = out.sort((a, b) => b.usd - a.usd);
  const top = sorted[0]?.usd ?? 0;
  // Dust under 1.5% of the largest holding would only crowd the labels.
  return sorted.filter((holding) => holding.usd >= top * 0.015).slice(0, max);
}

/** The map lays hills out by size in USD; books of any size are drawn at one map scale, largest = this many map dollars. */
export const MAP_TOP_USD = 14_000;

/**
 * Scales holdings so the largest stands MAP_TOP_USD tall (a $3k book and a
 * $3M book both fill the sheet) and returns the factor, so labels can print
 * the real dollars (`usd / factor`).
 */
export function mapScale(holdings: readonly ReliefHolding[]): { readonly holdings: ReliefHolding[]; readonly factor: number } {
  const top = holdings.reduce((max, holding) => Math.max(max, holding.usd), 0);
  const factor = top > 0 ? MAP_TOP_USD / top : 1;
  return { holdings: holdings.map((holding) => ({ ...holding, usd: holding.usd * factor })), factor };
}

/**
 * Pixel terrain holdings: perp positions are hills (shorts lakes) carrying
 * their rope (distance to liquidation), balance lines are hills; stablecoins
 * and perp margin do not move with a shock. Largest `max` only.
 */
export function terrainHoldings(snapshot: TraderSnapshot, max = 7): TerrainHolding[] {
  return reliefHoldings(snapshot, max).map((holding) => {
    const rope = holding.note ? /rope (\d+)%/u.exec(holding.note) : null;
    const position = holding.id.startsWith("pos:") ? snapshot.positions.find((p) => `pos:${p.id}` === holding.id) : undefined;
    const lev = holding.leverage && holding.leverage > 1 ? ` ${holding.leverage}×` : "";
    const margin = holding.note === "margin";
    return {
      id: holding.id,
      label: `${holding.symbol}${lev}${margin ? " margin" : ""}`,
      usd: holding.usd,
      side: holding.side === "short" ? "short" : "long",
      rope: position?.liquidationDistancePct ?? (rope ? Number(rope[1]) : null),
      stable: margin || STABLE.test(holding.symbol),
    } satisfies TerrainHolding;
  });
}

const STABLE = /^(USDC|USDT0?|USDE|USDH|DAI|USDHL)$/iu;

/**
 * Net worth if every price moved by `shock` percent at once (an estimate):
 * longs gain shock x notional, shorts lose it, and a position whose rope is
 * shorter than the move is liquidated, losing at most its margin
 * (notional / leverage). Balances other than stablecoins move with the shock.
 */
export function shockedNetWorth(snapshot: TraderSnapshot, shock: number): { readonly netWorth: number; readonly liquidated: number } {
  const s = shock / 100;
  let delta = 0;
  let liquidated = 0;
  for (const position of snapshot.positions) {
    const notional = positionUsd(position);
    if (!(notional > 0)) continue;
    const rope = position.liquidationDistancePct;
    const against = position.side === "long" ? -shock : shock;
    const margin = notional / Math.max(1, position.leverage.value);
    if (rope !== null && against >= rope) {
      liquidated += 1;
      delta -= margin;
      continue;
    }
    delta += (position.side === "long" ? 1 : -1) * notional * s;
  }
  for (const layer of snapshot.layers) {
    for (const line of layer.lines) {
      if (line.usd === null || !(line.usd > 0) || line.account === "perp" || STABLE.test(line.asset)) continue;
      delta += line.usd * s;
    }
  }
  return { netWorth: snapshot.totals.netWorthUsd + delta, liquidated };
}

export interface LayerShare {
  readonly layer: Layer;
  readonly usd: number;
  /** 0..1 of the net worth (0 when the net worth is 0). */
  readonly share: number;
}

/** Net worth by altitude, Floor first. */
export function layerShares(snapshot: TraderSnapshot): LayerShare[] {
  const by = snapshot.totals.byLayer;
  const total = Math.max(0, by.hypercore) + Math.max(0, by.hyperevm) + Math.max(0, by.elysium);
  const share = (usd: number) => (total > 0 ? Math.max(0, usd) / total : 0);
  return [
    { layer: "floor", usd: by.hypercore, share: share(by.hypercore) },
    { layer: "ridge", usd: by.hyperevm, share: share(by.hyperevm) },
    { layer: "summit", usd: by.elysium, share: share(by.elysium) },
  ];
}

export interface RopeLine {
  readonly id: string;
  readonly coin: string;
  readonly side: "long" | "short";
  readonly leverage: number;
  readonly entry: number;
  readonly mark: number;
  readonly liquidation: number | null;
  /** Percent to the crevasse, or null when it cannot be liquidated. */
  readonly ropePct: number | null;
  readonly usd: number;
  readonly pnl: number;
  /** Why this rope was picked ("closest short", "safest long"). */
  readonly role: "short" | "tight" | "safe" | "other";
}

function toRope(position: TraderPosition, role: RopeLine["role"]): RopeLine {
  const liquidation = position.liquidationPx !== null ? Number(position.liquidationPx) : null;
  return {
    id: position.id,
    coin: position.coin,
    side: position.side,
    leverage: position.leverage.value,
    entry: Number(position.entryPx),
    mark: position.markPx,
    liquidation: liquidation !== null && Number.isFinite(liquidation) && liquidation > 0 ? liquidation : null,
    ropePct: position.liquidationDistancePct,
    usd: positionUsd(position),
    pnl: position.unrealizedPnl,
    role,
  };
}

const ropeOf = (position: TraderPosition) => position.liquidationDistancePct ?? Number.POSITIVE_INFINITY;

/**
 * Three ropes that explain the idea: the tightest long, the tightest short
 * (the one fraying first), and the safest long. Missing kinds are filled
 * with the largest remaining positions, so a book of longs still shows three.
 */
export function pickRopes(snapshot: TraderSnapshot, count = 3): RopeLine[] {
  const liquidatable = snapshot.positions.filter((position) => position.liquidationPx !== null && positionUsd(position) > 0);
  const longs = liquidatable.filter((position) => position.side === "long").sort((a, b) => ropeOf(a) - ropeOf(b));
  const shorts = liquidatable.filter((position) => position.side === "short").sort((a, b) => ropeOf(a) - ropeOf(b));
  const chosen: RopeLine[] = [];
  const used = new Set<string>();
  const take = (position: TraderPosition | undefined, role: RopeLine["role"]) => {
    if (!position || used.has(position.id) || chosen.length >= count) return;
    used.add(position.id);
    chosen.push(toRope(position, role));
  };
  take(longs[0], "tight");
  take(shorts[0], "short");
  take(longs.length > 1 ? longs[longs.length - 1] : undefined, "safe");
  const rest = [...liquidatable].sort((a, b) => positionUsd(b) - positionUsd(a));
  for (const position of rest) take(position, "other");
  return chosen;
}

/* -------------------------------------------------------- the sentence */

export interface SentenceChip {
  readonly text: string;
  readonly kind: ChipKind | "side";
  /** ▲ buying side, ▼ selling side, null for neither. */
  readonly direction: "up" | "down" | null;
}

const UP_VERBS = new Set(["long", "buy", "stake", "deposit", "lend"]);
const DOWN_VERBS = new Set(["short", "sell", "close", "reduce", "flatten", "unstake", "withdraw"]);

/**
 * The chip row under the route card, read locally (a visual aid only; the
 * plan comes from the API). An amount followed by its asset reads as one
 * chip ("200 USDC").
 */
export function sentenceChips(sentence: string): SentenceChip[] {
  const tokens = previewChips(sentence).map((token) => ({ text: token.text.replace(/[,;!?]+$/u, ""), kind: token.kind }));
  const out: SentenceChip[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    const next = tokens[index + 1];
    if (token.kind === "amount" && next?.kind === "asset") {
      out.push({ text: `${token.text} ${next.text}`, kind: "amount", direction: null });
      index += 1;
      continue;
    }
    if (token.kind === "trigger" && /^[a-z]+$/iu.test(token.text) && (next?.kind === "trigger" || next?.kind === "amount") && /\d/u.test(next.text)) {
      out.push({ text: `${token.text} ${next.text}`, kind: "trigger", direction: null });
      index += 1;
      continue;
    }
    const lower = token.text.toLowerCase();
    const direction = token.kind === "verb" ? (UP_VERBS.has(lower) ? "up" : DOWN_VERBS.has(lower) ? "down" : null) : null;
    out.push({ text: token.text, kind: token.kind, direction });
  }
  return out.slice(0, 8);
}

const API_UP = new Set(["long", "buy", "stake", "deposit"]);
const API_DOWN = new Set(["short", "sell", "close", "reduce", "flatten", "unstake", "withdraw"]);

/** The chips of an API reading (@elyia/core/api/language ParseIntentResponse.chips), validated loosely. */
export function apiChips(body: unknown): SentenceChip[] | null {
  if (typeof body !== "object" || body === null || !Array.isArray((body as { chips?: unknown }).chips)) return null;
  const out: SentenceChip[] = [];
  for (const raw of (body as { chips: unknown[] }).chips) {
    if (typeof raw !== "object" || raw === null) continue;
    const { text, kind, value } = raw as { text?: unknown; kind?: unknown; value?: unknown };
    if (typeof text !== "string" || typeof kind !== "string" || kind === "connector" || kind === "unknown") continue;
    const shown = typeof value === "string" && value.length <= 24 ? value : text;
    const lower = text.toLowerCase();
    const direction = kind === "side" || kind === "verb" ? (API_UP.has(lower) ? "up" : API_DOWN.has(lower) ? "down" : null) : null;
    out.push({ text: shown, kind: kind as SentenceChip["kind"], direction });
  }
  return out.slice(0, 8);
}

const FLOOR_WORDS = /\b(long|short|perps?|leverage|\d+(?:\.\d+)?[x×]|twap|limit|tp|sl|flatten|funding|hypercore|core|spot|stop|close)\b/iu;
const RIDGE_WORDS = /\b(hyperevm|khype|stake|unstake|kinetiq|hyperswap|evm)\b/iu;
const SUMMIT_WORDS = /\b(elysium|kalos|summit|dex da costa|bridge|ascend)\b/iu;

/** The altitudes a sentence travels (bridges touch both ends). */
export function sentenceLayers(sentence: string): ReadonlySet<Layer> {
  const layers = new Set<Layer>();
  if (FLOOR_WORDS.test(sentence)) layers.add("floor");
  if (RIDGE_WORDS.test(sentence)) layers.add("ridge");
  if (SUMMIT_WORDS.test(sentence)) layers.add("summit");
  // The canonical bridge runs HyperEVM <-> Elysium: a bridge always touches both.
  if (/\bbridge\b/iu.test(sentence)) {
    layers.add("ridge");
    layers.add("summit");
  }
  return layers;
}

/** A first grade from the words alone (the Rule Book grades the real plan). */
export function sentenceGrade(sentence: string): Grade | null {
  const text = sentence.trim();
  if (!text) return null;
  const leverage = /(\d+(?:\.\d+)?)\s*[x×]\b/iu.exec(text);
  const lev = leverage ? Number(leverage[1]) : undefined;
  if (/\b(long|short|perps?|twap)\b/iu.test(text) || lev !== undefined) return gradeFor({ kind: "perp", leverage: lev });
  if (/\b(stake|unstake)\b/iu.test(text)) return gradeFor({ kind: "stake" });
  if (/\bsend\b/iu.test(text)) return gradeFor({ kind: "send" });
  if (/\b(swap|bridge|buy|sell|move|deposit)\b/iu.test(text)) return gradeFor({ kind: "swap" });
  return null;
}

/** Real sentences the placeholder cycles through, English and Turkish. */
export const PLACEHOLDER_EXAMPLES: readonly string[] = [
  "long ETH 5x with 200 USDC, stop at -3%",
  "bridge 20 HYPE to Elysium and swap half to USDC",
  "ETH'de 200 USDC ile 5x long aç, stop -3%",
  "stake 10 HYPE to kHYPE on HyperEVM",
  "her gün 10 HYPE al",
  "twap buy 40 HYPE over 30 minutes",
];

/* ---------------------------------------------------------- formatting */

export function usd(value: number, options: { readonly cents?: boolean } = {}): string {
  const abs = Math.abs(value);
  const digits = options.cents ? 2 : 0;
  const body = abs.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return `${value < 0 ? "−" : ""}$${body}`;
}

export function signedUsd(value: number): string {
  if (value === 0) return "$0";
  return `${value > 0 ? "▲ +" : "▼ −"}$${Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function shortAddress(address: string): string {
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}

/** Elysium mainnet (chain 99901) opens on 9 Nov 2026. */
export const MAINNET_AT = Date.UTC(2026, 10, 9);

/** Whole days from `now` until `target` (0 on or after it). */
export function daysUntil(target: number, now: number): number {
  return Math.max(0, Math.ceil((target - now) / 86_400_000));
}
