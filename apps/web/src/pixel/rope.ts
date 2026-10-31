/**
 * The pixel rope (pure drawing): a braided red and yellow rope from the
 * crevasse (liquidation ✕) to the climber (the mark), a dotted route ahead to
 * the flag (take profit), the anchor (stop) and the entry tick. Under 10% to
 * the crevasse it frays: gaps and loose strands.
 */
import { drawGrid, type PixelSurface } from "./draw";
import { elySprite, INK, mini, ROPE_RED, SUN, type PixelGrid } from "./ely";
import type { RopeGeometry } from "../topo/geometry/rope";

export const ROPE_H_FULL = 30;
export const ROPE_H_COMPACT = 12;

export interface RopeLayout {
  readonly w: number;
  readonly h: number;
  /** Rope row (y). */
  readonly y: number;
  readonly margin: number;
  /** Marker x for a 0..1 rope position. */
  x(at: number): number;
}

export function ropeLayout(w: number, compact: boolean): RopeLayout {
  const h = compact ? ROPE_H_COMPACT : ROPE_H_FULL;
  const margin = compact ? 6 : 10;
  return { w, h, y: compact ? 6 : 22, margin, x: (at) => Math.round(margin + at * (w - margin * 2)) };
}

let climberCalm: PixelGrid | null = null;
let climberWorried: PixelGrid | null = null;

/** Paints the rope. `seconds` drives the loose strands of a critical rope (one change per second). */
export function paintRope(ctx: PixelSurface & { clearRect(x: number, y: number, w: number, h: number): void }, rope: RopeGeometry, layout: RopeLayout, seconds = 0): void {
  const { w, h, y } = layout;
  ctx.clearRect(0, 0, w, h);
  const compact = h === ROPE_H_COMPACT;
  const find = (kind: string) => rope.markers.find((marker) => marker.kind === kind);
  const crevasse = find("crevasse");
  const climber = find("climber");
  const flag = find("flag");
  const anchor = find("anchor");
  const entry = find("entry");
  const start = crevasse ? layout.x(crevasse.at) : 1;
  const cx = climber ? layout.x(climber.at) : Math.round(w / 2);
  const goal = flag ? layout.x(flag.at) : w - 2;

  // route ahead: dotted ink
  ctx.fillStyle = INK;
  for (let x = cx + 2; x < goal; x += rope.openEnd ? 4 : 3) ctx.fillRect(x, y, 1, 1);

  // the rope: braided, two pixels high
  const pulse = rope.pulses ? Math.floor(seconds) % 2 : 0;
  for (let x = start + 3; x < cx; x += 1) {
    if (rope.frays && (x - start) % 7 === (pulse ? 3 : 5)) continue;
    ctx.fillStyle = (x >> 1) % 2 ? SUN : ROPE_RED;
    ctx.fillRect(x, y, 1, 2);
    if (rope.frays && (x - start) % 9 === 2 + pulse) {
      ctx.fillStyle = ROPE_RED;
      ctx.fillRect(x, y - 1 - ((x >> 2) % 2), 1, 1);
      ctx.fillRect(x + 1, y + 2 + ((x >> 3) % 2), 1, 1);
    }
  }

  // crevasse: a red ✕ over a notch in the ground
  if (crevasse) {
    const x0 = layout.x(crevasse.at);
    const r = compact ? 2 : 3;
    ctx.fillStyle = ROPE_RED;
    for (let i = -r; i <= r; i += 1) {
      ctx.fillRect(x0 + i, y + 1 + i, 1, 1);
      ctx.fillRect(x0 + i, y + 1 - i, 1, 1);
    }
    if (!compact) {
      ctx.fillStyle = INK;
      for (let i = 0; i < 4; i += 1) {
        ctx.fillRect(x0 - 3 + i, h - 4 + i, 1, 1);
        ctx.fillRect(x0 + 3 - i, h - 4 + i, 1, 1);
      }
    }
  }
  // anchor: a piton with its ring
  if (anchor) {
    const ax = layout.x(anchor.at);
    ctx.fillStyle = INK;
    ctx.fillRect(ax, y - (compact ? 4 : 6), 1, compact ? 9 : 12);
    if (!compact) {
      ctx.fillRect(ax - 1, y - 8, 3, 1);
      ctx.fillRect(ax - 2, y - 7, 1, 1);
      ctx.fillRect(ax + 2, y - 7, 1, 1);
    }
  }
  // entry tick
  if (entry) {
    ctx.fillStyle = INK;
    ctx.fillRect(layout.x(entry.at), y + 3, 1, compact ? 3 : 4);
  }
  // flag
  if (flag) {
    ctx.fillStyle = INK;
    const fh = compact ? 10 : 14;
    ctx.fillRect(goal, y + 2 - fh, 1, fh);
    ctx.fillStyle = "#1F7A4C";
    ctx.fillRect(goal + 1, y + 2 - fh, compact ? 4 : 6, compact ? 3 : 4);
  }
  // the climber
  if (compact) {
    ctx.fillStyle = INK;
    ctx.fillRect(cx - 3, y - 3, 7, 8);
    ctx.fillStyle = SUN;
    ctx.fillRect(cx - 2, y - 2, 5, 6);
  } else {
    climberCalm ??= mini(elySprite({ gear: "rope", eye: "happy" }));
    climberWorried ??= mini(elySprite({ gear: "rope", eye: "worried", mouth: "o" }));
    const sprite = rope.frays ? climberWorried : climberCalm;
    drawGrid(ctx, sprite, cx - 8, y - 16, 1);
  }
}
