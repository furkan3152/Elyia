/**
 * Ely v2's pixel drawings (pure painting, ported from the approved v2
 * mockup engine, elyia-design/v2/src/app.js): the avatar in its states, the
 * reading spinner, the route elevation strip, the live mini range, big Ely
 * on the rock, Ely walking the composer, the automation vignettes and the
 * PnL waterfall. Every function paints on a `fillRect` surface with a
 * resolved palette, so they run on the shared ticker and in tests alike.
 */
import { drawGrid, type PixelSurface } from "../../pixel/draw";
import { elySprite, mini, type ElyTraits, type PixelGrid } from "../../pixel/ely";
import { shade } from "../../pixel/topo";

export interface Pal {
  readonly ink: string;
  readonly ink2: string;
  readonly ink3: string;
  readonly accent: string;
  readonly onAccent: string;
  readonly rule: string;
  readonly ruleStrong: string;
  readonly card: string;
  readonly paper: string;
  readonly paper2: string;
  readonly up: string;
  readonly down: string;
  readonly night: boolean;
}

const DAY: Pal = { ink: "#16201B", ink2: "#4A554F", ink3: "#5C6760", accent: "#17788C", onAccent: "#FFFFFF", rule: "#C9BFA6", ruleStrong: "#A89C80", card: "#FFF9EC", paper: "#F2ECDD", paper2: "#E9E1CD", up: "#1F7A4C", down: "#C62D1F", night: false };

/** The sheet's colours, read from the CSS tokens around `element` (channel triplets like "22 32 27"). */
export function paletteOf(element: Element | null): Pal {
  if (!element || typeof getComputedStyle === "undefined") return DAY;
  const styles = getComputedStyle(element);
  const tok = (name: string, fallback: string) => {
    const raw = styles.getPropertyValue(name).trim();
    return raw ? `rgb(${raw.split(/\s+/u).join(",")})` : fallback;
  };
  const night = document.documentElement.dataset.theme === "night" || document.documentElement.dataset.theme === "dark";
  return {
    ink: tok("--ink", DAY.ink),
    ink2: tok("--ink-2", DAY.ink2),
    ink3: tok("--ink-3", DAY.ink3),
    accent: tok("--accent", DAY.accent),
    onAccent: tok("--on-accent", DAY.onAccent),
    rule: tok("--rule", DAY.rule),
    ruleStrong: tok("--rule-strong", DAY.ruleStrong),
    card: tok("--card", DAY.card),
    paper: tok("--paper", DAY.paper),
    paper2: tok("--paper-2", DAY.paper2),
    up: tok("--up", DAY.up),
    down: tok("--down", DAY.down),
    night,
  };
}

export const SUN = "#F2C200";
export const ROPE = "#C62D1F";

/* ------------------------------------------------------------ avatar */

export type AvatarState = "idle" | "talk" | "climb" | "summit" | "worry";

const AV: Readonly<Record<string, ElyTraits>> = {
  idle: { gear: "lamp" },
  blink: { gear: "lamp", eye: "blink" },
  talk: { gear: "lamp" },
  talkO: { gear: "lamp", mouth: "o" },
  climb: { gear: "rope", eye: "happy" },
  summit: { gear: "crown", eye: "happy", mouth: "grin" },
  worry: { gear: "rope", eye: "worried", mouth: "o" },
};

const minis = new Map<string, PixelGrid>();
export function elyMini(traits: ElyTraits): PixelGrid {
  const key = JSON.stringify(traits);
  let grid = minis.get(key);
  if (!grid) {
    grid = mini(elySprite(traits));
    minis.set(key, grid);
  }
  return grid;
}

/** Ely's chat avatar (20 x 22): idle bobs at 1.2 Hz and blinks, talk moves the mouth at 2.5 Hz, climb hangs on a scrolling rope, summit waves the flag at 1 Hz, worry sweats. */
export function drawAvatar(ctx: PixelSurface & { clearRect(x: number, y: number, w: number, h: number): void }, state: AvatarState, T: number, pal: Pal, W = 20, H = 22): void {
  ctx.clearRect(0, 0, W, H);
  const ox = Math.floor((W - 16) / 2);
  let oy = H - 18;
  let sprite = AV.idle!;
  if (state === "idle") {
    oy -= Math.floor(T * 1.2) % 2;
    sprite = Math.floor(T * 10) % 34 === 0 ? AV.blink! : AV.idle!;
  } else if (state === "talk") {
    sprite = Math.floor(T * 5) % 2 ? AV.talkO! : AV.talk!;
  } else if (state === "climb") {
    for (let y = 0; y < H; y += 2) {
      ctx.fillStyle = (y / 2 + Math.floor(T * 5)) % 2 ? SUN : ROPE;
      ctx.fillRect(ox + 7, y, 2, 2);
    }
    oy = H - 19 + (Math.floor(T * 3) % 2);
    sprite = AV.climb!;
  } else if (state === "summit") {
    sprite = AV.summit!;
    ctx.fillStyle = pal.ink2;
    ctx.fillRect(W - 3, 0, 1, 8);
    ctx.fillStyle = ROPE;
    const wave = Math.floor(T * 2) % 2;
    ctx.fillRect(W - 2, 1, 2 - wave, 2);
    ctx.fillRect(W - 2, 3, 1 + wave, 1);
  } else if (state === "worry") {
    sprite = AV.worry!;
    ctx.fillStyle = "#6FD3E3";
    const drop = Math.floor(T * 3) % 4;
    ctx.fillRect(ox + 14, 4 + drop, 1, 2);
  }
  drawGrid(ctx, elyMini(sprite), ox, oy, 1);
}

/** The 8-dot reading spinner (9 x 9); one dot lit, stepping 8 times a second around the ring. */
export function drawSpinner(ctx: PixelSurface & { clearRect(x: number, y: number, w: number, h: number): void }, T: number, pal: Pal): void {
  ctx.clearRect(0, 0, 9, 9);
  const ring = [
    [4, 0],
    [7, 1],
    [8, 4],
    [7, 7],
    [4, 8],
    [1, 7],
    [0, 4],
    [1, 1],
  ] as const;
  const lit = Math.floor(T * 8) % 8;
  ring.forEach(([x, y], index) => {
    ctx.fillStyle = index === lit ? pal.accent : pal.rule;
    ctx.fillRect(x, y, 1, 1);
  });
}

/* --------------------------------------------------------- route strip */

export type StripLayer = "floor" | "ridge" | "summit";
export type StripState = "settled" | "climbing" | "next" | "waiting" | "failed";

export const ZONES: Readonly<Record<StripLayer, readonly string[]>> = {
  floor: ["#5FB0B8", "#2D8796", "#1E6B7D", "#0F4C5C"],
  ridge: ["#E2BD86", "#C08D55", "#8A5A2B", "#6B4423"],
  summit: ["#FFFFFF", "#C3EAF0", "#85CCD8", "#4FA7BA"],
};

const smooth = (a: number, b: number, u: number) => {
  const k = Math.max(0, Math.min(1, (u - a) / (b - a)));
  return k * k * (3 - 2 * k);
};

const ALT: Readonly<Record<StripLayer, number>> = { floor: 0.18, ridge: 0.42, summit: 0.72 };

/** Camp positions along the strip for `steps` legs: start camp + one per leg (fractions of the width). */
export function stripCamps(steps: number): number[] {
  const n = Math.max(1, steps);
  return Array.from({ length: n + 1 }, (_, index) => 0.03 + (0.89 * index) / n);
}

/** Height (0..1) of the land at `u`: each leg climbs (or descends) to its layer's altitude. */
export function stripProfile(u: number, layers: readonly StripLayer[]): number {
  const camps = stripCamps(layers.length);
  let height = Math.max(0.1, ALT[layers[0] ?? "floor"] - 0.3);
  for (let index = 0; index < layers.length; index += 1) {
    const from = index === 0 ? height : ALT[layers[index - 1]!];
    const to = ALT[layers[index]!];
    const a = camps[index]!;
    const b = camps[index + 1]!;
    if (u >= a) height = from + (to - from) * smooth(a + (b - a) * 0.2, a + (b - a) * 0.75, u);
  }
  return height + 0.025 * Math.sin(u * 41) + 0.015 * Math.sin(u * 97);
}

/** Which layer the land at `u` belongs to (the leg it lies on). */
export function stripZone(u: number, layers: readonly StripLayer[]): StripLayer {
  const camps = stripCamps(layers.length);
  for (let index = layers.length - 1; index >= 0; index -= 1) if (u >= camps[index]! + (camps[index + 1]! - camps[index]!) * 0.35) return layers[index]!;
  return layers[0] ?? "floor";
}

export interface StripOptions {
  readonly layers: readonly StripLayer[];
  readonly states: readonly StripState[];
  /** Draw Ely at the head of the path (big and mini strips); else a small pin. */
  readonly ely: boolean;
  /** 0..1 progress of the climbing leg (animated by the caller). */
  readonly climb?: number;
}

function flag(ctx: PixelSurface, x: number, y: number, state: "done" | "next" | "todo", T: number, pal: Pal) {
  ctx.fillStyle = pal.ink2;
  ctx.fillRect(x, y - 7, 1, 7);
  ctx.fillStyle = state === "done" ? ROPE : state === "next" ? SUN : pal.ruleStrong;
  const wave = state === "done" ? Math.floor(T * 2) % 2 : 0;
  ctx.fillRect(x + 1, y - 7, 4 - wave, 2);
  ctx.fillRect(x + 1, y - 5, 3 + wave, 1);
}

/** The route elevation strip: layer-zoned land, camps, the dotted path ahead, the accent path walked, flags (done red and waving, next sun, todo rule) and Ely at the head. */
export function drawRouteStrip(ctx: PixelSurface & { clearRect(x: number, y: number, w: number, h: number): void }, W: number, H: number, T: number, options: StripOptions, pal: Pal): void {
  ctx.clearRect(0, 0, W, H);
  const layers = options.layers.length > 0 ? options.layers : (["summit"] as const);
  const tops: number[] = [];
  const band = Math.max(3, Math.round(H / 7));
  for (let i = 0; i < W; i += 1) {
    const u = i / Math.max(1, W - 1);
    const top = Math.round(H - 2 - Math.min(0.95, stripProfile(u, layers)) * (H - 4));
    tops.push(top);
    const zone = ZONES[stripZone(u, layers)];
    for (let y = top; y < H; y += 1) {
      const k = Math.min(zone.length - 1, Math.floor((y - top) / band));
      ctx.fillStyle = (y - top) % band === 0 && y > top ? shade(zone[k]!, -0.2) : zone[k]!;
      ctx.fillRect(i, y, 1, 1);
    }
    ctx.fillStyle = shade(zone[0]!, -0.38);
    ctx.fillRect(i, top, 1, 1);
  }
  const camps = stripCamps(layers.length).map((u) => Math.round(u * (W - 1)));
  const progress = layers.map((_, index) => {
    const state = options.states[index] ?? "waiting";
    if (state === "settled") return 1;
    if (state === "climbing") return Math.max(0.15, Math.min(0.92, options.climb ?? 0.5));
    return 0;
  });
  let head = camps[0]!;
  let moving = false;
  for (let s = 0; s < camps.length - 1; s += 1) {
    const a = camps[s]!;
    const b = camps[s + 1]!;
    const p = progress[s]!;
    const end = a + (b - a) * p;
    for (let i = a; i <= b; i += 1) {
      const y = (tops[i] ?? H) - 2;
      if (p > 0 && i <= end) {
        if (i % 2 === 0) {
          ctx.fillStyle = pal.accent;
          ctx.fillRect(i, y, 1, 1);
        }
      } else if (i % 3 === 0) {
        ctx.fillStyle = pal.ruleStrong;
        ctx.fillRect(i, y, 1, 1);
      }
    }
    if (p > 0) {
      head = Math.round(end);
      moving = p < 1;
    }
  }
  for (let s = 1; s < camps.length; s += 1) {
    const x = camps[s]!;
    const state = options.states[s - 1] ?? "waiting";
    const prevDone = s === 1 || options.states[s - 2] === "settled";
    flag(ctx, x, (tops[x] ?? H) - 2, state === "settled" ? "done" : state === "failed" ? "todo" : prevDone ? "next" : "todo", T, pal);
  }
  // the start cairn
  const c0 = camps[0]!;
  const y0 = (tops[c0] ?? H) - 2;
  ctx.fillStyle = pal.ink2;
  ctx.fillRect(c0 - 2, y0 - 2, 5, 1);
  ctx.fillRect(c0 - 1, y0 - 3, 3, 1);
  ctx.fillRect(c0, y0 - 4, 1, 1);
  if (options.ely) {
    const allDone = progress.every((p) => p >= 1);
    const failed = options.states.some((state) => state === "failed");
    const traits = failed ? AV.worry! : allDone ? AV.summit! : moving ? AV.climb! : AV.idle!;
    const bob = moving ? Math.floor(T * 6) % 2 : 0;
    const ex = Math.max(0, Math.min(W - 16, head - 8));
    const ey = Math.max(0, (tops[Math.max(0, Math.min(W - 1, head))] ?? H) - 19 - bob);
    drawGrid(ctx, elyMini(traits), ex, ey, 1);
  } else {
    ctx.fillStyle = pal.ink;
    ctx.fillRect(head - 1, (tops[head] ?? H) - 5, 2, 3);
    ctx.fillStyle = SUN;
    ctx.fillRect(head - 1, (tops[head] ?? H) - 6, 2, 1);
  }
}

/* ----------------------------------------------------------- mini range */

/** Block cadence per layer (s): HyperCore ~0.5, HyperEVM ~1, Elysium ~0.114 (the beacon blinks once per 8 blocks). */
export const BEACON_PERIOD: Readonly<Record<StripLayer, number>> = { floor: 0.5, ridge: 1, summit: 0.114 * 8 };

/** Floor, Ridge and Summit as one rising landscape: drifting clouds, a beacon per layer, a scrolling block barograph. */
export function drawMiniRange(ctx: PixelSurface & { clearRect(x: number, y: number, w: number, h: number): void }, W: number, H: number, T: number, pal: Pal, ticks?: Readonly<Record<StripLayer, number>>): void {
  ctx.clearRect(0, 0, W, H);
  const noise = (u: number) => Math.sin(u * 31) * 0.5 + Math.sin(u * 13 + 1) * 0.5;
  const top = (i: number) => {
    const u = i / W;
    const e = 0.1 + 0.22 * smooth(0.26, 0.4, u) + 0.26 * smooth(0.6, 0.74, u) + (0.12 + 0.2 * u) * Math.pow(Math.abs(Math.sin(u * Math.PI * 6 + 0.4)), 1.6) + 0.025 * noise(u);
    return Math.round(H - 4 - Math.min(0.97, e) * (H - 5));
  };
  const zone = (u: number): StripLayer => (u < 0.34 ? "floor" : u < 0.67 ? "ridge" : "summit");
  for (let c = 0; c < 3; c += 1) {
    const cx = ((c * 71 + T * (2 + c)) % (W + 30)) - 30;
    const cy = 3 + c * 2;
    ctx.fillStyle = pal.night ? "#26372D" : "#FFFFFF";
    for (let k = 0; k < 14; k += 1) {
      const h = 1 + Math.round(Math.sin((k / 14) * Math.PI) * 2);
      ctx.fillRect(Math.round(cx + k), cy - h + 2, 1, h);
    }
  }
  for (let i = 0; i < W; i += 1) {
    const tp = top(i);
    const z = ZONES[zone(i / W)];
    for (let y = tp; y < H - 3; y += 1) {
      const k = Math.min(3, Math.floor((y - tp) / 3));
      ctx.fillStyle = (y - tp) % 3 === 0 && y > tp ? shade(z[k]!, -0.2) : z[k]!;
      ctx.fillRect(i, y, 1, 1);
    }
    ctx.fillStyle = shade(z[0]!, -0.38);
    ctx.fillRect(i, tp, 1, 1);
  }
  ctx.fillStyle = pal.night ? "#0A110D" : "#22302A";
  ctx.fillRect(0, H - 3, W, 3);
  for (let i = 0; i < W; i += 2) {
    const z = zone(i / W);
    const block = ticks ? ticks[z] : Math.floor(T / (z === "floor" ? 0.5 : z === "ridge" ? 1 : 0.9));
    const h = 1 + ((i * 7 + block * 13) % 3 === 0 ? 1 : 0);
    ctx.fillStyle = z === "floor" ? "#5FB0B8" : z === "ridge" ? "#E2BD86" : "#C3EAF0";
    ctx.fillRect(i, H - h, 1, h);
  }
  const beacons: ReadonlyArray<readonly [number, StripLayer]> = [
    [0.17, "floor"],
    [0.5, "ridge"],
    [0.83, "summit"],
  ];
  for (const [u, layer] of beacons) {
    const i = Math.round(u * W);
    const tp = top(i);
    const period = BEACON_PERIOD[layer];
    const on = T % period < period / 2;
    ctx.fillStyle = pal.ink2;
    ctx.fillRect(i, tp - 4, 1, 4);
    ctx.fillStyle = on ? SUN : ROPE;
    ctx.fillRect(i - 1, tp - 6, 3, 2);
  }
}

/* ------------------------------------------------------------- big Ely */

/** Big Ely (48 x 48) on a snow-capped rock before a sun disc (a moon by NIGHT), bobbing at 1.2 Hz and blinking. */
export function drawBigEly(ctx: PixelSurface & { clearRect(x: number, y: number, w: number, h: number): void }, T: number, pal: Pal): void {
  ctx.clearRect(0, 0, 48, 48);
  ctx.fillStyle = pal.night ? "#3A5144" : "#F6DA72";
  for (let y = -15; y <= 15; y += 1) {
    const w = Math.round(Math.sqrt(225 - y * y));
    ctx.fillRect(24 - w, 20 + y, w * 2, 1);
  }
  ctx.fillStyle = pal.night ? "#547060" : "#FFE9A3";
  for (let y = -15; y <= 15; y += 4) {
    const w = Math.round(Math.sqrt(225 - y * y));
    ctx.fillRect(24 - w, 20 + y, w * 2, 1);
  }
  const rock = ["#E2BD86", "#B07A44", "#8A5A2B", "#6B4423"] as const;
  for (let i = 2; i < 46; i += 1) {
    const d = Math.abs(i - 23.5);
    const top = 40 + Math.max(0, Math.round((d - 12) * 0.8)) + (i % 5 === 0 ? 1 : 0);
    for (let y = top; y < 48; y += 1) {
      const k = Math.min(3, Math.floor((y - top) / 2));
      ctx.fillStyle = (y - top) % 2 === 0 && y > top ? shade(rock[k]!, -0.15) : rock[k]!;
      ctx.fillRect(i, y, 1, 1);
    }
    ctx.fillStyle = d < 9 ? "#FFFFFF" : "#C3EAF0";
    ctx.fillRect(i, top, 1, 1);
    if (d < 6) ctx.fillRect(i, top + 1, 1, 1);
  }
  const bob = Math.floor(T * 1.2) % 2;
  const blink = Math.floor(T * 10) % 38 === 0;
  drawGrid(ctx, elySprite({ gear: "lamp", eye: blink ? "blink" : "open" }), 8, 8 + bob, 1);
  const spark = Math.floor(T * 2) % 6;
  ctx.fillStyle = SUN;
  if (spark < 3) {
    ctx.fillRect(5 + spark, 6, 1, 1);
    ctx.fillRect(41 - spark, 9, 1, 1);
  }
}

/** Ely walking along the top edge of the composer while a turn is in flight (`W` x 21). */
export function drawWalker(ctx: PixelSurface & { clearRect(x: number, y: number, w: number, h: number): void }, W: number, T: number, pal: Pal): void {
  ctx.clearRect(0, 0, W, 21);
  const span = Math.max(1, W - 20);
  const period = 7;
  const phase = (T % period) / period;
  const pos = phase < 0.5 ? phase * 2 : 2 - phase * 2;
  const ex = Math.round(4 + pos * span);
  const step = Math.floor(T * 6) % 2;
  ctx.fillStyle = pal.ink;
  ctx.fillRect(ex + 4, 17, 2, 3 - step);
  ctx.fillRect(ex + 10, 17, 2, 2 + step);
  ctx.fillStyle = pal.ruleStrong;
  for (let i = 1; i <= 3; i += 1) {
    const dx = phase < 0.5 ? -i * 3 : 16 + i * 3;
    if ((Math.floor(T * 6) + i) % 3) ctx.fillRect(ex + dx, 19, 1, 1);
  }
  const grid = elyMini({ gear: "lamp", eye: Math.floor(T * 4) % 9 === 0 ? "blink" : "open" });
  drawGrid(ctx, phase < 0.5 ? grid : grid.map((row) => row.slice().reverse()), ex, 1 - step, 1);
}

/* ------------------------------------------------------------- glyphs */

/**
 * 9 x 9 pixel glyphs. Keys: i ink · a accent · s sun · S sun light · o sun
 * shade · d rope red · u up · w card · r ridge · f floor · m muted · k on-accent.
 */
export const GLYPHS = {
  anchor: ["...iii...", "...i.i...", "...iii...", ".iiiiiii.", "....i....", "i...i...i", "ii..i..ii", ".ii.i.ii.", "..iiiii.."],
  coin: ["..ooooo..", ".oSSssso.", "oSssoosso", "oSsosssso", "osssoooso", "osssssoso", "oSsooosso", ".ossssso.", "..ooooo.."],
  rebalance: [".........", ".aa......", ".aa......", ".aa.ff...", ".aa.ff.rr", ".aa.ff.rr", ".aa.ff.rr", ".aa.ff.rr", "iiiiiiiii"],
  bolt: ["....ss...", "...ss....", "..ss.....", ".sssssss.", ".....ss..", "....ss...", "...ss....", "..ss.....", ".s......."],
  shield: ["iiiiiiiii", "iaaaaaaai", "iaaaaaawi", "iaaaaawai", "iawaawaai", ".iawwaai.", ".iaawaai.", "..iaaai..", "...iii..."],
  swap: ["...a.....", "..aa.....", ".aaaaaaa.", "..aa.....", "...a.....", ".....r...", ".....rr..", ".rrrrrrr.", ".....rr.."],
  peak: ["....w....", "...waw...", "...aaa...", "..aaaaa..", "..aaaar..", ".aaaarrr.", ".aaarrrr.", "aaarrrrrr", "fffffffff"],
  search: [".iii.....", "i...i....", "i...i....", "i...i....", ".iii.....", "....ii...", ".....ii..", "......ii.", "........."],
  send: ["....k....", "...kkk...", "..k.k.k..", ".k..k..k.", "....k....", "....k....", "....k....", "....k....", "........."],
  wallet: [".........", "iiiiiiii.", "irrrrrrri", "irrrrriii", "irrrrris.", "irrrrriii", "irrrrrrri", "iiiiiiiii", "........."],
  check: [".........", "........u", ".......uu", "......uu.", "u....uu..", "uu..uu...", ".uuuu....", "..uu.....", "........."],
  flag: ["i........", "iddddd...", "idddddd..", "iddddd...", "i........", "i........", "i........", "i........", "iii......"],
  pulse: [".........", ".........", "....i....", "...i.i...", "iii...i.i", ".......i.", ".........", ".........", "........."],
  gas: [".iiiii...", ".iwwwi.i.", ".iwwwi..i", ".iiiii..i", ".iaaai.ii", ".iaaai.i.", ".iaaaii..", ".iaaai...", "iiiiiii.."],
  stairs: [".......uu", ".......u.", ".....uuu.", ".....u...", "...uuu...", "...u.....", ".uuu.....", ".u.......", "iiiiiiiii"],
  broom: [".......r.", "......r..", ".....r...", "....r....", "..ssr....", ".sssss...", "sssss....", "ssss.....", "s.s.s...."],
  eye: [".........", "..iiiii..", ".i.....i.", "i..aaa..i", "i..aia..i", "i..aaa..i", ".i.....i.", "..iiiii..", "........."],
  chat: [".iiiiiii.", "i.......i", "i.ii.ii.i", "i.......i", "i.iiii..i", "i.......i", ".iiiiiii.", "..ii.....", "..i......"],
  clock: ["..iiiii..", ".i.....i.", "i...i...i", "i...i...i", "i...iii.i", "i.......i", ".i.....i.", "..iiiii..", "........."],
} as const satisfies Record<string, readonly string[]>;

export type GlyphName = keyof typeof GLYPHS;

/** Glyph key -> colour for PixelGlyph (token names follow the sheet). */
export const GLYPH_COLORS: Readonly<Record<string, string>> = { i: "--ink", a: "--accent", s: SUN, S: "#FFE27A", o: "#B89100", d: "--down", u: "--up", w: "--card", r: "#B07A44", f: "#1E6B7D", m: "--ink-3", k: "--on-accent" };
