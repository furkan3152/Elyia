import { usePulse } from "../../hooks/usePulse";
import { formatBlockNumber, formatGwei, formatTps } from "../../lib/format";
import type { PulseStatus } from "../../lib/pulse/pulseHub";
import { Badge } from "../../ui/Badge";
import { cx } from "../../ui/cx";
import { NumberTicker } from "../../ui/NumberTicker";
import { Panel, PanelHeader } from "../../ui/Panel";
import { Stat } from "../../ui/Stat";
import type { Tone } from "../../ui/tones";
import { LiveSun } from "../../visuals/sun/LiveSun";
import { BlockFeed } from "./BlockFeed";
import { BridgeContracts, ChainFacts } from "./ChainFacts";
import { IntervalChart } from "./IntervalChart";

const STATUS: Readonly<Record<PulseStatus, { readonly label: string; readonly tone: Tone }>> = {
  live: { label: "live · testnet 99801", tone: "mint" },
  fallback: { label: "live via public RPC · testnet 99801", tone: "mint" },
  connecting: { label: "connecting · testnet 99801", tone: "neutral" },
  stale: { label: "stale · no new block", tone: "gold" },
  offline: { label: "offline · no endpoint answers", tone: "rose" },
};

/** "/elysium" — Elysium's ~115 ms blocks made visible. */
export default function ElysiumPage() {
  const snapshot = usePulse();
  const { pulse, status, recent, lastBlockAt, source } = snapshot;
  const blocksPerMinute = pulse && pulse.blockTimeMs > 0 ? Math.round(60_000 / pulse.blockTimeMs) : null;
  const meta = STATUS[status];

  return (
    <div className="mx-auto max-w-[1360px] px-4 pb-24 pt-2 sm:px-8 lg:px-10">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-3">
          <p className="eyebrow">The pulse of Elysium</p>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-display text-display-lg text-text-0">Elysium Pulse</h1>
            <Badge tone={meta.tone} dot={status === "live" || status === "fallback" ? "pulse" : true} size="md">
              {meta.label}
            </Badge>
          </div>
          <p className="max-w-xl text-text-1">
            Every block as it lands{blocksPerMinute ? <>, about <span className="tnum text-text-0">{blocksPerMinute}</span> a minute</> : null}. One ray per block around the Sun.
          </p>
        </div>
        <p className="font-mono text-xs text-text-2">
          {source === "rpc" ? "polled from Elysium's public RPC by your browser (the Elyia API is unreachable)" : "streamed from the chain by the Elyia API, one event per block"}
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]">
        <div className="flex min-w-0 flex-col gap-5">
          <Panel variant="glass" padding="lg" className="rounded-3xl">
            <div className="mx-auto w-full max-w-[500px]">
              <LiveSun />
            </div>
          </Panel>
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Block time" value={<NumberTicker value={pulse ? Math.round(pulse.blockTimeMs) : null} format={(v) => `${v} ms`} placeholder="—" />} hint={source === "rpc" ? "measured in your browser" : "measured on the wall clock"} />
            <Stat label="Gas price" value={pulse ? formatGwei(pulse.gasPriceGwei) : "—"} hint="base fee, paid in HYPE" />
            <Stat label="Transactions / s" value={<NumberTicker value={pulse ? pulse.tps : null} format={(v) => formatTps(Number(v))} placeholder="—" />} hint="user transactions only" />
            <Stat label="HyperEVM block" value={pulse?.l1BlockNumber ? `#${formatBlockNumber(pulse.l1BlockNumber)}` : "—"} hint="parent block recorded by Nitro" />
          </div>
          <Panel padding="lg" className="rounded-3xl">
            <PanelHeader title="The chain" />
            <ChainFacts />
          </Panel>
        </div>

        <div className="flex min-w-0 flex-col gap-5">
          <Panel padding="lg" className="rounded-3xl">
            <PanelHeader title="Last 60 block intervals" aside={<span className="font-mono">gold = 10% slower than the mean</span>} />
            <IntervalChart recent={recent} source={source} />
          </Panel>
          <Panel padding="md" className={cx("min-w-0 rounded-3xl")}>
            <PanelHeader title="Blocks" aside={<span className="tnum font-mono">{recent.length > 0 ? `head #${formatBlockNumber(recent[recent.length - 1]!.number)}` : ""}</span>} />
            <BlockFeed recent={recent} lastBlockAt={lastBlockAt} loading={recent.length === 0 && status === "connecting"} rows={14} />
          </Panel>
          <Panel padding="lg" className="min-w-0 rounded-3xl">
            <PanelHeader title="Bridge contracts" aside={<span>HyperEVM ↔ Elysium · canonical + mirror</span>} />
            <BridgeContracts />
          </Panel>
        </div>
      </div>
    </div>
  );
}
