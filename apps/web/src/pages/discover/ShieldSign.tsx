import { useCallback } from "react";

import { useReducedMotion } from "../../motion/useReducedMotion";
import { Ely } from "../../pixel/Ely";
import { PixelCanvas } from "../../pixel/PixelCanvas";
import type { ElyState } from "../../pixel/states";
import type { Condition } from "../../topo/geometry/conditions";
import { INK, ROPE_RED, SUN, UP, WARN } from "../track/flow/pixelArt";

const W = 49;
const H = 44;

/** Glyphs on the board, 9 x 9: ▲ for open, ! for caution, ✕ for closed, ? before a reading. */
const GLYPH: Readonly<Record<Condition | "unknown", readonly string[]>> = {
  open: ["....#....", "...###...", "...###...", "..#####..", "..#####..", ".#######.", ".#######.", "#########", "#########"],
  caution: ["...###...", "...###...", "...###...", "...###...", "...###...", "...###...", ".........", "...###...", "...###..."],
  closed: ["##.....##", "###...###", ".###.###.", "..#####..", "...###...", "..#####..", ".###.###.", "###...###", "##.....##"],
  unknown: ["..#####..", ".##...##.", ".......##", "......##.", "....##...", "...##....", ".........", "...##....", "...##...."],
};

const BOARD: Readonly<Record<Condition | "unknown", string>> = { open: UP, caution: WARN, closed: ROPE_RED, unknown: "#5C6760" };

/** The trail condition sign (pure painting): a diamond board on a post, the glyph in card white, a sun blaze on the post. */
function paintSign(ctx: CanvasRenderingContext2D, condition: Condition | "unknown", seconds: number, still: boolean): void {
  ctx.clearRect(0, 0, W, H);
  const cx = (W - 1) / 2;
  // post
  ctx.fillStyle = INK;
  ctx.fillRect(cx - 2, 24, 5, H - 24);
  ctx.fillStyle = "#8A5A2B";
  ctx.fillRect(cx - 1, 25, 3, H - 26);
  ctx.fillStyle = SUN;
  ctx.fillRect(cx - 1, 34, 3, 2);
  // ground
  ctx.fillStyle = INK;
  ctx.fillRect(cx - 10, H - 1, 21, 1);
  // diamond board, 31 px tall, stepped edges, a 1 px ink rim
  const top = 1;
  const half = 15;
  const sway = still ? 0 : Math.floor(seconds * 1.5) % 8 === 0 ? 1 : 0;
  for (let i = 0; i <= half * 2; i += 1) {
    const w = half - Math.abs(i - half);
    ctx.fillStyle = INK;
    ctx.fillRect(cx - w - 1 + sway, top + i, w * 2 + 3, 1);
    if (i > 0 && i < half * 2) {
      ctx.fillStyle = BOARD[condition];
      ctx.fillRect(cx - w + sway, top + i, w * 2 + 1, 1);
    }
  }
  const rows = GLYPH[condition];
  rows.forEach((row, y) => {
    [...row].forEach((c, x) => {
      if (c !== "#") return;
      ctx.fillStyle = "#FFF9EC";
      ctx.fillRect(cx - 4 + x + sway, top + half - 4 + y, 1, 1);
    });
  });
}

const WORD: Readonly<Record<Condition | "unknown", string>> = { open: "Open", caution: "Caution", closed: "Closed", unknown: "Not read yet" };
const ELY: Readonly<Record<Condition | "unknown" | "reading", ElyState>> = { open: "summit", caution: "worry", closed: "worry", unknown: "idle", reading: "watch" };

export interface ShieldSignProps {
  readonly condition: Condition | null;
  readonly reading: boolean;
  readonly score?: number;
  readonly reason?: string;
}

/**
 * Shield's verdict in pixels: the trail condition sign on its post and Ely
 * the inspector beside it (goggles on while reading, crowned when the trail
 * is open, worried at caution or closed). Mirrored about the axis.
 */
export function ShieldSign({ condition, reading, score, reason }: ShieldSignProps) {
  const key = condition ?? "unknown";
  // the end state whenever motion is reduced (the shared loop may repaint a still canvas at t = 0)
  const reduced = useReducedMotion();
  const draw = useCallback((ctx: CanvasRenderingContext2D, info: { readonly seconds: number; readonly still: boolean }) => paintSign(ctx, key, info.seconds, info.still || reduced), [key, reduced]);
  return (
    <div className="flex flex-col items-center gap-5 text-center">
      <div className="flex items-end justify-center gap-6">
        <PixelCanvas width={W} height={H} scale={3} draw={draw} animate fps={6} redrawKey={key} label={`Route condition: ${WORD[key]}`} />
        <Ely state={reading ? ELY.reading : ELY[key]} size={132} label={reading ? "Ely is inspecting the contract" : `Ely: ${WORD[key].toLowerCase()}`} />
      </div>
      <p className="font-display text-[34px] font-bold leading-none text-ink">
        {reading ? "Inspecting…" : WORD[key]}
        {score !== undefined && !reading ? <span className="tnum ml-3 font-mono text-[17px] font-semibold text-ink-2">{Math.round(score)} / 100</span> : null}
      </p>
      {reason && !reading ? <p className="max-w-[420px] text-[14px] leading-relaxed text-ink-2 text-pretty">{reason}</p> : null}
    </div>
  );
}
