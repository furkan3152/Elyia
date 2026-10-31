import type { IntentGraph } from "@elyia/core/intent";
import type { Journey } from "@elyia/core/journey";
import { explorerTxUrl } from "@elyia/core/networks";
import { parseReference } from "@elyia/core/references";
import { useQuery } from "@tanstack/react-query";

import { ApiError, apiGet } from "../../lib/api";
import { RouteCard, type RouteEvidence } from "../../topo/RouteCard";
import { routeFromIntent } from "./flow/routeModel";
import { ElyLoader } from "../../pixel/ElyLoader";
import { TraceHead } from "./TraceView";
import type { Stage } from "./traceRoute";
import { TraceScene } from "./TraceScene";
import type { Station } from "./traceTrail";

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
      <div className="flex flex-col gap-8" role="status">
        <TraceScene stations={[]} idleText={offline ? "PLANNER OFFLINE" : "NOT ON THIS PLANNER"} caption={[`◆ ${id.slice(0, 12)}…`, "Elyia planner", offline ? "offline" : "not found"]} label={offline ? "The planner is offline" : "Journey not found"} />
        <TraceHead
          hash={id}
          kicker={`Journey · ${id.slice(0, 12)}…`}
          title={offline ? "The planner is offline" : "Not found on this planner"}
          detail={offline ? "This journey lives on the Elyia planner, which is not answering. Its transactions are still on chain: paste a tx hash above to follow one directly." : error instanceof Error ? error.message : "No such journey."}
        />
      </div>
    );
  }
  if (!intent.data || !journey.data) {
    return (
      <div className="flex justify-center py-10">
        <ElyLoader label="Reading the journey from the planner…" size="lg" />
      </div>
    );
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
  const stations: Station[] = journey.data.stops.map((stop, index) => {
    const step = route.steps[index];
    return { label: `W${index + 1} ${stop.title.split(" ").slice(0, 3).join(" ")}`, layer: step?.toLayer ?? step?.layer ?? "summit", state: PHASE_STAGE[stop.phase] ?? "todo" };
  });
  const title = journey.data.next === "none" ? "Journey complete" : journey.data.next === "sign" ? "Your turn to sign" : journey.data.next === "review" ? "Needs a look" : "Climbing";
  return (
    <div className="flex flex-col gap-10">
      <TraceScene
        stations={stations}
        idleText=""
        caption={[`◆ route ${route.id}`, "verified by the planner", `${journey.data.done} of ${journey.data.total} settled`]}
        label={`Journey ${route.id}: ${stations.map((station, index) => `${index + 1} ${station.label} on the ${station.layer}, ${station.state}`).join("; ")}`}
      />
      <TraceHead hash={id} kicker={`Journey · ${journey.data.done} of ${journey.data.total} settled · verified by the planner`} title={title} detail={`“${route.sentence}”`} />
      <RouteCard id={route.id} sentence={route.sentence} grade={route.grade} steps={route.steps} fees={route.fees} signatures={route.signatures} rules={route.rules} binding={route.binding} evidence={evidence} note="Sign the next step from the page that planned it; this page follows." />
    </div>
  );
}
