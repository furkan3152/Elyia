import type { NetworkEnvironment } from "@elyia/core/networks";
import { useState } from "react";
import { useAccount } from "wagmi";

import { useSearchParam } from "../../app/routes/useRoute";
import { Page } from "../../app/shell/Page";
import { useUiStore } from "../../app/state/uiStore";
import { Reveal } from "../../motion/Reveal";
import { SignpostCluster } from "../../topo/Signpost";
import { cx } from "../../ui/cx";
import { NumberField } from "../../ui/NumberInput";
import { SegmentedControl } from "../../ui/SegmentedControl";
import { FlowCard } from "../track/flow/FlowCard";
import { formatEta } from "../track/flow/routeModel";
import { useDebounced, useFlowPlan, type FlowAsk } from "../track/flow/useFlowPlan";
import { useFlowRun } from "../track/flow/useFlowRun";
import { usePacks } from "../track/flow/usePacks";
import { AscentSection } from "./AscentSection";
import { DescentClock, TicketWatch } from "./Facts";
import { laneAction, laneAsset, laneBalance, laneById, LANES, laneSentence, type BridgeAsset, type LaneId } from "./lanes";

const LAYER_WORD = { floor: "Floor", ridge: "Ridge", summit: "Summit" } as const;
function bridgeAsk(laneId: LaneId, asset: BridgeAsset, amount: string, mode: NetworkEnvironment): FlowAsk | null {
  const lane = laneById(laneId);
  if (!lane || !/^\d*\.?\d+$/u.test(amount) || Number(amount) <= 0) return null;
  return { key: `${lane.id}:${asset}:${amount}`, sentence: laneSentence(lane, asset, amount), grade: lane.grade, actions: [laneAction(lane, asset, amount, mode)] };
}

function decimalText(value: number, decimals: number): string {
  const factor = 10 ** decimals;
  return (Math.floor(value * factor) / factor).toFixed(decimals).replace(/\.?0+$/u, "");
}

/**
 * "/app/bridge": ascent and descent. The range cut open (every lane between
 * Floor, Ridge and Summit with its real time), a signpost per lane, your
 * pack at the starting camp, and the route card the planner draws: quote
 * bound, Rule Book checked, signed step by step, stamped as it settles.
 * The facts that matter sit beside it: the ticket watch and the descent clock.
 */
export default function BridgePage() {
  const mode = useUiStore((state) => state.mode);
  const { address } = useAccount();
  const packs = usePacks(address);
  const initialLane = laneById(useSearchParam("lane"))?.id ?? "up-summit";
  const initialAsset = (useSearchParam("asset") ?? "").toUpperCase() === "USDC" ? "USDC" : "HYPE";
  const initialAmount = useSearchParam("amount") ?? "";
  const [laneId, setLaneId] = useState<LaneId>(initialLane);
  const [wanted, setWanted] = useState<BridgeAsset>(initialAsset);
  const [amount, setAmount] = useState(/^\d+(\.\d+)?$/u.test(initialAmount) ? initialAmount : "");
  const lane = laneById(laneId)!;
  const asset = laneAsset(lane, wanted);
  const balance = laneBalance(lane, asset, packs);
  const settledAmount = useDebounced(amount);

  const ask = bridgeAsk(lane.id, asset, settledAmount, mode);
  const plan = useFlowPlan(ask, address ?? null);
  const run = useFlowRun(ask, plan.data ?? null);

  const choose = (next: LaneId) => {
    setLaneId(next);
    run.reset();
  };

  const eta = formatEta(lane.seconds(asset));
  return (
    <Page className="pb-16">
      <section className="max-w-[1040px] pb-8 pt-4 sm:pt-10" aria-labelledby="bridge-title">
        <p className="label-tab mb-5">Sheet 04 · Ascent and descent · {mode === "testnet" ? "practice wall" : "mainnet"}</p>
        <h1 id="bridge-title" className="text-[44px] font-bold leading-[0.98] tracking-[-0.03em] text-ink sm:text-[72px]">
          Move between
          <br className="hidden sm:block" /> the layers.
        </h1>
        <p className="mt-4 max-w-2xl text-[17px] leading-relaxed text-ink-2 sm:text-[19px]">Up to the Summit by cable car, down the long trail, across to the Floor in seconds. You sign every step; Elyia watches the ticket until it lands.</p>
      </section>

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-12 xl:gap-8">
        <AscentSection className="lg:col-span-7" selected={lane.id} onSelect={choose} asset={asset} packs={packs} />

        <section className="flex flex-col gap-5 border-2 border-rule bg-card p-4 shadow-hard-lg sm:p-5 lg:col-span-5" aria-labelledby="bridge-ticket">
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="bridge-ticket" className="caption">
              Junction · {LANES.length} lanes · you sign
            </h2>
            <span className="caption !text-ink-3">grade T{lane.grade}</span>
          </div>
          <SignpostCluster
            label="Bridge lanes"
            blades={LANES.map((item) => ({
              destination: (
                <>
                  {item.title}
                  {item.id === lane.id ? <span className="sr-only"> (chosen)</span> : null}
                </>
              ),
              eta: formatEta(item.seconds(laneAsset(item, asset))),
              grade: item.grade,
              highlight: item.id === lane.id,
              chosen: item.id === lane.id,
              detail: `${LAYER_WORD[item.from]}${item.from === item.to ? "" : ` → ${LAYER_WORD[item.to]}`} · ${item.carrier} · ${item.assets.join(", ")}`,
              onClick: () => choose(item.id),
            }))}
          />
          <div className="flex flex-col gap-4 border-t-2 border-dashed border-rule/50 pt-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <SegmentedControl
                label="Asset"
                value={asset}
                onChange={(next) => setWanted(next)}
                options={(["HYPE", "USDC"] as const).map((value) => ({ value, label: value, disabled: !lane.assets.includes(value) }))}
              />
              <p className="tnum font-mono text-xs text-ink-2">
                {balance !== null ? (
                  <>
                    at the {LAYER_WORD[lane.from]}
                    {lane.id === "to-spot" ? " (perps)" : lane.from === "floor" ? " (spot)" : ""}: <span className="font-semibold text-ink">{decimalText(balance, asset === "HYPE" ? 4 : 2)}</span> {asset}
                  </>
                ) : address ? (
                  "reading your pack…"
                ) : (
                  "connect to read your pack"
                )}
              </p>
            </div>
            <NumberField
              label={`Amount · ${lane.title.toLowerCase()}`}
              value={amount}
              onChange={(next) => {
                setAmount(next);
                run.reset();
              }}
              decimals={asset === "HYPE" ? 18 : 6}
              max={balance !== null && balance > 0 ? decimalText(balance, asset === "HYPE" ? 6 : 2) : undefined}
              unit={asset}
              placeholder={asset === "HYPE" ? "0.5" : "25"}
              hint={lane.how(asset)}
            />
            <dl className="grid grid-cols-3 border-2 border-rule text-center">
              {[
                ["Time", eta],
                ["Signatures", String(lane.signatures(asset))],
                ["Mainnet", lane.mainnetSeconds ? formatEta(lane.mainnetSeconds) : eta],
              ].map(([term, value], index) => (
                <div key={term} className={cx("px-2 py-2", index > 0 && "border-l-2 border-rule")}>
                  <dt className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">{term}</dt>
                  <dd className="tnum mt-0.5 font-mono text-[15px] font-semibold text-ink">{value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>
      </div>

      <section className="mt-10" aria-label="Route card">
        <FlowCard
          ask={ask}
          plan={plan.data}
          planning={plan.isFetching}
          updatedAt={plan.dataUpdatedAt}
          run={run}
          fineprint={lane.id === "down-ridge" ? "The claim opens after the confirm period; Elyia keeps the journey on the track page." : lane.id === "up-summit" && asset === "USDC" ? "ERC-20 deposits ride a retryable ticket: Elyia watches it and asks once if it stalls." : undefined}
          empty={
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-2 border-dashed border-rule/60 px-5 py-6">
              <p className="font-mono text-[15px] text-ink-2">“{laneSentence(lane, asset, "")}”</p>
              <p className="text-[15px] text-ink-2">Enter an amount and the Guide surveys the route: steps, fees, the Rule Book and the quote, before anything signs.</p>
            </div>
          }
        />
      </section>

      <Reveal className="mt-10 grid grid-cols-1 items-start gap-6 lg:grid-cols-12 xl:gap-8">
        <TicketWatch className="lg:col-span-7" />
        <DescentClock mode={mode} className="lg:col-span-5" />
      </Reveal>
    </Page>
  );
}
