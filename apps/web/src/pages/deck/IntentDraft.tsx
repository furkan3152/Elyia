import type { CreateIntentResponse } from "@elyia/core/api/intents";
import type { JourneyStop } from "@elyia/core/journey";
import { useQuery } from "@tanstack/react-query";

import { navigate } from "../../app/routes/history";
import { routeHref } from "../../app/routes/routeTable";
import { useUiStore } from "../../app/state/uiStore";
import { ApiError, apiPost } from "../../lib/api";
import { IntentChips } from "../../oracle/IntentChips";
import { openOracle } from "../../oracle/oracleStore";
import { previewChips } from "../../oracle/preview";
import { Blaze } from "../../topo/Blaze";
import type { Layer } from "../../topo/geometry/relief";
import { RouteCard, type RouteStep, type RouteStepState } from "../../topo/RouteCard";
import { Button, ButtonLink } from "../../ui/Button";
import { cx } from "../../ui/cx";
import { LAYER_NAME, NETWORK_NAME } from "../portfolio/range/model";
import { sketchRoute } from "./routesLog";

const LAYER_FOR: Readonly<Record<string, Layer>> = { hypercore: "floor", hyperevm: "ridge", elysium: "summit" };
const TONE = { floor: "text-floor", ridge: "text-ridge", summit: "text-summit-ink" } as const;

function stopLayer(stop: JourneyStop): Layer {
  const family = stop.network.split("-")[0] ?? "hypercore";
  return LAYER_FOR[family] ?? "floor";
}

function stopState(stop: JourneyStop): RouteStepState {
  switch (stop.phase) {
    case "done":
      return "settled";
    case "in-flight":
      return "climbing";
    case "your-turn":
      return "next";
    case "failed":
    case "review":
    case "stopped":
      return "failed";
    default:
      return "waiting";
  }
}

/** Planner steps as route-card waypoints. */
function stepsFrom(response: CreateIntentResponse): RouteStep[] {
  return response.journey.stops.map((stop, index, stops) => {
    const layer = stopLayer(stop);
    const next = stops[index + 1];
    const toLayer = next && stopLayer(next) !== layer ? stopLayer(next) : undefined;
    return {
      id: `W${index + 1}`,
      layer,
      toLayer,
      action: stop.title,
      venue: stop.networkName,
      inOut: stop.holds.map((hold) => `${baseToDecimal(hold.expected, hold.decimals)} ${hold.symbol}`).join(" + ") || "—",
      fee: "—",
      eta: stop.eta ? new Date(stop.eta).toISOString().slice(11, 16) : "—",
      state: stopState(stop),
    };
  });
}

/** Base units to a short decimal ("11940000", 6 -> "11.94"). */
function baseToDecimal(value: string, decimals: number): string {
  if (!/^\d+$/u.test(value)) return value;
  const padded = value.padStart(decimals + 1, "0");
  const whole = padded.slice(0, padded.length - decimals);
  const fraction = decimals > 0 ? padded.slice(-decimals).replace(/0+$/u, "").slice(0, 4) : "";
  return `${BigInt(whole).toLocaleString("en-US")}${fraction ? `.${fraction}` : ""}`;
}

function routeId(sentence: string): string {
  let hash = 0;
  for (let index = 0; index < sentence.length; index += 1) hash = (hash * 31 + sentence.charCodeAt(index)) >>> 0;
  return hash.toString(16).toUpperCase().padStart(4, "0").slice(-4);
}

/**
 * A sentence handed to the deck (`/app?intent=`): the Guide asks the planner
 * for a dry run (nothing stored, nothing signed) and draws the route card.
 * When the planner cannot read the sentence yet, the card stays a draft:
 * the parsed words, the layers it climbs, the grade, and the way forward.
 */
export function IntentDraft({ sentence, account }: { readonly sentence: string; readonly account: string | null }) {
  const mode = useUiStore((state) => state.mode);
  const sketch = sketchRoute(sentence);
  const plan = useQuery({
    queryKey: ["intent-dry-run", mode, sentence, account],
    queryFn: ({ signal }) =>
      apiPost<CreateIntentResponse>(
        "/v1/intents",
        { text: sentence, accounts: account ? [`eip155:${mode === "testnet" ? 99801 : 99901}:${account}`] : [], mode, dryRun: true },
        { query: { dryRun: true }, signal, timeoutMs: 20_000 },
      ),
    retry: 0,
    staleTime: 30_000,
  });
  const id = routeId(sentence);
  const dismiss = () => navigate(`${routeHref("deck")}${account ? `?as=${account}` : ""}`, { replace: true });

  if (plan.data) {
    const steps = stepsFrom(plan.data);
    return (
      <RouteCard
        id={id}
        sentence={sentence}
        grade={sketch.grade}
        steps={steps}
        fees="quoted at signing"
        signatures={{ done: 0, needed: steps.filter((step) => step.state === "next" || step.state === "waiting").length }}
        rules={plan.data.policy.reasons.length === 0 ? ["Rule Book: allowed"] : plan.data.policy.reasons.map((reason) => reason.message)}
        binding={plan.data.policy.ruleBookHash}
        note="A dry run: nothing is stored and nothing moves until you sign each step."
        action={
          <Button variant="primary" size="lg" fullWidth grade={sketch.grade} onClick={() => openOracle(sentence)}>
            Review and sign
          </Button>
        }
      />
    );
  }

  const problem = plan.error instanceof ApiError ? plan.error : null;
  const reason =
    problem?.code === "TEXT_NOT_SUPPORTED_YET"
      ? "The planner on this server does not read whole sentences yet. Your words are parsed above; the terminal and the one-tap jobs take it from here."
      : problem?.code === "NETWORK_ERROR" || problem?.code === "TIMEOUT"
        ? "The Elyia planner is not answering. Your words are parsed above; nothing is lost."
        : problem
          ? problem.message
          : "The Guide is surveying the route…";
  const trade = /\b(long|short|buy|sell)\s+([a-z0-9]{2,10})\b/iu.exec(sentence);
  return (
    <article className="el-rise relative bg-card text-left px-frame px-drop-lg" aria-label="Route card draft">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-dashed border-rule px-4 py-2.5 font-tag text-[11px] uppercase text-ink-2">
        <span className="text-ink">Route card {id} · draft</span>
        <span className="flex items-center gap-2">
          <Blaze grade={sketch.grade} size={14} /> grade T{sketch.grade}
        </span>
      </header>
      <div className="grid gap-5 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:p-5">
        <div className="min-w-0">
          <p className="break-words font-mono text-lg leading-snug text-ink sm:text-xl">“{sentence}”</p>
          <IntentChips tokens={previewChips(sentence)} className="mt-3" />
          <p className="mt-3 max-w-2xl text-sm text-ink-2" aria-live="polite">
            {plan.isPending ? "The Guide is surveying the route…" : reason}
          </p>
        </div>
        <ol className="flex items-end gap-1.5 self-end" aria-label="Layers the route climbs">
          {sketch.layers.map((layer, index) => (
            <li key={layer} className="flex flex-col items-center gap-1">
              <span className={cx("px-frame-thin", layer === "floor" ? "h-6 bg-floor" : layer === "ridge" ? "h-10 bg-ridge" : "h-14 bg-summit", "w-12")} aria-hidden="true" />
              <span className={cx("font-tag text-[10px] uppercase", TONE[layer])}>
                {index + 1}·{LAYER_NAME[layer]}
              </span>
              <span className="sr-only">{NETWORK_NAME[layer]}</span>
            </li>
          ))}
        </ol>
      </div>
      <footer className="flex flex-wrap items-center gap-x-6 gap-y-5 border-t-2 border-dashed border-rule px-4 py-4">
        {trade ? (
          <ButtonLink to={routeHref("trade", { market: trade[2]!.toUpperCase() })} variant="primary" size="sm" grade={sketch.grade}>
            Open the {trade[2]!.toUpperCase()} terminal
          </ButtonLink>
        ) : null}
        <Button variant="ink" size="sm" onClick={() => openOracle(sentence)}>
          Edit the sentence
        </Button>
        <Button variant="ghost" size="sm" onClick={dismiss}>
          Dismiss
        </Button>
        <span className="ml-auto font-tag text-[11px] uppercase text-ink-3">dry run · nothing signs here</span>
      </footer>
    </article>
  );
}
