/**
 * The range as pixel terrain (pure): the Relief plan's holdings placed in
 * three equal regions, Floor | Ridge | Summit from left to right (the same
 * order as the layer camps under the map), with what the shock slider needs:
 * each hill's underlying market, its rope in percent, and whether the chosen
 * shock moves it at all.
 */
import type { TerrainHolding } from "../../../pixel/terrain";
import type { Layer } from "../../../topo/geometry/relief";
import { LAYERS, MAP_UNITS, type ReliefPlan } from "./model";

export interface RangeHolding extends TerrainHolding {
  readonly layer: Layer;
  /** The market this hill moves with (HYPE for kHYPE), null when unknown or cash. */
  readonly underlying: string | null;
  /** The exact USD value (map heights are scaled). */
  readonly exactUsd: number;
}

export interface RopeDistance {
  readonly coin: string;
  /** Fraction of the mark to liquidation (0.07 = 7%), null without a liquidation price. */
  readonly distance: number | null;
}

const STABLE = /^(USD|USDC|USDT|USDE|USDH|DAI)$/iu;
const MAX_LABEL = 14;

/** Short peak labels: "HYPERLIQUIDITY PROVIDER" -> "HYPERLIQUIDIT…", leverage kept. */
export function peakLabel(symbol: string, leverage?: number | null): string {
  const base = symbol.replace(/\s+margin.*$/iu, " margin").trim();
  const short = base.length > MAX_LABEL ? `${base.slice(0, MAX_LABEL - 1)}…` : base;
  return leverage && leverage > 1 ? `${short} ${leverage}×` : short;
}

/**
 * Positions as fractions of the sheet: each layer owns a third; its largest
 * hill stands in the middle of the third, the rest on a golden-angle spiral
 * kept inside the third (so the regions never mix).
 */
export function regionLayout(layers: readonly Layer[]): ReadonlyArray<readonly [number, number]> {
  const rank = new Map<Layer, number>();
  return layers.map((layer) => {
    const column = LAYERS.indexOf(layer);
    const k = rank.get(layer) ?? 0;
    rank.set(layer, k + 1);
    const cx = (column + 0.5) / 3;
    if (k === 0) return [cx, 0.56] as const;
    const r = Math.sqrt(k) * 0.34;
    const a = k * 2.39996 + 0.8;
    const x = cx + Math.cos(a) * r * 0.36;
    const y = 0.56 + Math.sin(a) * r * 0.78;
    return [Math.max(column / 3 + 0.04, Math.min((column + 1) / 3 - 0.04, x)), Math.max(0.2, Math.min(0.9, y))] as const;
  });
}

/**
 * Terrain holdings for a shock on `driver` (null: the whole range moves).
 * Hill height is the square root of value (so small holdings stay visible).
 * Hills outside the driver's market, cash and unknown markets are stable:
 * the slider never moves money it does not touch. Ropes count only on the
 * driver's market (their distance in percent decides when they snap).
 */
export function terrainHoldings(plan: ReliefPlan, ropes: readonly RopeDistance[], driver: string | null, cap = 12): RangeHolding[] {
  const shown = plan.holdings.slice(0, cap);
  const top = Math.max(1e-9, ...shown.map((holding) => holding.usd));
  const positions = regionLayout(shown.map((holding) => holding.layer));
  return shown.map((holding, index) => {
    const source = plan.sources.get(holding.id);
    const underlying = source?.kind === "position" ? source.position.coin : source?.kind === "line" ? (source.line.underlying ?? null) : null;
    const cash = underlying === null || STABLE.test(underlying) || (source?.kind === "line" && STABLE.test(source.line.asset));
    const moved = !cash && (driver === null || underlying === driver);
    const rope = source?.kind === "position" && moved ? (ropes.find((entry) => entry.coin === source.position.coin)?.distance ?? null) : null;
    const [x, y] = positions[index]!;
    return {
      id: holding.id,
      label: peakLabel(holding.symbol, source?.kind === "position" ? holding.leverage : null),
      // Height follows the square root of value: a $5M hill still lets a $50k one show (labels print exact dollars).
      usd: Math.round(Math.sqrt(holding.usd / top) * MAP_UNITS),
      side: holding.side === "short" ? "short" : "long",
      rope: rope === null ? null : Math.max(0.5, Math.round(rope * 1000) / 10),
      stable: !moved,
      x,
      y,
      layer: holding.layer,
      underlying,
      exactUsd: plan.exactUsd.get(holding.id) ?? holding.usd / plan.scale,
    };
  });
}

/** Markets worth a shock chip: the largest exposures first, then any roped coin (at most five). */
export function shockDrivers(exposure: readonly { readonly underlying: string }[], ropes: readonly { readonly coin: string }[]): string[] {
  const coins = new Set<string>();
  for (const row of exposure) if (coins.size < 4) coins.add(row.underlying);
  for (const rope of ropes) if (coins.size < 5) coins.add(rope.coin);
  return [...coins];
}

/** The dollars a peak stands for at a shock (percent): what its label prints. Snapped ropes print 0. */
export function peakDollars(holding: RangeHolding, shockPct: number): number {
  const k = 1 + shockPct / 100;
  if (typeof holding.rope === "number" && (holding.side === "short" ? shockPct >= holding.rope : -shockPct >= holding.rope)) return 0;
  return holding.stable ? holding.exactUsd : holding.exactUsd * k;
}
