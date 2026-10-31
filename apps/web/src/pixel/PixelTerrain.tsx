import { useCallback, useMemo, useRef, useState } from "react";

import { useResolvedTheme } from "../app/state/useTheme";
import { cx, FOCUS_RING } from "../ui/cx";
import { drawGrid } from "./draw";
import { elySprite, mini, ROPE_RED, type PixelGrid } from "./ely";
import { PixelCanvas } from "./PixelCanvas";
import { useMeasuredWidth } from "../topo/useMeasuredWidth";
import { DAY_TERRAIN, LABEL_MARGIN, NIGHT_TERRAIN, paintTerrain, placeLabels, terrainModel, type LabelPlacement, type TerrainHolding, type TerrainModel, type TerrainPeak } from "./terrain";

export interface PixelTerrainProps {
  readonly holdings: readonly TerrainHolding[];
  /** Market shock in percent (-30..30): hills scale, ropes shorter than the fall snap into lakes. */
  readonly shock?: number;
  /** Clicking (or Enter on) a peak label selects the holding. */
  readonly onSelect?: (holding: TerrainHolding) => void;
  readonly selectedId?: string | null;
  /** Accessible name of the map. */
  readonly label?: string;
  readonly formatUsd?: (usd: number) => string;
  /** About how many pixels across (default 200; one pixel is a few CSS px). */
  readonly resolution?: number;
  /** Height / width (default 0.55). */
  readonly aspect?: number;
  /** "dry" ground never dips under water, so every lake is a short or a snapped rope (default "wet", as the reference). */
  readonly ground?: "wet" | "dry";
  readonly className?: string;
}

const usd = (value: number) => `$${Math.round(value).toLocaleString("en-US")}`;
let calm: PixelGrid | null = null;
let worried: PixelGrid | null = null;

function terrainSummary(model: TerrainModel, format: (n: number) => string): string {
  const peaks = model.peaks.map((peak) => `${peak.holding.label} ${peak.snapped ? "rope snapped" : peak.lake ? "lake (short)" : format(peak.value)}`);
  return `${peaks.join("; ")}. ${model.snaps} rope${model.snaps === 1 ? "" : "s"} snapped.`;
}

/**
 * The portfolio as a pixel elevation map: a hill per holding (height =
 * value), lakes for shorts. Drag the shock: hills sink, a rope shorter than
 * the fall snaps and its hill collapses into a lake, and Ely, standing on
 * the tallest peak, looks worried. Peak labels are real buttons.
 */
export function PixelTerrain({ holdings, shock = 0, onSelect, selectedId = null, label, formatUsd = usd, resolution = 200, aspect = 0.55, ground = "wet", className }: PixelTerrainProps) {
  const [hot, setHot] = useState<string | null>(null);
  const night = useResolvedTheme() === "dark";
  const palette = night ? NIGHT_TERRAIN : DAY_TERRAIN;
  const cache = useRef<{ readonly holdings: readonly TerrainHolding[]; readonly key: string; readonly model: TerrainModel } | null>(null);
  const modelFor = useCallback(
    (w: number, h: number) => {
      const key = `${w}x${h}|${shock}|${ground}`;
      const hit = cache.current;
      if (hit && hit.holdings === holdings && hit.key === key) return hit.model;
      const model = terrainModel(holdings, w, h, shock, { ground });
      cache.current = { holdings, key, model };
      return model;
    },
    [holdings, shock, ground],
  );
  // A reference model at a fixed size for the labels and the summary (positions are fractions).
  const reference = useMemo(() => terrainModel(holdings, 100, Math.round(100 * aspect), shock, { ground }), [holdings, shock, aspect, ground]);
  const hasWater = reference.peaks.some((peak) => peak.lake);
  const [measure, width] = useMeasuredWidth<HTMLDivElement>(900);
  const height = width * aspect;
  const big = width >= 640;
  const placements = useMemo(() => {
    const charW = big ? 10.6 : 8.6;
    const boxH = big ? 28 : 24;
    const order = reference.peaks.map((peak, index) => ({ peak, index })).sort((a, b) => b.peak.value - a.peak.value);
    const spots = order.map(({ peak }) => ({
      x: (peak.x / reference.w) * width,
      y: (peak.y / reference.h) * height,
      // the plate (text + 16 px padding) plus 6 px of air so neighbours never touch
      w: (peak.snapped ? `${peak.holding.label} · snapped` : peak.holding.label).length * charW + 24,
      h: boxH,
    }));
    // Ely stands on the tallest standing peak (a 16 x 17 sprite 13-30 px above it): keep it clear.
    const tallest = reference.tallest;
    const px = width / resolution; // CSS px per map pixel
    const obstacles = tallest
      ? [
          {
            x0: (tallest.x / reference.w) * width - 9 * px,
            y0: (tallest.y / reference.h) * height - 31 * px,
            x1: (tallest.x / reference.w) * width + 9 * px,
            y1: (tallest.y / reference.h) * height - 12 * px,
          },
        ]
      : [];
    const chosen = placeLabels(spots, width, height, obstacles);
    // Each label's left edge in CSS px, kept inside the map (a label near
    // the edge slides in instead of hanging off the sheet at phone width).
    const out: Array<{ readonly placement: LabelPlacement; readonly left: number }> = reference.peaks.map(() => ({ placement: "right-up", left: 0 }));
    order.forEach(({ index }, k) => {
      const placement = chosen[k]!;
      const spot = spots[k]!;
      const x0 = placement.startsWith("left") ? spot.x - 6 - spot.w : spot.x + 6;
      out[index] = { placement, left: Math.round(Math.max(LABEL_MARGIN, Math.min(width - spot.w - LABEL_MARGIN, x0))) };
    });
    return out;
  }, [reference, width, height, big, resolution]);

  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, info: { readonly w: number; readonly h: number; readonly seconds: number }) => {
      const model = modelFor(info.w, info.h);
      paintTerrain(ctx, model, info.seconds, palette);
      for (const peak of model.peaks) {
        ctx.fillStyle = peak.snapped ? ROPE_RED : palette.dot;
        ctx.fillRect(peak.x - 1, peak.y - 1, 3, 3);
      }
      if (model.tallest) {
        calm ??= mini(elySprite({ gear: "lamp" }));
        worried ??= mini(elySprite({ gear: "rope", eye: "worried", mouth: "o" }));
        const sprite = model.snaps > 0 ? worried : calm;
        const shake = model.snaps > 0 && Math.floor(info.seconds * 6) % 4 === 0 ? 1 : 0;
        drawGrid(ctx, sprite, model.tallest.x - 8 + shake, Math.max(0, model.tallest.y - 30), 1);
      }
    },
    [modelFor, palette],
  );

  const peakLabel = (peak: TerrainPeak) => (peak.snapped ? `${peak.holding.label} · snapped` : peak.holding.label);
  return (
    <div ref={measure} className={cx("relative w-full", className)}>
      <PixelCanvas
        width={resolution}
        height={Math.round(resolution * aspect)}
        aspect={aspect}
        draw={draw}
        animate={hasWater || reference.snaps > 0}
        fps={6}
        label={label ?? `Portfolio elevation map. ${terrainSummary(reference, formatUsd)}`}
        redrawKey={`${shock}|${holdings.length}|${ground}|${night}`}
      />
      <ul className="pointer-events-none absolute inset-0 m-0 list-none p-0">
        {reference.peaks.map((peak, index) => {
          const top = (peak.y / reference.h) * 100;
          const selected = selectedId === peak.holding.id;
          const { placement, left: leftPx } = placements[index] ?? { placement: "right-up" as const, left: 0 };
          const down = placement.endsWith("down");
          const content = (
            <>
              <span>{peakLabel(peak)}</span>
              {hot === peak.holding.id || selected ? <span className="ml-2 font-mono text-[11px] normal-case opacity-90 sm:text-[13px]">{peak.lake && !peak.snapped ? "short" : formatUsd(peak.value)}</span> : null}
            </>
          );
          const classes = cx(
            "pointer-events-auto absolute inline-flex items-center whitespace-nowrap px-2 font-tag uppercase",
            big ? "h-7 text-[14px]" : "h-6 text-[11px]",
            down ? "translate-y-[6px]" : "-translate-y-[calc(100%+6px)]",
            peak.snapped ? (night ? "bg-down text-[#16201B]" : "bg-down text-white") : selected ? "bg-signal text-[#16201B]" : night ? "bg-[#EEE7D8] text-[#16201B]" : "bg-[#16201B] text-[#FFF9EC]",
            onSelect && FOCUS_RING,
          );
          return (
            <li key={peak.holding.id} className="contents">
              {onSelect ? (
                <button
                  type="button"
                  aria-pressed={selected}
                  aria-label={`${peak.holding.label}: ${peak.snapped ? "rope snapped" : formatUsd(peak.value)}`}
                  onClick={() => onSelect(peak.holding)}
                  onPointerEnter={() => setHot(peak.holding.id)}
                  onPointerLeave={() => setHot(null)}
                  onFocus={() => setHot(peak.holding.id)}
                  onBlur={() => setHot(null)}
                  className={classes}
                  style={{ left: leftPx, top: `${top}%` }}
                >
                  {content}
                </button>
              ) : (
                <span aria-hidden="true" className={classes} style={{ left: leftPx, top: `${top}%` }}>
                  {content}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
