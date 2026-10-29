import type { PortfolioHistory, PortfolioSnapshot } from "@elyia/core/api/portfolio";
import React, { useMemo, useState } from "react";

import { navigate } from "../../../app/routes/history";
import { routeHref } from "../../../app/routes/routeTable";
import { intentHref } from "../../../oracle/preview";
import { Button } from "../../../ui/Button";
import { cx, FOCUS_RING } from "../../../ui/cx";
import { Dialog } from "../../../ui/Dialog";
import { SegmentedControl } from "../../../ui/SegmentedControl";
import { toast } from "../../../ui/toast";
import { amount, pct, usdFull, usdShort } from "../range/format";
import {
  descentRadar,
  dustLines,
  gasCamps,
  layerSplit,
  LAYER_NAME,
  LAYERS,
  NETWORK_NAME,
  rebalanceMoves,
  REBALANCE_TARGETS,
  timelineCsv,
  type RebalancePreset,
} from "../range/model";
import { WatchField } from "./WatchField";

type Job = "rebalance" | "dust" | "gas" | "descent" | null;

const TONE = { floor: "text-floor", ridge: "text-ridge", summit: "text-summit-ink" } as const;
const FILL = { floor: "bg-floor", ridge: "bg-ridge", summit: "bg-summit" } as const;

function JobCard({ title, status, tone, onClick }: { readonly title: string; readonly status: React.ReactNode; readonly tone?: "warn" | "ok"; readonly onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        "group flex min-h-[86px] flex-col items-start justify-between gap-2 border-2 border-rule bg-card p-3.5 text-left shadow-hard transition-[transform,box-shadow] duration-fast hover:-translate-x-px hover:-translate-y-px hover:shadow-hard-lg active:translate-x-[3px] active:translate-y-[3px] active:shadow-none",
        FOCUS_RING,
      )}
    >
      <span className="flex w-full items-center justify-between gap-2 text-[15px] font-bold uppercase leading-tight tracking-[0.02em] text-ink">
        {title}
        <span aria-hidden="true" className="text-ink-3 transition-transform duration-fast group-hover:translate-x-0.5">
          →
        </span>
      </span>
      <span className={cx("font-mono text-xs leading-snug", tone === "warn" ? "text-warn-ink" : "text-ink-2")}>{status}</span>
    </button>
  );
}

function plan(sentence: string) {
  navigate(intentHref(sentence));
}

export interface JobsProps {
  readonly snapshot: PortfolioSnapshot;
  readonly history: PortfolioHistory | null;
  readonly sample: boolean;
  readonly now: number;
  readonly className?: string;
}

/**
 * One-tap jobs: rebalance to a target, sweep dust, gas at every camp, the
 * descent radar, watch any range, and the CSV of the timeline. Each card
 * says its state in one line; tapping it opens the job with the exact
 * sentence the planner will receive. Nothing signs here.
 */
export function Jobs({ snapshot, history, sample, now, className }: JobsProps) {
  const [job, setJob] = useState<Job>(null);
  const [preset, setPreset] = useState<RebalancePreset>("thirds");
  const split = useMemo(() => layerSplit(snapshot), [snapshot]);
  const moves = useMemo(() => rebalanceMoves(split, REBALANCE_TARGETS[preset]), [split, preset]);
  const dust = useMemo(() => dustLines(snapshot), [snapshot]);
  const dustUsd = dust.reduce((sum, line) => sum + line.usd, 0);
  const gas = useMemo(() => gasCamps(snapshot), [snapshot]);
  const thirsty = gas.filter((camp) => camp.state === "low" || camp.state === "empty");
  const radar = useMemo(() => descentRadar(snapshot, history, now), [snapshot, history, now]);
  const drift = moves.reduce((sum, move) => sum + move.usd, 0);

  const downloadCsv = () => {
    const timeline = history?.timeline ?? [];
    if (timeline.length === 0) {
      toast.info("Nothing in the register yet", { description: "Fills, funding and transfers appear here as they happen." });
      return;
    }
    const blob = new Blob([timelineCsv(timeline)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `elyia-range-${sample ? "sample" : snapshot.address.slice(0, 10)}-${new Date(now).toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 2_000);
    toast.success(`Saved ${timeline.length} register lines`, { description: "UTC times, one row per event." });
  };

  return (
    <section id="jobs" className={cx("scroll-mt-28", className)} aria-label="One-tap jobs">
      <p className="caption">
        <span className="!text-ink">One-tap jobs</span> · each opens a route card, you sign
      </p>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <JobCard title="Rebalance to target" status={drift > 1 ? `${usdShort(drift)} off a three-way split · ${moves.length} move${moves.length === 1 ? "" : "s"}` : "On target"} onClick={() => setJob("rebalance")} />
        <JobCard title="Sweep dust" status={dust.length > 0 ? `${dust.length} token${dust.length === 1 ? "" : "s"} · ${usdFull(dustUsd)} → USDC` : "No dust on any layer"} onClick={() => setJob("dust")} />
        <JobCard
          title="Gas at every camp"
          tone={thirsty.length > 0 ? "warn" : "ok"}
          status={thirsty.length > 0 ? `${thirsty.map((camp) => LAYER_NAME[camp.layer]).join(" + ")} low on HYPE` : gas.some((camp) => camp.state === "unknown") ? "Some camps not read" : "Every camp has HYPE for gas"}
          onClick={() => setJob("gas")}
        />
        <JobCard title="Descent radar" status={radar.length > 0 ? `${radar.length} on the way down` : "Nothing on the way down"} onClick={() => setJob("descent")} />
      </div>
      <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-start">
        <WatchField hrefFor={(address) => routeHref("portfolio", { address })} className="min-w-0 flex-1" />
        <Button variant="ink" size="md" className="h-11 shrink-0" onClick={downloadCsv} aria-label="Download the timeline as CSV">
          CSV ↓
        </Button>
      </div>

      <Dialog
        open={job === "rebalance"}
        onClose={() => setJob(null)}
        title="Rebalance to target"
        description="Moves USDC between the layers until each holds its share. The planner picks the bridges; you sign every step."
        footer={
          <>
            <Button variant="ghost" onClick={() => setJob(null)}>
              Close
            </Button>
            <Button variant="primary" grade={2} disabled={moves.length === 0} onClick={() => plan(moves.map((move) => move.sentence).join(" and "))}>
              Plan {moves.length} move{moves.length === 1 ? "" : "s"} ▸
            </Button>
          </>
        }
      >
        <SegmentedControl
          label="Target mix"
          value={preset}
          onChange={setPreset}
          fullWidth
          options={[
            { value: "thirds", label: "Even thirds" },
            { value: "floor-heavy", label: "Trader 60/20/20" },
            { value: "summit-heavy", label: "Summit 30/20/50" },
          ]}
        />
        <ul className="mt-4 flex flex-col gap-3">
          {split.map((entry) => {
            const target = REBALANCE_TARGETS[preset][entry.layer];
            return (
              <li key={entry.layer} className="grid grid-cols-[5.5rem_minmax(0,1fr)_7rem] items-center gap-3 text-sm">
                <span className={cx("font-bold tracking-[0.04em]", TONE[entry.layer])}>{LAYER_NAME[entry.layer]}</span>
                <span className="relative h-4 border-1.5 border-rule bg-paper-2/60" aria-hidden="true">
                  <span className={cx("absolute inset-y-0 left-0", FILL[entry.layer])} style={{ width: `${entry.share * 100}%` }} />
                  <span className="absolute inset-y-[-4px] w-0.5 bg-ink" style={{ left: `${target * 100}%` }} />
                </span>
                <span className="tnum text-right font-mono text-xs text-ink-2">
                  {pct(entry.share)} → <span className="text-ink">{pct(target)}</span>
                </span>
              </li>
            );
          })}
        </ul>
        <ol className="mt-5 flex flex-col divide-y divide-rule/15 border-y-1.5 border-rule">
          {moves.length === 0 ? <li className="py-2.5 text-sm text-ink-2">Already on target. Nothing to move.</li> : null}
          {moves.map((move, index) => (
            <li key={`${move.from}-${move.to}`} className="flex items-baseline gap-3 py-2.5 text-sm">
              <span className="font-mono text-xs text-ink-3">W{index + 1}</span>
              <span className="min-w-0 flex-1 text-ink">
                {usdFull(move.usd)} USDC <span className={TONE[move.from]}>{LAYER_NAME[move.from]}</span> → <span className={TONE[move.to]}>{LAYER_NAME[move.to]}</span>
              </span>
              <span className="font-mono text-[11px] text-ink-3">“{move.sentence}”</span>
            </li>
          ))}
        </ol>
      </Dialog>

      <Dialog
        open={job === "dust"}
        onClose={() => setJob(null)}
        title="Sweep dust"
        description="Small balances you will never trade, swapped to USDC on the Floor in one route."
        footer={
          <>
            <Button variant="ghost" onClick={() => setJob(null)}>
              Close
            </Button>
            <Button variant="primary" grade={1} disabled={dust.length === 0} onClick={() => plan(`sell ${dust.map((line) => `${amount(Number(line.amount))} ${line.asset}`).join(", ")} to USDC`)}>
              Sweep {dust.length} to USDC ▸
            </Button>
          </>
        }
      >
        {dust.length === 0 ? (
          <p className="text-sm text-ink-2">No dust: every token you hold is worth at least $5.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-rule/15 border-y-1.5 border-rule">
            {dust.map((line) => (
              <li key={line.id} className="flex items-baseline justify-between gap-3 py-2 text-sm">
                <span className="text-ink">
                  <span className="font-bold">{line.asset}</span> <span className={cx("font-mono text-[11px]", TONE[line.layer])}>{LAYER_NAME[line.layer]}</span>
                </span>
                <span className="tnum font-mono text-xs text-ink-2">
                  {amount(Number(line.amount))} · {usdFull(line.usd)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Dialog>

      <Dialog
        open={job === "gas"}
        onClose={() => setJob(null)}
        title="Gas at every camp"
        description={`HyperCore needs no gas. HyperEVM and Elysium pay in HYPE; under ${0.05} HYPE a camp is low.`}
        footer={
          <Button variant="ghost" onClick={() => setJob(null)}>
            Close
          </Button>
        }
      >
        <ul className="flex flex-col gap-2.5">
          {LAYERS.map((layer) => {
            const camp = gas.find((entry) => entry.layer === layer)!;
            return (
              <li key={layer} className="flex flex-wrap items-center justify-between gap-3 border-2 border-rule bg-card px-3 py-2.5">
                <span className="text-sm">
                  <span className={cx("font-bold", TONE[layer])}>{LAYER_NAME[layer]}</span> <span className="text-ink-2">· {NETWORK_NAME[layer]}</span>
                </span>
                <span className="tnum font-mono text-xs text-ink">
                  {camp.state === "none-needed" ? "no gas needed" : camp.state === "unknown" ? "not read" : `${amount(camp.hype)} HYPE`}
                  {camp.state === "low" || camp.state === "empty" ? <span className="ml-2 font-semibold text-warn-ink">{camp.state === "empty" ? "EMPTY" : "LOW"}</span> : camp.state === "ok" ? <span className="ml-2 text-up">✓</span> : null}
                </span>
                {camp.sentence ? (
                  <Button variant="signpost" size="sm" onClick={() => plan(camp.sentence as string)}>
                    Top up 0.3 HYPE
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      </Dialog>

      <Dialog
        open={job === "descent"}
        onClose={() => setJob(null)}
        title="Descent radar"
        description="What is on its way down or waiting at a hut: unstaking queues, vault lock-ups, recent withdrawals. Elysium withdrawals take the long trail (about 5.5 days on mainnet)."
        footer={
          <Button variant="ghost" onClick={() => setJob(null)}>
            Close
          </Button>
        }
      >
        {radar.length === 0 ? (
          <p className="text-sm text-ink-2">Nothing on the way down. Withdrawals you start show here until they land.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-rule/15 border-y-1.5 border-rule">
            {radar.map((item) => (
              <li key={item.id} className="flex flex-wrap items-baseline justify-between gap-3 py-2.5 text-sm">
                <span className="text-ink">
                  <span className={cx("mr-2 font-mono text-[11px] font-semibold", TONE[item.layer])}>{LAYER_NAME[item.layer]}</span>
                  {item.what}
                </span>
                <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-2">
                  {item.state.replace(/-/gu, " ")}
                  {item.when ? ` · ${item.when}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Dialog>
    </section>
  );
}
