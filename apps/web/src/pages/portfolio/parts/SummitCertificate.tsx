import { useCallback, useMemo } from "react";

import { PixelCanvas } from "../../../pixel/PixelCanvas";
import type { ProfilePoint } from "../../../topo/geometry/profile";
import { Button } from "../../../ui/Button";
import { copyText } from "../../../ui/clipboard";
import { toast } from "../../../ui/toast";
import { dayLabel, pct, shortAddr, usdShort } from "../range/format";
import { summitFacts } from "../range/model";
import { CERT_H, CERT_W, certificateNumber, EXPORT_SCALE, FIGURE, paintCertificate, TAG, type CertificateContent } from "./certificate";
import { DAY_SHEET } from "./sheetColors";

export interface SummitCertificateProps {
  readonly address: string;
  readonly series: readonly ProfilePoint[];
  readonly rangeWord: string;
  readonly ropes: number;
  readonly mode: "testnet" | "mainnet";
  readonly sample: boolean;
  readonly className?: string;
}

/**
 * The summit certificate: a pixel trophy card drawn on canvas (Ely crowned,
 * the range's high, its ridge, the climb, the deepest drop). The PNG is the
 * same pixels scaled x6 with nearest neighbour, so the export is
 * pixel-perfect in the current sheet. Or copy a one-line brag.
 */
export function SummitCertificate({ address, series, rangeWord, ropes, mode, sample, className }: SummitCertificateProps) {
  // The certificate prints on the DAY sheet in both themes (a card from the hut): the PNG is the same everywhere.
  const colors = DAY_SHEET;
  const facts = useMemo(() => summitFacts(series), [series]);
  const values = useMemo(() => series.map((point) => point.value), [series]);
  const number = certificateNumber(address);
  const content = useMemo<CertificateContent>(() => ({ number, address, facts, values, rangeWord, ropes, mode, sample }), [number, address, facts, values, rangeWord, ropes, mode, sample]);
  const climb = facts.changePct ?? 0;
  const line = `Summit certificate No. ${number}: ${shortAddr(address)} reached ${usdShort(facts.high)}${facts.highAt ? ` on ${dayLabel(facts.highAt)}` : ""} · ${rangeWord} ${climb >= 0 ? "climb" : "descent"} ${climb >= 0 ? "+" : ""}${pct(climb)} · max drawdown ${(facts.drawdown * 100).toFixed(1)}%${sample ? " (sample)" : ""} · surveyed by Elyia`;
  const draw = useCallback((ctx: CanvasRenderingContext2D, info: { readonly seconds: number; readonly still: boolean }) => paintCertificate(ctx, content, colors, info.seconds, info.still), [content, colors]);

  const savePng = async () => {
    try {
      await Promise.all([document.fonts?.load(TAG), document.fonts?.load(FIGURE)].filter(Boolean));
      const art = document.createElement("canvas");
      art.width = CERT_W;
      art.height = CERT_H;
      const actx = art.getContext("2d");
      if (!actx) throw new Error("canvas");
      paintCertificate(actx, content, colors, 0.6, true);
      const out = document.createElement("canvas");
      out.width = CERT_W * EXPORT_SCALE;
      out.height = CERT_H * EXPORT_SCALE;
      const octx = out.getContext("2d");
      if (!octx) throw new Error("canvas");
      octx.imageSmoothingEnabled = false;
      octx.drawImage(art, 0, 0, out.width, out.height);
      const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("png");
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `elyia-summit-${number}.png`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(link.href), 2_000);
      toast.success("Certificate saved", { description: `elyia-summit-${number}.png · ${out.width} x ${out.height}, pixel-perfect` });
    } catch {
      toast.error("Could not draw the PNG", { description: "Your browser blocked the canvas. Copy the line instead." });
    }
  };

  return (
    <section className={className} aria-label="Summit certificate">
      <div className="mx-auto w-full max-w-[776px] bg-[#FFF9EC] p-1 px-frame px-drop-lg">
        <PixelCanvas width={CERT_W} height={CERT_H} contain draw={draw} animate fps={12} label={line} redrawKey={line} />
      </div>
      <div className="mt-10 flex flex-wrap justify-center gap-x-6 gap-y-5">
        <Button variant="primary" size="lg" onClick={() => void savePng()}>
          Save PNG ↓
        </Button>
        <Button
          variant="ink"
          size="lg"
          onClick={() =>
            void copyText(line).then((ok) => {
              if (ok) toast.success("Copied", { description: "Paste it anywhere." });
              else toast.error("Could not copy");
            })
          }
        >
          Copy the line
        </Button>
      </div>
    </section>
  );
}
