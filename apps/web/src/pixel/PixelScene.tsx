import { useCallback, useMemo, useRef } from "react";

import { useResolvedTheme } from "../app/state/useTheme";
import { usePulseFeed } from "../hooks/usePulse";
import type { BlockFeed } from "../lib/pulse/pulseHub";
import { cx } from "../ui/cx";
import { PixelCanvas } from "./PixelCanvas";
import { DAY_SCENE, DEFAULT_SCENE_LABELS, drawScene, NIGHT_SCENE, SCENE_H, sceneAltitude, sceneModel, type SceneLabels, type SceneModel } from "./scene";
import { useBlockTicks } from "./useBlockTicks";

export interface PixelSceneProps {
  /** Survey pin texts on the three ridges. */
  readonly labels?: SceneLabels;
  /** Seconds per climb (default 18). */
  readonly cycle?: number;
  /**
   * Block feed for the barograph strip. Default "pulse": the shared Elysium
   * pulse (live, with a labelled sample while it is quiet). null: sample only.
   */
  readonly feed?: BlockFeed | null | "pulse";
  /** DAY or NIGHT sky; default follows the sheet. */
  readonly night?: boolean;
  /** Accessible name. */
  readonly label?: string;
  /** Hide the caption row under the scene. */
  readonly hideCaption?: boolean;
  readonly className?: string;
}

const CAPACITY = 220;

function SceneBody({ labels = DEFAULT_SCENE_LABELS, cycle = 18, feed, night, label, hideCaption = false, className }: Omit<PixelSceneProps, "feed"> & { readonly feed: BlockFeed | null }) {
  const theme = useResolvedTheme();
  const isNight = night ?? theme === "dark";
  const { store, live, head } = useBlockTicks(feed, CAPACITY);
  const altitude = useRef<HTMLSpanElement>(null);
  const models = useRef(new Map<number, SceneModel>());
  const palette = isNight ? NIGHT_SCENE : DAY_SCENE;
  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, info: { readonly w: number; readonly seconds: number; readonly still: boolean }) => {
      let model = models.current.get(info.w);
      if (!model) {
        model = sceneModel(info.w);
        models.current.clear();
        models.current.set(info.w, model);
      }
      if (!info.still) store.advance(performance.now());
      const progress = drawScene(ctx, model, { seconds: info.seconds, cycle, labels, palette, baro: store.ticks, still: info.still });
      if (altitude.current) altitude.current.textContent = `Altitude ${sceneAltitude(progress.climb).toLocaleString("en-US")} m`;
    },
    [cycle, labels, palette, store],
  );
  const name = label ?? `Pixel mountain range: Ely climbs the trail from the ${labels.ridge.toLowerCase()} to the ${labels.summit.toLowerCase()} and plants the flag`;
  const redraw = useMemo(() => `${isNight}|${labels.summit}|${labels.ridge}|${labels.floor}`, [isNight, labels]);
  return (
    <figure className={cx("m-0 w-full", className)}>
      <div className="bg-card px-frame px-drop">
        <PixelCanvas width={400} height={SCENE_H} draw={draw} animate fps={20} endTime={0} night={isNight} label={name} redrawKey={redraw} />
      </div>
      {hideCaption ? null : (
        <figcaption className="mt-4 grid grid-cols-2 items-center gap-2 px-1 sm:grid-cols-3 font-tag text-[11px] uppercase text-ink-2">
          <span className={cx("justify-self-start", live && "text-up")}>
            {live ? `▲ Summit #${(head ?? store.lastBlock ?? 0).toLocaleString("en-US")}` : "◇ Sample blocks"}
          </span>
          <span className="hidden justify-self-center text-center sm:block">114 ms · 1 pixel = 1 block</span>
          <span ref={altitude} className="justify-self-end text-right tnum">
            Altitude 4,810 m
          </span>
        </figcaption>
      )}
    </figure>
  );
}

function PulseScene(props: Omit<PixelSceneProps, "feed">) {
  const feed = usePulseFeed();
  return <SceneBody {...props} feed={feed} />;
}

/**
 * The hero range: altitude-banded ridges (Summit, Ridge, Floor), the sun
 * rising (a moon and stars by NIGHT), a drifting cloud sea, survey pins, and
 * Ely climbing the trail to plant the flag in confetti. Along the bottom a
 * barograph strip ticks once per Elysium block (live from the pulse, or a
 * labelled sample). Reduced motion: Ely on the summit, flag planted.
 */
export function PixelScene({ feed = "pulse", ...props }: PixelSceneProps) {
  if (feed === "pulse") return <PulseScene {...props} />;
  return <SceneBody {...props} feed={feed} />;
}
