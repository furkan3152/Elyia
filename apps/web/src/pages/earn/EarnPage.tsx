import { layersFor, type NetworkEnvironment } from "@elyia/core/networks";
import { useState } from "react";
import { useAccount } from "wagmi";

import { useUiStore } from "../../app/state/uiStore";
import { Ely } from "../../pixel/Ely";
import { ElyLoader } from "../../pixel/ElyLoader";
import { Page, Section, Split } from "../../pixel/layout";
import { buttonClasses } from "../../ui/buttonStyles";
import { cx, FOCUS_RING } from "../../ui/cx";
import { NumberField } from "../../ui/NumberInput";
import { SegmentedControl } from "../../ui/SegmentedControl";
import { Skeleton } from "../../ui/Skeleton";
import { FlowCard } from "../track/flow/FlowCard";
import { FlowEmpty } from "../track/flow/FlowPixel";
import { sheetTag } from "../track/flow/pixelHooks";
import { KINETIQ_MIN_STAKE } from "../track/flow/localPlanner";
import { useDebounced, useFlowPlan, type FlowAsk } from "../track/flow/useFlowPlan";
import { useFlowRun } from "../track/flow/useFlowRun";
import { packFigure, usePacks } from "../track/flow/usePacks";
import { useYields } from "./useYields";
import { formatApr, formatTvl, trailScore, type YieldRow } from "./yields";
import { YieldRange } from "./YieldRange";

type Direction = "in" | "out";

/** The planner action for entering or leaving a yield the engine executes. */
function earnAsk(row: YieldRow | null, direction: Direction, amount: string, mode: NetworkEnvironment): FlowAsk | null {
  const venue = row?.venue;
  if (!row || !venue || !/^\d*\.?\d+$/u.test(amount) || Number(amount) <= 0) return null;
  const network = venue.family === "elysium" ? layersFor(mode).elysium.key : layersFor(mode).hyperevm.key;
  if (direction === "out" && venue.withdraw) {
    const unit = venue.withdraw.unit;
    return {
      key: `${venue.protocol}:out:${amount}`,
      sentence: `withdraw ${amount} ${unit} from ${row.name}`,
      grade: 2,
      actions: [{ kind: "withdraw", network, protocol: venue.protocol, amount, ...(venue.withdraw.from ? { from: venue.withdraw.from } : {}), ...(venue.withdraw.to ? { to: venue.withdraw.to } : {}) }],
    };
  }
  if (venue.verb === "stake") {
    return { key: `${venue.protocol}:stake:${amount}`, sentence: `stake ${amount} HYPE to kHYPE`, grade: 1, actions: [{ kind: "stake", network, from: "HYPE", to: "kHYPE", amount, protocol: venue.protocol }] };
  }
  return {
    key: `${venue.protocol}:in:${amount}`,
    sentence: `${venue.protocol === "elyra-lending" ? "lend" : "deposit"} ${amount} ${venue.depositAsset} ${venue.protocol === "elyra-lending" ? "on" : "into"} ${row.name}`,
    grade: 2,
    actions: [{ kind: "deposit", network, from: venue.depositAsset, amount, protocol: venue.protocol }],
  };
}

const LAYER_WORD: Readonly<Record<YieldRow["layer"], string>> = { floor: "Floor", ridge: "Ridge", summit: "Summit" };
const KIND_WORD: Readonly<Record<YieldRow["kind"], string>> = { staking: "staking", "liquid-staking": "liquid staking", vault: "vault", lending: "lending" };

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
  const [direction, setDirection] = useState<Direction>("in");
  const settled = useDebounced(amount);
  const chosen = yields.rows.find((row) => row.id === selected) ?? yields.rows[0] ?? null;
  const ask = earnAsk(chosen?.entry === "planner" ? chosen : null, chosen?.venue?.withdraw ? direction : "in", settled, mode);
  const plan = useFlowPlan(ask, address ?? null);
  const run = useFlowRun(ask, plan.data ?? null);
  const hype = packs.ridge.HYPE;
  const kinetiq = chosen?.venue?.protocol === "kinetiq";
  const max = kinetiq && hype !== null && hype > 0.01 ? String(Math.floor((hype - 0.01) * 1e6) / 1e6) : undefined;
  const unit = chosen?.venue ? (direction === "out" && chosen.venue.withdraw ? chosen.venue.withdraw.unit : chosen.venue.depositAsset) : "HYPE";
  const sourceNote = yields.vaultSource === "api" ? "vaults via the Elyia API" : yields.vaultSource === "stats-dump" ? "vaults read from the public stats dump (API offline)" : "vaults coming online";

  return (
    <Page className="!pt-0">
      <Section level={1} tag={sheetTag("06", "Earn", mode)} title="Put HYPE to work." lede="Staking and HLP on the Floor, kHYPE on the Ridge, Elyra lending, Cheshire and stKALOS on the Summit, ranked by one rule: the APR, discounted for thin pools. Rates are read live, never promised; where none is published the peak says n/a.">
        {yields.rows.length > 0 ? (
          <YieldRange rows={yields.rows} selectedId={chosen?.id ?? null} onSelect={setSelected} source={yields.vaultSource === "api" ? "live · Elyia API" : yields.vaultSource === "stats-dump" ? "live · public stats dump" : "live · vaults loading"} />
        ) : (
          <div className="flex h-[360px] items-center justify-center bg-card px-frame px-drop">
            <ElyLoader label="Surveying the yields…" size="lg" />
          </div>
        )}
        <p className="mx-auto mt-6 max-w-[860px] text-center font-mono text-[11px] leading-relaxed text-ink-3">
          {sourceNote}
          {yields.idleVaults > 0 ? ` · ${yields.idleVaults} idle vaults (0% APR) left off` : ""} · TVL of HYPE yields at the HyperCore mainnet reference{mode === "testnet" ? " · vault TVL is test USDC" : ""}
        </p>
      </Section>

      <Section id="log" tag={`Yield log · ${yields.rows.length} ranked · score = APR × TVL weight`} title="Read the peak, then climb it." lede="The log ranks every yield by the same rule. Pick one: kHYPE, Elyra lending, Cheshire and stKALOS go through a route card here; HyperCore staking and vaults open on Hyperliquid until the planner runs them, and say so.">
        <Split>
          <section className="flex flex-col bg-card px-frame px-drop" aria-labelledby="yield-log">
            <h3 id="yield-log" className="border-b-2 border-rule px-5 py-4 text-center font-display text-[22px] font-bold leading-none text-ink">
              Yield log
            </h3>
            <ol className="flex flex-col">
              {yields.rows.map((row, index) => {
                const active = row.id === chosen?.id;
                const apr = row.aprPct ?? 0;
                return (
                  <li key={row.id} className="border-b-2 border-dashed border-rule last:border-b-0">
                    <button type="button" onClick={() => {
                        setSelected(row.id);
                        setAmount("");
                        setDirection("in");
                        run.reset();
                      }} aria-pressed={active} className={cx("grid w-full grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-3 px-5 py-3 text-left", active ? "bg-signal text-signal-ink" : "text-ink hover:bg-paper-2", FOCUS_RING)}>
                      <span className="tnum font-tag text-[11px] opacity-70">{String(index + 1).padStart(2, "0")}</span>
                      <span className="min-w-0">
                        <span className="block truncate font-display text-[16px] font-bold leading-tight">{row.name}</span>
                        <span className="block truncate font-mono text-[11px] opacity-75">
                          {LAYER_WORD[row.layer]} · {KIND_WORD[row.kind]} · {row.asset} · {row.tvlNote ?? formatTvl(row.tvlUsd)}
                        </span>
                      </span>
                      <span className={cx("tnum whitespace-nowrap text-right font-mono text-[14px] font-semibold", !active && apr < 0 && "text-down")}>
                        {apr < 0 ? "▼ " : apr > 0 ? "▲ " : ""}
                        {formatApr(row.aprPct)}
                        {row.estimated ? <span className="block text-[10px] font-normal opacity-70">est.</span> : null}
                      </span>
                    </button>
                  </li>
                );
              })}
              {yields.loading && yields.rows.length < 3 ? (
                <li className="px-5 py-4">
                  <Skeleton className="h-4 w-2/3" />
                </li>
              ) : null}
            </ol>
            <p className="mt-auto border-t-2 border-dashed border-rule px-5 py-4 text-center text-[13px] leading-relaxed text-ink-2 text-pretty">
              <span className="font-semibold text-ink">How the rank works.</span> Score = APR × a TVL weight: 0 at $10k, 1 at $10M, a third per decade between. A 300% APR on $5k never outranks HLP. Losing vaults are lakes on the skyline.
            </p>
          </section>

          <section className="flex flex-col items-center gap-5 bg-card p-5 text-center px-frame px-drop sm:p-6" aria-label="Chosen yield">
            {chosen ? (
              <>
                <p className="caption">
                  Rank {yields.rows.indexOf(chosen) + 1} · score {Number.isFinite(trailScore(chosen)) ? trailScore(chosen).toFixed(2) : "—"}
                </p>
                <Ely state={(chosen.aprPct ?? 0) < 0 ? "worry" : "summit"} size={88} label={(chosen.aprPct ?? 0) < 0 ? "Ely: this vault is losing" : null} />
                <h3 className="font-display text-[30px] font-bold leading-none text-ink">{chosen.name}</h3>
                <p className="max-w-[440px] text-[14px] leading-snug text-ink-2 text-pretty">{chosen.note}</p>
                <dl className="grid w-full grid-cols-2 gap-6">
                  <div className="flex flex-col items-center gap-1 bg-paper-2 px-3 py-3 px-frame-thin">
                    <dt className="font-tag text-[10px] uppercase text-ink-2">APR{chosen.estimated ? " · est." : ""}</dt>
                    <dd className={cx("tnum font-display text-[28px] font-bold leading-none", (chosen.aprPct ?? 0) < 0 ? "text-down" : "text-ink")}>{chosen.aprPct === null ? "n/a" : formatApr(chosen.aprPct)}</dd>
                  </div>
                  <div className="flex flex-col items-center gap-1 bg-paper-2 px-3 py-3 px-frame-thin">
                    <dt className="font-tag text-[10px] uppercase text-ink-2">TVL</dt>
                    <dd className="tnum font-display text-[28px] font-bold leading-none text-ink">{chosen.tvlNote ? <span className="text-[18px]">{chosen.tvlNote}</span> : chosen.tvlUsd === null ? "n/a" : formatTvl(chosen.tvlUsd)}</dd>
                  </div>
                </dl>
                {chosen.entry === "planner" ? (
                  <div className="mt-auto flex w-full flex-col gap-3 text-left">
                    {chosen.venue?.withdraw ? (
                      <SegmentedControl
                        label="Direction"
                        fullWidth
                        value={direction}
                        onChange={(next) => {
                          setDirection(next);
                          setAmount("");
                          run.reset();
                        }}
                        options={[
                          { value: "in", label: chosen.kind === "lending" ? "Supply" : "Deposit" },
                          { value: "out", label: "Withdraw" },
                        ]}
                      />
                    ) : null}
                    <NumberField
                      label={kinetiq ? "Stake HYPE on the Ridge" : `${direction === "out" ? "Withdraw" : chosen.kind === "lending" ? "Supply" : "Deposit"} ${unit} on the ${LAYER_WORD[chosen.layer]}`}
                      value={amount}
                      onChange={(next) => {
                        setAmount(next);
                        run.reset();
                      }}
                      decimals={unit === "USDC" || unit === "cUSDC" ? 6 : unit === "stKALOS" ? 24 : 18}
                      max={max}
                      unit={unit}
                      placeholder={unit === "HYPE" ? "0.5" : "1"}
                      hint={kinetiq ? (address ? `on HyperEVM: ${packFigure(hype)} HYPE · min ${KINETIQ_MIN_STAKE}` : `connect to read your pack · min ${KINETIQ_MIN_STAKE} HYPE`) : "the planner reads the vault, checks the Rule Book and draws the route card"}
                    />
                    {chosen.estimated ? <p className="font-mono text-[11px] leading-snug text-ink-3">kHYPE earns the validator rewards above, less Kinetiq’s fee; the APR shown is the underlying rate.</p> : null}
                  </div>
                ) : (
                  <div className="mt-auto flex flex-col items-center gap-4">
                    <p className="max-w-[460px] text-[14px] leading-snug text-ink text-pretty">
                      {chosen.kind === "vault" ? "Vault deposits are a HyperCore action Elyia does not execute yet." : "Delegating on HyperCore takes two wallet signatures (to staking, then delegate); Elyia’s planner does not run them yet."} You can do it on Hyperliquid now; Elyia will plan it here when the planner does.
                    </p>
                    {chosen.href ? (
                      <a href={chosen.href} target="_blank" rel="noreferrer" className={buttonClasses({ variant: "ink", size: "md" })}>
                        Open on Hyperliquid ↗<span className="sr-only"> (opens in a new tab)</span>
                      </a>
                    ) : null}
                  </div>
                )}
              </>
            ) : (
              <div className="flex flex-1 items-center">
                <ElyLoader label="Reading the rates…" />
              </div>
            )}
          </section>
        </Split>
      </Section>

      {chosen?.entry === "planner" ? (
        <Section id="route" tag={`Route card · ${chosen.name}`} title={kinetiq ? "Stake, stamped as it lands." : "Climb it, stamped as it lands."} lede="The planner reads the venue, checks the Rule Book and draws the route card; each settled step gets its stamp from the chain.">
          <FlowCard
            ask={ask}
            plan={plan.data}
            planning={plan.isFetching}
            updatedAt={plan.dataUpdatedAt}
            run={run}
            empty={<FlowEmpty sentence={kinetiq ? "stake … HYPE to kHYPE" : `${direction === "out" ? "withdraw" : "deposit"} … ${unit} · ${chosen.name}`} help="Enter an amount: the planner reads the venue, checks the Rule Book and draws the route card." />}
          />
        </Section>
      ) : null}
    </Page>
  );
}
