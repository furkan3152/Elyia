import { ConnectButton } from "@rainbow-me/rainbowkit";
import { explorerTxUrl, NETWORKS } from "@elyia/core/networks";
import React from "react";
import { useAccount } from "wagmi";

import { routeHref } from "../../../app/routes/routeTable";
import { Blaze } from "../../../topo/Blaze";
import { RouteCard, type RouteEvidence } from "../../../topo/RouteCard";
import { Button, ButtonLink } from "../../../ui/Button";
import { cx } from "../../../ui/cx";
import { Skeleton } from "../../../ui/Skeleton";
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
    <p className={cx("mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] uppercase tracking-[0.12em]", offline ? "text-warn-ink" : "text-ink-2")}>
      <span className={cx("border-2 border-rule px-2 py-0.5 font-semibold shadow-hard-sm", offline ? "bg-warn/25 text-ink" : "bg-card text-ink")}>{offline ? "Planner offline" : "Elyia planner"}</span>
      <span>{offline ? "planned in your browser · simple moves only" : "dry run · nothing stored · nothing signed"}</span>
    </p>
  );
}

/**
 * A flow's route card with its one action: plan state (surveying, refused,
 * offline), the card itself, the sign button for the next step, what was
 * proven, and the trail notes (planner warnings) in plain words.
 */
export function FlowCard({ ask, plan, planning, updatedAt, run, empty, fineprint, className }: FlowCardProps) {
  const { isConnected } = useAccount();
  if (!ask) return <div className={className}>{empty}</div>;
  if (!plan) {
    return (
      <div className={cx("border-2 border-rule bg-card p-5 shadow-hard-lg", className)} aria-busy="true" aria-live="polite">
        <p className="caption">Route card · surveying</p>
        <p className="mt-2 font-mono text-[15px] text-ink">“{ask.sentence}”</p>
        <Skeleton className="mt-4 h-40 w-full" />
        <p className="mt-3 text-sm text-ink-2">The Guide is surveying the route…</p>
      </div>
    );
  }
  if (plan.kind === "refused") {
    return (
      <div className={cx("relative border-2 border-rule bg-card shadow-hard-lg", className)} role="status">
        <header className="flex items-center justify-between gap-3 border-b-2 border-dashed border-rule px-4 py-2.5 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-2">
          <span className="text-ink">Route card · {plan.offline ? "planner offline" : "no route"}</span>
          <span className="flex items-center gap-2">
            <Blaze grade={ask.grade} size={13} /> T{ask.grade}
          </span>
        </header>
        <div className="p-4 sm:p-5">
          <p className="font-mono text-[15px] text-ink">“{ask.sentence}”</p>
          <p className="mt-3 flex gap-3 text-[15px] leading-snug text-ink">
            <span aria-hidden="true" className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center border-2 border-rule bg-warn font-bold text-ink">!</span>
            <span>{plan.message}</span>
          </p>
          <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.1em] text-ink-3">{plan.code.replace(/_/gu, " ")}</p>
        </div>
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
      <Button variant="primary" size="lg" fullWidth grade={route.grade} loading={run.busy} disabled={blocked || !next || planning} onClick={() => void run.start()}>
        {next ? `Sign ${next.id} · ${next.action}` : "Waiting on the chain"}
      </Button>
      {run.journeyId ? (
        <ButtonLink to={routeHref("track", { id: run.journeyId })} variant="ghost" size="sm" fullWidth>
          Follow on the track page →
        </ButtonLink>
      ) : null}
    </>
  );

  return (
    <div className={className}>
      <SourceStrip plan={plan} />
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
        evidence={evidence}
        action={action}
        note={
          <span aria-live="polite">
            {run.error ? <span className="block font-semibold text-down">{run.error}</span> : null}
            {fineprint}
          </span>
        }
      />
      {route.warnings.length > 0 ? (
        <ul className="mt-4 flex flex-col gap-1.5" aria-label="Trail notes">
          {route.warnings.map((warning) => (
            <li key={warning} className="flex gap-2.5 text-[13px] leading-snug text-ink-2">
              <span aria-hidden="true" className="mt-[3px] h-3 w-3 shrink-0 rotate-45 border-1.5 border-rule bg-warn" />
              <span>{warning}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
