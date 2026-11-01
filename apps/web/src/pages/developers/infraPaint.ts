/** The infra drawing (pure paint), ported from the v2 mockup's `infra`. */
import { shade } from "../../pixel/topo";
import { AVATAR, drawMini, SUN, SUN_SHADE, ZONES, tokenReader } from "./portal/canvasKit";

export const INFRA_W = 239;
export const INFRA_H = 60;
const W = INFRA_W;
const H = INFRA_H;
const LANES = [12, 30, 48] as const;
const BANDS = ["summit", "ridge", "floor"] as const;

type Paint = (x: number, y: number) => void;

/** Orthogonal pixel pipe through the given corner points. */
function pipe(paint: Paint, points: ReadonlyArray<readonly [number, number]>) {
  for (let i = 0; i < points.length - 1; i += 1) {
    const [a, b] = points[i]!;
    const [c, d] = points[i + 1]!;
    let x = a;
    let y = b;
    while (x !== c || y !== d) {
      paint(x, y);
      if (x !== c) x += Math.sign(c - x);
      else y += Math.sign(d - y);
    }
    paint(c, d);
  }
}

/** Paints one frame of the infra drawing (ported from the v2 mockup's `infra`). */
export function paintInfra(ctx: CanvasRenderingContext2D, seconds: number, still: boolean) {
  const token = tokenReader(ctx.canvas);
  const T = still ? 1.35 : seconds;
  ctx.clearRect(0, 0, W, H);
  // your app: a window with traffic lights, an input and a button
  ctx.fillStyle = token("--rule-strong");
  ctx.fillRect(8, 14, 46, 32);
  ctx.fillStyle = token("--card");
  ctx.fillRect(9, 18, 44, 27);
  ctx.fillStyle = "#C62D1F";
  ctx.fillRect(10, 15, 2, 2);
  ctx.fillStyle = SUN;
  ctx.fillRect(13, 15, 2, 2);
  ctx.fillStyle = token("--up");
  ctx.fillRect(16, 15, 2, 2);
  ctx.fillStyle = token("--paper-2");
  ctx.fillRect(12, 24, 38, 5);
  ctx.fillStyle = token("--accent");
  ctx.fillRect(42, 24, 8, 5);
  ctx.fillStyle = token("--rule");
  for (let i = 0; i < 3; i += 1) ctx.fillRect(12, 33 + i * 3, 24 - i * 6, 1);
  // pipes
  const rule = token("--rule-strong");
  const paintWith = (colour: string): Paint => (x, y) => {
    ctx.fillStyle = colour;
    ctx.fillRect(x, y, 1, 1);
  };
  pipe(paintWith(rule), [
    [54, 30],
    [104, 30],
  ]);
  for (const lane of LANES)
    pipe(paintWith(rule), [
      [136, 30],
      [148, 30],
      [148, lane],
      [168, lane],
    ]);
  pipe(paintWith(SUN_SHADE), [
    [168, 54],
    [31, 54],
    [31, 46],
  ]);
  // Ely's station: a plank bench, Ely talking on it
  ctx.fillStyle = "#8A5A2B";
  ctx.fillRect(104, 38, 32, 4);
  ctx.fillStyle = "#E2BD86";
  ctx.fillRect(104, 38, 32, 1);
  ctx.fillStyle = "#6B4423";
  ctx.fillRect(108, 42, 4, 6);
  ctx.fillRect(128, 42, 4, 6);
  drawMini(ctx, !still && Math.floor(T * 4) % 2 ? AVATAR.talkOpen : AVATAR.talk, 112, 21);
  // three layer bands
  LANES.forEach((lane, index) => {
    const zone = ZONES[BANDS[index]!];
    const y0 = lane - 8;
    for (let k = 0; k < 64; k += 1) {
      const u = k / 63;
      const top = y0 + 2 + Math.round((1 - Math.abs(Math.sin(u * Math.PI * (2 + index)))) * 7) + (index === 0 && Math.abs(u - 0.6) < 0.1 ? -2 : 0);
      for (let y = top; y < y0 + 16; y += 1) {
        ctx.fillStyle = zone[Math.min(3, Math.floor((y - top) / 3))]!;
        ctx.fillRect(170 + k, y, 1, 1);
      }
      ctx.fillStyle = shade(zone[0], -0.38);
      ctx.fillRect(170 + k, top, 1, 1);
    }
  });
  // packets: requests (accent) out, receipts (sun) back as webhooks
  const packet = (x: number, y: number, colour: string) => {
    ctx.fillStyle = colour;
    ctx.fillRect(Math.round(x) - 1, Math.round(y) - 1, 2, 2);
  };
  const accent = token("--accent");
  for (let j = 0; j < 3; j += 1) packet(54 + ((T * 0.5 + j / 3) % 1) * 50, 30, accent);
  LANES.forEach((lane, index) => {
    const p = (T * 0.45 + index * 0.27) % 1;
    const l1 = 12;
    const l2 = Math.abs(lane - 30);
    const l3 = 20;
    const d = p * (l1 + l2 + l3);
    if (d < l1) packet(136 + d, 30, accent);
    else if (d < l1 + l2) packet(148, 30 + Math.sign(lane - 30) * (d - l1), accent);
    else packet(148 + (d - l1 - l2), lane, accent);
  });
  for (let j = 0; j < 2; j += 1) {
    const p = (T * 0.3 + j / 2) % 1;
    const d = p * (137 + 8);
    if (d < 137) packet(168 - d, 54, SUN);
    else packet(31, 54 - (d - 137), SUN);
  }
}

