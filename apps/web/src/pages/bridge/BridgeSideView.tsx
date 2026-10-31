import { useCallback, useRef } from "react";

import { useReducedMotion } from "../../motion/useReducedMotion";
import { PixelCanvas } from "../../pixel/PixelCanvas";
import type { TextSurface } from "../../pixel/scene";
import { formatEta } from "../track/flow/routeModel";
import { PixelFigure } from "../track/flow/FlowPixel";
import { useCompact, useNight } from "../track/flow/pixelHooks";
import { laneAsset, type BridgeAsset, type Lane } from "./lanes";
import { paintSideView, sideGeometry, type SideGeometry } from "./sideView";

export interface BridgeSideViewProps {
  readonly lane: Lane;
  readonly asset: BridgeAsset;
  readonly className?: string;
}

const LAYER_WORD = { floor: "Floor", ridge: "Ridge", summit: "Summit" } as const;

/**
 * The hero of /app/bridge: the three layers cut open as a pixel side view,
 * every lane drawn between the camps, and Ely travelling the chosen one on
 * the shared clock (the cable car up, the switchbacks down, the zip lines of
 * the Core link, the footbridge on the Floor). Reduced motion shows Ely
 * standing at the destination.
 */
export function BridgeSideView({ lane, asset, className }: BridgeSideViewProps) {
  const compact = useCompact();
  const night = useNight();
  const cache = useRef<SideGeometry | null>(null);
  const eta = formatEta(lane.seconds(laneAsset(lane, asset))).replace("~", "");
  const tag = `${lane.tag} · ${eta}`.toUpperCase();
  // the end state whenever motion is reduced (the shared loop may repaint a still canvas at t = 0)
  const reduced = useReducedMotion();
  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, info: { readonly w: number; readonly h: number; readonly seconds: number; readonly still: boolean }) => {
      if (!cache.current || cache.current.w !== info.w || cache.current.h !== info.h) cache.current = sideGeometry(info.w, info.h);
      paintSideView(ctx as unknown as TextSurface, cache.current, { seconds: info.seconds, still: info.still || reduced, night, selected: lane.id, tag, compact });
    },
    [lane.id, tag, night, compact, reduced],
  );
  const route = `${LAYER_WORD[lane.from]}${lane.from === lane.to ? "" : ` → ${LAYER_WORD[lane.to]}`}`;
  return (
    <PixelFigure
      className={className}
      caption={[`◆ ${lane.title}`, `${route} · by ${lane.carrier}`, `${eta} · ${lane.signatures(laneAsset(lane, asset))} sig.`]}
    >
      <PixelCanvas
        width={compact ? 200 : 400}
        height={compact ? 128 : 150}
        draw={draw}
        animate
        fps={16}
        endTime={0}
        redrawKey={`${lane.id}|${tag}|${night}|${compact}`}
        label={`Cross-section of the three layers: Floor (HyperCore), Ridge (HyperEVM) and Summit (Elysium), with six bridge lanes. Chosen: ${lane.title}, ${route}, by ${lane.carrier}, ${eta}.`}
      />
    </PixelFigure>
  );
}
