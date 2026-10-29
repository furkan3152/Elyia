import type { IntentGraph } from "@elyia/core/intent";
import type { Journey } from "@elyia/core/journey";
import { explorerTxUrl } from "@elyia/core/networks";
import { parseReference } from "@elyia/core/references";
import { useQuery } from "@tanstack/react-query";

import { ApiError, apiGet } from "../../lib/api";
import { RouteCard, type RouteEvidence } from "../../topo/RouteCard";
import { Skeleton } from "../../ui/Skeleton";
import { routeFromIntent } from "./flow/routeModel";
import { StageStrip } from "./TraceView";
import type { Stage } from "./traceRoute";

const PHASE_STAGE: Readonly<Record<string, Stage["state"]>> = { done: "done", skipped: "done", "in-flight": "now", "your-turn": "now", waiting: "todo", failed: "alert", review: "alert", stopped: "alert" };

/**
 * A planner journey (`/app/track/int_…`): the stored intent and the journey
 * the planner verifies from chain, refreshed while anything is in flight.
 */
export function IntentView({ id }: { readonly id: string }) {
  const intent = useQuery({ queryKey: ["intent", id], queryFn: ({ signal }) => apiGet<IntentGraph>(`/v1/intents/${id}`, { signal }), refetchInterval: 5_000, retry: 0 });
  const journey = useQuery({ queryKey: ["intent", id, "journey"], queryFn: ({ signal }) => apiGet<Journey>(`/v1/intents/${id}/journey`, { signal }), refetchInterval: (query) => (query.state.data?.next === "none" ? false : 3_000), retry: 0 });

  if (intent.error || journey.error) {
    const error = (intent.error ?? journey.error) as unknown;
    const offline = error instanceof ApiError && (error.code === "NETWORK_ERROR" || error.code === "TIMEOUT");
    return (
      <div className="border-2 border-rule bg-card p-5 shadow-hard-lg" role="status">
        <p className="caption">Journey · {id.slice(0, 12)}…</p>
        <h2 className="mt-2 text-[28px] font-bold tracking-[-0.02em] text-ink">{offline ? "The planner is offline" : "Not found on this planner"}</h2>
        <p className="mt-1.5 max-w-2xl text-[15px] text-ink-2">
          {offline ? "This journey lives on the Elyia planner, which is not answering. Its transactions are still on chain: paste a tx hash above to follow one directly." : error instanceof Error ? error.message : "No such journey."}
        </p>
      </div>
    );
  }
  if (!intent.data || !journey.data) {
    return <Skeleton className="h-80 w-full" />;
  }
  const route = routeFromIntent(intent.data, journey.data, 1);
  const evidence: RouteEvidence[] = intent.data.steps.flatMap((step, index) =>
    (step.references ?? []).map((reference) => {
      const parsed = parseReference(reference);
      const hash = parsed?.kind === "evm-tx" ? parsed.hash : null;
      const url = hash ? explorerTxUrl(step.network, hash) : null;
      return {
        step: `W${index + 1}`,
        proven: step.status === "settled",
        text: url ? (
          <a href={url} target="_blank" rel="noreferrer" className="underline decoration-dotted underline-offset-2 hover:text-accent">
            {reference.length > 24 ? `${reference.slice(0, 14)}…${reference.slice(-6)}` : reference}
          </a>
        ) : (
          reference
        ),
      };
    }),
  );
  const stages: Stage[] = journey.data.stops.map((stop, index) => ({ label: `W${index + 1} ${stop.title.split(" ").slice(0, 3).join(" ")}`, state: PHASE_STAGE[stop.phase] ?? "todo" }));
  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="caption">Journey · {journey.data.done} of {journey.data.total} settled · verified by the planner</p>
        <h2 className="mt-1.5 text-[32px] font-bold leading-tight tracking-[-0.02em] text-ink">{journey.data.next === "none" ? "Journey complete" : journey.data.next === "sign" ? "Your turn to sign" : journey.data.next === "review" ? "Needs a look" : "Climbing"}</h2>
      </div>
      <StageStrip stages={stages} />
      <RouteCard className="grid-cols-[minmax(0,1fr)]" id={route.id} sentence={route.sentence} grade={route.grade} steps={route.steps} fees={route.fees} signatures={route.signatures} rules={route.rules} binding={route.binding} evidence={evidence} note="Sign the next step from the page that planned it; this page follows." />
    </div>
  );
}
