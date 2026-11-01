import { useCallback } from "react";

import { PixelCanvas } from "../../pixel/PixelCanvas";
import type { RouteStepState } from "../../topo/RouteCard";
import { LAYER_NET, LAYER_WORD, type CardLayer } from "./cardModel";
import { drawRouteStrip, paletteOf } from "./draw";

export interface RouteStripProps {
  readonly layers: readonly CardLayer[];
  readonly states: readonly RouteStepState[];
  /** CSS px per pixel: 2 inline, 4 in the panel. */
  readonly scale: 2 | 4;
  /** Logical height in pixels. */
  readonly height?: number;
  readonly className?: string;
}

/** The route's elevation strip: the land zoned by layer, camps with flags, the path walked and Ely at its head. */
export function RouteStrip({ layers, states, scale, height = 36, className }: RouteStripProps) {
  const climbingIndex = states.findIndex((state) => state === "climbing");
  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, info: { readonly w: number; readonly h: number; readonly seconds: number; readonly still: boolean }) => {
      const climb = climbingIndex >= 0 ? (info.still ? 0.6 : 0.2 + ((info.seconds * 0.12) % 0.7)) : undefined;
      drawRouteStrip(ctx, info.w, info.h, info.still ? 0 : info.seconds, { layers, states: states as never, ely: true, ...(climb !== undefined ? { climb } : {}) }, paletteOf(ctx.canvas));
    },
    [layers, states, climbingIndex],
  );
  const settled = states.filter((state) => state === "settled").length;
  const label = `Route elevation strip: ${layers.map((layer) => `${LAYER_WORD[layer]} (${LAYER_NET[layer]})`).join(" to ")}; ${settled} of ${layers.length} legs settled.`;
  return <PixelCanvas width={160} height={height} pixelSize={scale} draw={draw} animate fps={12} endTime={0} redrawKey={`${layers.join()}|${states.join()}`} label={label} className={className} />;
}
