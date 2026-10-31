/**
 * The yield skyline (pure): every way to earn as a pixel mountain in a side
 * view, in rank order, one equal slot each between two mirrored gutters.
 * Height is the APR (square-root scale, so 5% and 50% both read), the
 * mountain's width is the TVL (log scale), its rock is its layer (Floor
 * teal, Ridge ochre) and the tallest wear snow. A losing vault is a lake
 * under the ground line. Ely stands on the chosen summit and plants the
 * flag; on a losing lake Ely worries at the shore.
 */
import type { TextSurface } from "../../pixel/scene";
import type { LayerSurface } from "../track/flow/pixelArt";
import { shade } from "../../pixel/topo";
import { AQUA, CARD, INK, paintCached, paintCloud, paintConfetti, paintEly, paintFlag, paintLabel, paintSky, strataFor, WHITE } from "../track/flow/pixelArt";
import { formatApr, type YieldRow } from "./yields";

export interface Mountain {
  readonly id: string;
  /** Centre x of the slot (and the summit). */
  readonly cx: number;
  /** Half width of the base. */
  readonly half: number;
  /** Height above the ground in pixels (negative: lake depth). */
  readonly rise: number;
  readonly lake: boolean;
}

export interface SkylineLayout {
  readonly w: number;
  readonly h: number;
  readonly gutter: number;
  readonly ground: number;
  readonly slot: number;
  readonly mountains: readonly Mountain[];
}

/** Each side gutter, as a fraction of the width. */
export const SKYLINE_GUTTER = 0.04;

export function skylineLayout(rows: readonly YieldRow[], w: number, h: number): SkylineLayout {
  const gutter = Math.round(w * SKYLINE_GUTTER);
  const ground = Math.round(h * 0.8);
  const inner = w - gutter * 2;
  const n = Math.max(1, rows.length);
  const slot = inner / n;
  const maxGain = Math.max(1, ...rows.map((row) => row.aprPct ?? 0));
  const maxLoss = Math.max(1, ...rows.map((row) => -(row.aprPct ?? 0)));
  const room = ground - 46;
  const mountains = rows.map((row, index) => {
    const apr = row.aprPct ?? 0;
    const tvl = row.tvlUsd ?? 0;
    // log TVL: $10k -> 0.35 slot, $10B -> 0.8 slot (half widths), always inside a slot and a half
    const decades = tvl > 0 ? Math.log10(tvl) : 3;
    const share = Math.max(0.28, Math.min(0.78, 0.28 + ((decades - 4) / 6) * 0.5));
    const half = Math.max(4, Math.round(slot * share));
    const rise = apr < 0 ? -Math.max(2, Math.round(Math.sqrt(-apr / maxLoss) * Math.min(10, h - ground - 4))) : Math.max(4, Math.round(Math.sqrt(apr / maxGain) * room));
    return { id: row.id, cx: Math.round(gutter + slot * (index + 0.5)), half, rise, lake: apr < 0 };
  });
  return { w, h, gutter, ground, slot, mountains };
}

/** Height of a mountain over column x (0 outside it): convex flanks, stepped in 2 px terraces. */
export function mountainHeight(m: Mountain, x: number): number {
  const d = Math.abs(x - m.cx) / m.half;
  if (d >= 1 || m.lake) return 0;
  const raw = m.rise * (1 - d ** 1.25);
  return Math.max(1, Math.round(raw / 2) * 2);
}

export interface SkylineFrame {
  readonly rows: readonly YieldRow[];
  readonly selectedId: string | null;
  readonly night: boolean;
  readonly seconds: number;
  readonly still: boolean;
}

/** The still land: soil bands, lakes and the mountains (tallest at the back). */
function paintLand(ctx: TextSurface, layout: SkylineLayout, rows: readonly YieldRow[], night: boolean): void {
  const { w, h, ground, mountains } = layout;
  const strata = strataFor(night);
  // the ground: a meadow line and soil bands down to the bottom
  const soil = strata.ridge;
  for (let y = ground; y < h; y += 1) {
    const k = Math.min(3, Math.floor((y - ground) / 5));
    ctx.fillStyle = (y - ground) % 4 === 0 && y > ground ? shade(soil[k]!, -0.2) : soil[k]!;
    ctx.fillRect(0, y, w, 1);
  }

  // lakes first (they sit in the ground), then mountains, tallest at the back
  mountains.forEach((m) => {
    if (!m.lake) return;
    const depth = -m.rise;
    for (let x = m.cx - m.half; x <= m.cx + m.half; x += 1) {
      const d = Math.abs(x - m.cx) / m.half;
      const col = Math.round(depth * (1 - d * d)) + 1;
      for (let y = ground; y < ground + col; y += 1) {
        ctx.fillStyle = y === ground ? "#2F7E8C" : "#1F5866";
        ctx.fillRect(x, y, 1, 1);
      }
    }
  });
  const order = mountains.map((m, index) => ({ m, index })).filter(({ m }) => !m.lake).sort((a, b) => b.m.rise - a.m.rise);
  const tallest = order[0]?.m.rise ?? 0;
  for (const { m, index } of order) {
    const row = rows[index]!;
    const rock = row.layer === "ridge" ? strata.ridge : row.layer === "summit" ? strata.summit : strata.floor;
    const snowy = m.rise >= tallest * 0.75 && m.rise > 20;
    const band = Math.max(3, Math.round(m.rise / 6));
    for (let x = m.cx - m.half; x <= m.cx + m.half; x += 1) {
      const height = mountainHeight(m, x);
      if (height <= 0 || x < 0 || x >= w) continue;
      const top = ground - height;
      for (let y = top; y < ground; y += 1) {
        const depth = y - (ground - m.rise);
        const k = Math.min(rock.length - 1, Math.max(0, Math.floor(depth / band)));
        const edge = depth % band === 0 && depth > 0;
        let color = rock[k]!;
        if (snowy && depth < band) color = WHITE;
        // the lit flank (left) is a step lighter
        if (x < m.cx && !(snowy && depth < band)) color = shade(color, 0.12);
        ctx.fillStyle = edge ? shade(color, -0.22) : color;
        ctx.fillRect(x, y, 1, 1);
      }
      ctx.fillStyle = INK;
      ctx.fillRect(x, top, 1, 1);
      // a stepped outline: fill the vertical gap to the neighbour's top
      const next = mountainHeight(m, x + 1);
      if (next > height) ctx.fillRect(x, ground - next, 1, next - height);
      const prev = mountainHeight(m, x - 1);
      if (prev > height) ctx.fillRect(x, ground - prev, 1, prev - height);
    }
  }
  ctx.fillStyle = INK;
  ctx.fillRect(0, ground, w, 1);
}

/** Paints the skyline. */
export function paintSkyline(ctx: LayerSurface, layout: SkylineLayout, frame: SkylineFrame): void {
  const { w, h, ground, mountains } = layout;
  const { night, seconds: T, still, rows } = frame;
  ctx.font = "8px Silkscreen";
  ctx.textBaseline = "top";
  paintSky(ctx, w, ground, night, { x: Math.round(w * 0.5), y: Math.round(ground * 0.22) }, T, still);
  for (let i = 0; i < 3; i += 1) {
    const x = still ? (i * 131) % w : ((i * 131 + T * (2 + i)) % (w + 40)) - 40;
    paintCloud(ctx, x, Math.round(ground * (0.18 + i * 0.08)), 18 + i * 5, night);
  }

  // the ground, the lakes and the mountains are still: painted once, then blitted
  const key = `sky|${w}|${h}|${night}|${rows.map((row) => `${row.id}:${row.aprPct}:${row.tvlUsd}:${row.layer}`).join(",")}`;
  paintCached(ctx, key, w, h, (layer) => paintLand(layer, layout, rows, night));
  // lake glints move: a few pixels per frame
  if (!still) {
    for (const m of mountains) {
      if (!m.lake) continue;
      const depth = -m.rise;
      ctx.fillStyle = AQUA;
      for (let x = m.cx - m.half; x <= m.cx + m.half; x += 1) {
        const d = Math.abs(x - m.cx) / m.half;
        const col = Math.round(depth * (1 - d * d)) + 1;
        for (let y = ground; y < ground + col; y += 1) if ((x + y + Math.floor(T * 2)) % 9 === 0) ctx.fillRect(x, y, 1, 1);
      }
    }
  }

  // the APR over each summit (or over each lake); the names sit in the buttons under the frame
  mountains.forEach((m, index) => {
    const row = rows[index]!;
    const chosen = row.id === frame.selectedId;
    const apr = formatApr(row.aprPct);
    const labelY = m.lake ? ground - 12 : ground - m.rise - (chosen ? 34 : 12);
    paintLabel(ctx, apr, m.cx, Math.max(1, labelY), chosen ? INK : CARD, "center", chosen ? "#F2C200" : INK);
  });

  // Ely on the chosen summit, flag planted; at the shore of a losing lake, worried
  const chosenIndex = rows.findIndex((row) => row.id === frame.selectedId);
  const chosen = chosenIndex >= 0 ? mountains[chosenIndex] : undefined;
  if (chosen && !chosen.lake) {
    const foot = ground - chosen.rise;
    paintFlag(ctx, chosen.cx + 6, foot, T, still);
    paintEly(ctx, "summit", chosen.cx - 2, foot, { seconds: T, still });
    paintConfetti(ctx, chosen.cx, foot - 4, T, still, 26);
  } else if (chosen) {
    paintEly(ctx, "worry", chosen.cx - chosen.half - 6, ground, { seconds: T, still });
  }
}
