import type { CreateIntentResponse } from "@elyia/core/api/intents";
import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";

import { useUiStore } from "../../../app/state/uiStore";
import { ApiError, apiPost } from "../../../lib/api";
import { drawGrid } from "../../../pixel/draw";
import { elySprite, INK, LAYERS, mini } from "../../../pixel/ely";
import { PixelCanvas } from "../../../pixel/PixelCanvas";
import { shade } from "../../../pixel/topo";
import { Blaze } from "../../../topo/Blaze";
import { Button } from "../../../ui/Button";
import { cx } from "../../../ui/cx";
import { sketchRoute } from "../../deck/routesLog";
import { LAYER_NAME } from "../../portfolio/range/model";

type Layer = "floor" | "ridge" | "summit";

const PALETTE: Readonly<Record<Layer, readonly string[]>> = { floor: LAYERS.Floor, ridge: LAYERS.Ridge, summit: LAYERS.Summit };
const STEP: Readonly<Record<Layer, number>> = { floor: 8, ridge: 16, summit: 25 };
const TONE: Readonly<Record<Layer, string>> = { floor: "text-floor", ridge: "text-ridge", summit: "text-summit-ink" };
const W = 72;
const H = 44;

/** The route's layers as a stepped pixel side view, Ely standing on the last step. */
function paintSteps(ctx: CanvasRenderingContext2D, layers: readonly Layer[]) {
  ctx.clearRect(0, 0, W, H);
  const n = Math.max(1, layers.length);
  const width = Math.floor(W / n);
  const left0 = Math.floor((W - width * n) / 2);
  layers.forEach((layer, index) => {
    const height = STEP[layer];
    const left = left0 + index * width;
    const top = H - height;
    const colours = PALETTE[layer];
    for (let y = top; y < H; y += 1) {
      const band = Math.min(colours.length - 1, Math.floor((y - top) / 3));
      ctx.fillStyle = (y - top) % 3 === 0 && y > top ? shade(colours[4 - band] ?? colours[0]!, -0.2) : (colours[4 - band] ?? colours[0]!);
      ctx.fillRect(left, y, width, 1);
    }
    ctx.fillStyle = INK;
    ctx.fillRect(left, top, width, 1);
    ctx.fillRect(left, top, 1, height);
    if (index === n - 1) ctx.fillRect(left + width - 1, top, 1, height);
  });
  const lastLayer = layers[layers.length - 1] ?? "floor";
  const lastLeft = left0 + (n - 1) * width;
  drawGrid(ctx, mini(elySprite({ gear: "rope", eye: "happy" })), lastLeft + Math.floor(width / 2) - 8, H - STEP[lastLayer] - 17, 1);
}

/**
 * A route sentence the Guide handed to the planner, as a pixel route card:
 * the layers it climbs as a stepped side view with Ely on the top step, its
 * grade, the planner's answer (waypoints, or why it is offline), and the way
 * to the full route card where each step is quoted and signed.
 */
export function RouteProposal({ sentence, onOpen }: { readonly sentence: string; readonly onOpen: () => void }) {
  const mode = useUiStore((state) => state.mode);
  const sketch = sketchRoute(sentence);
  const layers = sketch.layers as readonly Layer[];
  const plan = useQuery({
    queryKey: ["intent-dry-run", mode, sentence, null],
    queryFn: ({ signal }) => apiPost<CreateIntentResponse>("/v1/intents", { text: sentence, accounts: [], mode, dryRun: true }, { query: { dryRun: true }, signal, timeoutMs: 15_000 }),
    retry: 0,
    staleTime: 30_000,
  });
  const problem = plan.error instanceof ApiError ? plan.error : null;
  const status = plan.data
    ? `planner · ${plan.data.journey.stops.length} waypoint${plan.data.journey.stops.length === 1 ? "" : "s"} · quoted`
    : plan.isPending
      ? "planner · surveying…"
      : problem?.code === "TEXT_NOT_SUPPORTED_YET"
        ? "planner · reads this sentence soon · words parsed"
        : "planner offline · words parsed";
  const draw = useCallback((ctx: CanvasRenderingContext2D) => paintSteps(ctx, layers), [layers]);
  return (
    <article className="el-rise relative bg-card px-frame px-drop" aria-label="Route card proposal">
      <header className="flex items-center justify-between gap-3 border-b-2 border-rule bg-paper-2 px-3 py-1.5">
        <span className="font-tag text-[11px] uppercase text-ink">Route card · draft</span>
        <span className="flex items-center gap-1.5 font-tag text-[11px] uppercase text-ink-2">
          <Blaze grade={sketch.grade} size={12} /> T{sketch.grade}
        </span>
      </header>
      <div className="grid gap-4 px-3 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end sm:gap-6">
        <div className="min-w-0">
          <p className="break-words font-display text-[18px] font-bold leading-snug text-ink">“{sentence}”</p>
          <p className="mt-2 font-mono text-[11px] text-ink-3" aria-live="polite">
            {status}
          </p>
        </div>
        <figure className="m-0 flex flex-col items-center gap-1.5">
          <PixelCanvas width={W} height={H} scale={2} draw={draw} redrawKey={layers.join("|")} label={`The route climbs ${layers.map((layer) => LAYER_NAME[layer]).join(", then ")}`} />
          <figcaption className="flex gap-3 font-tag text-[10px] uppercase">
            {layers.map((layer) => (
              <span key={layer} className={cx(TONE[layer])}>
                {LAYER_NAME[layer]}
              </span>
            ))}
          </figcaption>
        </figure>
      </div>
      <footer className="flex flex-wrap items-center gap-x-6 gap-y-3 border-t-2 border-dashed border-rule px-3 py-3">
        <Button variant="primary" size="sm" grade={sketch.grade} onClick={onOpen}>
          Open the route card ▸
        </Button>
        <span className="font-mono text-[11px] text-ink-3">each step quoted · Rule Book checked · you sign</span>
      </footer>
    </article>
  );
}
