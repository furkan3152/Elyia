import { useId, useMemo, useRef } from "react";

import { copyText } from "../../../ui/clipboard";
import { Button } from "../../../ui/Button";
import { toast } from "../../../ui/toast";
import type { ProfilePoint } from "../../../topo/geometry/profile";
import { dayLabel, pct, shortAddr, usdShort } from "../range/format";
import { summitFacts } from "../range/model";

const W = 640;
const H = 360;

/** A short stable number for the certificate (FNV-1a of the address). */
function certificateNumber(address: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < address.length; index += 1) {
    hash ^= address.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36).toUpperCase().padStart(6, "0").slice(0, 6);
}

function ridge(series: readonly ProfilePoint[], x0: number, x1: number, y0: number, y1: number): { line: string; area: string; high: [number, number] | null } {
  if (series.length < 2) return { line: "", area: "", high: null };
  const step = Math.max(1, Math.floor(series.length / 120));
  const points = series.filter((_, index) => index % step === 0 || index === series.length - 1);
  const min = Math.min(...points.map((p) => p.value));
  const max = Math.max(...points.map((p) => p.value));
  const span = max - min || 1;
  const t0 = points[0]!.t;
  const t1 = points[points.length - 1]!.t;
  const xy = points.map((p) => [x0 + ((p.t - t0) / (t1 - t0 || 1)) * (x1 - x0), y1 - ((p.value - min) / span) * (y1 - y0)] as [number, number]);
  const line = `M${xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join("L")}`;
  const area = `${line}L${x1},${y1 + 18}L${x0},${y1 + 18}Z`;
  let high = xy[0]!;
  for (const point of xy) if (point[1] < high[1]) high = point;
  return { line, area, high };
}

/** Resolves `rgb(var(--token))` into plain colours so the saved PNG keeps the current sheet. */
function resolveTokens(svg: string): string {
  const style = getComputedStyle(document.documentElement);
  return svg.replace(/var\(--([a-z0-9-]+)\)/giu, (_, name: string) => style.getPropertyValue(`--${name}`).trim().replace(/\s+/gu, " ").split(" ").join(","));
}

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
 * The summit certificate: a share card drawn in SVG (the range's high, the
 * climb, the deepest drawdown, a ridge of the curve, a rubber stamp). Saves
 * as a PNG in the current sheet, or copies a one-line brag.
 */
export function SummitCertificate({ address, series, rangeWord, ropes, mode, sample, className }: SummitCertificateProps) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/gu, "");
  const ref = useRef<SVGSVGElement>(null);
  const facts = useMemo(() => summitFacts(series), [series]);
  const shape = useMemo(() => ridge(series, 36, W - 36, 196, 268), [series]);
  const number = certificateNumber(address);
  const climb = facts.changePct ?? 0;
  const line = `Summit certificate No. ${number}: ${shortAddr(address)} reached ${usdShort(facts.high)}${facts.highAt ? ` on ${dayLabel(facts.highAt)}` : ""} · ${rangeWord} ${climb >= 0 ? "climb" : "descent"} ${climb >= 0 ? "+" : ""}${pct(climb)} · max drawdown ${(facts.drawdown * 100).toFixed(1)}%${sample ? " (sample)" : ""} · surveyed by Elyia`;

  const savePng = async () => {
    const svg = ref.current;
    if (!svg) return;
    const markup = resolveTokens(new XMLSerializer().serializeToString(svg));
    const image = new Image();
    const url = URL.createObjectURL(new Blob([markup], { type: "image/svg+xml;charset=utf-8" }));
    try {
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error("render"));
        image.src = url;
      });
      const canvas = document.createElement("canvas");
      canvas.width = W * 2;
      canvas.height = H * 2;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("canvas");
      context.drawImage(image, 0, 0, W * 2, H * 2);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("png");
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `elyia-summit-${number}.png`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(link.href), 2_000);
      toast.success("Certificate saved", { description: `elyia-summit-${number}.png` });
    } catch {
      toast.error("Could not draw the PNG", { description: "Your browser blocked the canvas. Copy the line instead." });
    } finally {
      URL.revokeObjectURL(url);
    }
  };

  const ink = "rgb(var(--ink))";
  const ink2 = "rgb(var(--ink-2))";
  const card = "rgb(var(--card))";
  return (
    <section className={className} aria-label="Summit certificate">
      <svg ref={ref} xmlns="http://www.w3.org/2000/svg" viewBox={`0 0 ${W} ${H}`} width="100%" className="block border-2 border-rule shadow-hard-lg" role="img" aria-label={line}>
        <defs>
          <pattern id={`${id}-hatch`} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <path d="M0,0V5" stroke="rgb(var(--contour))" strokeWidth="1.1" strokeOpacity="0.8" />
          </pattern>
        </defs>
        <rect width={W} height={H} fill={card} />
        <rect x="10" y="10" width={W - 20} height={H - 20} fill="none" stroke={ink} strokeWidth="1" />
        {/* neat-line ticks */}
        <g stroke={ink} strokeWidth="1">
          {Array.from({ length: 15 }, (_, i) => (
            <path key={i} d={`M${10 + (i + 1) * ((W - 20) / 16)},10v6M${10 + (i + 1) * ((W - 20) / 16)},${H - 10}v-6`} />
          ))}
        </g>
        {/* faint contour ground */}
        <g fill="none" stroke="rgb(var(--contour))" strokeOpacity="0.35" strokeWidth="0.8">
          {[0, 1, 2, 3, 4].map((ring) => (
            <ellipse key={ring} cx={W - 150} cy={232} rx={36 + ring * 22} ry={24 + ring * 15} />
          ))}
        </g>
        <g fontFamily="IBM Plex Mono, ui-monospace, monospace" fill={ink2} fontSize="11" letterSpacing="1.6">
          <rect x="30" y="28" width="236" height="24" fill={card} stroke={ink} strokeWidth="2" />
          <text x="42" y="44" fill={ink} fontWeight="600">
            SUMMIT CERTIFICATE · No. {number}
          </text>
          <text x={W - 30} y="44" textAnchor="end">
            {mode === "testnet" ? "PRACTICE WALL · TESTNET" : "MAINNET"}
          </text>
        </g>
        <text x="30" y="88" fontFamily="Space Grotesk Variable, Space Grotesk, system-ui, sans-serif" fontSize="16" fill={ink2}>
          This certifies that {shortAddr(address)} reached
        </text>
        <text x="28" y="146" fontFamily="Space Grotesk Variable, Space Grotesk, system-ui, sans-serif" fontWeight="700" fontSize="56" letterSpacing="-1.5" fill={ink}>
          {usdShort(facts.high)}
        </text>
        <text x="30" y="172" fontFamily="Instrument Serif, Georgia, serif" fontStyle="italic" fontSize="19" fill="rgb(var(--summit-ink))">
          {facts.highAt ? `the high of a ${rangeWord} range, ${dayLabel(facts.highAt).toLowerCase()}` : "a range still being surveyed"}
        </text>
        {/* the ridge */}
        {shape.line ? (
          <>
            <path d={shape.area} fill={`url(#${id}-hatch)`} />
            <path d={shape.line} fill="none" stroke={ink} strokeWidth="2" strokeLinejoin="round" />
            {shape.high ? (
              <g transform={`translate(${shape.high[0]},${shape.high[1]})`}>
                <path d="M0,0V-24" stroke={ink} strokeWidth="1.6" />
                <path d="M0,-24h16l-4,5 4,5H0Z" fill="rgb(var(--down))" stroke={ink} strokeWidth="1" />
              </g>
            ) : null}
          </>
        ) : null}
        <line x1="30" y1="290" x2={W - 30} y2="290" stroke={ink} strokeWidth="1.5" />
        <g fontFamily="IBM Plex Mono, ui-monospace, monospace" fontSize="12" fill={ink}>
          <text x="30" y="314">
            {climb >= 0 ? "▲" : "▼"} {rangeWord.toUpperCase()} {climb >= 0 ? "CLIMB" : "DESCENT"} {climb >= 0 ? "+" : ""}
            {pct(climb)}
          </text>
          <text x="232" y="314">
            ▼ MAX DRAWDOWN {(facts.drawdown * 100).toFixed(1)}%
          </text>
          <text x="438" y="314">
            ROPES OUT {ropes}
          </text>
          <text x="30" y="334" fill={ink2} fontSize="10.5" letterSpacing="1">
            SURVEY: ELYIA · REFERENCE PRICES · HYPERCORE + HYPEREVM + ELYSIUM
          </text>
        </g>
        {/* the stamp */}
        <g transform={`translate(${W - 96},${118}) rotate(-9)`} fill="none" stroke="rgb(var(--summit-ink))" strokeWidth="2.4" opacity="0.88">
          <circle r="44" />
          <circle r="36" strokeWidth="1.2" />
          <text y="-14" textAnchor="middle" fontFamily="IBM Plex Mono, monospace" fontSize="9" fontWeight="600" letterSpacing="1.6" fill="rgb(var(--summit-ink))" stroke="none">
            SURVEYED
          </text>
          <text y="6" textAnchor="middle" fontFamily="Space Grotesk Variable, Space Grotesk, sans-serif" fontSize="17" fontWeight="700" fill="rgb(var(--summit-ink))" stroke="none">
            {sample ? "SAMPLE" : "SUMMIT"}
          </text>
          <text y="22" textAnchor="middle" fontFamily="IBM Plex Mono, monospace" fontSize="8.5" letterSpacing="1.2" fill="rgb(var(--summit-ink))" stroke="none">
            {new Date().toISOString().slice(0, 10)}
          </text>
        </g>
      </svg>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="primary" size="sm" onClick={() => void savePng()}>
          Save PNG ↓
        </Button>
        <Button
          variant="ink"
          size="sm"
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
