/** The kit locker's pixel items and the motion sample (pure drawing). */
import { drawGrid } from "../../../pixel/draw";
import { elySprite, INK, LAYERS, mini } from "../../../pixel/ely";
import { bandOf, fieldMax, shade, topoField } from "../../../pixel/topo";

/** 11 x 11 locker items (kit palette keys: k ink, y sun, w card, r rope red, b blue). */
export const ITEM: Readonly<Record<"sun" | "moon" | "motion" | "mast" | "book" | "key" | "keys", readonly string[]>> = {
  sun: ["y....y....y", ".y...y...y.", "..y.....y..", "....kkk....", "...kyyyk...", "yy.kyyyk.yy", "...kyyyk...", "....kkk....", "..y.....y..", ".y...y...y.", "y....y....y"],
  moon: ["...kkkkk...", "..kwwwwk...", ".kwwwk.....", "kwwwk...y..", "kwwwk..yyy.", "kwwwk...y..", "kwwwk......", "kwwwk......", ".kwwwk.....", "..kwwwwk...", "...kkkkk..."],
  motion: ["...........", "........yy.", "........yy.", "......kkkk.", "......k....", "....kkk....", "....k......", "..kkk......", "..k........", "kkk........", "..........."],
  mast: ["...........", ".k.......k.", "k..k...k..k", "k.k..r..k.k", "k.k.kkk.k.k", "k..k.k.k..k", ".k...k...k.", ".....k.....", "....kkk....", "...k.k.k...", "..k..k..k.."],
  book: [".kkkkkkkk..", ".krrrrrrkk.", ".krwwwwrkwk", ".krrrrrrkwk", ".krrrrrrkwk", ".krryyrrkwk", ".krryyrrkwk", ".krrrrrrkwk", ".kkkkkkkkwk", "..kwwwwwwwk", "..kkkkkkkkk"],
  key: ["...........", ".kkkk......", "kyyyyk.....", "kykkyk.....", "kykkykkkkkk", "kyyyyyyyyyk", ".kkkkkkykyk", "......k.k.k", "...........", "...........", "..........."],
  keys: ["...........", "...........", "kkkkkkkkkkk", "kwkwkwkwkwk", "kkkkkkkkkkk", "kwkwkwkwkwk", "kkkkkkkkkkk", "kwkkkkkkkwk", "kkkkkkkkkkk", "...........", "..........."],
};

export const MW = 72;
export const MH = 40;
const FIELD = topoField(MW, MH, 77, [
  [36, 20, 1, 8],
  [18, 29, 0.6, 7],
  [54, 29, 0.6, 7],
]);
const FMAX = fieldMax(FIELD);
const CYCLE = 6;

/**
 * What the Motion switch controls, drawn: the terrain draws in band by band
 * (by altitude, in steps), then Ely climbs to the top and puts the crown on.
 * Motion off: the finished map, Ely already on the summit.
 */
export function paintMotionSample(ctx: CanvasRenderingContext2D, seconds: number, still: boolean, night: boolean) {
  const t = still ? CYCLE : seconds % CYCLE;
  const levels = 5;
  const shown = still ? levels : Math.min(levels, 1 + Math.floor(t * 2.4));
  ctx.fillStyle = night ? "#16211B" : "#FFF9EC";
  ctx.fillRect(0, 0, MW, MH);
  const palette = LAYERS.Summit;
  for (let y = 0; y < MH; y += 1) {
    for (let x = 0; x < MW; x += 1) {
      const band = bandOf(FIELD[y]![x]!, FMAX, levels);
      const right = x + 1 < MW ? bandOf(FIELD[y]![x + 1]!, FMAX, levels) : band;
      const down = y + 1 < MH ? bandOf(FIELD[y + 1]![x]!, FMAX, levels) : band;
      const edge = right !== band || down !== band;
      if (band === 0 || band >= shown) {
        // not surveyed yet: the contour is pencilled in
        if (edge) {
          ctx.fillStyle = night ? "#3A4A41" : "#D8CBB0";
          ctx.fillRect(x, y, 1, 1);
        }
        continue;
      }
      const colour = palette[band]!;
      ctx.fillStyle = edge ? shade(colour, -0.28) : colour;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  const done = shown >= levels;
  if (done) {
    const climb = still ? 1 : Math.max(0, Math.min(1, (t - (levels - 1) / 2.4) / 1.4));
    const top = 20 - 17;
    const y = Math.round(MH - 17 - climb * (MH - 17 - top));
    drawGrid(ctx, mini(elySprite(climb >= 1 ? { gear: "crown", eye: "happy", mouth: "grin" } : { gear: "rope", eye: "happy" })), 28, y, 1);
    if (climb >= 1) {
      ctx.fillStyle = INK;
      ctx.fillRect(46, 2, 1, 10);
      ctx.fillStyle = "#C62D1F";
      const wave = still ? 0 : Math.floor(seconds * 2) % 2;
      for (let row = 0; row < 4; row += 1) ctx.fillRect(47, 2 + row, 5 - (row === 2 ? wave : 0), 1);
    }
  }
}
