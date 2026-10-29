import type { CSSProperties } from "react";

import { useMeasuredWidth } from "./useMeasuredWidth";
import { cx } from "../ui/cx";
import { ropeGeometry, type RopeInput, type RopeMarker } from "./geometry/rope";

export interface RopeProps extends RopeInput {
  /** Market name for the accessible summary ("ETH"). */
  readonly symbol?: string;
  /** Price formatter (default: 4 significant digits). */
  readonly formatPrice?: (price: number) => string;
  /** "full" with labels; "compact" for a table row. */
  readonly variant?: "full" | "compact";
  readonly className?: string;
}

const W_FULL = 560;
const H_FULL = 96;
const W_COMPACT = 240;
const H_COMPACT = 34;

function defaultPrice(price: number): string {
  if (!Number.isFinite(price)) return "—";
  const abs = Math.abs(price);
  const digits = abs >= 1000 ? 0 : abs >= 100 ? 1 : abs >= 1 ? 3 : 5;
  return price.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

const pct = (fraction: number) => `${Math.abs(fraction * 100).toFixed(Math.abs(fraction) < 0.1 ? 1 : 0)}%`;

/** The rope's ends glide with the climber (CSS `d` transition; instant where unsupported). */
function glide(d: string): CSSProperties {
  return { d: `path("${d}")`, transition: "d 700ms cubic-bezier(0.16, 1, 0.3, 1)" } as CSSProperties;
}

/*
 * Marker glyphs, drawn at (0, ground). The rope runs at ground - 14.
 */
function Crevasse({ ground }: { readonly ground: number }) {
  return (
    <g>
      <path d={`M-11,${ground} L-3,${ground + 9} L0,${ground + 4} L4,${ground + 11} L11,${ground}`} fill="rgb(var(--card))" stroke="rgb(var(--ink))" strokeWidth="1.4" strokeLinejoin="round" />
      <path d={`M-5,${ground - 21} l10,10 M5,${ground - 21} l-10,10`} stroke="rgb(var(--down))" strokeWidth="2.4" strokeLinecap="square" />
    </g>
  );
}

function Anchor({ rope }: { readonly rope: number }) {
  // a piton hammered into the rock with a ring the rope runs through
  return (
    <g stroke="rgb(var(--ink))" fill="none" strokeWidth="1.6" strokeLinejoin="round">
      <path d={`M0,${rope - 9} V${rope + 9}`} />
      <path d={`M-6,${rope + 4} Q0,${rope + 12} 6,${rope + 4}`} />
      <circle cx="0" cy={rope - 11} r="2.6" fill="rgb(var(--card))" />
    </g>
  );
}

function Flag({ ground }: { readonly ground: number }) {
  return (
    <g>
      <path d={`M0,${ground} V${ground - 30}`} stroke="rgb(var(--ink))" strokeWidth="1.6" />
      <path d={`M0,${ground - 30} h15 l-4,5 4,5 H0Z`} fill="rgb(var(--up))" stroke="rgb(var(--ink))" strokeWidth="1.2" strokeLinejoin="round" />
    </g>
  );
}

/**
 * The Rope: a position as a pitch from crevasse (liquidation) through anchor
 * (stop) and climber (mark) to the flag (take-profit). The rope between the
 * crevasse and the climber is the liquidation distance. It frays (dashed)
 * under 10% and pulses slowly (under 1 Hz) under 5%. The climber eases to
 * each new mark.
 */
export function Rope({ symbol, formatPrice = defaultPrice, variant = "full", className, ...input }: RopeProps) {
  const rope = ropeGeometry(input);
  const compact = variant === "compact";
  const [measure, measured] = useMeasuredWidth<HTMLDivElement>(compact ? W_COMPACT : W_FULL);
  const W = Math.max(compact ? 160 : 260, measured);
  const H = compact ? H_COMPACT : H_FULL;
  const margin = compact ? 14 : 30;
  const ground = compact ? 28 : 48;
  const ropeY = ground - (compact ? 8 : 14);
  const x = (at: number) => margin + at * (W - margin * 2);
  const find = (kind: RopeMarker["kind"]) => rope.markers.find((marker) => marker.kind === kind);
  const crevasse = find("crevasse");
  const climber = find("climber")!;
  const flag = find("flag");
  const ropeStart = crevasse ? x(crevasse.at) : margin * 0.4;
  const climberX = x(climber.at);
  const goalX = flag ? x(flag.at) : W - margin * 0.4;
  const ahead = `M${climberX.toFixed(1)},${ropeY} L${goalX.toFixed(1)},${ropeY}`;
  const length = `M${ropeStart.toFixed(1)},${ropeY} L${climberX.toFixed(1)},${ropeY}`;
  const tone = rope.state === "critical" || rope.state === "fraying" ? "rgb(var(--down))" : "rgb(var(--ridge))";

  const summary = [
    `${input.side === "long" ? "Long" : "Short"}${symbol ? ` ${symbol}` : ""}`,
    rope.distance !== null && crevasse ? `${pct(rope.distance)} to liquidation at ${formatPrice(crevasse.price)}` : "no liquidation price",
    find("anchor") ? `stop ${formatPrice(find("anchor")!.price)}` : "no stop",
    flag ? `take profit ${formatPrice(flag.price)}` : "no take profit",
    `mark ${formatPrice(climber.price)}`,
  ].join("; ");

  // labels under the ground for crevasse, anchor, flag; nudged up when two would collide
  const labelled = rope.markers.filter((marker) => marker.kind !== "climber" && marker.kind !== "entry");
  const placed: Array<{ marker: RopeMarker; x: number; row: number }> = [];
  for (const marker of labelled) {
    const mx = x(marker.at);
    const row = placed.some((other) => Math.abs(other.x - mx) < 70 && other.row === 0) ? 1 : 0;
    placed.push({ marker, x: mx, row });
  }

  return (
    <div ref={measure} className={cx("w-full min-w-0", className)}>
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="block max-w-full overflow-visible" role="img" aria-label={`Rope: ${summary}`}>
      {/* ground: the rock edge, broken by the crevasse */}
      <path d={`M${margin * 0.3},${ground} H${W - margin * 0.3}`} stroke="rgb(var(--ink))" strokeWidth={compact ? 1 : 1.4} opacity={compact ? 0.5 : 0.8} />
      {!compact && <path d={`M${margin * 0.3},${ground + 4} H${W - margin * 0.3}`} stroke="rgb(var(--ink))" strokeWidth="0.6" strokeDasharray="1 5" opacity="0.5" />}
      {/* the route ahead to the flag */}
      <path d={ahead} style={glide(ahead)} stroke="rgb(var(--ink))" strokeWidth="1" strokeDasharray={rope.openEnd ? "1 4" : "4 3"} opacity={rope.openEnd ? 0.45 : 0.7} />
      {/* the rope: crevasse to climber */}
      <path
        d={length}
        style={glide(length)}
        stroke={tone}
        strokeWidth={compact ? 2.6 : 3.4}
        strokeLinecap="round"
        strokeDasharray={rope.frays ? (compact ? "4 2.5" : "6 3.5") : undefined}
        className={cx(rope.pulses && "el-loop el-pulse-slow")}
      />
      {crevasse ? (
        <g transform={`translate(${x(crevasse.at)},0)`}>{compact ? <path d={`M-4,${ropeY - 4} l8,8 M4,${ropeY - 4} l-8,8`} stroke="rgb(var(--down))" strokeWidth="2" /> : <Crevasse ground={ground} />}</g>
      ) : null}
      {find("anchor") ? <g transform={`translate(${x(find("anchor")!.at)},0)`}>{compact ? <path d={`M0,${ropeY - 5}V${ropeY + 5}`} stroke="rgb(var(--ink))" strokeWidth="1.6" /> : <Anchor rope={ropeY} />}</g> : null}
      {find("entry") ? <path d={`M${x(find("entry")!.at)},${ground - 4}V${ground + (compact ? 4 : 7)}`} stroke="rgb(var(--ink))" strokeWidth="1.4" /> : null}
      {flag ? <g transform={`translate(${x(flag.at)},0)`}>{compact ? <path d={`M0,${ground}V${ground - 16}h8l-3,3 3,3H0`} fill="rgb(var(--up))" stroke="rgb(var(--ink))" strokeWidth="1" /> : <Flag ground={ground} />}</g> : null}
      {/* the climber eases along the rope */}
      <g className="el-climber" style={{ transform: `translateX(${climberX}px)` }}>
        <circle cx="0" cy={ropeY} r={compact ? 4.5 : 6.5} fill="rgb(var(--signal))" stroke="rgb(var(--ink))" strokeWidth={compact ? 1.6 : 2} />
        {!compact ? (
          <text x="0" y={ropeY - 13} textAnchor="middle" fontFamily="IBM Plex Mono, monospace" fontSize="12" fontWeight="600" fill="rgb(var(--ink))">
            {formatPrice(climber.price)}
          </text>
        ) : null}
      </g>
      {compact ? (
        rope.distance !== null ? (
          <text x={(ropeStart + climberX) / 2} y={ropeY - 6} textAnchor="middle" fontFamily="IBM Plex Mono, monospace" fontSize="11" fontWeight="600" fill={rope.frays ? "rgb(var(--down))" : "rgb(var(--ink-2))"}>
            {pct(rope.distance)}
          </text>
        ) : null
      ) : (
        <g fontFamily="IBM Plex Mono, monospace" fontSize="11.5" fill="rgb(var(--ink-2))">
          {placed.map(({ marker, x: mx, row }) => {
            const anchorText = mx < 50 ? "start" : mx > W - 50 ? "end" : "middle";
            const glyph = marker.kind === "crevasse" ? "✕" : marker.kind === "anchor" ? "⚓" : "⚑";
            const color = marker.kind === "crevasse" ? "rgb(var(--down))" : marker.kind === "flag" ? "rgb(var(--up))" : "rgb(var(--ink-2))";
            return (
              <text key={marker.kind} x={mx} y={ground + 21 + row * 14} textAnchor={anchorText} fill={color}>
                {glyph} {formatPrice(marker.price)} · {pct(marker.fromMark)}
              </text>
            );
          })}
          <text x={W - margin * 0.3} y={H - 3} textAnchor="end" fill="rgb(var(--ink-3))" fontSize="11">
            {input.side === "long" ? "price →" : "← price"}
          </text>
          {rope.openEnd ? (
            <text x={W - margin * 0.3} y={ropeY - 6} textAnchor="end" fill="rgb(var(--ink-3))" fontSize="11">
              no flag set
            </text>
          ) : null}
        </g>
      )}
    </svg>
    </div>
  );
}
