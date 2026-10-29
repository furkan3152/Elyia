import { Inbox } from "lucide-react";
import { useEffect, useState } from "react";

import { formatUsd } from "../../lib/format";
import { AddressPill } from "../../ui/AddressPill";
import { DataTable, type DataColumn } from "../../ui/DataTable";
import { EmptyState } from "../../ui/EmptyState";
import { NetworkBadge } from "../../ui/NetworkBadge";
import { NumberTicker } from "../../ui/NumberTicker";
import { Panel, PanelHeader } from "../../ui/Panel";
import { ProgressRing } from "../../ui/ProgressRing";
import { Skeleton, SkeletonText } from "../../ui/Skeleton";
import { Sparkline } from "../../ui/Sparkline";
import { Stat } from "../../ui/Stat";
import { KitSection } from "./KitSection";

interface SampleRow {
  readonly market: string;
  readonly side: "long" | "short";
  readonly size: number;
  readonly pnl: number | null;
  readonly liq: number;
}

/* Kit sample rows (documentation only, never shown as data). */
const ROWS: readonly SampleRow[] = [
  { market: "HYPE", side: "long", size: 12_400, pnl: 812, liq: 0.31 },
  { market: "ETH", side: "short", size: 8_950, pnl: -214, liq: 0.14 },
  { market: "BTC", side: "long", size: 6_020, pnl: 96, liq: 0.47 },
  { market: "FARTCOIN", side: "short", size: 1_100, pnl: null, liq: 0.06 },
];

const COLUMNS: DataColumn<SampleRow>[] = [
  { id: "market", header: "Market", cell: (row) => <span className={row.side === "long" ? "text-mint" : "text-rose"}>{`${row.side.toUpperCase()} ${row.market}`}</span>, sortValue: (row) => row.market, firstSort: "asc" },
  { id: "size", header: "Size", align: "right", cell: (row) => formatUsd(row.size, { cents: false }), sortValue: (row) => row.size },
  { id: "pnl", header: "PnL", align: "right", cell: (row) => (row.pnl === null ? "—" : <span className={row.pnl >= 0 ? "text-mint" : "text-rose"}>{formatUsd(row.pnl, { cents: false })}</span>), sortValue: (row) => row.pnl },
  { id: "liq", header: "Liq distance", align: "right", cell: (row) => `${Math.round(row.liq * 100)}%`, sortValue: (row) => row.liq, firstSort: "asc" },
];

const WALK = [114.2, 116.8, 113.1, 115.4, 119.9, 112.6, 114.9, 117.3];

/** Panels, stats, live figures, charts, tables and identity pills. */
export function DataSection() {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setStep((value) => value + 1), 1_400);
    return () => window.clearInterval(timer);
  }, []);
  const tick = WALK[step % WALK.length]!;
  return (
    <>
      <KitSection
        id="panels"
        title="Panel · Card · PanelHeader · Stat · NumberTicker"
        description="Panel variants: flat (dense app panels), glass (over the aurora), raised (primary cards), glow (the one thing that matters). NumberTicker flashes mint up / rose down once per change and never tweens: an invented in-between price is false data."
        code={'<Panel variant="raised"><PanelHeader title="Net worth · 3 layers" aside={…} />…</Panel>\n<Stat label="Block time" value={<NumberTicker value={ms} format={(v) => `${v} ms`} />} hint="live" />'}
      >
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {(["flat", "glass", "raised", "glow"] as const).map((variant) => (
            <Panel key={variant} variant={variant}>
              <PanelHeader title={variant} aside="aside" />
              <p className="text-sm text-text-1">Panel variant “{variant}”.</p>
            </Panel>
          ))}
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Ticking (kit sample)" value={<NumberTicker value={tick} format={(v) => `${Number(v).toFixed(1)} ms`} />} hint="flashes on change" />
          <Stat label="Mainnet" value="Nov 9" tone="gold" hint="chain 99901" />
          <Stat label="PnL today" value="+$1,204.18" tone="mint" />
          <Stat label="Liq distance" value="6%" tone="rose" hint="FARTCOIN short" />
        </div>
      </KitSection>

      <KitSection
        id="charts"
        title="Sparkline · ProgressRing · Skeleton"
        description="Sparkline draws a line (with a soft area, tone auto from the trend) or bars (with a highlight threshold and a dashed reference). ProgressRing for fills and slices. Skeletons, never spinners, while data loads."
        code={'<Sparkline values={series} variant="bars" highlightFrom={128} reference={115} fluid label="Block interval…" />\n<ProgressRing value={22 / 40} label="TWAP 22 of 40 filled">55%</ProgressRing>'}
      >
        <div className="grid items-center gap-6 md:grid-cols-3">
          <Panel>
            <Sparkline values={[3, 4, 3.6, 5, 4.4, 6, 5.6, 7, 6.8, 8]} width={240} height={48} label="Rising sample series" />
            <Sparkline values={[8, 7.2, 7.6, 6, 6.4, 5, 5.2, 4]} width={240} height={48} className="mt-3" label="Falling sample series" />
          </Panel>
          <Panel>
            <Sparkline values={[112, 118, 114, 131, 116, 113, 129, 115, 117, 114, 120, 133, 116]} variant="bars" width={240} height={64} highlightFrom={128} reference={115} label="Sample block intervals" />
          </Panel>
          <Panel className="flex items-center gap-5">
            <ProgressRing value={22 / 40} label="TWAP 22 of 40 filled" size={56} tone="violet">
              55%
            </ProgressRing>
            <ProgressRing value={0.85} label="Confirm period" size={56} tone="gold">
              9 s
            </ProgressRing>
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-4 w-24" />
              <SkeletonText lines={2} />
            </div>
          </Panel>
        </div>
      </KitSection>

      <KitSection
        id="table"
        title="DataTable"
        description="Dense, sortable (unknown values always sort last), sticky header, clickable rows with Enter/Space, highlighted and muted rows, skeleton rows while loading. No virtualisation: page beyond a few hundred rows."
        code={'<DataTable caption="Open positions" columns={columns} rows={rows} getRowId={(r) => r.market}\n  defaultSort={{ columnId: "liq", direction: "asc" }} onRowClick={(r) => navigate(routeHref("trade", { market: r.market }))} />'}
      >
        <Panel padding="sm">
          <DataTable caption="Kit sample positions" columns={COLUMNS} rows={ROWS} getRowId={(row) => row.market} defaultSort={{ columnId: "liq", direction: "asc" }} maxHeight="260px" />
        </Panel>
      </KitSection>

      <KitSection
        id="identity"
        title="AddressPill · NetworkBadge · EmptyState"
        description="AddressPill copies and links to the explorer from @elyia/core's registry (no link when a network has no public explorer yet). NetworkBadge gives each realm a fixed glyph and colour. EmptyState teaches with an example intent that opens the Oracle."
        code={'<AddressPill address={addr} network="elysium-testnet" label="Inbox" />\n<NetworkBadge network="hypercore-testnet" />\n<EmptyState title="No positions yet" example="long ETH 5x with 200 USDC" />'}
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-2">
              <NetworkBadge network="elysium-testnet" />
              <NetworkBadge network="hyperevm-testnet" />
              <NetworkBadge network="hypercore-testnet" />
              <NetworkBadge network="elysium-mainnet" />
              <NetworkBadge network="hypercore" iconOnly />
            </div>
            <div className="flex flex-wrap gap-2">
              <AddressPill label="WHYPE" address="0xCD57F65c2B0e5881CFC2E609F7CD53b746E1F234" network="elysium-testnet" />
              <AddressPill label="Inbox" address="0x11178Df40CBf87a4343f4B3F8B09B366ceFA8Ec0" network="hyperevm-testnet" />
              <AddressPill label="Mainnet (no explorer yet)" address="0x503D572157113fAaaD4DbeD2647Bb10b949216B6" network="elysium-mainnet" />
            </div>
          </div>
          <Panel>
            <EmptyState icon={<Inbox className="h-5 w-5" />} title="No positions yet" description="Your HyperCore perps appear here." example="long ETH 5x with 200 USDC, stop at -3%" compact />
          </Panel>
        </div>
      </KitSection>
    </>
  );
}
