/**
 * The big kill switch (pure drawing, 64 x 44): a hazard-striped housing
 * with a red mushroom button on the axis. Armed, the dome stands proud with
 * a highlight; pressed, it sits down in its collar and the two beacons on
 * the housing light in turn, once a second (never faster than 3 Hz).
 */
import type { PixelSurface } from "../../../pixel/draw";
import { INK, ROPE_RED, SUN } from "../../../pixel/ely";

export const KILL_W = 64;
export const KILL_H = 44;

export interface KillFrame {
  readonly on: boolean;
  readonly seconds: number;
  readonly still: boolean;
  /** The pointer is over it (the dome lifts a little). */
  readonly hover?: boolean;
}

function rect(ctx: PixelSurface, x: number, y: number, w: number, h: number, c: string) {
  ctx.fillStyle = c;
  ctx.fillRect(x, y, w, h);
}

/** Paints the switch; symmetric about x = 31.5. */
export function drawKillSwitch(ctx: PixelSurface & { clearRect(x: number, y: number, w: number, h: number): void }, frame: KillFrame): void {
  ctx.clearRect(0, 0, KILL_W, KILL_H);
  // housing: ink outline, hazard stripes, a dark inner plate
  rect(ctx, 2, 14, 60, 30, INK);
  for (let y = 15; y < 43; y += 1) {
    for (let x = 3; x < 61; x += 1) {
      // mirrored diagonal stripes, 3 px wide
      const d = x < 32 ? x : 63 - x;
      ctx.fillStyle = Math.floor((d + y) / 3) % 2 === 0 ? SUN : INK;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  rect(ctx, 8, 19, 48, 21, INK);
  rect(ctx, 9, 20, 46, 19, "#26302B");
  // screws in the corners, mirrored
  for (const [x, y] of [[5, 17], [57, 17], [5, 39], [57, 39]] as const) {
    rect(ctx, x, y, 2, 2, "#8F9A93");
    rect(ctx, x, y, 1, 1, "#E9E1CD");
  }
  // beacons: left and right, lit in turn when pressed
  const phase = frame.still ? 0 : Math.floor(frame.seconds) % 2;
  for (const [x, lit] of [[13, frame.on && phase === 0], [47, frame.on && phase === 1]] as const) {
    rect(ctx, x, 24, 4, 6, INK);
    rect(ctx, x + 1, 25, 2, 4, lit ? "#FF6B5E" : frame.on ? "#6B1A12" : "#3A4640");
    if (lit) {
      rect(ctx, x + 1, 25, 1, 1, "#FFD7D0");
      ctx.fillStyle = "rgba(255,107,94,0.45)";
      ctx.fillRect(x - 1, 23, 6, 1);
      ctx.fillRect(x - 1, 30, 6, 1);
    }
  }
  // collar
  rect(ctx, 20, 31, 24, 6, INK);
  rect(ctx, 21, 32, 22, 4, "#5C6760");
  rect(ctx, 21, 32, 22, 1, "#8F9A93");
  // the mushroom dome: proud when armed, seated when pressed
  const lift = frame.on ? 0 : frame.hover ? 8 : 7;
  const top = 30 - lift - (frame.on ? 2 : 0);
  const rows = frame.on ? 4 : 4 + lift;
  for (let i = 0; i < rows; i += 1) {
    const y = top + i;
    const half = i === 0 ? 7 : i === 1 ? 9 : 11;
    rect(ctx, 32 - half - 1, y, (half + 1) * 2, 1, INK);
    rect(ctx, 32 - half, y, half * 2, 1, frame.on ? "#8E1E14" : ROPE_RED);
  }
  rect(ctx, 32 - 6, top - 1, 12, 1, INK);
  if (!frame.on) {
    // highlight on the dome
    rect(ctx, 25, top + 1, 4, 1, "#FF9A8A");
    rect(ctx, 24, top + 2, 2, 1, "#FF9A8A");
    // stem shadow under the dome
    rect(ctx, 22, top + rows, 20, 1, "#4A1712");
  } else {
    rect(ctx, 27, top + 1, 10, 1, "#B5352A");
  }
  // the label plate on top: OFF AIR when pressed
  rect(ctx, 16, 2, 32, 10, INK);
  rect(ctx, 17, 3, 30, 8, frame.on ? ROPE_RED : "#FFF9EC");
  // a pixel word: "STOP" when armed, "HELD" when pressed, 3x5 letters
  const word = frame.on ? "HELD" : "STOP";
  const glyphs: Readonly<Record<string, readonly string[]>> = {
    S: ["111", "100", "111", "001", "111"],
    T: ["111", "010", "010", "010", "010"],
    O: ["111", "101", "101", "101", "111"],
    P: ["111", "101", "111", "100", "100"],
    H: ["101", "101", "111", "101", "101"],
    E: ["111", "100", "111", "100", "111"],
    L: ["100", "100", "100", "100", "111"],
    D: ["110", "101", "101", "101", "110"],
  };
  ctx.fillStyle = frame.on ? "#FFF9EC" : INK;
  [...word].forEach((letter, index) => {
    const rowsOf = glyphs[letter] ?? [];
    const left = 25 + index * 4;
    rowsOf.forEach((row, y) => {
      [...row].forEach((bit, x) => {
        if (bit === "1") ctx.fillRect(left + x, 4 + y, 1, 1);
      });
    });
  });
}
