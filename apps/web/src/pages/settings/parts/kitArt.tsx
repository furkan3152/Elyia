import { useCallback } from "react";

import { PixelCanvas } from "../../../pixel/PixelCanvas";
import { MH, MW, paintMotionSample } from "./kitItems";

export function MotionArt({ night }: { readonly night: boolean }) {
  const draw = useCallback((ctx: CanvasRenderingContext2D, info: { readonly seconds: number; readonly still: boolean }) => paintMotionSample(ctx, info.seconds, info.still, night), [night]);
  return <PixelCanvas width={MW} height={MH} contain draw={draw} animate fps={8} redrawKey={night} label="Motion sample: the map draws in band by band, then Ely climbs to the summit" />;
}
