import { useMemo } from "react";

import { PixelTerrain } from "../pixel/PixelTerrain";
import type { TerrainHolding } from "../pixel/terrain";
import { cx } from "../ui/cx";
import type { Layer, ReliefHolding } from "./geometry/relief";

export interface ReliefProps {
  readonly holdings: readonly ReliefHolding[];
  /** Kept for compatibility (the pixel terrain sizes itself to its container). */
  readonly width?: number;
  readonly height?: number;
  /** Kept for compatibility (bands replace contour intervals). */
  readonly interval?: number;
  readonly seed?: number;
  readonly formatUsd?: (usd: number) => string;
  /** Kept for compatibility (the pixel map is drawn at once). */
  readonly drawOn?: boolean;
  /** The three layers named under the map (default true). */
  readonly regionLabels?: boolean;
  /** Kept for compatibility. */
  readonly furniture?: boolean;
  /** Clicking a peak label selects the holding. */
  readonly onSelect?: (holding: ReliefHolding) => void;
  readonly selectedId?: string | null;
  /** Accessible name of the map. */
  readonly label?: string;
  /** Kept for compatibility. */
  readonly minWidth?: number;
  /** Market shock in percent (-30..30), for "what if" views. */
  readonly shock?: number;
  readonly className?: string;
}

const LAYER_ORDER: readonly Layer[] = ["floor", "ridge", "summit"];
const REGION: Readonly<Record<Layer, { readonly name: string; readonly net: string; readonly tone: string }>> = {
  floor: { name: "Floor", net: "HyperCore", tone: "text-floor" },
  ridge: { name: "Ridge", net: "HyperEVM", tone: "text-ridge" },
  summit: { name: "Summit", net: "Elysium", tone: "text-summit-ink" },
};

function defaultUsd(usd: number): string {
  if (usd >= 100_000) return `$${(usd / 1000).toFixed(0)}k`;
  return `$${Math.round(usd).toLocaleString("en-US")}`;
}

/** "rope 19%" in a note becomes the rope distance. */
function ropeFromNote(note: string | undefined): number | undefined {
  const match = note ? /rope\s+(\d+(?:\.\d+)?)\s*%/iu.exec(note) : null;
  return match ? Number(match[1]) : undefined;
}

/** Places each layer's holdings in its third of the sheet (Floor, Ridge, Summit from left to right), largest in the middle of its third. */
function reliefToTerrain(holdings: readonly ReliefHolding[]): TerrainHolding[] {
  const out: TerrainHolding[] = [];
  LAYER_ORDER.forEach((layer, column) => {
    const group = holdings.filter((holding) => holding.layer === layer).sort((a, b) => b.usd - a.usd);
    const cx0 = (column + 0.5) / 3;
    group.forEach((holding, rank) => {
      const r = rank === 0 ? 0 : 0.1 + 0.04 * Math.sqrt(rank);
      const a = rank * 2.39996 + 0.9;
      out.push({
        id: holding.id,
        label: `${holding.symbol}${holding.leverage && holding.leverage > 1 ? ` ${holding.leverage}×` : ""}`,
        usd: holding.usd,
        side: holding.side === "short" ? "short" : "long",
        rope: ropeFromNote(holding.note),
        stable: /^(USDC|USDT|USDE|USDH|DAI)$/iu.test(holding.symbol) || /vault/iu.test(holding.symbol),
        x: Math.max(0.06, Math.min(0.94, cx0 + r * Math.cos(a) * 0.9)),
        y: Math.max(0.18, Math.min(0.9, 0.56 + r * Math.sin(a) * 2.2)),
      });
    });
  });
  return out;
}

/**
 * The Relief: your portfolio as a pixel elevation map (wraps PixelTerrain).
 * Each holding a hill (height = USD), shorts lakes; the three layers sit in
 * three equal regions, named under the map.
 */
export function Relief({ holdings, formatUsd = defaultUsd, regionLabels = true, onSelect, selectedId = null, label, shock = 0, className }: ReliefProps) {
  const terrain = useMemo(() => reliefToTerrain(holdings), [holdings]);
  const byId = useMemo(() => new Map(holdings.map((holding) => [holding.id, holding])), [holdings]);
  return (
    <div className={cx("w-full min-w-0", className)}>
      <div className="bg-card px-frame">
        <PixelTerrain
          holdings={terrain}
          shock={shock}
          formatUsd={formatUsd}
          selectedId={selectedId}
          label={label}
          onSelect={
            onSelect
              ? (holding) => {
                  const original = byId.get(holding.id);
                  if (original) onSelect(original);
                }
              : undefined
          }
        />
      </div>
      {regionLabels ? (
        <ul className="mt-3 grid grid-cols-3 text-center font-tag text-[11px] uppercase">
          {LAYER_ORDER.map((layer) => (
            <li key={layer} className={REGION[layer].tone}>
              {REGION[layer].name} <span className="text-ink-2">· {REGION[layer].net}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
