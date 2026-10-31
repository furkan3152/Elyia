import type { PortfolioHistory, PortfolioSnapshot } from "@elyia/core/api/portfolio";
import { useCallback } from "react";

import { LAYERS as PALETTES, SUN } from "../../../pixel/ely";
import { PixelAltimeter } from "../../../pixel/PixelAltimeter";
import { PixelCanvas } from "../../../pixel/PixelCanvas";
import { rngOf, shade } from "../../../pixel/topo";
import type { Layer } from "../../../topo/geometry/relief";
import { useMeasuredWidth } from "../../../topo/useMeasuredWidth";
import { Panel } from "../../../ui/Panel";
import { cx } from "../../../ui/cx";
import { pct, usdFull, usdShort, usdSigned } from "../range/format";
import { dayChange, SOURCE_LABEL } from "../range/labels";
import { layerSplit, LAYER_NAME, NETWORK_NAME, type LayerShare } from "../range/model";
import type { RangeSource } from "../range/useRange";
import { useSheetColors } from "./sheetColors";

const TONE = { floor: "text-floor", ridge: "text-ridge", summit: "text-summit-ink" } as const;
const PALETTE_OF: Readonly<Record<Layer, readonly string[]>> = { floor: PALETTES.Floor, ridge: PALETTES.Ridge, summit: PALETTES.Summit };

/**
 * The FLOOR / RIDGE / SUMMIT split: one pixel bar, each layer's width its
 * share of the net worth in its altitude colour, the figures under it
 * (never colour alone: every segment is named).
 */
export function LayerSplitBar({ split, compact = false, className }: { readonly split: readonly LayerShare[]; readonly compact?: boolean; readonly className?: string }) {
  const colors = useSheetColors();
  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, info: { readonly w: number; readonly h: number }) => {
      const { w, h } = info;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = colors.paper2;
      ctx.fillRect(0, 0, w, h);
      let x = 0;
      const visible = split.filter((entry) => entry.share > 0);
      visible.forEach((entry, index) => {
        const width = index === visible.length - 1 ? w - x : Math.max(1, Math.round(entry.share * w));
        const palette = PALETTE_OF[entry.layer];
        for (let px = x; px < x + width; px += 1) {
          for (let py = 0; py < h; py += 1) {
            // two altitude bands per segment, a dither seam between them
            const top = py < h / 2;
            ctx.fillStyle = top ? palette[3]! : (px + py) % 2 === 0 && py === Math.floor(h / 2) ? palette[3]! : palette[1]!;
            ctx.fillRect(px, py, 1, 1);
          }
        }
        if (index > 0) {
          ctx.fillStyle = colors.ink;
          ctx.fillRect(x, 0, 1, h);
        }
        x += width;
      });
    },
    [split, colors],
  );
  return (
    <div className={className}>
      <div className="bg-card p-1 px-frame-thin">
        <PixelCanvas
          width={120}
          height={compact ? 3 : 4}
          pixelSize={4}
          aspect={undefined}
          draw={draw}
          redrawKey={`${split.map((entry) => entry.share.toFixed(4)).join("|")}|${colors.night}`}
          label={`Layer split: ${split.map((entry) => `${LAYER_NAME[entry.layer]} ${NETWORK_NAME[entry.layer]} ${usdShort(entry.usd)}, ${pct(entry.share)}`).join("; ")}`}
        />
      </div>
      <ul className={cx("mt-2.5 grid grid-cols-3 gap-2 font-mono", compact ? "text-[11px]" : "text-xs")} aria-hidden="true">
        {split.map((entry, index) => (
          <li key={entry.layer} className={cx("min-w-0", index === 1 && "text-center", index === 2 && "text-right")}>
            <span className={cx("font-tag text-[11px] uppercase", TONE[entry.layer])}>{LAYER_NAME[entry.layer]}</span>
            <span className="tnum block text-ink">{entry.status === "unavailable" || entry.status === "error" ? "not read" : usdShort(entry.usd)}</span>
            {!compact ? <span className="tnum block text-ink-3">{pct(entry.share)}</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

export interface NetWorthProps {
  readonly snapshot: PortfolioSnapshot;
  readonly history: PortfolioHistory | null;
  readonly source: RangeSource;
  readonly size?: "md" | "lg";
  /** Centre everything on the axis (default true). */
  readonly centred?: boolean;
  /** Hide the layer split bar (the camps show it). */
  readonly split?: boolean;
  readonly className?: string;
}

/** Altimeter net worth, today's move and the layer split. Money rolls digit by digit, never tweens. */
export function NetWorth({ snapshot, history, source, size = "lg", centred = true, split: showSplit = true, className }: NetWorthProps) {
  const split = layerSplit(snapshot);
  const today = dayChange(history);
  const upnl = snapshot.totals.unrealizedPnlUsd;
  // The altimeter keeps whole blocks: a long figure on a phone steps down a size instead of being cut.
  const [measure, width] = useMeasuredWidth<HTMLDivElement>(0);
  const digits = usdFull(snapshot.totals.netWorthUsd).length;
  const fits = (box: number) => width === 0 || width >= digits * box;
  const fit = size === "lg" && fits(46) ? "lg" : fits(38) ? "md" : "sm";
  return (
    <div className={cx(centred && "text-center", className)} ref={measure}>
      <p className={cx("caption flex flex-wrap items-center gap-x-2", centred && "justify-center")}>
        <span className="!text-ink">Altimeter · net worth</span>
        <span aria-hidden="true">·</span>
        <span className={source === "sample" ? "bg-signal px-1 text-signal-ink" : undefined}>{SOURCE_LABEL[source]}</span>
      </p>
      <div className={cx("mt-4 flex", centred && "justify-center")}>
        <PixelAltimeter value={usdFull(snapshot.totals.netWorthUsd)} label={source === "sample" ? "Net worth (sample)" : "Net worth"} size={fit} markLatest />
      </div>
      <p className={cx("tnum mt-4 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[13px] text-ink-2", centred && "justify-center")}>
        {today !== null ? (
          <span>
            <span className={today > 0 ? "text-up" : today < 0 ? "text-down" : "text-ink-2"}>{usdSigned(today)}</span> today
          </span>
        ) : null}
        {snapshot.positions.length > 0 ? (
          <span>
            open PnL <span className={upnl >= 0 ? "text-up" : "text-down"}>{usdSigned(upnl)}</span>
          </span>
        ) : null}
        {snapshot.totals.unpricedLines > 0 ? <span>{snapshot.totals.unpricedLines} unpriced</span> : null}
      </p>
      {showSplit ? <LayerSplitBar split={split} className="mt-5 text-left" /> : null}
    </div>
  );
}

const CAMP_W = 64;
const CAMP_H = 32;

/** One camp's mountain (pure painting): height = the layer's share, banded in its altitude palette, a flag on the highest camp. */
function paintCamp(ctx: CanvasRenderingContext2D, layer: Layer, relative: number, highest: boolean, seconds: number, still: boolean, groundInk: string): void {
  ctx.clearRect(0, 0, CAMP_W, CAMP_H);
  const palette = PALETTE_OF[layer];
  const base = CAMP_H - 4;
  // height relative to the tallest camp (it fills the card); a camp with anything at all keeps a mound
  const peak = relative > 0 ? 2 + Math.max(0.05, Math.min(1, relative)) * (base - 12) : 1;
  const halfWidth = Math.max(8, peak * 1.15 + 4);
  const random = rngOf(layer === "floor" ? 11 : layer === "ridge" ? 23 : 37);
  const jitter = Array.from({ length: CAMP_W }, () => random());
  const cx = CAMP_W / 2;
  const tops: number[] = [];
  for (let x = 0; x < CAMP_W; x += 1) {
    // a mirrored peak: the slope is the same on both sides of the axis
    const d = Math.abs(x + 0.5 - cx);
    const shoulder = Math.max(0, peak - d * (peak / halfWidth));
    const rough = Math.round(jitter[Math.min(x, CAMP_W - 1 - x)]! * 1.6);
    tops.push(Math.round(base - shoulder + (shoulder > 2 ? rough : 0)));
  }
  for (let x = 0; x < CAMP_W; x += 1) {
    const top = tops[x]!;
    for (let y = top; y < base; y += 1) {
      const altitude = (base - y) / Math.max(1, base - 3);
      const band = Math.min(palette.length - 1, Math.floor(altitude * palette.length));
      const edge = y > top && Math.floor(((base - y + 1) / Math.max(1, base - 3)) * palette.length) !== band;
      ctx.fillStyle = edge ? shade(palette[band]!, -0.25) : palette[band]!;
      ctx.fillRect(x, y, 1, 1);
    }
    ctx.fillStyle = groundInk;
    ctx.fillRect(x, top, 1, 1);
  }
  // ground
  ctx.fillStyle = groundInk;
  ctx.fillRect(0, base, CAMP_W, 1);
  for (let x = 1; x < CAMP_W; x += 3) ctx.fillRect(x, base + 2, 1, 1);
  if (highest && relative > 0) {
    const fx = Math.floor(cx);
    const fy = tops[fx]! - 9;
    ctx.fillStyle = groundInk;
    ctx.fillRect(fx, fy, 1, 9);
    const wave = still ? 0 : Math.floor(seconds * 2) % 2;
    ctx.fillStyle = SUN;
    ctx.fillRect(fx + 1, fy, 5 - wave, 2);
    ctx.fillRect(fx + 1, fy + 2, 4 + wave, 2);
  }
}

function CampPeak({ layer, relative, highest }: { readonly layer: Layer; readonly relative: number; readonly highest: boolean }) {
  const colors = useSheetColors();
  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, info: { readonly seconds: number; readonly still: boolean }) => paintCamp(ctx, layer, relative, highest, info.seconds, info.still, colors.ink),
    [layer, relative, highest, colors.ink],
  );
  return <PixelCanvas width={CAMP_W} height={CAMP_H} contain draw={draw} animate={highest} fps={2} decorative redrawKey={`${relative.toFixed(4)}|${highest}|${colors.night}`} />;
}

/**
 * The three camps: Floor, Ridge and Summit side by side, equal cards, each
 * a pixel mountain whose height is the layer's share of the net worth. The
 * highest camp flies the sun flag.
 */
export function LayerCamps({ snapshot, className }: { readonly snapshot: PortfolioSnapshot; readonly className?: string }) {
  const split = layerSplit(snapshot);
  const top = split.reduce((best, entry) => (entry.share > best.share ? entry : best), split[0]!);
  return (
    <ul className={cx("px-cards m-0 list-none p-0", className)} style={{ "--cards-lg": 3, "--cards-md": 3, "--cards-sm": 3, "--cards-xs": 3, "--cards-gap": "28px" } as React.CSSProperties} aria-label="Net worth by layer">
      {split.map((entry) => {
        const unread = entry.status === "unavailable" || entry.status === "error";
        return (
          <li key={entry.layer} className="flex">
            <Panel padding="none" className="flex w-full flex-col items-center px-2 pb-4 pt-3 text-center sm:px-4 sm:pb-5 sm:pt-4">
              <span className={cx("font-tag text-[11px] uppercase sm:text-[13px]", TONE[entry.layer])}>{LAYER_NAME[entry.layer]}</span>
              <span className="mt-0.5 hidden font-mono text-[11px] text-ink-3 sm:block">{NETWORK_NAME[entry.layer]}</span>
              <div className="mt-3 w-full max-w-[256px]">
                <CampPeak layer={entry.layer} relative={unread || !(top.share > 0) ? 0 : entry.share / top.share} highest={!unread && entry === top} />
              </div>
              <span className="tnum mt-3 font-display text-lg font-bold text-ink sm:text-[26px]">{unread ? "not read" : usdShort(entry.usd)}</span>
              <span className="tnum font-mono text-[11px] text-ink-2 sm:text-xs">{unread ? entry.status : `${pct(entry.share)} of the range`}</span>
              <span className="sr-only">
                {LAYER_NAME[entry.layer]} {NETWORK_NAME[entry.layer]}: {unread ? "not read" : `${usdFull(entry.usd)}, ${pct(entry.share)}`}
              </span>
            </Panel>
          </li>
        );
      })}
    </ul>
  );
}
