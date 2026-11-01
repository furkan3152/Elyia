/**
 * The shareable WL application card (1200 × 630 PNG, X's large card size):
 * the applicant's own goat (the art for a Herd number derived from the
 * wallet, or the placeholder when the generator is not importable here),
 * the X handle, the usage score and weight, and the referral code.
 */
import type { HerdApplication, HerdUsageScore } from "@elyia/core/api/herd";
import { keccak256, toHex } from "viem";
import { goatRaster, placeholderRaster } from "./metadata.js";
import { drawText, Raster, textWidth } from "./raster.js";

export const CARD_W = 240;
export const CARD_H = 126;
export const CARD_SCALE = 5;

/** A stable Herd art number for a wallet's card (1..3333); not a token, just a face. */
export function cardGoatOf(wallet: string, maxSupply = 3333): number {
  return Number(BigInt(keccak256(toHex(wallet.toLowerCase()))) % BigInt(maxSupply)) + 1;
}

const PAPER = "#F4EEDC";
const PAPER_2 = "#E9E1C8";
const INK = "#16201B";
const INK_2 = "#4A5A51";
const ACCENT = "#17788C";
const SUN = "#F2C200";

export async function renderCard(input: { readonly wallet: string; readonly application: HerdApplication | null; readonly score: HerdUsageScore; readonly testnet: boolean }): Promise<Buffer> {
  const card = new Raster(CARD_W, CARD_H);
  card.fillStyle = PAPER;
  card.fillRect(0, 0, CARD_W, CARD_H);
  // Stepped frame (no ink outline: a rule line and a depth band, as the UI).
  card.fillStyle = "#CDBF9A";
  card.fillRect(2, 0, CARD_W - 4, 2);
  card.fillRect(2, CARD_H - 2, CARD_W - 4, 2);
  card.fillRect(0, 2, 2, CARD_H - 4);
  card.fillRect(CARD_W - 2, 2, 2, CARD_H - 4);
  card.fillStyle = PAPER_2;
  card.fillRect(2, CARD_H - 6, CARD_W - 4, 4);

  const art = cardGoatOf(input.wallet);
  const goat = (await goatRaster(art)) ?? placeholderRaster();
  const size = goat.width;
  const scale = Math.max(1, Math.floor(96 / size));
  card.fillStyle = ACCENT;
  card.fillRect(10, 10, size * scale + 4, size * scale + 4);
  card.blit(goat, 12, 12, scale);

  const left = 22 + size * scale;
  drawText(card, "THE HERD", left, 12, INK, 2);
  drawText(card, input.testnet ? "WL CARD · TESTNET" : "WL CARD", left, 30, ACCENT);
  const handle = input.application ? `@${input.application.xHandle.toUpperCase()}` : `${input.wallet.slice(0, 6)}..${input.wallet.slice(-4)}`.toUpperCase();
  drawText(card, handle.slice(0, 20), left, 44, INK);
  drawText(card, "SCORE", left, 64, INK_2);
  const scoreWidth = drawText(card, String(input.score.score), left + 36, 58, INK, 2);
  drawText(card, "/100", left + 38 + scoreWidth, 64, INK_2);
  drawText(card, `WEIGHT ${input.score.weight.toFixed(2)}X`, left, 78, INK_2);
  const referral = input.application?.referral ?? keccak256(toHex(input.wallet.toLowerCase())).slice(2, 10);
  drawText(card, `REF ${referral.toUpperCase()}`, left, 90, INK_2);
  // Score bar in 20 steps.
  const steps = Math.round(input.score.score / 5);
  for (let index = 0; index < 20; index += 1) {
    card.fillStyle = index < steps ? SUN : PAPER_2;
    card.fillRect(left + index * 5, 102, 4, 6);
  }
  const foot = "ELYIA";
  drawText(card, foot, CARD_W - 10 - textWidth(foot), CARD_H - 17, ACCENT);
  return card.scaled(CARD_SCALE).png();
}
