import type { CreateIntentResponse } from "@elyia/core/api/intents";
import { useQuery } from "@tanstack/react-query";

import { useUiStore } from "../../../app/state/uiStore";
import { ApiError, apiPost } from "../../../lib/api";
import { Blaze } from "../../../topo/Blaze";
import { Button } from "../../../ui/Button";
import { cx } from "../../../ui/cx";
import { sketchRoute } from "../../deck/routesLog";
import { LAYER_NAME } from "../../portfolio/range/model";

const TONE = { floor: "text-floor", ridge: "text-ridge", summit: "text-summit-ink" } as const;
const BAR = { floor: "bg-floor", ridge: "bg-ridge", summit: "bg-summit" } as const;
const HEIGHT = { floor: "h-3", ridge: "h-6", summit: "h-9" } as const;

/**
 * A route sentence the Guide handed to the planner: a laminated stub with
 * the layers it climbs and its grade, the planner's answer (waypoints, or
 * why it is offline), and the way to the full route card where each step
 * is quoted and signed.
 */
export function RouteProposal({ sentence, onOpen }: { readonly sentence: string; readonly onOpen: () => void }) {
  const mode = useUiStore((state) => state.mode);
  const sketch = sketchRoute(sentence);
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
  return (
    <article className="el-rise relative border-2 border-rule bg-card shadow-hard" aria-label="Route card proposal">
      <header className="flex items-center justify-between gap-3 border-b-2 border-dashed border-rule px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-2">
        <span className="text-ink">Route card · draft</span>
        <span className="flex items-center gap-1.5">
          <Blaze grade={sketch.grade} size={12} /> T{sketch.grade}
        </span>
      </header>
      <div className="grid gap-4 px-3 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <div className="min-w-0">
          <p className="break-words font-mono text-[15px] leading-snug text-ink">“{sentence}”</p>
          <p className="mt-2 font-mono text-[11px] text-ink-3" aria-live="polite">
            {status}
          </p>
        </div>
        <ol className="flex items-end gap-1" aria-label="Layers the route climbs">
          {sketch.layers.map((layer) => (
            <li key={layer} className="flex flex-col items-center gap-1">
              <span aria-hidden="true" className={cx("w-10 border-2 border-rule", BAR[layer], HEIGHT[layer])} />
              <span className={cx("font-mono text-[10px] font-semibold tracking-[0.1em]", TONE[layer])}>{LAYER_NAME[layer]}</span>
            </li>
          ))}
        </ol>
      </div>
      <footer className="el-perf-h flex flex-wrap items-center gap-2 px-3 py-2.5">
        <Button variant="primary" size="sm" grade={sketch.grade} onClick={onOpen}>
          Open the route card ▸
        </Button>
        <span className="font-mono text-[11px] text-ink-3">each step quoted · Rule Book checked · you sign</span>
      </footer>
    </article>
  );
}
