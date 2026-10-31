import { useState } from "react";
import { useAccount } from "wagmi";

import { routeHref } from "../../app/routes/routeTable";
import { useRouteParam } from "../../app/routes/useRoute";
import { WalletButton } from "../../app/shell/WalletButton";
import { useNow } from "../../hooks/useNow";
import { ElyLoader } from "../../pixel/ElyLoader";
import { Page, Section, Split } from "../../pixel/layout";
import { AddressPill } from "../../ui/AddressPill";
import { Badge } from "../../ui/Badge";
import { Panel, PanelHeader } from "../../ui/Panel";
import { ExposureFold } from "./parts/ExposureFold";
import { EquityProfile, EquityRangeControl, PnlCalendar, Register } from "./parts/History";
import { Jobs } from "./parts/Jobs";
import { LayerCamps, NetWorth } from "./parts/NetWorth";
import { RangeTerrain } from "./parts/RangeTerrain";
import { RopeList } from "./parts/Ropes";
import { frayingRope } from "./range/ropes";
import { SummitCertificate } from "./parts/SummitCertificate";
import { WatchField } from "./parts/WatchField";
import { pct, shortAddr } from "./range/format";
import { SOURCE_LABEL } from "./range/labels";
import type { EquityRange } from "./range/model";
import { EXAMPLE_ADDRESS, SAMPLE_ADDRESS } from "./range/sample";
import { useEquity } from "./range/useEquity";
import { useRange, type RangeData } from "./range/useRange";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/u;
const RANGE_WORD: Readonly<Record<EquityRange, string>> = { day: "1-day", week: "7-day", month: "30-day", allTime: "all-time" };

/**
 * "/app/portfolio/:address?": the range, as one centred survey sheet.
 * The hero is a big pixel elevation map of every holding on HyperCore,
 * HyperEVM and Elysium (Floor | Ridge | Summit), with the shock slider that
 * collapses peaks into lakes and the Guide's hedge one tap away. Then the
 * altimeter and the three camps, real exposure mirrored on the axis beside
 * the ropes, one-tap jobs, the elevation profile, the PnL calendar as pixel
 * tiles, the summit certificate (a pixel PNG) and the register. Any
 * address, read only; nothing here signs.
 */
export default function PortfolioPage() {
  const param = useRouteParam("address");
  const { address: connected } = useAccount();
  const invalid = param !== undefined && !ADDRESS.test(param);
  const followed = invalid ? null : (param ?? connected ?? null);
  const range = useRange(followed);
  const own = followed !== null && connected !== undefined && followed.toLowerCase() === connected.toLowerCase();
  const sample = range.source === "sample";

  const title = sample ? "Your money, surveyed." : own ? "Your range." : `${shortAddr(range.address)}’s range.`;
  const lede = sample
    ? "Every holding a hill, every short a lake, every layer a region. Drag the shock and watch the peaks fall. Connect a wallet or watch any address to survey a real range."
    : "Every holding on HyperCore, HyperEVM and Elysium as one terrain. Drag the shock, tap a peak, plan the move. Read only: nothing signs here.";

  return (
    <Page>
      <Section
        id="range"
        level={1}
        tag={`Sheet 03 · Portfolio · ${sample ? "sample range" : own ? "your range" : "watching"}`}
        title={title}
        lede={lede}
        actions={<HeroActions range={range} sample={sample} />}
      >
        {invalid ? (
          <p role="alert" className="mx-auto mb-10 max-w-[720px] bg-card px-4 py-3 text-center text-sm text-down px-frame px-tone-down">
            “{param.slice(0, 64)}” is not an address. Showing the sample range; paste 0x followed by 40 hex characters.
          </p>
        ) : null}
        {range.source === "browser" ? (
          <p className="mx-auto mb-10 max-w-[720px] bg-paper-2 px-4 py-3 text-center text-[13px] text-ink-2 px-frame-thin">
            <span className="font-semibold text-ink">The Elyia survey is not answering</span> ({range.apiProblem}). This range is read straight from HyperCore and the public HyperEVM and Elysium RPCs in your browser.
          </p>
        ) : null}
        {range.snapshot ? (
          <RangeTerrain snapshot={range.snapshot} ropes={range.ropes} sample={sample} />
        ) : (
          <div className="flex min-h-[420px] items-center justify-center bg-card px-frame px-drop-lg" aria-busy="true">
            <ElyLoader label="Surveying the range" size="lg" />
          </div>
        )}
      </Section>
      {range.snapshot ? <Body range={range} /> : null}
    </Page>
  );
}

function HeroActions({ range, sample }: { readonly range: RangeData; readonly sample: boolean }) {
  if (sample) {
    return (
      <div className="flex w-full max-w-[720px] flex-col items-stretch gap-6 sm:flex-row sm:items-start">
        <WatchField hrefFor={(address) => routeHref("portfolio", { address })} example={EXAMPLE_ADDRESS} size="lg" className="min-w-0 flex-1" />
        <WalletButton />
      </div>
    );
  }
  return (
    <>
      <Badge tone={range.live || range.source === "browser" ? "up" : "neutral"} variant="outline" dot={range.live ? "pulse" : true}>
        {SOURCE_LABEL[range.source]}
      </Badge>
      {range.address ? <AddressPill address={range.address} network={range.mode === "testnet" ? "hypercore-testnet" : "hypercore-mainnet"} /> : null}
      {range.snapshot ? <span className="font-mono text-[11px] text-ink-3">USD at HyperCore mainnet {range.snapshot.pricing.label} prices</span> : null}
    </>
  );
}

function Body({ range }: { readonly range: RangeData }) {
  const snapshot = range.snapshot!;
  const sample = range.source === "sample";
  const now = useNow(60_000);
  const [equityRange, setEquityRange] = useState<EquityRange>("month");
  const { series } = useEquity(range.history, equityRange);
  const fraying = frayingRope(range.ropes);

  return (
    <>
      <Section id="altimeter" tag="Altimeter · three camps" title="One altitude, three camps." lede="Net worth across the Floor, the Ridge and the Summit. The tallest camp flies the flag; only the digits that change roll.">
        <NetWorth snapshot={snapshot} history={range.history} source={range.source} split={false} />
        <LayerCamps snapshot={snapshot} className="mx-auto mt-12 max-w-[960px]" />
      </Section>

      <Section
        id="exposure"
        tag="Real exposure · ropes"
        title="What actually moves you."
        lede="Left: every market you are exposed to on any layer, folded onto one axis, short to the left and long to the right. Right: every rope, nearest the crevasse first."
      >
        <Split>
          <Panel variant="sheet" padding="none" className="flex flex-col">
            <PanelHeader ruled title="Exposure · all layers folded" aside={sample ? "sample" : `${snapshot.exposure.filter((row) => !row.isCash).length} markets`} />
            <ExposureFold snapshot={snapshot} className="flex-1 p-5 sm:p-6" />
          </Panel>
          <Panel variant="sheet" padding="none" className="flex flex-col">
            <PanelHeader ruled title={`Ropes · ${range.ropes.length} out`} aside={fraying ? <span className="text-down">▼ {fraying.coin} {pct(fraying.distance)}</span> : sample ? "sample" : "live marks"} />
            <RopeList ropes={range.ropes} sample={sample} />
          </Panel>
        </Split>
      </Section>

      <Section id="jobs-section" tag="One-tap jobs · you sign" title="Chores at base camp." lede="Each card says its state in a picture and a line. Tap one: the job opens with the exact sentence the planner will receive. Nothing signs here.">
        <Jobs snapshot={snapshot} history={range.history} sample={sample} now={now} />
      </Section>

      <Section id="profile" tag="Elevation profile" title="The climb so far." lede="Equity as a ridgeline: the flag on the high, the deepest drop flooded as a lake, camps at the biggest events." actions={<EquityRangeControl range={equityRange} onRange={setEquityRange} />}>
        <EquityProfile history={range.history} sample={sample} range={equityRange} className="mx-auto max-w-[1040px]" />
      </Section>

      <Section id="calendar" tag="PnL calendar · 35 days" title="Every day, a tile." lede="Realised PnL minus fees plus funding, per UTC day. A gain rises as a hill, a loss sinks as a lake.">
        <PnlCalendar history={range.history} now={now} sample={sample} className="mx-auto max-w-[840px]" />
      </Section>

      <Section id="certificate" tag={`Summit certificate · ${RANGE_WORD[equityRange]}`} title="Proof you reached the top." lede="A pixel trophy card for the range's high. The PNG is the same pixels, six times larger: crisp anywhere you post it.">
        <SummitCertificate address={range.address ?? SAMPLE_ADDRESS} series={series} rangeWord={RANGE_WORD[equityRange]} ropes={range.ropes.length} mode={range.mode} sample={sample} />
      </Section>

      <Section id="register" tag={`Summit register · UTC${sample ? " · sample" : ""}`} title="Every step, in ink." lede="Fills, funding and transfers as a log book, each line with its proof.">
        <Register history={range.history} address={range.address} mode={range.mode} sample={sample} />
      </Section>
    </>
  );
}
