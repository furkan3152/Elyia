import type { PortfolioHistory } from "@elyia/core/api/portfolio";
import { useCallback, useMemo } from "react";

import type { RopeView } from "../../features/trading/useTopoData";
import { useNow } from "../../hooks/useNow";
import { INK, LAYERS } from "../../pixel/ely";
import { PixelCanvas } from "../../pixel/PixelCanvas";
import { shade } from "../../pixel/topo";
import { RadioLog, type RadioEntry } from "../../topo/RadioLog";
import { cx } from "../../ui/cx";
import { pct, usdShort } from "../portfolio/range/format";
import { registerEntries, sortRopes, type LayerShare } from "../portfolio/range/model";

const PALETTE: Readonly<Record<LayerShare["layer"], readonly string[]>> = { floor: LAYERS.Floor, ridge: LAYERS.Ridge, summit: LAYERS.Summit };
const HEIGHT: Readonly<Record<LayerShare["layer"], number>> = { floor: 5, ridge: 9, summit: 13 };
const NAME: Readonly<Record<LayerShare["layer"], string>> = { floor: "Floor", ridge: "Ridge", summit: "Summit" };
const TONE: Readonly<Record<LayerShare["layer"], string>> = { floor: "text-floor", ridge: "text-ridge", summit: "text-summit-ink" };

/**
 * The layer split as a pixel side view: each layer is a step as wide as its
 * share of net worth and as high as its altitude (Floor, Ridge, Summit), in
 * its own altitude bands.
 */
export function LayerSkyline({ split, className }: { readonly split: readonly LayerShare[]; readonly className?: string }) {
  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, info: { readonly w: number; readonly h: number }) => {
      const { w, h } = info;
      ctx.clearRect(0, 0, w, h);
      const visible = split.filter((entry) => entry.share > 0.002);
      if (visible.length === 0) {
        ctx.fillStyle = INK;
        for (let x = 0; x < w; x += 2) ctx.fillRect(x, h - 1, 1, 1);
        return;
      }
      let x = 0;
      const total = visible.reduce((sum, entry) => sum + entry.share, 0);
      visible.forEach((entry, index) => {
        const width = index === visible.length - 1 ? w - x : Math.max(2, Math.round((entry.share / total) * w));
        const top = h - HEIGHT[entry.layer];
        const colours = PALETTE[entry.layer];
        for (let y = top; y < h; y += 1) {
          const band = Math.min(4, Math.floor((y - top) / 2));
          const colour = colours[4 - band]!;
          ctx.fillStyle = (y - top) % 2 === 0 && y > top ? shade(colour, -0.2) : colour;
          ctx.fillRect(x, y, width, 1);
        }
        ctx.fillStyle = INK;
        ctx.fillRect(x, top, width, 1);
        ctx.fillRect(x, top, 1, h - top);
        if (index === visible.length - 1) ctx.fillRect(x + width - 1, top, 1, h - top);
        x += width;
      });
    },
    [split],
  );
  const summary = split.map((entry) => `${NAME[entry.layer]} ${usdShort(entry.usd)}`).join(", ");
  return (
    <figure className={cx("m-0", className)}>
      <PixelCanvas width={120} height={14} pixelSize={3} draw={draw} redrawKey={split.map((entry) => entry.share.toFixed(4)).join("|")} label={`Net worth by layer: ${summary}`} />
      <figcaption className="mt-2 grid grid-cols-3 font-tag text-[10px] uppercase">
        {split.map((entry, index) => (
          <span key={entry.layer} className={cx(index === 0 ? "text-left" : index === 1 ? "text-center" : "text-right")}>
            <span className={TONE[entry.layer]}>{NAME[entry.layer]}</span> <span className="tnum font-mono text-[11px] normal-case text-ink-2">{usdShort(entry.usd)}</span>
          </span>
        ))}
      </figcaption>
    </figure>
  );
}

/** The camp's radio log: fraying ropes first, then the latest fills and funding from history. */
export function CampRadio({ ropes, history, sample, className }: { readonly ropes: readonly RopeView[]; readonly history: PortfolioHistory | null; readonly sample: boolean; readonly className?: string }) {
  const now = useNow(30_000);
  const entries = useMemo<RadioEntry[]>(() => {
    const out: RadioEntry[] = [];
    const latest = history?.timeline[0]?.time ?? now;
    for (const rope of sortRopes(ropes)) {
      if (rope.distance !== null && rope.distance < 0.25) {
        out.push({ id: `rope-${rope.coin}`, at: now, from: "ELY", to: "you", message: `${rope.coin} rope ${pct(rope.distance)}${rope.distance < 0.1 ? ", fraying: add margin or set an anchor" : ", watch it"}`, tone: "alert", live: rope.distance < 0.1 });
      }
    }
    for (const entry of registerEntries(history?.timeline ?? [], 6).slice(0, 5)) {
      out.push({ id: entry.id, at: entry.time, from: entry.kind === "ledger" ? "BASE" : "FLOOR", message: `${entry.entry}${entry.amount ? ` · ${entry.amount}` : ""}`, tone: entry.kind === "fill" ? "settled" : "plain" });
    }
    if (out.length === 0) out.push({ id: "quiet", at: latest, from: "ELY", to: "you", message: "All quiet on the range. Say where to and I will draft the route." });
    return out.slice(0, 6);
  }, [ropes, history, now]);
  return <RadioLog className={cx("px-drop", className)} entries={entries} title={`Radio log · base camp${sample ? " · sample" : ""}`} aside={sample ? "sample" : "live"} footer="Ely proposes · you sign · it never withdraws" maxHeight="320px" />;
}
