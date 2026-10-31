import { ROPE_RED, SUN } from "../../../pixel/ely";
import { paintProfile, profileColumns } from "../../../pixel/profile";
import { drawElyState } from "../../../pixel/states";
import { contourMask, rngOf, shade, topoField, type Peak } from "../../../pixel/topo";
import { dayLabel, pct, shortAddr, usdShort } from "../range/format";
import type { SummitFacts } from "../range/model";
import { drawPixelText } from "./pixelText";
import type { SheetColors } from "./sheetColors";

/** The certificate is a 256 x 188 pixel card; the PNG is the same pixels at x6 (1536 x 1128), nearest neighbour. */
export const CERT_W = 256;
export const CERT_H = 188;
export const EXPORT_SCALE = 6;
export const TAG = "8px Silkscreen";
export const FIGURE = "700 28px 'Pixelify Sans'";

/** A short stable number for the certificate (FNV-1a of the address). */
export function certificateNumber(address: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < address.length; index += 1) {
    hash ^= address.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36).toUpperCase().padStart(6, "0").slice(0, 6);
}

export interface CertificateContent {
  readonly number: string;
  readonly address: string;
  readonly facts: SummitFacts;
  readonly values: readonly number[];
  readonly rangeWord: string;
  readonly ropes: number;
  readonly mode: "testnet" | "mainnet";
  readonly sample: boolean;
}

const backgrounds = new Map<string, boolean[][]>();

/** The faint contour ground, seeded by the certificate number (the same card always draws the same map). */
function groundMask(number: string): boolean[][] {
  const hit = backgrounds.get(number);
  if (hit) return hit;
  const random = rngOf(Number.parseInt(number, 36) || 7);
  const peaks: Peak[] = Array.from({ length: 6 }, () => [random() * CERT_W, random() * CERT_H, 0.5 + random() * 0.8, 18 + random() * 26] as const);
  const mask = contourMask(topoField(CERT_W, CERT_H, 1, peaks), 7);
  backgrounds.set(number, mask);
  return mask;
}

/**
 * Paints the certificate (pure apart from the canvas): a stepped 2 px
 * frame on the sheet's card, a faint contour ground, Ely crowned on the
 * axis with flag and confetti, the high in Pixelify, the range's ridge with
 * its summit flag and drawdown lake, and the three facts in equal thirds.
 */
export function paintCertificate(ctx: CanvasRenderingContext2D, content: CertificateContent, colors: SheetColors, seconds: number, still: boolean): void {
  const W = CERT_W;
  const H = CERT_H;
  const cx = W / 2;
  ctx.clearRect(0, 0, W, H);
  // card with stepped corners (the corner pixel stays clear)
  ctx.fillStyle = colors.card;
  ctx.fillRect(1, 0, W - 2, H);
  ctx.fillRect(0, 1, W, H - 2);
  // contour ground
  const mask = groundMask(content.number);
  ctx.fillStyle = shade(colors.card, colors.night ? 0.08 : -0.06);
  for (let y = 1; y < H - 1; y += 1) for (let x = 1; x < W - 1; x += 1) if (mask[y]![x]) ctx.fillRect(x, y, 1, 1);
  // frame: 2 px of ink, inset 3, corners stepped
  ctx.fillStyle = colors.ink;
  ctx.fillRect(5, 3, W - 10, 2);
  ctx.fillRect(5, H - 5, W - 10, 2);
  ctx.fillRect(3, 5, 2, H - 10);
  ctx.fillRect(W - 5, 5, 2, H - 10);
  // corner rivets, mirrored
  for (const [x, y] of [
    [8, 8],
    [W - 10, 8],
    [8, H - 10],
    [W - 10, H - 10],
  ] as const) {
    ctx.fillStyle = SUN;
    ctx.fillRect(x, y, 2, 2);
  }

  drawPixelText(ctx, "SUMMIT CERTIFICATE", cx, 9, { font: TAG, color: colors.ink, align: "center" });
  if (content.sample) {
    drawPixelText(ctx, "SAMPLE", 14, 9, { font: TAG, color: colors.down });
    drawPixelText(ctx, "SAMPLE", W - 14, 9, { font: TAG, color: colors.down, align: "right" });
  }

  // Ely, crowned, on the axis
  ctx.save();
  ctx.translate(cx - 20, 16);
  drawElyState(ctx, { state: "summit", seconds, still, clear: false });
  ctx.restore();

  drawPixelText(ctx, usdShort(content.facts.high), cx, 60, { font: FIGURE, color: colors.ink, align: "center" });
  const when = content.facts.highAt ? ` · ${dayLabel(content.facts.highAt).toUpperCase()}` : "";
  drawPixelText(ctx, content.facts.highAt ? `${content.rangeWord.toUpperCase()} HIGH${when}` : "A RANGE STILL BEING SURVEYED", cx, 92, { font: TAG, color: colors.accent, align: "center" });
  drawPixelText(ctx, `REACHED BY ${shortAddr(content.address).toUpperCase()}`, cx, 102, { font: TAG, color: colors.ink2, align: "center" });

  // the ridge: equity as the kit's pixel profile, on a scratch canvas then blitted
  if (content.values.length >= 2 && typeof document !== "undefined") {
    const scratch = document.createElement("canvas");
    scratch.width = W - 16;
    scratch.height = 44;
    const sctx = scratch.getContext("2d");
    if (sctx) {
      paintProfile(sctx, profileColumns(content.values, scratch.width, scratch.height), { wave: !still && Math.floor(seconds) % 2 === 1 });
      ctx.drawImage(scratch, 8, 108);
    }
  }
  ctx.fillStyle = colors.ink;
  ctx.fillRect(8, 154, W - 16, 1);

  // three facts in equal thirds, separated on the grid
  const third = (W - 16) / 3;
  const climb = content.facts.changePct ?? 0;
  const facts = [
    { text: `${climb >= 0 ? "+" : "-"}${pct(Math.abs(climb))} ${climb >= 0 ? "CLIMB" : "DESCENT"}`, color: climb >= 0 ? colors.up : colors.down },
    { text: `${(content.facts.drawdown * 100).toFixed(1)}% DROP`, color: colors.ink },
    { text: `${content.ropes} ROPE${content.ropes === 1 ? "" : "S"}`, color: colors.ink },
  ];
  facts.forEach((fact, index) => {
    const mid = 8 + third * index + third / 2;
    drawPixelText(ctx, fact.text, mid, 160, { font: TAG, color: fact.color, align: "center" });
    if (index > 0) {
      ctx.fillStyle = colors.ink3;
      for (let y = 159; y < 168; y += 2) ctx.fillRect(Math.round(8 + third * index), y, 1, 1);
    }
  });
  drawPixelText(ctx, `NO. ${content.number} · ${content.mode === "testnet" ? "TESTNET" : "MAINNET"} · ELYIA`, cx, 174, { font: TAG, color: colors.ink3, align: "center" });
  // a rope-red flag pixel on the title's axis, so the eye starts in the middle
  ctx.fillStyle = ROPE_RED;
  ctx.fillRect(Math.round(cx) - 1, 5, 2, 2);
}

