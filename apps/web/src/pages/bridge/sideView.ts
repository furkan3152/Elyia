/**
 * The bridge side view (pure): the range cut open as pixel art. Three
 * terraces stand for the three layers (Floor = HyperCore, Ridge =
 * HyperEVM, Summit = Elysium); under the skyline the rock is drawn in
 * altitude bands, icy at the Summit, ochre at the Ridge, glacial teal on the
 * Floor. Every bridge lane is a real path between the camps: the cable car
 * up to the Summit, the long switchback trail down, the Core link zip lines
 * between the Ridge and the Floor, and the footbridge between spot and perps
 * on the Floor. Ely travels the chosen lane on the shared clock.
 */
import type { Layer } from "../../topo/geometry/relief";
import type { TextSurface } from "../../pixel/scene";
import type { LayerSurface } from "../track/flow/pixelArt";
import { shade } from "../../pixel/topo";
import { CARD, INK, paintCached, paintCloud, paintConfetti, paintEly, paintFlag, paintHut, paintLabel, paintSky, ROPE_RED, strataFor, SUN, type MiniMood } from "../track/flow/pixelArt";
import type { LaneId } from "./lanes";

export interface Pt {
  readonly x: number;
  readonly y: number;
}

export interface SideGeometry {
  readonly w: number;
  readonly h: number;
  /** Ground line of each terrace. */
  readonly ground: Readonly<Record<Layer, number>>;
  /** Skyline y for every column. */
  readonly skyline: readonly number[];
  readonly camps: Readonly<Record<"spot" | "perps" | "ridge" | "summit", Pt>>;
  /** Cable car pylon tops (ridge, summit). */
  readonly cable: readonly [Pt, Pt];
  /** Sampled foot positions of each lane, start to end. */
  readonly lanes: Readonly<Record<LaneId, readonly Pt[]>>;
}

const smooth = (t: number) => {
  const u = Math.min(1, Math.max(0, t));
  return u * u * (3 - 2 * u);
};

/** The skyline: floor plateau, slope, ridge terrace, slope, summit plateau. */
function skylineAt(x: number, w: number, g: Readonly<Record<Layer, number>>): number {
  const f = x / w;
  if (f < 0.36) return g.floor;
  if (f < 0.47) return g.floor + (g.ridge - g.floor) * smooth((f - 0.36) / 0.11);
  if (f < 0.63) return g.ridge;
  if (f < 0.8) return g.ridge + (g.summit - g.ridge) * smooth((f - 0.63) / 0.17);
  return g.summit;
}

function lerp(a: Pt, b: Pt, t: number): Pt {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/** A quadratic through a sagging control point, sampled `n` times. */
function sagged(a: Pt, b: Pt, sag: number, n = 40): Pt[] {
  const c = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 + sag };
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n;
    const u = 1 - t;
    return { x: u * u * a.x + 2 * u * t * c.x + t * t * b.x, y: u * u * a.y + 2 * u * t * c.y + t * t * b.y };
  });
}

/** A polyline resampled to `n` evenly spaced points. */
export function resample(points: readonly Pt[], n: number): Pt[] {
  const lengths = [0];
  for (let i = 1; i < points.length; i += 1) lengths.push(lengths[i - 1]! + Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y));
  const total = lengths[lengths.length - 1]! || 1;
  const out: Pt[] = [];
  let j = 1;
  for (let i = 0; i <= n; i += 1) {
    const at = (i / n) * total;
    while (j < lengths.length - 1 && lengths[j]! < at) j += 1;
    const span = lengths[j]! - lengths[j - 1]! || 1;
    out.push(lerp(points[j - 1]!, points[j]!, (at - lengths[j - 1]!) / span));
  }
  return out;
}

/** The geometry of a side view `w` x `h` pixels. */
export function sideGeometry(w: number, h: number): SideGeometry {
  const ground = { floor: Math.round(h * 0.74), ridge: Math.round(h * 0.5), summit: Math.round(h * 0.24) };
  const skyline = Array.from({ length: w }, (_, x) => Math.round(skylineAt(x, w, ground)));
  const at = (f: number): Pt => {
    const x = Math.round(w * f);
    return { x, y: skyline[Math.min(w - 1, x)]! };
  };
  const camps = { spot: at(0.1), perps: at(0.27), ridge: at(0.53), summit: at(0.9) };
  const pylonA = { x: Math.round(w * 0.585), y: ground.ridge - 21 };
  const pylonB = { x: Math.round(w * 0.845), y: ground.summit - 21 };

  // the long trail: switchbacks hugging the upper slope, from the summit hut to the ridge hut
  const trail: Pt[] = [{ x: camps.summit.x - 8, y: ground.summit }];
  const legs = 6;
  for (let i = 0; i <= legs; i += 1) {
    const f = 0.8 - (i / legs) * 0.17;
    const x = w * f + (i % 2 === 0 ? 2 : -6);
    trail.push({ x, y: skylineAt(Math.max(0, Math.min(w - 1, x)), w, ground) - (i % 2 === 0 ? 1 : 3) });
  }
  trail.push({ x: camps.ridge.x + 8, y: ground.ridge });

  // the Core link: two zip lines between the ridge hut and the floor station, down and up
  const linkTop = { x: camps.ridge.x - 8, y: ground.ridge - 9 };
  const linkFoot = { x: camps.perps.x + 9, y: ground.floor - 9 };
  const down = sagged(linkTop, linkFoot, 4).map((p) => ({ x: p.x, y: p.y + 13 }));
  const up = sagged({ x: linkFoot.x + 2, y: linkFoot.y - 4 }, { x: linkTop.x + 2, y: linkTop.y - 4 }, 4).map((p) => ({ x: p.x, y: p.y + 13 }));

  // the footbridge between spot and perps: an arch
  const span = (from: Pt, to: Pt, lift: number) => Array.from({ length: 21 }, (_, i) => {
    const t = i / 20;
    return { x: from.x + (to.x - from.x) * t, y: from.y - Math.sin(t * Math.PI) * lift };
  });

  const cableFeet = sagged(pylonA, pylonB, 6).map((p) => ({ x: p.x, y: p.y + 16 }));
  const lanes: Record<LaneId, readonly Pt[]> = {
    "up-summit": resample([{ x: camps.ridge.x + 4, y: ground.ridge }, { x: pylonA.x, y: ground.ridge }, ...cableFeet, { x: pylonB.x, y: ground.summit }, { x: camps.summit.x - 8, y: ground.summit }], 80),
    "down-ridge": resample(trail, 80),
    "down-floor": resample(down, 60),
    "up-ridge": resample(up, 60),
    "to-perps": resample(span({ x: camps.spot.x + 5, y: ground.floor }, { x: camps.perps.x - 5, y: ground.floor }, 7), 40),
    "to-spot": resample(span({ x: camps.perps.x - 5, y: ground.floor }, { x: camps.spot.x + 5, y: ground.floor }, 7), 40),
  };
  return { w, h, ground, skyline, camps, cable: [pylonA, pylonB], lanes };
}

export interface LaneMotion {
  /** Where Ely's feet are. */
  readonly at: Pt;
  /** 0..1 along the lane. */
  readonly t: number;
  readonly arrived: boolean;
  readonly facingLeft: boolean;
}

/** Seconds per trip (travel 70%, then a stand at the camp). */
export const TRIP_SECONDS = 7;

/** Ely on a lane at `seconds` (still: standing at the destination). */
export function laneMotion(points: readonly Pt[], seconds: number, still: boolean): LaneMotion {
  const p = still ? 1 : (((seconds % TRIP_SECONDS) + TRIP_SECONDS) % TRIP_SECONDS) / TRIP_SECONDS;
  const t = Math.min(1, p / 0.7);
  const index = Math.min(points.length - 1, Math.floor(t * (points.length - 1)));
  const here = points[index]!;
  const ahead = points[Math.min(points.length - 1, index + 1)]!;
  const first = points[0]!;
  const last = points[points.length - 1]!;
  return { at: here, t, arrived: t >= 1, facingLeft: (ahead.x === here.x ? last.x - first.x : ahead.x - here.x) < 0 };
}

const MOOD: Readonly<Record<LaneId, MiniMood>> = { "up-summit": "walk", "down-ridge": "walk", "down-floor": "climb", "up-ridge": "climb", "to-perps": "walk", "to-spot": "walk" };

export interface SideFrame {
  readonly seconds: number;
  readonly still: boolean;
  readonly night: boolean;
  readonly selected: LaneId;
  /** Short lane tag for the chosen lane ("CABLE CAR · 2 MIN"). */
  readonly tag: string;
  readonly compact: boolean;
}

function dot(ctx: TextSurface, p: Pt, color: string) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(p.x), Math.round(p.y), 1, 1);
}

/** The rock of the cross-section: each layer a zone with its own altitude bands, counted from the zone's top. */
function paintRock(ctx: TextSurface, geo: SideGeometry, strata: Readonly<Record<"floor" | "ridge" | "summit" | "gold", readonly string[]>>, summitZone: number, ridgeZone: number): void {
  const { w, h, ground, skyline } = geo;
  const zones = [
    { from: 0, to: summitZone, colors: strata.summit },
    { from: summitZone, to: ridgeZone, colors: strata.ridge },
    { from: ridgeZone, to: h, colors: strata.floor },
  ];
  for (let x = 0; x < w; x += 1) {
    const top = skyline[x]!;
    for (const zone of zones) {
      const start = Math.max(top, zone.from);
      if (start >= zone.to) continue;
      const band = Math.max(3, Math.round((zone.to - Math.max(zone.from, ground.summit)) / 5));
      for (let y = start; y < zone.to; y += 1) {
        const k = Math.min(zone.colors.length - 1, Math.floor((y - start) / band));
        const edge = (y - start) % band === 0 && y > start;
        ctx.fillStyle = edge ? shade(zone.colors[k]!, -0.2) : zone.colors[k]!;
        ctx.fillRect(x, y, 1, 1);
      }
      // the seam under the zone: a dashed ink line through the rock
      if (zone.to < h && zone.to > top && x % 4 !== 3) dot(ctx, { x, y: zone.to - 1 }, INK);
    }
    ctx.fillStyle = INK;
    ctx.fillRect(x, top, 1, 1);
  }
}

/** Paints one frame of the side view. */
export function paintSideView(ctx: LayerSurface, geo: SideGeometry, frame: SideFrame): void {
  const { w, h, ground, camps, cable, lanes } = geo;
  const { seconds: T, still, night, selected } = frame;
  const strata = strataFor(night);
  paintSky(ctx, w, h, night, { x: Math.round(w * 0.3), y: Math.round(h * 0.2) }, T, still);
  for (let i = 0; i < 4; i += 1) {
    const cw = 16 + (i % 3) * 6;
    const x = still ? (i * 97) % w : ((i * 97 + T * (3 + i)) % (w + 40)) - 40;
    paintCloud(ctx, x, Math.round(h * (0.12 + (i % 2) * 0.1)), cw, night);
  }

  // the rock, cut open (static: painted once per size and sheet, then blitted)
  const summitZone = Math.round((ground.summit + ground.ridge) / 2) + 2;
  const ridgeZone = Math.round((ground.ridge + ground.floor) / 2) + 2;
  paintCached(ctx, `side|${w}|${h}|${night}`, w, h, (layer) => paintRock(layer, geo, strata, summitZone, ridgeZone));

  ctx.font = "8px Silkscreen";
  ctx.textBaseline = "top";

  // lanes not chosen: faint dotted lines; the chosen one in sun with ink pixels
  const faint = night ? "#7FA2B2" : "#4A554F";
  const paintLane = (id: LaneId) => {
    const points = lanes[id];
    const chosen = id === selected;
    points.forEach((p, i) => {
      if (chosen) {
        dot(ctx, { x: p.x, y: p.y - 1 }, i % 2 === 0 ? SUN : INK);
      } else if (i % 3 === 0) dot(ctx, { x: p.x, y: p.y - 1 }, faint);
    });
  };
  // cable car: pylons and the cable itself (ink), always drawn
  const wireInk = night ? "#B9CFD8" : INK;
  for (const top of cable) {
    const base = top === cable[0] ? ground.ridge : ground.summit;
    ctx.fillStyle = wireInk;
    ctx.fillRect(top.x, top.y, 1, base - top.y);
    ctx.fillRect(top.x - 2, top.y, 5, 1);
  }
  const wire = lanes["up-summit"];
  for (let i = 0; i < wire.length; i += 1) {
    const p = wire[i]!;
    if (p.x > cable[0].x && p.x < cable[1].x) dot(ctx, { x: p.x, y: p.y - 16 }, wireInk);
  }
  // Core link lines and the footbridge
  for (const id of ["down-ridge", "down-floor", "up-ridge", "to-perps", "to-spot"] as const) if (id !== selected) paintLane(id);
  paintLane(selected);

  // camps
  paintHut(ctx, camps.ridge.x, ground.ridge, selected === "up-summit" || selected === "down-ridge" || selected === "down-floor" || selected === "up-ridge" || night);
  paintHut(ctx, camps.summit.x, ground.summit, selected === "up-summit" || selected === "down-ridge" || night, true);
  for (const [post, word] of [
    [camps.spot, "S"],
    [camps.perps, "P"],
  ] as const) {
    ctx.fillStyle = INK;
    ctx.fillRect(post.x, ground.floor - 9, 1, 9);
    ctx.fillRect(post.x - 4, ground.floor - 14, 9, 6);
    ctx.fillStyle = selected === "to-perps" || selected === "to-spot" ? SUN : "#FFF9EC";
    ctx.fillRect(post.x - 3, ground.floor - 13, 7, 4);
    ctx.fillStyle = INK;
    ctx.fillText(word, post.x - 1, ground.floor - 14);
  }

  // the layer names, set into the rock at the right edge like a geological section key
  // two short lines (layer, network) keep the plates narrow, clear of the cable car's path
  const names: ReadonlyArray<readonly string[]> = frame.compact ? [["SUMMIT"], ["RIDGE"], ["FLOOR"]] : [["SUMMIT", "ELYSIUM"], ["RIDGE", "HYPEREVM"], ["FLOOR", "HYPERCORE"]];
  const centres = [Math.round((ground.summit + summitZone) / 2), Math.round((summitZone + ridgeZone) / 2), Math.round((ridgeZone + h) / 2)];
  names.forEach((lines, index) => {
    const width = Math.max(...lines.map((line) => Math.ceil(ctx.measureText(line).width)));
    const left = w - width - 7;
    const top = centres[index]! - Math.round((lines.length * 9) / 2);
    ctx.fillStyle = INK;
    ctx.fillRect(left - 3, top - 1, width + 6, lines.length * 9 + 2);
    ctx.fillStyle = CARD;
    lines.forEach((line, row) => {
      const lw = Math.ceil(ctx.measureText(line).width);
      ctx.fillText(line, left + width - lw, top + row * 9);
    });
  });

  // Ely on the chosen lane
  const motion = laneMotion(lanes[selected], T, still);
  const ex = Math.round(motion.at.x);
  const ey = Math.round(motion.at.y);
  if (selected === "up-summit" && !motion.arrived && motion.at.x > cable[0].x && motion.at.x < cable[1].x) {
    // the gondola: a cabin hangs from the cable, Ely looking out of the window
    const cx = ex;
    const cy = ey - 16;
    ctx.fillStyle = INK;
    ctx.fillRect(cx, cy, 1, 4);
    ctx.fillRect(cx - 9, cy + 4, 19, 1);
    ctx.fillRect(cx - 9, cy + 4, 1, 15);
    ctx.fillRect(cx + 9, cy + 4, 1, 15);
    ctx.fillStyle = night ? "#3D5E70" : "#C3EAF0";
    ctx.fillRect(cx - 8, cy + 5, 17, 8);
    paintEly(ctx, "climb", cx, cy + 22, { seconds: T, still });
    ctx.fillStyle = ROPE_RED;
    ctx.fillRect(cx - 8, cy + 13, 17, 6);
    ctx.fillStyle = INK;
    ctx.fillRect(cx - 9, cy + 13, 19, 1);
    ctx.fillRect(cx - 9, cy + 19, 19, 1);
    ctx.fillStyle = SUN;
    ctx.fillRect(cx - 6, cy + 15, 3, 2);
  } else {
    const mood: MiniMood = motion.arrived ? "summit" : night && MOOD[selected] === "walk" ? "night" : MOOD[selected];
    if ((selected === "down-floor" || selected === "up-ridge") && !motion.arrived) {
      // hanging from the zip line by a short rope
      ctx.fillStyle = INK;
      ctx.fillRect(ex, ey - 22, 1, 4);
      paintEly(ctx, mood, ex, ey + 0, { seconds: T, still, facingLeft: motion.facingLeft });
    } else {
      paintEly(ctx, mood, ex, ey, { seconds: T, still, walking: !motion.arrived, facingLeft: motion.facingLeft });
    }
    if (motion.arrived) paintConfetti(ctx, ex, ey - 6, T, still, 24);
  }
  // the summit flag waves only while Ely stands under it
  paintFlag(ctx, camps.summit.x + 8, ground.summit, T, still || !(selected === "up-summit" && motion.arrived));

  // the chosen lane's tag, on a sun plate near its middle
  const mid = lanes[selected][Math.floor(lanes[selected].length / 2)]!;
  const labelY = Math.max(3, Math.round(mid.y - (selected === "up-summit" ? 36 : selected === "to-perps" || selected === "to-spot" ? 30 : 28)));
  const labelX = Math.round(mid.x);
  const width = Math.ceil(ctx.measureText(frame.tag).width);
  const left = Math.max(2, Math.min(w - width - 6, labelX - Math.round(width / 2) - 2));
  ctx.fillStyle = INK;
  ctx.fillRect(left - 1, labelY - 1, width + 6, 12);
  paintLabel(ctx, frame.tag, left + 2, labelY + 1, INK, "left", SUN);
}
