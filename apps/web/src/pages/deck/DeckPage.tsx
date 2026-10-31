import { useCallback, useEffect, useMemo, useState } from "react";
import { useAccount } from "wagmi";

import { navigate } from "../../app/routes/history";
import { routeHref } from "../../app/routes/routeTable";
import { useSearchParam } from "../../app/routes/useRoute";
import { WalletButton } from "../../app/shell/WalletButton";
import { readStorage, writeStorage } from "../../app/state/storage";
import { intentHref } from "../../oracle/preview";
import { Ely } from "../../pixel/Ely";
import { ElyLoader } from "../../pixel/ElyLoader";
import { Cards, Page, Section, Split } from "../../pixel/layout";
import { PixelTerrain } from "../../pixel/PixelTerrain";
import type { ElyState } from "../../pixel/states";
import { Badge } from "../../ui/Badge";
import { ButtonLink } from "../../ui/Button";
import { Panel } from "../../ui/Panel";
import { LayerSplitBar, NetWorth } from "../portfolio/parts/NetWorth";
import { RopeList } from "../portfolio/parts/Ropes";
import { WatchField } from "../portfolio/parts/WatchField";
import { pct, shortAddr, usdShort } from "../portfolio/range/format";
import { layerSplit } from "../portfolio/range/model";
import { EXAMPLE_ADDRESS } from "../portfolio/range/sample";
import { peakDollars, terrainHoldings } from "../portfolio/range/terrainPlan";
import { useEquity } from "../portfolio/range/useEquity";
import { useRange, type RangeData } from "../portfolio/range/useRange";
import { useReliefPlan } from "../portfolio/range/useReliefPlan";
import { BaseCamp } from "./BaseCamp";
import { campReading, type CampReading } from "./camp";
import { DeckCard, GuideRadio, Junction, RecentRoutes } from "./DeckCards";
import { IntentDraft } from "./IntentDraft";
import { parseRoutes, pushRoute, ROUTES_KEY, type LoggedRoute } from "./routesLog";
import { WhereBox } from "./WhereBox";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/u;

function useRoutesLog(): readonly [readonly LoggedRoute[], (sentence: string) => void] {
  const [routes, setRoutes] = useState<readonly LoggedRoute[]>(() => parseRoutes(readStorage(ROUTES_KEY)));
  const add = useCallback((sentence: string) => {
    setRoutes((previous) => {
      const next = pushRoute(previous, sentence, Date.now());
      writeStorage(ROUTES_KEY, JSON.stringify(next));
      return next;
    });
  }, []);
  return [routes, add] as const;
}

/**
 * "/app": base camp. WHERE TO? on the axis (one sentence; the Guide drafts
 * the route and you sign every step), then the camp itself: a pixel
 * panorama where Ely says the account's state (worried when a rope is under
 * 10%, asleep when the range is empty, crowned at a new high), the
 * altimeter with the layer split beside a mini terrain, the ropes nearest
 * the crevasse beside the junction, and the radio log beside recent routes.
 * Not connected, it teaches with a labelled sample and lets you watch any
 * address (`?as=0x…`).
 */
export default function DeckPage() {
  const intent = useSearchParam("intent");
  const asParam = useSearchParam("as");
  const { address: connected } = useAccount();
  const viewAs = asParam && ADDRESS.test(asParam) ? asParam.toLowerCase() : null;
  const followed = viewAs ?? connected ?? null;
  const range = useRange(followed);
  const [routes, logRoute] = useRoutesLog();
  // A sentence that arrives from ⌘K or the landing is logged once.
  useEffect(() => {
    if (intent) logRoute(intent.slice(0, 500));
  }, [intent, logRoute]);
  const sentence = intent ? intent.slice(0, 500) : null;
  const watching = viewAs !== null && (!connected || viewAs !== connected.toLowerCase());
  const sample = range.source === "sample";

  return (
    <Page>
      <Section
        id="where"
        level={1}
        tag={`Sheet 01 · Deck · base camp${watching ? ` · watching ${shortAddr(viewAs)}` : ""}`}
        title="Where to?"
        lede="One sentence. The Guide surveys the route across the Floor, the Ridge and the Summit; you sign every step."
      >
        <WhereBox key={sentence ?? ""} initial={sentence ?? ""} onPlan={logRoute} viewAs={viewAs} />
        {sentence ? (
          <div className="mx-auto mt-14 max-w-[960px]">
            <IntentDraft sentence={sentence} account={followed?.toLowerCase() ?? null} />
          </div>
        ) : null}
      </Section>
      {sample ? <Teaching /> : null}
      <Camp range={range} routes={routes} watching={watching} />
    </Page>
  );
}

const TITLE: Readonly<Record<CampReading["mood"], string>> = {
  loading: "Surveying the range…",
  sample: "What base camp looks like.",
  empty: "Quiet at camp.",
  worry: "Holding on.",
  summit: "A new high.",
  watch: "On watch.",
  calm: "All ropes holding.",
};

function campLede(reading: CampReading, range: RangeData): string {
  const ropes = range.ropes.length;
  switch (reading.mood) {
    case "loading":
      return "Ely is climbing to read your three layers: HyperCore, HyperEVM and Elysium.";
    case "sample":
      return "A labelled sample range: not anyone's money. Connect a wallet or watch an address and base camp reads yours.";
    case "empty":
      return "Nothing on any layer yet, so Ely sleeps by the tent. Bridge or deposit and the first hill rises.";
    case "worry":
      return `${reading.rope?.coin ?? "A"} rope is ${pct(reading.rope?.distance ?? 0)} from the crevasse. Add margin or set an anchor before the slope gives.`;
    case "summit":
      return "The account stands at its highest value of the month. Ely planted the flag.";
    case "watch":
      return `Watching ${shortAddr(range.address)}, read only. ${ropes} rope${ropes === 1 ? "" : "s"} out, none under 10%.`;
    default:
      return `${ropes} rope${ropes === 1 ? "" : "s"} out, none under 10% to the crevasse. Say where to.`;
  }
}

const SCENE_WORDS: Readonly<Record<ElyState, string>> = {
  idle: "Ely waits by the tent, headlamp on",
  climb: "Ely climbs while the range is read",
  summit: "Ely wears the crown; the flag flies on the summit",
  worry: "Ely holds on to the rope, worried, under a grey sky",
  sleep: "Ely sleeps under the stars",
  watch: "Ely keeps watch with the lamp",
  talk: "Ely talks",
};

function Camp({ range, routes, watching }: { readonly range: RangeData; readonly routes: readonly LoggedRoute[]; readonly watching: boolean }) {
  const sample = range.source === "sample";
  const { series } = useEquity(range.history, "month");
  const equity = useMemo(() => series.map((point) => point.value), [series]);
  const snapshot = range.snapshot;
  const reading = campReading({
    loading: snapshot === null,
    sample,
    watching,
    netWorthUsd: snapshot?.totals.netWorthUsd ?? 0,
    positions: snapshot?.positions.length ?? 0,
    ropes: range.ropes,
    equity,
  });
  const portfolioHref = range.address ? routeHref("portfolio", { address: range.address }) : routeHref("portfolio");
  const tag = sample ? "Base camp · sample range" : watching ? `Base camp · watching ${shortAddr(range.address)}` : snapshot ? "Base camp · your range · live" : "Base camp";

  return (
    <>
      <Section
        id="camp"
        tag={tag}
        title={reading.mood === "worry" && reading.rope ? `${reading.rope.coin} is holding on.` : TITLE[reading.mood]}
        lede={campLede(reading, range)}
        actions={
          watching ? (
            <>
              <Badge tone="neutral" variant="outline">
                Read only · nothing here moves its money
              </Badge>
              <ButtonLink to={routeHref("deck")} variant="ink" size="sm">
                Stop watching ✕
              </ButtonLink>
            </>
          ) : undefined
        }
      >
        <BaseCamp mood={reading.mood} ely={reading.ely} sample={sample} radio={range.ropes.length > 0 || (range.history?.timeline.length ?? 0) > 0} label={`Base camp: ${SCENE_WORDS[reading.ely]}. ${TITLE[reading.mood]}`} />
        {snapshot ? (
          <div className="mt-12">
            <Split>
              <Panel variant="sheet" padding="lg" className="flex flex-col justify-center">
                <NetWorth snapshot={snapshot} history={range.history} source={range.source} size="lg" split={false} />
                <LayerSplitBar split={layerSplit(snapshot)} className="mx-auto mt-8 w-full max-w-[420px]" />
                <div className="mt-10 flex justify-center">
                  <ButtonLink to={portfolioHref} variant="primary" size="lg">
                    Open the full survey ▸
                  </ButtonLink>
                </div>
              </Panel>
              <MiniTerrain range={range} portfolioHref={portfolioHref} />
            </Split>
          </div>
        ) : (
          <div className="mt-12 flex justify-center">
            <ElyLoader label="Reading the three layers" size="md" />
          </div>
        )}
      </Section>

      <Section id="ropes" tag="Ropes · the junction" title="Nearest the crevasse." lede="Every open position as a rope, the shortest first; beside it, the junction: six routes, one tap each.">
        <Split>
          <DeckCard
            title={`Ropes · ${range.ropes.length} out${sample ? " · sample" : ""}`}
            aside={
              <ButtonLink to={routeHref("trade")} variant="ghost" size="xs">
                terminal ▸
              </ButtonLink>
            }
          >
            <RopeList ropes={range.ropes} sample={sample} />
          </DeckCard>
          <DeckCard title="The junction · signposts">
            <Junction portfolioHref={portfolioHref} />
          </DeckCard>
        </Split>
      </Section>

      <Section id="radio" tag="Radio log · routes" title="What the range said." lede="The Guide's radio reads your fills, funding and transfers and calls every fraying rope. Routes you planned in this browser wait beside it.">
        <Split>
          <DeckCard title={routes.length === 0 ? "Routes · examples" : `Routes · ${routes.length} planned here`}>
            <RecentRoutes routes={routes} onReplan={(text) => navigate(intentHref(text))} />
          </DeckCard>
          <GuideRadio ropes={range.ropes} history={range.history} sample={sample} className="flex flex-col px-drop-lg [&>ol]:flex-1" />
        </Split>
      </Section>
    </>
  );
}

/** The followed range as a small pixel terrain; tapping a peak opens the full survey. */
function MiniTerrain({ range, portfolioHref }: { readonly range: RangeData; readonly portfolioHref: string }) {
  const snapshot = range.snapshot!;
  const plan = useReliefPlan(snapshot, range.ropes, 9);
  const holdings = useMemo(() => terrainHoldings(plan, range.ropes, null, 8), [plan, range.ropes]);
  const dollars = useMemo(() => new Map(holdings.map((holding) => [holding.id, peakDollars(holding, 0)])), [holdings]);
  const sample = range.source === "sample";
  return (
    <Panel variant="sheet" padding="none" className="flex flex-col">
      <div className="flex items-center justify-between gap-3 border-b-4 border-rule px-4 py-2.5">
        <h3 className="caption !font-tag !text-ink">Your range · pixel terrain{sample ? " · sample" : ""}</h3>
        <span className="font-tag text-[11px] uppercase text-ink-2">{usdShort(snapshot.totals.netWorthUsd)}</span>
      </div>
      <div className="flex flex-1 flex-col justify-center">
        {holdings.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
            <Ely state="sleep" size={88} label="Ely asleep: an empty range" />
            <p className="font-display text-xl font-bold text-ink">An empty range.</p>
          </div>
        ) : (
          <PixelTerrain
            holdings={holdings}
            ground="dry"
            resolution={140}
            aspect={0.62}
            onSelect={() => navigate(portfolioHref)}
            formatUsd={(value) => {
              const match = holdings.find((holding) => Math.abs(holding.usd - value) < 1e-6);
              return usdShort(match ? dollars.get(match.id) : value);
            }}
            label={`${sample ? "Sample range" : "Your range"} as terrain: ${holdings
              .slice(0, 5)
              .map((holding) => `${holding.label} ${usdShort(holding.exactUsd)}`)
              .join(", ")}. Floor, Ridge and Summit from left to right.`}
          />
        )}
      </div>
      <p className="border-t-4 border-dashed border-rule/30 px-4 py-2.5 text-center font-tag text-[11px] uppercase text-ink-2">Floor · Ridge · Summit, left to right · tap a peak to survey it</p>
    </Panel>
  );
}

/** Not connected: how to bring a range (three equal steps, Ely in each), then a wallet or any address to watch. */
function Teaching() {
  const steps: readonly { readonly ely: ElyState; readonly title: string; readonly body: string }[] = [
    { ely: "idle", title: "Connect a wallet", body: "Your key never leaves it. Elyia reads your three layers and plans; you sign." },
    { ely: "watch", title: "Or watch any range", body: "Paste an address: positions, ropes and history, live and read only." },
    { ely: "talk", title: "Say where to", body: "One sentence becomes a route card. Every step is quoted, checked by the Rule Book and proven on chain." },
  ];
  return (
    <Section
      id="start"
      tag="Your range · not surveyed yet"
      title="Bring a range to survey."
      lede="Three ways in. Until then, base camp below shows a labelled sample."
      actions={
        <div className="flex w-full max-w-[760px] flex-col items-stretch gap-6 sm:flex-row sm:items-start">
          <WatchField hrefFor={(address) => `${routeHref("deck")}?as=${address}`} example={EXAMPLE_ADDRESS} size="lg" className="min-w-0 flex-1" />
          <WalletButton />
        </div>
      }
    >
      <Cards n={3} as="ol">
        {steps.map((step, index) => (
          <li key={step.title} className="flex">
            <Panel padding="lg" className="flex w-full flex-col items-center text-center">
              <span className="font-tag text-[12px] uppercase text-accent">Step {index + 1}</span>
              <Ely state={step.ely} size={132} className="mt-3" label={null} />
              <h3 className="mt-4 font-display text-[22px] font-bold text-ink">{step.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-2">{step.body}</p>
            </Panel>
          </li>
        ))}
      </Cards>
    </Section>
  );
}
