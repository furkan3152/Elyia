import type { NetworkEnvironment } from "@elyia/core/networks";
import { useState } from "react";
import { useAccount } from "wagmi";

import { useSearchParam } from "../../app/routes/useRoute";
import { useUiStore } from "../../app/state/uiStore";
import { Cards, Grid, Page, Section } from "../../pixel/layout";
import type { Layer } from "../../topo/geometry/relief";
import { cx } from "../../ui/cx";
import { NumberField } from "../../ui/NumberInput";
import { SegmentedControl } from "../../ui/SegmentedControl";
import { FlowCard } from "../track/flow/FlowCard";
import { FlowEmpty } from "../track/flow/FlowPixel";
import { sheetTag, useNight } from "../track/flow/pixelHooks";
import { formatEta } from "../track/flow/routeModel";
import { useDebounced, useFlowPlan, type FlowAsk } from "../track/flow/useFlowPlan";
import { useFlowRun } from "../track/flow/useFlowRun";
import { packFigure, usePacks, type Packs } from "../track/flow/usePacks";
import { BridgeSideView } from "./BridgeSideView";
import { DescentClock, TicketWatch } from "./Facts";
import { LaneCards } from "./LaneCards";
import { laneAction, laneAsset, laneBalance, laneById, laneSentence, type BridgeAsset, type Lane, type LaneId } from "./lanes";

const LAYER_WORD = { floor: "Floor", ridge: "Ridge", summit: "Summit" } as const;
const LAYER_NET = { floor: "HyperCore", ridge: "HyperEVM", summit: "Elysium" } as const;
const LAYER_TEXT: Readonly<Record<Layer, string>> = { floor: "text-floor", ridge: "text-ridge", summit: "text-summit-ink" };

function bridgeAsk(laneId: LaneId, asset: BridgeAsset, amount: string, mode: NetworkEnvironment): FlowAsk | null {
  const lane = laneById(laneId);
  if (!lane || !/^\d*\.?\d+$/u.test(amount) || Number(amount) <= 0) return null;
  return { key: `${lane.id}:${asset}:${amount}`, sentence: laneSentence(lane, asset, amount), grade: lane.grade, actions: [laneAction(lane, asset, amount, mode)] };
}

function decimalText(value: number, decimals: number): string {
  const factor = 10 ** decimals;
  return (Math.floor(value * factor) / factor).toFixed(decimals).replace(/\.?0+$/u, "");
}

/** Your pack at each camp: three equal cards, Summit to Floor, the lane's start and end marked. */
function CampPacks({ packs, lane }: { readonly packs: Packs; readonly lane: Lane }) {
  return (
    <Grid cols={3} keep className="mt-12 !gap-x-4 sm:!gap-x-6">
      {(["summit", "ridge", "floor"] as const).map((layer) => {
        const camp = packs[layer];
        const role = lane.from === layer && lane.to === layer ? "start · end" : lane.from === layer ? "start" : lane.to === layer ? "end" : null;
        return (
          <div key={layer} className={cx("flex min-w-0 flex-col items-center gap-2 px-2 py-4 text-center px-frame px-drop sm:px-4 sm:py-5", role ? "bg-card" : "bg-paper-2")}>
            <p className="font-tag text-[10px] uppercase text-ink-2 sm:text-[11px]">
              <span className={LAYER_TEXT[layer]}>{LAYER_WORD[layer]}</span>
              <span className="hidden sm:inline"> · {LAYER_NET[layer]}</span>
            </p>
            <p className="tnum font-display text-[17px] font-bold leading-none text-ink sm:text-[24px]">{packs.address ? `${packFigure(camp.HYPE)} HYPE` : "— HYPE"}</p>
            <p className="tnum font-mono text-[11px] text-ink-2 sm:text-[13px]">
              {packs.address ? `${packFigure(camp.USDC, 2)} USDC` : "— USDC"}
              {layer === "floor" && packs.address ? ` · ${packFigure(packs.perps, 2)} perps` : ""}
            </p>
            <p className={cx("mt-1 font-tag text-[10px] uppercase", role ? "bg-signal px-2 py-0.5 text-signal-ink" : "text-ink-3")}>{role ? `lane ${role}` : "camp"}</p>
          </div>
        );
      })}
    </Grid>
  );
}

/**
 * "/app/bridge": ascent and descent. The range cut open as a pixel side
 * view (every lane between Floor, Ridge and Summit with its real time, Ely
 * travelling the chosen one), your pack at each camp, the six lanes as equal
 * signpost cards, the ticket, and the route card the planner draws: quote
 * bound, Rule Book checked, signed step by step, stamped as it settles. The
 * facts that matter close the sheet: the ticket watch and the descent clock.
 */
export default function BridgePage() {
  const mode = useUiStore((state) => state.mode);
  const night = useNight();
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
    <Page className="!pt-0">
      <Section
        level={1}
        tag={sheetTag("04", "Ascent and descent", mode)}
        title={
          <>
            Move between
            <br />
            the layers.
          </>
        }
        lede="Up to the Summit by cable car, down the long trail, across to the Floor in seconds. You sign every step; Elyia watches the ticket until it lands."
      >
        <BridgeSideView lane={lane} asset={asset} />
        <CampPacks packs={packs} lane={lane} />
        <p className="mt-6 text-center font-mono text-[11px] text-ink-3">{packs.address ? "pack = what you can move from each camp, read live" : "connect a wallet to read your pack at each camp"} · times are the practice wall’s</p>
      </Section>

      <Section id="lanes" tag={`Junction · 6 lanes · grade T${lane.grade}`} title="Pick a lane. Name the amount." lede="Each lane is a real bridge route with its real time. Choose one, say how much, and the Guide surveys it before anything signs.">
        <LaneCards selected={lane.id} asset={asset} onSelect={choose} />
        <div className="mx-auto mt-12 flex max-w-[720px] flex-col gap-6 bg-card p-5 px-frame px-drop sm:p-6" aria-label="Ticket">
          <div className="flex flex-col items-center gap-3 text-center">
            <p className="caption">Ticket · {lane.title}</p>
            <SegmentedControl label="Asset" value={asset} onChange={(next) => setWanted(next)} options={(["HYPE", "USDC"] as const).map((value) => ({ value, label: value, disabled: !lane.assets.includes(value) }))} />
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
          <dl className="grid grid-cols-3 gap-4 text-center">
            {[
              ["Time", eta],
              ["Signatures", String(lane.signatures(asset))],
              ["Mainnet", lane.mainnetSeconds ? formatEta(lane.mainnetSeconds) : eta],
            ].map(([term, value]) => (
              <div key={term} className="bg-paper-2 px-2 py-3 px-frame-thin">
                <dt className="font-tag text-[10px] uppercase text-ink-2">{term}</dt>
                <dd className="tnum mt-1 font-display text-[20px] font-bold text-ink">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </Section>

      <Section id="route" tag="Route card · surveyed, then signed" title="The route, stamped as it lands." lede="Steps, hut fees, the Rule Book and the quote, before anything signs. Each settled step gets its stamp from the chain.">
        <FlowCard
          ask={ask}
          plan={plan.data}
          planning={plan.isFetching}
          updatedAt={plan.dataUpdatedAt}
          run={run}
          fineprint={lane.id === "down-ridge" ? "The claim opens after the confirm period; Elyia keeps the journey on the track page." : lane.id === "up-summit" && asset === "USDC" ? "ERC-20 deposits ride a retryable ticket: Elyia watches it and asks once if it stalls." : undefined}
          empty={<FlowEmpty sentence={laneSentence(lane, asset, "")} help="Enter an amount and the Guide surveys the route: steps, fees, the Rule Book and the quote, before anything signs." />}
        />
      </Section>

      <Section id="facts" tag="Field notes · the two clocks" title="What the bridge does not tell you." lede="Tickets that stall and a trail down that takes days on mainnet: Elyia watches both for you.">
        <Cards n={2}>
          <TicketWatch />
          <DescentClock mode={mode} night={night} />
        </Cards>
      </Section>
    </Page>
  );
}
