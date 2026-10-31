import type { AlertKind } from "./rules";

/** 9 x 9 pixel glyphs for the five kinds (palette keys from the kit: k ink, y sun, o caution, w card, r rope red, b blue). */
export const GLYPHS: Readonly<Record<AlertKind, readonly string[]>> = {
  price: ["......kkk", ".......kk", "......k.k", ".....k...", "k...k....", ".k.k.....", "..k......", ".........", "kkkkkkkkk"],
  funding: ["k........", "kkkkkkkk.", "kooowwwk.", "kooowwwk.", "kkkkkkkk.", "k........", "k........", "k........", "kkk......"],
  rope: [".........", "r...r....", ".r.r.....", "..r...kkk", ".r.ryrkyk", "r...r.kkk", ".........", ".........", "kkkkkkkkk"],
  fill: ["..kkkkk..", "..kyyyk..", "..kkkkk..", "...kkk...", "kkkkkkkkk", "krrrrrrrk", "kkkkkkkkk", ".........", "........."],
  bridge: ["kk.......", "..kk.....", "....kk...", "....k.kk.", "..kkkkk.k", "..kwbwk..", "..kkkkk..", ".........", "........."],
};
