import { layersFor, type NetworkEnvironment } from "@elyia/core/networks";
import { useState } from "react";
import { useAccount } from "wagmi";

import { Page } from "../../app/shell/Page";
import { useUiStore } from "../../app/state/uiStore";
import { Reveal } from "../../motion/Reveal";
import { LayerChip } from "../../ui/Badge";
import { buttonClasses } from "../../ui/buttonStyles";
import { cx } from "../../ui/cx";
import { NumberField } from "../../ui/NumberInput";
import { Skeleton } from "../../ui/Skeleton";
import { FlowCard } from "../track/flow/FlowCard";
import { KINETIQ_MIN_STAKE } from "../track/flow/localPlanner";
import { useDebounced, useFlowPlan, type FlowAsk } from "../track/flow/useFlowPlan";
import { useFlowRun } from "../track/flow/useFlowRun";
import { packFigure, usePacks } from "../track/flow/usePacks";
import { useYields } from "./useYields";
import { formatApr, formatTvl, trailScore, type YieldRow } from "./yields";
import { YieldRange } from "./YieldRange";

function stakeAsk(amount: string, mode: NetworkEnvironment): FlowAsk | null {
  if (!/^\d*\.?\d+$/u.test(amount) || Number(amount) <= 0) return null;
  return {
    key: `stake:${amount}`,
    sentence: `stake ${amount} HYPE to kHYPE`,
    grade: 1,
    actions: [{ kind: "stake", network: layersFor(mode).hyperevm.key, from: "HYPE", to: "kHYPE", amount }],
  };
}

const KIND_WORD: Readonly<Record<YieldRow["kind"], string>> = { staking: "staking", "liquid-staking": "liquid staking", vault: "vault" };

/**
 * "/app/earn": rest at the hut. Every live way to earn on HyperCore and
 * HyperEVM, ranked by one rule (APR, discounted for thin TVL) and drawn as
 * the yield range. kHYPE stakes through a route card here; HyperCore
 * staking and vault deposits open on Hyperliquid until the planner executes
 * them, and say so.
 */
export default function EarnPage() {
  const mode = useUiStore((state) => state.mode);
  const { address } = useAccount();
  const packs = usePacks(address);
  const yields = useYields();
  const [selected, setSelected] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const settled = useDebounced(amount);
  const ask = stakeAsk(settled, mode);
  const plan = useFlowPlan(ask, address ?? null);
  const run = useFlowRun(ask, plan.data ?? null);
  const chosen = yields.rows.find((row) => row.id === selected) ?? yields.rows[0] ?? null;
  const hype = packs.ridge.HYPE;
  const max = hype !== null && hype > 0.01 ? String(Math.floor((hype - 0.01) * 1e6) / 1e6) : undefined;
  const sourceNote = yields.vaultSource === "api" ? "vaults via the Elyia API" : yields.vaultSource === "stats-dump" ? "vaults read from the public stats dump (API offline)" : "vaults coming online";

  return (
    <Page className="pb-16">
      <section className="max-w-[1040px] pb-8 pt-4 sm:pt-10" aria-labelledby="earn-title">
        <p className="label-tab mb-5">Sheet 06 · Earn · {mode === "testnet" ? "practice wall" : "mainnet"}</p>
        <h1 id="earn-title" className="text-[44px] font-bold leading-[0.98] tracking-[-0.03em] text-ink sm:text-[72px]">
          Put HYPE to work.
        </h1>
        <p className="mt-4 max-w-2xl text-[17px] leading-relaxed text-ink-2 sm:text-[19px]">Staking on the Floor, kHYPE on the Ridge, HLP and the vaults worth a look, ranked by one rule: the APR, discounted for thin pools. Rates are read live, never promised.</p>
      </section>

      {yields.rows.length > 0 ? (
        <YieldRange rows={yields.rows} selectedId={chosen?.id ?? null} onSelect={setSelected} />
      ) : (
        <Skeleton className="h-[320px] w-full" />
      )}
      <p className="mt-2 font-mono text-[11px] text-ink-3">
        {sourceNote}{yields.idleVaults > 0 ? ` · ${yields.idleVaults} idle vaults (0% APR) left off` : ""} · TVL of HYPE yields at the HyperCore mainnet reference{mode === "testnet" ? " · vault TVL is test USDC" : ""}
      </p>

      <div className="mt-8 grid grid-cols-1 items-start gap-6 lg:grid-cols-12 xl:gap-8">
        <section className="border-2 border-rule bg-card shadow-hard lg:col-span-7" aria-labelledby="yield-log">
          <header className="flex flex-wrap items-baseline justify-between gap-2 border-b-2 border-rule px-4 py-2.5">
            <h2 id="yield-log" className="caption">
              Yield log · {yields.rows.length} ranked
            </h2>
            <span className="caption !text-ink-3">score = APR × TVL weight</span>
          </header>
          <div className="el-logbook relative overflow-x-auto">
            <table className="w-full border-separate border-spacing-0 text-[13px]">
              <caption className="sr-only">Yields ranked by APR discounted for thin TVL</caption>
              <thead>
                <tr className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-2">
                  {["No.", "Where", "Layer", "APR", "TVL", ""].map((heading, index) => (
                    <th key={heading || index} scope="col" className={cx("whitespace-nowrap border-b-1.5 border-rule py-2 font-medium", index === 0 ? "pl-4 pr-2 text-left" : "px-3 text-left", (index === 3 || index === 4) && "text-right")}>
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {yields.rows.map((row, index) => {
                  const active = row.id === chosen?.id;
                  return (
                    <tr key={row.id} className={cx("cursor-pointer", active && "bg-signal/35")} onClick={() => setSelected(row.id)}>
                      <td className="tnum border-b border-rule/15 py-2.5 pl-4 pr-2 font-mono text-ink-2">{String(index + 1).padStart(2, "0")}</td>
                      <td className="border-b border-rule/15 px-3 py-2.5">
                        <button type="button" className="text-left font-semibold text-ink hover:underline" onClick={() => setSelected(row.id)} aria-pressed={active}>
                          {row.name}
                        </button>
                        <span className="block font-mono text-[11px] text-ink-3">
                          {KIND_WORD[row.kind]} · {row.asset}
                        </span>
                      </td>
                      <td className="border-b border-rule/15 px-3 py-2.5">
                        <LayerChip layer={row.layer} />
                      </td>
                      <td className={cx("tnum whitespace-nowrap border-b border-rule/15 px-3 py-2.5 text-right font-mono font-semibold", (row.aprPct ?? 0) < 0 ? "text-down" : "text-ink")}>
                        {(row.aprPct ?? 0) < 0 ? "▼ " : (row.aprPct ?? 0) > 0 ? "▲ " : ""}
                        {formatApr(row.aprPct)}
                        {row.estimated ? <span className="font-normal text-ink-3"> est.</span> : null}
                      </td>
                      <td className="tnum whitespace-nowrap border-b border-rule/15 px-3 py-2.5 text-right font-mono text-ink-2">{formatTvl(row.tvlUsd)}</td>
                      <td className="whitespace-nowrap border-b border-rule/15 px-3 py-2.5 text-right font-mono text-[11px] text-ink-3">{row.entry === "planner" ? "route card" : "Hyperliquid ↗"}</td>
                    </tr>
                  );
                })}
                {yields.loading && yields.rows.length < 3 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-3">
                      <Skeleton className="h-4 w-2/3" />
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>

        <aside className="flex flex-col gap-4 lg:col-span-5" aria-label="Chosen yield">
          {chosen ? (
            <div className="border-2 border-rule bg-card p-4 shadow-hard-lg sm:p-5">
              <p className="caption">
                Rank {yields.rows.indexOf(chosen) + 1} · score {Number.isFinite(trailScore(chosen)) ? trailScore(chosen).toFixed(2) : "—"}
              </p>
              <h2 className="mt-1.5 text-[28px] font-bold leading-tight tracking-[-0.02em] text-ink">{chosen.name}</h2>
              <p className="mt-1 text-[14px] leading-snug text-ink-2">{chosen.note}</p>
              <dl className="mt-4 grid grid-cols-2 border-2 border-rule">
                <div className="px-3 py-2">
                  <dt className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">APR{chosen.estimated ? " · est." : ""}</dt>
                  <dd className="tnum font-mono text-[26px] font-semibold text-ink">{formatApr(chosen.aprPct)}</dd>
                </div>
                <div className="border-l-2 border-rule px-3 py-2">
                  <dt className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">TVL</dt>
                  <dd className="tnum font-mono text-[26px] font-semibold text-ink">{formatTvl(chosen.tvlUsd)}</dd>
                </div>
              </dl>
              {chosen.entry === "planner" ? (
                <div className="mt-4 flex flex-col gap-3">
                  <NumberField
                    label="Stake HYPE on the Ridge"
                    value={amount}
                    onChange={(next) => {
                      setAmount(next);
                      run.reset();
                    }}
                    decimals={18}
                    max={max}
                    unit="HYPE"
                    placeholder="0.5"
                    hint={address ? `on HyperEVM: ${packFigure(hype)} HYPE · min ${KINETIQ_MIN_STAKE}` : `connect to read your pack · min ${KINETIQ_MIN_STAKE} HYPE`}
                  />
                  {chosen.estimated ? <p className="font-mono text-[11px] leading-snug text-ink-3">kHYPE earns the validator rewards above, less Kinetiq’s fee; the APR shown is the underlying rate.</p> : null}
                </div>
              ) : (
                <div className="mt-4 flex flex-col gap-2">
                  <p className="text-[14px] leading-snug text-ink">
                    {chosen.kind === "vault" ? "Vault deposits are a HyperCore action Elyia does not execute yet." : "Delegating on HyperCore takes two wallet signatures (to staking, then delegate); Elyia’s planner does not run them yet."} You can do it on Hyperliquid now; Elyia will plan it here when the planner does.
                  </p>
                  {chosen.href ? (
                    <a href={chosen.href} target="_blank" rel="noreferrer" className={cx(buttonClasses({ variant: "ink", size: "md" }), "self-start")}>
                      Open on Hyperliquid ↗
                    </a>
                  ) : null}
                </div>
              )}
            </div>
          ) : (
            <Skeleton className="h-64 w-full" />
          )}
          <div className="border-2 border-dashed border-rule/60 p-4 text-[13px] leading-snug text-ink-2">
            <span className="font-semibold text-ink">How the rank works.</span> Score = APR × a TVL weight: 0 at $10k, 1 at $10M, a third per decade between. A 300% APR on $5k never outranks HLP. Losing vaults are basins on the range.
          </div>
        </aside>
      </div>

      {chosen?.entry === "planner" ? (
        <Reveal className="mt-10">
          <FlowCard
            ask={ask}
            plan={plan.data}
            planning={plan.isFetching}
            updatedAt={plan.dataUpdatedAt}
            run={run}
            empty={
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-2 border-dashed border-rule/60 px-5 py-6">
                <p className="font-mono text-[15px] text-ink-2">“stake … HYPE to kHYPE”</p>
                <p className="text-[15px] text-ink-2">Enter an amount: the planner reads Kinetiq’s rate, checks the Rule Book and draws the route card.</p>
              </div>
            }
          />
        </Reveal>
      ) : null}
    </Page>
  );
}
