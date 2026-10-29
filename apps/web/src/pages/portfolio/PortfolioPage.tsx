import { useMemo, useState } from "react";
import { useAccount } from "wagmi";

import { useRouteParam } from "../../app/routes/useRoute";
import { Page } from "../../app/shell/Page";
import { WalletButton } from "../../app/shell/WalletButton";
import { useNow } from "../../hooks/useNow";
import { Reveal } from "../../motion/Reveal";
import { AddressPill } from "../../ui/AddressPill";
import { cx } from "../../ui/cx";
import { Skeleton } from "../../ui/Skeleton";
import { ExposureFold } from "./parts/ExposureFold";
import { EquityProfile, PnlCalendar, Register } from "./parts/History";
import { Jobs } from "./parts/Jobs";
import { NetWorth } from "./parts/NetWorth";
import { PeakDetail, ReliefSheet } from "./parts/ReliefSheet";
import { ShockBulletin } from "./parts/ShockBulletin";
import { SummitCertificate } from "./parts/SummitCertificate";
import { WatchField } from "./parts/WatchField";
import { shortAddr } from "./range/format";
import { SOURCE_LABEL } from "./range/labels";
import { useEquity } from "./range/useEquity";
import { useReliefPlan } from "./range/useReliefPlan";
import type { EquityRange } from "./range/model";
import { EXAMPLE_ADDRESS, SAMPLE_ADDRESS } from "./range/sample";
import { useRange, type RangeData } from "./range/useRange";
import { routeHref } from "../../app/routes/routeTable";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/u;
const RANGE_WORD: Readonly<Record<EquityRange, string>> = { day: "1-day", week: "7-day", month: "30-day", allTime: "all-time" };

/**
 * "/app/portfolio/:address?": the range. A live Relief of every holding on
 * HyperCore, HyperEVM and Elysium (hills, basins, cliffs, regions; tap a peak
 * for its detail), the altimeter and layer split, the avalanche bulletin
 * with its shock slider on the live ropes, real exposure folded across
 * layers, one-tap jobs, then the elevation profile, the PnL calendar, the
 * summit certificate and the register. Any address, read only; nothing here
 * signs.
 */
export default function PortfolioPage() {
  const param = useRouteParam("address");
  const { address: connected } = useAccount();
  const invalid = param !== undefined && !ADDRESS.test(param);
  const followed = invalid ? null : (param ?? connected ?? null);
  const range = useRange(followed);
  const own = followed !== null && connected !== undefined && followed.toLowerCase() === connected.toLowerCase();

  return (
    <Page className="pb-16">
      <Header range={range} own={own} invalid={invalid ? param : null} />
      {range.snapshot ? <Body range={range} /> : <Loading />}
    </Page>
  );
}

function Header({ range, own, invalid }: { readonly range: RangeData; readonly own: boolean; readonly invalid: string | null }) {
  const sample = range.source === "sample";
  return (
    <header className="mb-6 sm:mb-8">
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
        <div className="min-w-0">
          <p className="label-tab mb-4">Sheet 03 · Portfolio · {sample ? "sample range" : own ? "your range" : "watching"}</p>
          <h1 className="text-[40px] font-bold leading-[1.02] tracking-[-0.025em] text-ink sm:text-[56px]">
            {sample ? "Your money, surveyed." : own ? "Your range." : `${shortAddr(range.address)}’s range.`}
          </h1>
          <p className="mt-3 max-w-2xl text-[17px] leading-relaxed text-ink-2 text-pretty">
            {sample
              ? "Every holding a hill, every short a basin, every layer a region. Connect a wallet or watch any address to survey a real range."
              : "Every holding on HyperCore, HyperEVM and Elysium as one terrain. Tap a peak; drag the shock; plan the move. Read only, nothing signs here."}
          </p>
        </div>
        <div className="flex flex-col items-start gap-2 sm:items-end">
          <span className={cx("inline-flex items-center gap-2 border-2 border-rule px-2.5 py-1 font-mono text-[11px] font-semibold uppercase tracking-[0.12em] shadow-hard", sample ? "bg-signal text-signal-ink" : "bg-card text-ink")}>
            {range.source !== "sample" ? <span aria-hidden="true" className={cx("h-2 w-2 rotate-45", range.live || range.source === "browser" ? "bg-up el-pulse-slow el-loop" : "bg-ink-3")} /> : null}
            {SOURCE_LABEL[range.source]}
          </span>
          {range.address ? <AddressPill address={range.address} network={range.mode === "testnet" ? "hypercore-testnet" : "hypercore-mainnet"} /> : null}
          {range.snapshot && !sample ? <span className="font-mono text-[11px] text-ink-3">USD at HyperCore mainnet {range.snapshot.pricing.label} prices</span> : null}
        </div>
      </div>
      {invalid ? (
        <p role="alert" className="mt-5 border-2 border-down bg-card px-3 py-2 text-sm text-down">
          “{invalid.slice(0, 64)}” is not an address. Showing the sample range; paste 0x followed by 40 hex characters below.
        </p>
      ) : null}
      {range.source === "browser" ? (
        <p className="mt-5 border-2 border-rule bg-paper-2 px-3 py-2 text-[13px] text-ink-2">
          <span className="font-semibold text-ink">The Elyia survey is not answering</span> ({range.apiProblem}). This range is read straight from HyperCore and the public HyperEVM and Elysium RPCs in your browser.
        </p>
      ) : null}
      {sample ? (
        <div className="mt-6 grid max-w-3xl grid-cols-1 items-start gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
          <WatchField hrefFor={(address) => routeHref("portfolio", { address })} example={EXAMPLE_ADDRESS} size="lg" />
          <WalletButton />
        </div>
      ) : null}
    </header>
  );
}

function Loading() {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.65fr)_minmax(340px,1fr)]" aria-busy="true" aria-label="Surveying the range">
      <Skeleton className="aspect-[900/700] w-full" />
      <div className="flex flex-col gap-4">
        <Skeleton className="h-40" />
        <Skeleton className="h-72" />
      </div>
    </div>
  );
}

function Body({ range }: { readonly range: RangeData }) {
  const snapshot = range.snapshot!;
  const sample = range.source === "sample";
  const now = useNow(60_000);
  const [selected, setSelected] = useState<string | null>(null);
  const [equityRange, setEquityRange] = useState<EquityRange>("month");
  const plan = useReliefPlan(snapshot, range.ropes, 14);
  const source = selected ? plan.sources.get(selected) : undefined;
  const { series } = useEquity(range.history, equityRange);
  const certificateSeries = useMemo(() => series, [series]);

  return (
    <>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.65fr)_minmax(340px,1fr)] xl:gap-8">
        <div className="flex min-w-0 flex-col gap-6">
          <ReliefSheet snapshot={snapshot} ropes={range.ropes} selectedId={selected} onSelect={setSelected} label={`Relief · height = USD · ${snapshot.positions.length} rope${snapshot.positions.length === 1 ? "" : "s"} out · shorts are basins`} sample={sample} />
          {source ? (
            <PeakDetail key={selected} source={source} ropes={range.ropes} worth={snapshot.totals.netWorthUsd} onClose={() => setSelected(null)} className="el-rise -mt-2" />
          ) : (
            <p className="-mt-3 font-mono text-[11px] text-ink-3">Tap a peak (or Tab to it and press Enter) for its rope, its share of the range and the next move.</p>
          )}
          <EquityProfile history={range.history} sample={sample} range={equityRange} onRange={setEquityRange} />
        </div>
        <aside className="flex min-w-0 flex-col gap-6" aria-label="Range instruments">
          <div className="border-2 border-rule bg-card p-4 shadow-hard sm:p-5">
            <NetWorth snapshot={snapshot} history={range.history} source={range.source} />
          </div>
          <ShockBulletin snapshot={snapshot} ropes={range.ropes} sample={sample} />
          <div className="border-2 border-rule bg-card p-4 shadow-hard sm:p-5">
            <ExposureFold snapshot={snapshot} />
          </div>
          <Jobs snapshot={snapshot} history={range.history} sample={sample} now={now} />
        </aside>
      </div>

      <Reveal className="mt-10 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] xl:gap-8">
        <PnlCalendar history={range.history} now={now} sample={sample} />
        <div>
          <p className="caption mb-3">
            <span className="!text-ink">Summit certificate</span> · share card · {RANGE_WORD[equityRange]}
          </p>
          <SummitCertificate address={range.address ?? SAMPLE_ADDRESS} series={certificateSeries} rangeWord={RANGE_WORD[equityRange]} ropes={range.ropes.length} mode={range.mode} sample={sample} />
        </div>
      </Reveal>

      <Reveal className="mt-12">
        <Register history={range.history} address={range.address} mode={range.mode} sample={sample} />
      </Reveal>
    </>
  );
}
