/**
 * The pixel trace of a hash across the layers (pure). The sheet is cut into
 * the three altitude bands (Summit on top, Ridge, Floor at the bottom), the
 * band names mirrored on both edges. Each stage of the journey is a
 * station in an equal slot, standing in the band of its layer; the trail
 * between stations steps up or down through the bands like a switchback.
 * Settled legs are inked, the live leg marches in sun pixels (4 steps per
 * second), the rest is dotted. Ely waits at the live station: climbing in
 * flight, crowned when everything settled, worried at an alert, asleep when
 * there is nothing on the map.
 */
import type { Layer } from "../../topo/geometry/relief";
import type { TextSurface } from "../../pixel/scene";
import { shade } from "../../pixel/topo";
import { CARD, INK, paintCached, paintConfetti, paintEly, paintFlag, paintLabel, ROPE_RED, strataFor, SUN, type MiniMood } from "./flow/pixelArt";
import type { LayerSurface } from "./flow/pixelArt";
import type { Stage } from "./traceRoute";

export interface Station {
  readonly label: string;
  readonly layer: Layer;
  readonly state: Stage["state"];
}

/** Layers of the trace stages by name (traceRoute's stage labels). */
const STAGE_LAYER: Readonly<Record<string, Layer>> = {
  HyperEVM: "ridge",
  "Delayed inbox": "ridge",
  Ticket: "summit",
  "Auto-redeem": "summit",
  "On the Summit": "summit",
  Withdrawn: "summit",
  "Confirm period": "summit",
  "Claim at the Ridge": "ridge",
};

/** Stations for traceRoute's stages; unknown names fall back to `fallback`. */
export function stationsOf(stages: readonly Stage[], fallback: Layer): Station[] {
  return stages.map((stage) => ({ label: stage.label, layer: STAGE_LAYER[stage.label] ?? fallback, state: stage.state }));
}

/** Side gutter of the station slots, as a fraction of the width. */
export const TRACE_GUTTER = 0.06;

export const BAND_ORDER: readonly Layer[] = ["summit", "ridge", "floor"];

/** y of the trail inside a layer's band (its centre line, a little low). */
export function bandLine(layer: Layer, h: number): number {
  const band = h / 3;
  return Math.round(BAND_ORDER.indexOf(layer) * band + band * 0.7);
}

/** x of station i of n between two gutters. */
export function stationX(index: number, n: number, w: number, gutter: number): number {
  const slot = (w - gutter * 2) / Math.max(1, n);
  return Math.round(gutter + slot * (index + 0.5));
}

/** The pixel trail between two stations: along, then a stepped switch of bands at the midpoint. */
export function legPoints(a: { x: number; y: number }, b: { x: number; y: number }): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = [];
  const mid = Math.round((a.x + b.x) / 2);
  for (let x = a.x; x < mid; x += 1) out.push({ x, y: a.y });
  const dir = b.y >= a.y ? 1 : -1;
  // a staircase: one pixel across for every two down (or up)
  let y = a.y;
  let x = mid;
  while (y !== b.y) {
    out.push({ x, y });
    y += dir;
    if (Math.abs(y - a.y) % 2 === 0) x += 1;
  }
  for (; x <= b.x; x += 1) out.push({ x, y: b.y });
  return out;
}

/** Ely's mood for a journey. */
export function journeyMood(stations: readonly Station[]): { readonly mood: MiniMood; readonly at: number } {
  if (stations.length === 0) return { mood: "sleep", at: -1 };
  const alert = stations.findIndex((s) => s.state === "alert");
  if (alert >= 0) return { mood: "worry", at: alert };
  const now = stations.findIndex((s) => s.state === "now");
  if (now >= 0) return { mood: "climb", at: now };
  if (stations.every((s) => s.state === "done")) return { mood: "summit", at: stations.length - 1 };
  const lastDone = stations.map((s) => s.state).lastIndexOf("done");
  return { mood: "walk", at: Math.max(0, lastDone) };
}

export interface TraceFrame {
  readonly stations: readonly Station[];
  /** Shown in the middle when there are no stations ("PASTE A HASH"). */
  readonly idleText: string;
  /** Ely's mood when there are no stations (default asleep; climbing while reading). */
  readonly idleMood?: MiniMood;
  readonly night: boolean;
  readonly seconds: number;
  readonly still: boolean;
  readonly compact: boolean;
}

const NAMES: Readonly<Record<Layer, readonly [string, string]>> = { summit: ["SUMMIT · ELYSIUM", "SUMMIT"], ridge: ["RIDGE · HYPEREVM", "RIDGE"], floor: ["FLOOR · HYPERCORE", "FLOOR"] };

/** The three altitude bands with their mirrored names. */
function paintBands(ctx: TextSurface, w: number, h: number, night: boolean, compact: boolean): void {
  const strata = strataFor(night);
  const bandH = h / 3;
  // the three bands: light strata of each layer, contour pixels every 4 rows
  BAND_ORDER.forEach((layer, index) => {
    const colors = strata[layer];
    const top = Math.round(index * bandH);
    const bottom = Math.round((index + 1) * bandH);
    for (let y = top; y < bottom; y += 1) {
      const k = Math.min(colors.length - 1, Math.floor(((y - top) / (bottom - top)) * 3));
      const base = night ? shade(colors[k + 1] ?? colors[k]!, -0.25) : colors[k]!;
      ctx.fillStyle = (y - top) % 4 === 3 ? shade(base, -0.1) : base;
      ctx.fillRect(0, y, w, 1);
    }
    // seam
    if (index > 0) {
      for (let x = 0; x < w; x += 1) if (x % 4 !== 3) {
        ctx.fillStyle = INK;
        ctx.fillRect(x, top, 1, 1);
      }
    }
    // the band name, mirrored on both edges
    const name = NAMES[layer][compact ? 1 : 0];
    const y = top + 4;
    // day: ink straight on the band; night: a cream name on an ink plate (AA on every band)
    paintLabel(ctx, name, 6, y, night ? CARD : INK, "left", night ? INK : undefined);
    paintLabel(ctx, name, w - 6, y, night ? CARD : INK, "right", night ? INK : undefined);
  });

}

/** Paints the trace. */
export function paintTrace(ctx: LayerSurface, w: number, h: number, frame: TraceFrame): void {
  const { stations, night, seconds: T, still, compact } = frame;
  const bandH = h / 3;
  ctx.font = "8px Silkscreen";
  ctx.textBaseline = "top";

  // the three bands are still: painted once per size and sheet, then blitted
  paintCached(ctx, `trace|${w}|${h}|${night}|${compact}`, w, h, (layer) => {
    layer.font = "8px Silkscreen";
    layer.textBaseline = "top";
    paintBands(layer, w, h, night, compact);
  });

  if (stations.length === 0) {
    const cx = Math.round(w / 2);
    paintLabel(ctx, frame.idleText, cx, Math.round(bandH / 2) - 4, INK, "center", SUN);
    paintEly(ctx, frame.idleMood ?? "sleep", cx, bandLine("ridge", h) + 4, { seconds: T, still, walking: frame.idleMood === "walk" });
    return;
  }

  const gutter = Math.round(w * TRACE_GUTTER);
  const points = stations.map((station, index) => ({ x: stationX(index, stations.length, w, gutter), y: bandLine(station.layer, h) }));
  // legs
  for (let i = 0; i + 1 < points.length; i += 1) {
    const leg = legPoints(points[i]!, points[i + 1]!);
    const to = stations[i + 1]!;
    const done = to.state === "done";
    const live = to.state === "now" || to.state === "alert";
    const march = still ? 0 : Math.floor(T * 4) % 4;
    leg.forEach((p, k) => {
      if (done) {
        ctx.fillStyle = INK;
        ctx.fillRect(p.x, p.y, 1, 2);
      } else if (live) {
        ctx.fillStyle = (k + march) % 4 < 2 ? (to.state === "alert" ? ROPE_RED : SUN) : INK;
        ctx.fillRect(p.x, p.y, 1, 2);
      } else if (k % 3 === 0) {
        ctx.fillStyle = INK;
        ctx.fillRect(p.x, p.y, 1, 1);
      }
    });
  }
  // stations: a post with a plate; done = ink, now = sun, alert = red, todo = card
  const { mood, at } = journeyMood(stations);
  stations.forEach((station, index) => {
    const p = points[index]!;
    const plate = station.state === "done" ? INK : station.state === "now" ? SUN : station.state === "alert" ? ROPE_RED : CARD;
    ctx.fillStyle = INK;
    ctx.fillRect(p.x - 3, p.y - 3, 7, 7);
    ctx.fillStyle = plate;
    ctx.fillRect(p.x - 2, p.y - 2, 5, 5);
    if (station.state === "done") {
      ctx.fillStyle = SUN;
      ctx.fillRect(p.x, p.y, 1, 1);
    }
    const text = String(index + 1);
    const ink = station.state === "done" ? CARD : station.state === "alert" ? CARD : INK;
    const label = station.state === "done" ? INK : station.state === "now" ? SUN : station.state === "alert" ? ROPE_RED : CARD;
    paintLabel(ctx, text, p.x, p.y + 7, ink, "center", label);
  });
  // Ely at the live station (standing on its post)
  const p = points[Math.max(0, at)]!;
  paintEly(ctx, mood, p.x, p.y - 4, { seconds: T, still });
  if (mood === "summit") {
    paintFlag(ctx, p.x + 9, p.y - 3, T, still);
    paintConfetti(ctx, p.x, p.y - 10, T, still, 26);
  }
}

/** A 7 x 7 mirrored fingerprint of a hash (true = filled), for the trace header. */
export function hashFingerprint(hash: string): boolean[][] {
  const hex = hash.replace(/^0x/u, "").padEnd(64, "0");
  const rows: boolean[][] = [];
  for (let y = 0; y < 7; y += 1) {
    const row: boolean[] = [];
    for (let x = 0; x < 4; x += 1) row.push(parseInt(hex[(y * 4 + x) % 64]!, 16) % 2 === 1);
    rows.push([...row, ...row.slice(0, 3).reverse()]);
  }
  return rows;
}
