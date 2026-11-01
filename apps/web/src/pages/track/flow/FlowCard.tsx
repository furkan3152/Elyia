import { ConnectButton } from "@rainbow-me/rainbowkit";
import { explorerTxUrl, NETWORKS } from "@elyia/core/networks";
import React, { useState } from "react";
import { useAccount } from "wagmi";

import { routeHref } from "../../../app/routes/routeTable";
import { Ely } from "../../../pixel/Ely";
import { ElyLoader } from "../../../pixel/ElyLoader";
import { PixelStamp } from "../../../pixel/PixelStamp";
import { Blaze } from "../../../topo/Blaze";
import { RouteCard, type RouteEvidence } from "../../../topo/RouteCard";
import { Button, ButtonLink } from "../../../ui/Button";
import { cx, FOCUS_RING } from "../../../ui/cx";
import { deviationLabel, isFakePrice, type FlowQuote } from "./routeModel";
import { tagWarnings, WARNING_LABEL } from "./sentence";
import type { FlowAsk, FlowPlan } from "./useFlowPlan";
import type { FlowRun } from "./useFlowRun";

export interface FlowCardProps {
  readonly ask: FlowAsk | null;
  readonly plan: FlowPlan | undefined;
  readonly planning: boolean;
  readonly updatedAt: number;
  readonly run: FlowRun;
  /** Shown while nothing is asked yet. */
  readonly empty: React.ReactNode;
  /** Extra line under the action (pool prices, descent times). */
  readonly fineprint?: React.ReactNode;
  /** Shown when the planner asks a question first (422 INTENT_CLARIFY); the sentence route passes its clarify panel. */
  readonly clarify?: React.ReactNode;
  /** Pick an example the planner offered with a refusal. */
  readonly onExample?: (sentence: string) => void;
  readonly className?: string;
}

function shortHash(value: string): string {
  const hash = value.startsWith("0x") ? value : (value.split(":").at(-1) ?? value);
  return hash.length > 14 ? `${hash.slice(0, 8)}…${hash.slice(-4)}` : hash;
}

/** The status strip above the card: who planned it and what it means. */
function SourceStrip({ plan }: { readonly plan: FlowPlan }) {
  if (plan.kind === "refused") return null;
  const offline = plan.kind === "offline";
  return (
    <p className={cx("mb-6 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-center font-tag text-[11px] uppercase", offline ? "text-warn-ink" : "text-ink-2")}>
      <span className={cx("px-2 py-0.5 px-frame-thin", offline ? "bg-warn text-warn-on" : "bg-card text-ink")}>{offline ? "Planner offline" : "Elyia planner"}</span>
      <span>{offline ? "planned in your browser · simple moves only" : "dry run · nothing stored · nothing signed"}</span>
    </p>
  );
}

/**
 * A flow's route card with its one action: plan state (surveying, refused,
 * offline), the card itself, the sign button for the next step, what was
 * proven, and the trail notes (planner warnings) in plain words.
 */
export function FlowCard({ ask, plan, planning, updatedAt, run, empty, fineprint, clarify, onExample, className }: FlowCardProps) {
  const { isConnected } = useAccount();
  const [confirmed, setConfirmed] = useState(false);
  if (!ask) return <div className={className}>{empty}</div>;
  if (!plan) {
    return (
      <div className={cx("mx-auto flex max-w-[720px] flex-col items-center gap-4 bg-card px-6 py-8 text-center px-frame px-drop", className)} aria-busy="true" aria-live="polite">
        <p className="caption">Route card · surveying</p>
        <ElyLoader label="The Guide is surveying the route…" size="lg" />
        <p className="font-mono text-[15px] text-ink">“{ask.sentence}”</p>
      </div>
    );
  }
  if (plan.kind === "clarify") {
    return (
      <div className={cx("mx-auto flex max-w-[720px] flex-col items-center gap-4 bg-card px-6 py-8 text-center px-frame px-drop", className)} role="status">
        <p className="caption">Route card · one question first</p>
        <Ely state="talk" size={88} label="Ely asks a question" />
        <p className="font-mono text-[15px] text-ink">“{ask.sentence}”</p>
        {clarify ?? <p className="max-w-[560px] text-[15px] leading-snug text-ink text-pretty">{plan.message}</p>}
      </div>
    );
  }
  if (plan.kind === "refused") {
    return (
      <div className={cx("mx-auto flex max-w-[720px] flex-col items-center gap-4 bg-card px-6 py-8 text-center px-frame px-drop", className)} role="status">
        <p className="flex items-center gap-3 font-tag text-[11px] uppercase text-ink-2">
          Route card · {plan.offline ? "planner offline" : "no route"}
          <span className="flex items-center gap-1.5">
            <Blaze grade={ask.grade} size={13} /> T{ask.grade}
          </span>
        </p>
        <Ely state="worry" size={88} label="Ely: no safe route" />
        <p className="font-mono text-[15px] text-ink">“{ask.sentence}”</p>
        <p className="max-w-[560px] text-[15px] leading-snug text-ink text-pretty">{plan.message}</p>
        <PixelStamp state="refused" text={plan.code.replace(/_/gu, " ")} size="sm" label={null} />
        {plan.examples && plan.examples.length > 0 ? (
          <ul className="flex flex-wrap justify-center gap-3" aria-label="Sentences the planner reads">
            {plan.examples.map((example) => (
              <li key={example}>
                {onExample ? (
                  <button type="button" onClick={() => onExample(example)} className={cx("px-btn px-btn-thin px-btn-paper px-3 py-1 font-mono text-[12px] text-ink", FOCUS_RING)}>
                    {example}
                  </button>
                ) : (
                  <span className="font-mono text-[12px] text-ink-2">{example}</span>
                )}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    );
  }

  const route = plan.route;
  const steps = route.steps.map((step) => ({ ...step, state: run.states[step.stepId] ?? step.state, block: run.runs[step.stepId]?.block, time: run.runs[step.stepId]?.time }));
  const evidence: RouteEvidence[] = steps.flatMap((step) => {
    const ran = run.runs[step.stepId];
    if (!ran?.reference) return [];
    const url = ran.reference.startsWith("0x") || ran.reference.startsWith("evm:") ? explorerTxUrl(step.network, ran.reference.replace(/^evm:/u, "")) : null;
    const proven = step.state === "settled";
    return [
      {
        step: step.id,
        proven,
        text: (
          <>
            {proven ? "settled on" : "sent on"} {NETWORKS[step.network].shortName} ·{" "}
            {url ? (
              <a href={url} target="_blank" rel="noreferrer" className="underline decoration-dotted underline-offset-2 hover:text-accent">
                {shortHash(ran.reference)}
              </a>
            ) : (
              shortHash(ran.reference)
            )}
            {ran.message ? ` · ${ran.message}` : ""}
          </>
        ),
      },
    ];
  });
  const done = steps.filter((step) => step.signer !== "none" && step.state === "settled").length;
  const next = steps.find((step) => step.stepId === run.nextStepId);
  const finished = steps.every((step) => step.state === "settled");
  const blocked = route.decision === "deny";
  const mustConfirm = route.decision === "confirm" && (route.confirmations?.length ?? 0) > 0;

  const action = !isConnected ? (
    <ConnectButton.Custom>
      {({ openConnectModal, mounted }) => (
        <Button variant="primary" size="lg" fullWidth onClick={openConnectModal} disabled={!mounted}>
          Connect to sign
        </Button>
      )}
    </ConnectButton.Custom>
  ) : finished ? (
    <ButtonLink to={run.journeyId ? routeHref("track", { id: run.journeyId }) : routeHref("track")} variant="ink" size="lg" fullWidth>
      On the summit · track →
    </ButtonLink>
  ) : (
    <>
      {mustConfirm && done === 0 ? (
        <label className="flex items-start gap-3 bg-warn/20 px-3 py-2.5 text-left text-[13px] leading-snug text-ink px-frame-thin">
          <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className={cx("mt-0.5 h-4 w-4 shrink-0 accent-[rgb(var(--ink))]", FOCUS_RING)} />
          <span>
            <span className="block font-tag text-[10px] uppercase text-ink-2">The Rule Book asks you to confirm</span>
            {route.confirmations!.join(" · ")}
          </span>
        </label>
      ) : null}
      <Button variant="primary" size="lg" fullWidth grade={route.grade} loading={run.busy} disabled={blocked || !next || planning || (mustConfirm && done === 0 && !confirmed)} onClick={() => void run.start({ confirmed: mustConfirm && confirmed })}>
        {next ? `Sign ${next.id} · ${next.action}` : "Waiting on the chain"}
      </Button>
      {run.journeyId ? (
        <ButtonLink to={routeHref("track", { id: run.journeyId })} variant="ghost" size="sm" fullWidth>
          Follow on the track page →
        </ButtonLink>
      ) : null}
    </>
  );

  const climbing = steps.some((step) => step.state === "climbing") || run.busy;
  const failed = steps.some((step) => step.state === "failed");
  return (
    <div className={className}>
      <SourceStrip plan={plan} />
      {finished || climbing || failed ? (
        <div className="mb-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-3 text-center" aria-live="polite">
          <Ely state={finished ? "summit" : failed ? "worry" : "climb"} size={64} label={null} />
          {finished ? (
            <PixelStamp state="settled" text="On the summit" detail={`route ${route.id} · ${steps.length} of ${steps.length} settled`} size="lg" animate />
          ) : (
            <p className="max-w-[420px] text-left font-mono text-[14px] leading-snug text-ink">
              <span className="block font-tag text-[11px] uppercase text-ink-2">{failed ? "Stopped on the route" : "In flight"}</span>
              {failed ? "A step stopped. Nothing after it was signed; read the note and try again." : next ? `Ely is on the rope: ${next.id} · ${next.action}. The card stamps each step as the chain proves it.` : "Waiting for the chain to prove the last step."}
            </p>
          )}
        </div>
      ) : null}
      <RouteCard
        className="grid-cols-[minmax(0,1fr)]"
        id={route.id}
        sentence={route.sentence}
        grade={route.grade}
        steps={steps}
        fees={route.fees}
        signatures={{ done, needed: route.signatures.needed, note: route.signatures.note }}
        quote={route.source === "planner" ? { expiresAt: updatedAt + 30_000, boundTo: route.minimum ? `min ${route.minimum}` : "re-quoted at signing" } : undefined}
        rules={route.rules}
        binding={route.binding}
        unpriced={route.unpriced}
        evidence={evidence}
        action={action}
        note={
          <span aria-live="polite">
            {run.error ? <span className="block font-semibold text-down">{run.error}</span> : null}
            {fineprint}
          </span>
        }
      />
      {route.quotes.length > 1 || route.quotes.some((quote) => quote.deviationBps !== undefined) ? <QuoteAuction quotes={route.quotes} /> : null}
      <TrailNotes warnings={route.warnings} />
    </div>
  );
}

/** Every venue that quoted, best first: what it pays, the floor, and how far from the reference it sits. */
export function QuoteAuction({ quotes, className }: { readonly quotes: readonly FlowQuote[]; readonly className?: string }) {
  return (
    <section className={cx("mx-auto mt-8 max-w-[860px] bg-card px-frame px-drop", className)} aria-label="Venue auction">
      <h3 className="border-b-2 border-rule px-4 py-2.5 text-center font-tag text-[11px] uppercase text-ink-2">Auction · {quotes.length} quote{quotes.length === 1 ? "" : "s"} · best wins · reference = HyperCore mainnet mid</h3>
      <ol className="flex flex-col">
        {quotes.map((quote) => (
          <li key={`${quote.stepId ?? ""}-${quote.protocol}`} className={cx("grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 border-b-2 border-dashed border-rule px-4 py-2.5 last:border-b-0 sm:grid-cols-[10rem_minmax(0,1fr)_auto]", quote.winner && "bg-signal/25")}>
            <span className="truncate font-display text-[15px] font-bold text-ink">
              {quote.winner ? "▶ " : ""}
              {quote.label}
            </span>
            <span className="tnum order-3 col-span-2 font-mono text-[12px] text-ink-2 sm:order-none sm:col-span-1">
              {quote.excluded ? `not eligible: ${quote.excluded}` : `${quote.out} · min ${quote.minimum}`}
            </span>
            <span className={cx("tnum justify-self-end whitespace-nowrap font-mono text-[12px]", isFakePrice(quote.deviationBps) ? "font-semibold text-down" : "text-ink-2")}>
              {quote.deviationBps !== undefined ? deviationLabel(quote.deviationBps) : "unpriced"}
              {isFakePrice(quote.deviationBps) ? <span className="ml-2 bg-down px-1.5 py-px font-tag text-[9px] uppercase text-paper">fake price</span> : null}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Planner warnings in plain words, tagged (fake testnet price, unpriced, look-alike…), the serious ones first. */
export function TrailNotes({ warnings, className }: { readonly warnings: readonly string[]; readonly className?: string }) {
  const tagged = tagWarnings(warnings);
  if (tagged.length === 0) return null;
  const serious = tagged.some((item) => item.serious);
  return (
    <section className={cx("mx-auto mt-8 flex max-w-[860px] flex-col items-center gap-4", className)} aria-label="Trail notes">
      {serious ? <Ely state="worry" size={56} label="Ely: read these notes before signing" /> : null}
      <ul className="flex w-full flex-col gap-2">
        {tagged.map((warning) => (
          <li key={warning.text} className="flex gap-3 text-[13px] leading-snug text-ink-2">
            <span className={cx("mt-px h-fit shrink-0 px-1.5 py-px font-tag text-[9px] uppercase px-frame-thin", warning.serious ? "bg-warn text-warn-on" : "bg-paper-2 text-ink-2")}>{WARNING_LABEL[warning.tag]}</span>
            <span>{warning.text}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
