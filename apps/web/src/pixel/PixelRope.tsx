import { useCallback, useMemo } from "react";

import { ropeGeometry, type RopeInput, type RopeMarker } from "../topo/geometry/rope";
import { useResolvedTheme } from "../app/state/useTheme";
import { useMeasuredWidth } from "../topo/useMeasuredWidth";
import { cx } from "../ui/cx";
import { INK } from "./ely";
import { PixelCanvas } from "./PixelCanvas";
import { paintRope, ROPE_H_COMPACT, ROPE_H_FULL, ropeLayout } from "./rope";

export interface PixelRopeProps extends RopeInput {
  /** Market name for the accessible summary ("ETH"). */
  readonly symbol?: string;
  readonly formatPrice?: (price: number) => string;
  /** "full" with Ely on the rope and labels; "compact" for a table row. */
  readonly variant?: "full" | "compact";
  /** Colour of the route dots, piton and poles (a resolved colour). Default: the painted sheet's ink (DAY #16201B, NIGHT #EEE7D8). */
  readonly ink?: string;
  readonly className?: string;
}

const NIGHT_INK = "#EEE7D8";
const DAY_UP = "#1F7A4C";
const NIGHT_UP = "#5FD39A";

function defaultPrice(price: number): string {
  if (!Number.isFinite(price)) return "—";
  const abs = Math.abs(price);
  const digits = abs >= 1000 ? 0 : abs >= 100 ? 1 : abs >= 1 ? 3 : 5;
  return price.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

const pct = (fraction: number) => `${Math.abs(fraction * 100).toFixed(Math.abs(fraction) < 0.1 ? 1 : 0)}%`;
const GLYPH: Readonly<Record<RopeMarker["kind"], string>> = { crevasse: "✕", anchor: "⚓", climber: "●", entry: "|", flag: "⚑" };
const TONE: Readonly<Record<RopeMarker["kind"], string>> = { crevasse: "text-down", anchor: "text-ink-2", climber: "text-ink", entry: "text-ink-3", flag: "text-up" };

/**
 * A position as a pixel rope: the crevasse ✕ (liquidation), the anchor
 * (stop), Ely climbing at the mark, the dotted route ahead to the flag (take
 * profit). The rope frays under 10% to the crevasse and Ely looks worried;
 * under 5% the loose strands shift once a second.
 */
export function PixelRope({ symbol, formatPrice = defaultPrice, variant = "full", ink, className, ...input }: PixelRopeProps) {
  const { side, entry, mark, liquidation, stop, takeProfit } = input;
  const rope = useMemo(() => ropeGeometry({ side, entry, mark, liquidation, stop, takeProfit }), [side, entry, mark, liquidation, stop, takeProfit]);
  const compact = variant === "compact";
  const night = useResolvedTheme() === "dark";
  const line = ink ?? (night ? NIGHT_INK : INK);
  const flag = night ? NIGHT_UP : DAY_UP;
  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, info: { readonly w: number; readonly seconds: number }) => paintRope(ctx, rope, ropeLayout(info.w, compact), info.seconds, line, flag),
    [rope, compact, line, flag],
  );
  const find = (kind: RopeMarker["kind"]) => rope.markers.find((marker) => marker.kind === kind);
  const crevasse = find("crevasse");
  const summary = [
    `${side === "long" ? "Long" : "Short"}${symbol ? ` ${symbol}` : ""}`,
    rope.distance !== null && crevasse ? `${pct(rope.distance)} to liquidation at ${formatPrice(crevasse.price)}` : "no liquidation price",
    find("anchor") ? `stop ${formatPrice(find("anchor")!.price)}` : "no stop",
    find("flag") ? `take profit ${formatPrice(find("flag")!.price)}` : "no take profit",
    `mark ${formatPrice(mark)}`,
  ].join("; ");

  // label row: ✕ crevasse, ⚓ anchor, ● mark, ⚑ flag. Laid out in real CSS px
  // (12 px Plex Mono is 7.2 px a character): each label centres on its marker,
  // clamped inside the rope, and drops to the next row when it would touch
  // a neighbour, so labels never overlap at phone width.
  const [measure, width] = useMeasuredWidth<HTMLDivElement>(640);
  const labelled = rope.markers.filter((marker) => marker.kind !== "entry");
  const texts = labelled.map((marker) => `${GLYPH[marker.kind]} ${formatPrice(marker.price)}${marker.kind === "climber" ? "" : ` · ${pct(marker.fromMark)}`}`);
  const placed: Array<{ marker: RopeMarker; text: string; x0: number; x1: number; row: number }> = [];
  labelled.forEach((marker, index) => {
    const text = texts[index]!;
    const w = text.length * 7.3;
    const centre = ((5.5 + marker.at * 89) / 100) * width;
    const x0 = Math.max(0, Math.min(width - w, centre - w / 2));
    const x1 = x0 + w;
    let row = 0;
    while (placed.some((other) => other.row === row && x0 < other.x1 + 10 && other.x0 < x1 + 10)) row += 1;
    placed.push({ marker, text, x0, x1, row });
  });
  const rows = Math.max(0, ...placed.map((p) => p.row)) + 1;

  return (
    <div ref={measure} className={cx("w-full min-w-0", className)} role="img" aria-label={`Rope: ${summary}`}>
      <PixelCanvas
        width={compact ? 80 : 180}
        height={compact ? ROPE_H_COMPACT : ROPE_H_FULL}
        pixelSize={compact ? 2 : 3}
        draw={draw}
        animate={rope.pulses}
        fps={4}
        decorative
        redrawKey={`${line}|${flag}`}
      />
      {compact ? (
        rope.distance !== null ? <span className={cx("mt-0.5 block text-right font-tag text-[11px]", rope.frays ? "text-down" : "text-ink-2")}>{pct(rope.distance)} to ✕</span> : null
      ) : (
        <div aria-hidden="true" className="relative mt-1" style={{ height: rows * 20 }}>
          {placed.map(({ marker, text, x0, row }) => (
            <span key={marker.kind} className={cx("absolute whitespace-nowrap font-mono text-xs tnum", TONE[marker.kind])} style={{ left: Math.round(x0), top: row * 20 }}>
              {text}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
