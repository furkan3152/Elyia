import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

import { cardGoatOf } from "../../../features/herd/art";
import { drawHerd } from "../../../pixel/herd";

export interface WlCardProps {
  readonly wallet: string;
  readonly handle: string | null;
  readonly score: number | null;
  readonly weight: number | null;
  readonly referral: string | null;
  readonly testnet: boolean;
}

export interface WlCardHandle {
  toBlob(): Promise<Blob | null>;
}

const W = 1200;
const H = 630;

/** The shareable WL card, drawn on a 1200 × 630 canvas (X's large card size). */
export const WlCard = forwardRef<WlCardHandle, WlCardProps>(function WlCard({ wallet, handle, score, weight, referral, testnet }, ref) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useImperativeHandle(ref, () => ({ toBlob: () => new Promise((resolve) => (canvas.current ? canvas.current.toBlob(resolve, "image/png") : resolve(null))) }), []);
  useEffect(() => {
    const element = canvas.current;
    const ctx = element?.getContext("2d");
    if (!element || !ctx) return;
    let cancelled = false;
    const paint = () => {
      if (cancelled) return;
      ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = "#F4EEDC";
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = "#CDBF9A";
      ctx.fillRect(10, 0, W - 20, 10);
      ctx.fillRect(10, H - 10, W - 20, 10);
      ctx.fillRect(0, 10, 10, H - 20);
      ctx.fillRect(W - 10, 10, 10, H - 20);
      ctx.fillStyle = "#E9E1C8";
      ctx.fillRect(10, H - 30, W - 20, 20);
      const goat = document.createElement("canvas");
      drawHerd(goat, cardGoatOf(wallet), 10);
      ctx.fillStyle = "#17788C";
      ctx.fillRect(40, 45, 500, 500);
      ctx.drawImage(goat, 50, 55, 480, 480);
      ctx.fillStyle = "#16201B";
      ctx.font = "700 76px 'Pixelify Sans', monospace";
      ctx.fillText("THE HERD", 590, 140);
      ctx.fillStyle = "#17788C";
      ctx.font = "28px 'Silkscreen', monospace";
      ctx.fillText(testnet ? "WL APPLICATION · TESTNET" : "WL APPLICATION", 594, 195);
      ctx.fillStyle = "#16201B";
      ctx.font = "40px 'Pixelify Sans', monospace";
      ctx.fillText(handle ? `@${handle}` : `${wallet.slice(0, 6)}…${wallet.slice(-4)}`, 594, 270);
      ctx.fillStyle = "#4A5A51";
      ctx.font = "26px 'Silkscreen', monospace";
      ctx.fillText("USAGE SCORE", 594, 345);
      ctx.fillStyle = "#16201B";
      ctx.font = "700 92px 'Pixelify Sans', monospace";
      ctx.fillText(score === null ? "—" : String(score), 594, 440);
      const width = ctx.measureText(score === null ? "—" : String(score)).width;
      ctx.fillStyle = "#4A5A51";
      ctx.font = "34px 'Pixelify Sans', monospace";
      ctx.fillText("/100", 606 + width, 440);
      for (let index = 0; index < 20; index += 1) {
        ctx.fillStyle = score !== null && index < Math.round(score / 5) ? "#F2C200" : "#E9E1C8";
        ctx.fillRect(594 + index * 27, 470, 22, 26);
      }
      ctx.fillStyle = "#4A5A51";
      ctx.font = "24px 'Silkscreen', monospace";
      ctx.fillText(`${weight !== null ? `WEIGHT ${weight.toFixed(2)}×   ` : ""}${referral ? `REF ${referral.toUpperCase()}` : ""}`, 594, 545);
      ctx.fillStyle = "#17788C";
      ctx.font = "24px 'Silkscreen', monospace";
      ctx.fillText("ELYIA", W - 140, H - 50);
    };
    void (document.fonts?.ready ?? Promise.resolve()).then(paint);
    paint();
    return () => {
      cancelled = true;
    };
  }, [wallet, handle, score, weight, referral, testnet]);
  return <canvas ref={canvas} width={W} height={H} className="block h-auto w-full [image-rendering:pixelated]" role="img" aria-label={`The Herd WL card for ${handle ? `@${handle}` : wallet}${score !== null ? `, usage score ${score} of 100` : ""}`} />;
});
