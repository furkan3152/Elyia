/**
 * The chart's rope markers (pure drawing). Lightweight-charts draws the
 * candles; this paints the position's levels over them as pixel art on a
 * transparent overlay, in device pixels with a whole-number art unit:
 *
 *   crevasse (liquidation)  a braided red and yellow rope, the ground past it
 *                           dithered red, a red ✕ at the left; it frays (gaps)
 *                           under 10% and Ely hangs on it, worried
 *   anchor (stop)           a dotted ink line and a piton
 *   flag (take profit)      a dotted green line and a pennant
 *   entry                   a dashed ink line
 *   ticket                  the ticket's limit price, dashed in the accent
 *   new flag / new anchor   the ticket's TP / SL preview, sparser dots
 */
import { drawGrid, type PixelSurface } from "../../pixel/draw";
import { elySprite, mini, ROPE_RED, SUN, type PixelGrid } from "../../pixel/ely";

export type ChartRopeKind = "crevasse" | "anchor" | "flag" | "entry" | "ticket" | "new-flag" | "new-anchor";

export interface ChartRope {
  readonly kind: ChartRopeKind;
  /** Price coordinate in device pixels from the pane top. */
  readonly y: number;
  /** The position is long (the crevasse opens below), else short (above). */
  readonly long?: boolean;
  /** Under 10% to the crevasse: the rope frays and Ely hangs on. */
  readonly frays?: boolean;
}

export interface ChartRopePalette {
  readonly ink: string;
  readonly up: string;
  readonly accent: string;
  /** Translucent rope red for the crevasse ground. */
  readonly danger: string;
}

export interface ChartRopeFrame {
  /** Pane size in device pixels (without the price axis). */
  readonly w: number;
  readonly h: number;
  /** Device pixels per art pixel (a whole number). */
  readonly unit: number;
  readonly ropes: readonly ChartRope[];
  readonly palette: ChartRopePalette;
  /** Shared clock (s): the loose strands of a fraying rope shift once a second. */
  readonly seconds?: number;
}

/** Device-pixel row of an art row: coordinates snap to the art grid so every line is crisp. */
export function snapToUnit(value: number, unit: number): number {
  return Math.round(value / unit) * unit;
}

/** Whether a level is inside the pane (with a little margin for the glyphs). */
export function onPane(y: number, h: number, unit: number): boolean {
  return Number.isFinite(y) && y >= -unit * 4 && y <= h + unit * 4;
}

let hanging: PixelGrid | null = null;

function dots(ctx: PixelSurface, y: number, w: number, u: number, color: string, on: number, period: number, thick = 1): void {
  ctx.fillStyle = color;
  for (let x = 0; x < w; x += period * u) ctx.fillRect(x, y, on * u, thick * u);
}

/** Paints every rope marker; the caller clears the canvas first. */
export function paintChartRopes(ctx: PixelSurface, frame: ChartRopeFrame): void {
  const { w, h, unit: u, palette } = frame;
  const pulse = Math.floor(frame.seconds ?? 0) % 2;
  // Drawing order: ground and quiet lines first, the crevasse rope last.
  const order: readonly ChartRopeKind[] = ["entry", "new-anchor", "new-flag", "ticket", "anchor", "flag", "crevasse"];
  const ropes = [...frame.ropes].filter((rope) => onPane(rope.y, h, u)).sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
  for (const rope of ropes) {
    const y = snapToUnit(rope.y, u);
    switch (rope.kind) {
      case "entry":
        dots(ctx, y, w, u, palette.ink, 3, 5);
        break;
      case "ticket":
        dots(ctx, y, w, u, palette.accent, 4, 6, 1);
        break;
      case "new-flag":
        dots(ctx, y, w, u, palette.up, 1, 4);
        break;
      case "new-anchor":
        dots(ctx, y, w, u, palette.ink, 1, 4);
        break;
      case "anchor": {
        dots(ctx, y, w, u, palette.ink, 1, 3);
        // a piton with its ring, clear of the crevasse ✕ and Ely
        const x = 36 * u;
        ctx.fillStyle = palette.ink;
        ctx.fillRect(x, y - 5 * u, u, 9 * u);
        ctx.fillRect(x - u, y - 7 * u, 3 * u, u);
        ctx.fillRect(x - 2 * u, y - 6 * u, u, u);
        ctx.fillRect(x + 2 * u, y - 6 * u, u, u);
        ctx.fillRect(x - u, y + 4 * u, 3 * u, u);
        break;
      }
      case "flag": {
        dots(ctx, y, w, u, palette.up, 1, 3);
        // a pennant on its pole, clear of the crevasse ✕ and Ely
        const x = 36 * u;
        ctx.fillStyle = palette.ink;
        ctx.fillRect(x, y - 9 * u, u, 10 * u);
        ctx.fillStyle = palette.up;
        ctx.fillRect(x + u, y - 9 * u, 5 * u, u);
        ctx.fillRect(x + u, y - 8 * u, 4 * u, u);
        ctx.fillRect(x + u, y - 7 * u, 3 * u, u);
        ctx.fillRect(x + u, y - 6 * u, 2 * u, u);
        break;
      }
      case "crevasse": {
        // the ground past the crevasse: a sparse red dither (every 4th art pixel, offset by row)
        const below = rope.long !== false;
        ctx.fillStyle = palette.danger;
        const from = below ? y + 2 * u : 0;
        const to = below ? h : y;
        for (let row = from; row < to; row += 2 * u) {
          const shift = ((row / u) >> 1) % 2 ? 2 * u : 0;
          for (let x = shift; x < w; x += 4 * u) ctx.fillRect(x, row, u, u);
        }
        // the rope: braided, two art pixels high, frayed with gaps under 10%
        for (let x = 0, i = 0; x < w; x += u, i += 1) {
          if (rope.frays && i % 11 === (pulse ? 4 : 8)) continue;
          ctx.fillStyle = (i >> 1) % 2 ? SUN : ROPE_RED;
          ctx.fillRect(x, y, u, 2 * u);
          if (rope.frays && i % 13 === 3 + pulse) {
            ctx.fillStyle = ROPE_RED;
            ctx.fillRect(x, y - u, u, u);
            ctx.fillRect(x + u, y + 2 * u, u, u);
          }
        }
        // the ✕ at the left edge, outlined in ink so it reads on any candle
        const cx = 8 * u;
        const cy = y + u;
        ctx.fillStyle = palette.ink;
        for (let i = -4; i <= 4; i += 1) {
          ctx.fillRect(cx + i * u - u, cy + i * u - u, 3 * u, 3 * u);
          ctx.fillRect(cx + i * u - u, cy - i * u - u, 3 * u, 3 * u);
        }
        ctx.fillStyle = ROPE_RED;
        for (let i = -3; i <= 3; i += 1) {
          ctx.fillRect(cx + i * u, cy + i * u, u, u);
          ctx.fillRect(cx + i * u, cy - i * u, u, u);
        }
        if (rope.frays) {
          // Ely holds on, just past the ✕, worried
          hanging ??= mini(elySprite({ gear: "rope", eye: "worried", mouth: "o" }));
          const ey = below ? y - 15 * u : y + 3 * u;
          drawGrid(ctx, hanging, 15 * u, ey + (pulse && !below ? u : 0), u);
        }
        break;
      }
      default:
        break;
    }
  }
}
