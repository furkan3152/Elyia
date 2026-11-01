/**
 * The price altitude as pixel bars (pure): one HYPE priced by every place
 * that quotes it, each a pixel tower on a log altitude from $1 to $100k,
 * the same scale post on both sides of the axis. The reference (HyperCore
 * mainnet mid) carries the sun cap and Ely; the air between the reference
 * line and a practice-wall pool far above it is hatched in rope red and
 * labelled, so nobody reads a testnet pool price as a market price.
 */
import type { TextSurface } from "../../pixel/scene";
import type { LayerSurface } from "../track/flow/pixelArt";
import { shade } from "../../pixel/topo";
import { CARD, INK, NIGHT_CARD, paintCached, paintEly, paintHatch, ROPE_RED, strataFor, SUN, WHITE } from "../track/flow/pixelArt";
import { altitudeOf, ALTITUDE_DECADES, decadeLabel, distortion, type AltitudeMark } from "./swapModel";

export interface BarLayout {
  readonly id: string;
  /** Left x and width of the tower. */
  readonly x: number;
  readonly w: number;
  /** Top y of the tower. */
  readonly top: number;
  readonly kind: AltitudeMark["kind"];
}

export interface AltitudeLayout {
  readonly w: number;
  readonly h: number;
  /** Gutter on each side (the scale post), equal left and right. */
  readonly gutter: number;
  /** Ground (the $1 line) and the $100k line. */
  readonly ground: number;
  readonly ceiling: number;
  readonly bars: readonly BarLayout[];
  /** y of the reference line, when there is a reference. */
  readonly referenceY: number | null;
}

/** Fraction of the width each scale post takes (more on the narrow phone canvas, so "$100k" fits). */
export function gutterFraction(w: number): number {
  return w < 260 ? 0.15 : 0.1;
}

/** y of a price on the log altitude. */
export function priceY(price: number, ground: number, ceiling: number): number {
  return Math.round(ground - altitudeOf(price) * (ground - ceiling));
}

/** Equal slots between the two posts; towers centred in their slots, half a slot wide. */
export function altitudeLayout(marks: readonly AltitudeMark[], w: number, h: number): AltitudeLayout {
  const gutter = Math.round(w * gutterFraction(w));
  const ground = h - 6;
  const ceiling = 14;
  const inner = w - gutter * 2;
  const n = Math.max(1, marks.length);
  const slot = inner / n;
  const barW = Math.max(6, Math.min(36, Math.round(slot * 0.46)));
  const bars = marks.map((mark, index) => {
    const centre = gutter + slot * (index + 0.5);
    return { id: mark.id, x: Math.round(centre - barW / 2), w: barW, top: priceY(mark.price, ground, ceiling), kind: mark.kind };
  });
  const reference = marks.find((mark) => mark.kind === "reference");
  return { w, h, gutter, ground, ceiling, bars, referenceY: reference ? priceY(reference.price, ground, ceiling) : null };
}

/** Mixes two hex colours (k = share of `b`). */
export function mix(a: string, b: string, k: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (shift: number) => Math.round(((pa >> shift) & 255) * (1 - k) + ((pb >> shift) & 255) * k);
  return `#${((1 << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).slice(1)}`;
}

/** The decade band colours, low to high: Floor teal, Ridge ochre, Summit ice, snow, gold. */
function decadeColor(decade: number, night: boolean): string {
  const strata = strataFor(night);
  const ramp = [strata.floor[2]!, strata.floor[0]!, strata.ridge[1]!, strata.summit[3]!, strata.summit[1]!, strata.gold[1]!];
  return ramp[Math.max(0, Math.min(ramp.length - 1, decade))]!;
}

export interface AltitudeFrame {
  readonly marks: readonly AltitudeMark[];
  readonly reference: number | null;
  readonly night: boolean;
  readonly seconds: number;
  readonly still: boolean;
}

/** Paints the price altitude: the still chart once (cached), then Ely on the reference tower. */
export function paintAltitude(ctx: LayerSurface, layout: AltitudeLayout, frame: AltitudeFrame): void {
  const key = `alt|${layout.w}|${layout.h}|${frame.night}|${frame.reference}|${frame.marks.map((mark) => `${mark.id}:${mark.price}`).join(",")}`;
  paintCached(ctx, key, layout.w, layout.h, (surface) => paintAltitudeStill(surface, layout, frame));
  const refBar = layout.bars.find((bar) => bar.kind === "reference");
  if (refBar) paintEly(ctx, "walk", refBar.x + Math.round(refBar.w / 2), refBar.top - 1, { seconds: frame.seconds, still: frame.still });
}

function paintAltitudeStill(ctx: TextSurface, layout: AltitudeLayout, frame: AltitudeFrame): void {
  const { w, h, gutter, ground, ceiling, bars, referenceY } = layout;
  const { night } = frame;
  // the sheet: one faint altitude zone per decade, dithered at each seam
  const top0 = ALTITUDE_DECADES[ALTITUDE_DECADES.length - 1]!;
  const sheet = night ? NIGHT_CARD : CARD;
  ctx.fillStyle = sheet;
  ctx.fillRect(0, 0, w, h);
  for (let y = ceiling; y < ground; y += 1) {
    const decade = Math.min(top0 - 1, Math.floor(((ground - y) / (ground - ceiling)) * top0));
    const zone = mix(sheet, decadeColor(decade, night), night ? 0.22 : 0.3);
    ctx.fillStyle = zone;
    ctx.fillRect(gutter, y, w - gutter * 2, 1);
  }
  ctx.font = "8px Silkscreen";
  ctx.textBaseline = "top";
  const top = ALTITUDE_DECADES[ALTITUDE_DECADES.length - 1]!;
  const ink = night ? "#EEE7D8" : INK;

  // the two scale posts and the decade lines between them; a narrow phone
  // post drops every "$" (the caption says USD) so "100k" stays on the sheet
  const widest = Math.max(...ALTITUDE_DECADES.map((decade) => Math.ceil(ctx.measureText(decadeLabel(decade)).width)));
  const bare = widest + 5 > gutter;
  for (const decade of ALTITUDE_DECADES) {
    const y = Math.round(ground - (decade / top) * (ground - ceiling));
    for (let x = gutter; x < w - gutter; x += 3) {
      ctx.fillStyle = night ? "#3D5E70" : "#C9C0A8";
      ctx.fillRect(x, y, 1, 1);
    }
    const text = bare ? decadeLabel(decade).slice(1) : decadeLabel(decade);
    const tw = Math.ceil(ctx.measureText(text).width);
    const gap = Math.min(5, Math.max(1, gutter - tw - 1));
    ctx.fillStyle = ink;
    ctx.fillText(text, gutter - tw - gap, y - 4);
    ctx.fillText(text, w - gutter + gap, y - 4);
    ctx.fillRect(gutter - 3, y, 3, 1);
    ctx.fillRect(w - gutter, y, 3, 1);
  }
  for (let y = ceiling; y <= ground; y += 1) {
    const decade = Math.min(top - 1, Math.floor(((ground - y) / (ground - ceiling)) * top));
    ctx.fillStyle = decadeColor(decade, night);
    ctx.fillRect(gutter - 2, y, 2, 1);
    ctx.fillRect(w - gutter, y, 2, 1);
  }

  // the air between the reference and the highest pool, hatched in rope red
  const reference = frame.reference;
  const pools = frame.marks.filter((mark) => mark.kind === "pool");
  const worst = pools.map((mark) => ({ mark, factor: reference ? distortion(mark.price, reference) : null })).sort((a, b) => (b.factor ?? 0) - (a.factor ?? 0))[0];
  const worstBar = worst ? bars.find((bar) => bar.id === worst.mark.id) : undefined;
  if (referenceY !== null && worstBar && worst?.factor && worst.factor > 1.5) {
    paintHatch(ctx, gutter, worstBar.top, w - gutter * 2, referenceY - worstBar.top, ROPE_RED);
  }

  // towers: banded by decade, contour pixel at every band edge, an ink outline
  frame.marks.forEach((mark, index) => {
    const bar = bars[index]!;
    if (mark.kind === "none") {
      // a survey stake: no pool for this pair, so no height to draw
      const cx = bar.x + Math.round(bar.w / 2);
      for (let y = ground - 12; y < ground; y += 1) {
        ctx.fillStyle = (ground - y) % 4 < 2 ? INK : ROPE_RED;
        ctx.fillRect(cx - 1, y, 2, 1);
      }
      ctx.fillStyle = ROPE_RED;
      ctx.fillRect(cx - 4, ground - 14, 8, 3);
      return;
    }
    for (let y = bar.top; y < ground; y += 1) {
      const decade = Math.min(top - 1, Math.floor(((ground - y) / (ground - ceiling)) * top));
      const color = decadeColor(decade, night);
      const edge = (ground - y) % 6 === 0;
      for (let x = bar.x; x < bar.x + bar.w; x += 1) {
        const lit = x < bar.x + Math.max(2, Math.round(bar.w / 4));
        ctx.fillStyle = edge ? shade(color, -0.22) : lit ? shade(color, 0.18) : color;
        ctx.fillRect(x, y, 1, 1);
      }
    }
    ctx.fillStyle = INK;
    ctx.fillRect(bar.x - 1, bar.top - 1, bar.w + 2, 1);
    ctx.fillRect(bar.x - 1, bar.top, 1, ground - bar.top);
    ctx.fillRect(bar.x + bar.w, bar.top, 1, ground - bar.top);
    // the cap: sun for the reference, card for pools, floor teal for the book
    ctx.fillStyle = mark.kind === "reference" ? SUN : mark.kind === "book" ? strataFor(night).floor[1]! : CARD;
    ctx.fillRect(bar.x, bar.top, bar.w, 3);
    ctx.fillStyle = INK;
    ctx.fillRect(bar.x, bar.top + 3, bar.w, 1);
  });

  // the gap's label, over the towers
  if (referenceY !== null && worstBar && worst?.factor && worst.factor > 1.5) {
    const label = `×${Math.round(worst.factor).toLocaleString("en-US")} ABOVE THE MARKET`;
    const lw = Math.ceil(ctx.measureText(label).width);
    const ly = Math.min(referenceY - 34, worstBar.top + 8);
    const lx = Math.round(w / 2 - lw / 2);
    ctx.fillStyle = ROPE_RED;
    ctx.fillRect(lx - 3, ly - 1, lw + 6, 11);
    ctx.fillStyle = WHITE;
    ctx.fillText(label, lx, ly);
  }

  // the reference line: "you are here", a sun dash across the sheet
  if (referenceY !== null) {
    for (let x = gutter; x < w - gutter; x += 1) {
      ctx.fillStyle = x % 4 < 2 ? SUN : INK;
      ctx.fillRect(x, referenceY, 1, 1);
    }
  }

  // ground
  ctx.fillStyle = INK;
  ctx.fillRect(gutter - 3, ground, w - gutter * 2 + 6, 2);
}
