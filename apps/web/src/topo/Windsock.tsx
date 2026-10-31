import { useMemo } from "react";

import { windsockGlyph } from "../pixel/glyphs";
import { PixelGlyph } from "../pixel/PixelGlyph";
import { cx } from "../ui/cx";
import { windsock } from "./geometry/conditions";

export interface WindsockProps {
  /** Annualised funding as a fraction (0.11 = 11% APR); positive means longs pay shorts. */
  readonly fundingApr: number | null | undefined;
  /** px height of the glyph. */
  readonly size?: number;
  /** Show "shorts paid · 11% APR" after the sock. */
  readonly showLabel?: boolean;
  readonly className?: string;
}

/**
 * Funding as a pixel windsock: five stripes, filled one per 10% APR; it
 * blows toward the side that gets paid (right = shorts paid, left = longs
 * paid) and its tail flutters in two frames, faster as funding strengthens.
 */
export function Windsock({ fundingApr, size = 22, showLabel = false, className }: WindsockProps) {
  const model = windsock(fundingApr);
  const toLeft = model.pays === "long";
  const limp = model.pays === "none";
  const words = limp ? "calm · no funding" : `${model.pays === "short" ? "shorts" : "longs"} paid · ${Math.abs(model.aprPct).toFixed(1)}% APR`;
  const frames = useMemo(() => {
    const flip = (rows: string[]) => (toLeft ? rows.map((row) => [...row].reverse().join("")) : rows);
    return [flip(windsockGlyph(model.stripes, 0, limp)), flip(windsockGlyph(model.stripes, 1, limp))];
  }, [model.stripes, limp, toLeft]);
  return (
    <span className={cx("inline-flex items-center gap-1.5 align-middle", className)} role="img" aria-label={`Funding windsock: ${words}, ${model.stripes} of 5 stripes`}>
      <PixelGlyph rows={frames[0]!} frames={limp ? undefined : frames} fps={1 + Math.round(model.strength * 2)} scale={Math.max(1, Math.round(size / 12))} label={null} />
      {showLabel ? <span className="tnum font-tag text-[11px] uppercase text-ink-2">{words}</span> : null}
    </span>
  );
}
