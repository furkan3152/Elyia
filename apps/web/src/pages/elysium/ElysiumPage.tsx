import { NETWORKS } from "@elyia/core/networks";
import { PROTOCOLS } from "@elyia/core/protocols";
import type { PulseBlock } from "@elyia/core/pulse";
import { useEffect, useMemo, useRef, useState } from "react";

import { useFloorStatus, useRidgeHead, type HeadStatus } from "../../app/shell/useLayerHeads";
import { usePulse, usePulseFeed } from "../../hooks/usePulse";
import { formatBlockNumber, formatGas, formatGwei, formatTps } from "../../lib/format";
import type { PulseStatus } from "../../lib/pulse/pulseHub";
import { Reveal } from "../../motion/Reveal";
import { Altimeter } from "../../topo/Altimeter";
import { Barograph } from "../../topo/Barograph";
import { ConditionSign } from "../../topo/ConditionSign";
import type { Layer } from "../../topo/geometry/relief";
import { SummitRegister, type RegisterRow } from "../../topo/SummitRegister";
import { useMeasuredWidth } from "../../topo/useMeasuredWidth";
import { Badge, Tag } from "../../ui/Badge";
import { cx, FOCUS_RING } from "../../ui/cx";
import type { Tone } from "../../ui/tones";
import { BridgeContracts, ChainFacts } from "./ChainFacts";
import { BlockTimeHistogram } from "./Histogram";
import { ageLabel } from "./model";
import { useSteady } from "./useSteady";
import { trailSigns } from "./registry";

const elysium = NETWORKS["elysium-testnet"];
const ridge = NETWORKS["hyperevm-testnet"];
const EXPLORER = elysium.vm === "evm" ? elysium.explorer : null;
const RIDGE_EXPLORER = ridge.vm === "evm" ? ridge.explorer : null;

const STATUS: Readonly<Record<PulseStatus, { readonly label: string; readonly tone: Tone }>> = {
  live: { label: "Live · testnet 99801", tone: "up" },
  fallback: { label: "Live via public RPC · 99801", tone: "up" },
  connecting: { label: "Reaching Elysium…", tone: "neutral" },
  stale: { label: "Stale · no new block", tone: "warn" },
  offline: { label: "Offline · no endpoint answers", tone: "down" },
};

const HEAD_WORD: Readonly<Record<HeadStatus, string>> = { live: "live", stale: "stale", offline: "offline", connecting: "reaching…" };
const LAYER_TEXT: Readonly<Record<Layer, string>> = { floor: "text-floor", ridge: "text-ridge", summit: "text-summit-ink" };
const LAYER_BAR: Readonly<Record<Layer, string>> = { floor: "bg-floor", ridge: "bg-ridge", summit: "bg-summit-ink" };

/** One altitude of the layer altimeter: name, network, head and how fresh it is. */
function AltitudeCell({ layer, name, network, head, status, note }: { readonly layer: Layer; readonly name: string; readonly network: string; readonly head: number | null; readonly status: HeadStatus; readonly note: string }) {
  const [ref, width] = useMeasuredWidth<HTMLDivElement>(420);
  return (
    <div ref={ref} className="relative flex min-w-0 flex-col gap-3 bg-card px-5 pb-5 pt-6">
      <span aria-hidden="true" className={cx("absolute inset-x-0 top-0 h-1.5", LAYER_BAR[layer])} />
      <p className="flex items-baseline justify-between gap-3">
        <span className={cx("text-[20px] font-bold uppercase tracking-[0.04em]", LAYER_TEXT[layer])}>{name}</span>
        <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-2">
          {network} · {HEAD_WORD[status]}
        </span>
      </p>
      {head !== null ? <Altimeter value={formatBlockNumber(head)} label={`${name} head`} size={width < 400 ? "sm" : "md"} markLatest /> : <p className="font-mono text-[26px] leading-none text-ink-3">{status === "live" ? "answering" : "—"}</p>}
      <p className="text-[13px] leading-snug text-ink-2">{note}</p>
    </div>
  );
}

/** Instrument readout: a big mono number with a caption. */
function Gauge({ label, value, unit, note }: { readonly label: string; readonly value: string; readonly unit?: string; readonly note: string }) {
  return (
    <div className="flex flex-col gap-1.5 border-b-1.5 border-rule/25 pb-4 last:border-b-0 last:pb-0">
      <p className="caption">{label}</p>
      <p className="tnum font-mono text-[36px] font-medium leading-none text-ink">
        {value}
        {unit ? <span className="ml-1.5 text-[15px] text-ink-2">{unit}</span> : null}
      </p>
      <p className="text-[13px] text-ink-2">{note}</p>
    </div>
  );
}

/** The register redraws twice a second (not per block), newest first; ages are skew-free relative to the newest block's arrival. */
function useRegisterRows(recent: readonly PulseBlock[], lastBlockAt: number | null): RegisterRow[] {
  const latest = useRef({ recent, lastBlockAt });
  useEffect(() => {
    latest.current = { recent, lastBlockAt };
  }, [recent, lastBlockAt]);
  const [rows, setRows] = useState<RegisterRow[]>([]);
  useEffect(() => {
    const build = () => {
      const { recent: blocks, lastBlockAt: arrived } = latest.current;
      const head = blocks[blocks.length - 1];
      const now = Date.now();
      setRows(
        blocks
          .slice(-10)
          .reverse()
          .map((block) => ({
            id: block.hash,
            when: ageLabel(head && arrived !== null ? now - arrived + (head.seenAt - block.seenAt) : null),
            entry: (
              <span>
                Block <b className="tnum font-mono font-semibold">#{formatBlockNumber(block.number)}</b>
                <span className="text-ink-2">
                  {" "}
                  · {block.txCount} {block.txCount === 1 ? "tx" : "txs"} · {formatGas(block.gasUsed)} gas
                </span>
              </span>
            ),
            layer: "summit" as const,
            amount: formatGwei(block.baseFeeGwei),
            proof: EXPLORER ? { label: `${block.hash.slice(0, 8)}…`, href: `${EXPLORER.url}/block/${block.number}` } : undefined,
          })),
      );
    };
    build();
    const timer = window.setInterval(build, 500);
    return () => window.clearInterval(timer);
  }, []);
  return rows;
}

const ALTITUDE_TITLE: Readonly<Record<Layer, string>> = { summit: "The Summit · Elysium", ridge: "The Ridge · HyperEVM", floor: "The Floor · HyperCore" };

/** The ecosystem registry as trail signs, filed by altitude. */
function Registry() {
  const signs = useMemo(() => trailSigns(PROTOCOLS), []);
  return (
    <div className="grid grid-cols-1 gap-[2px] border-2 border-rule bg-rule shadow-hard-xl lg:grid-cols-2">
      {(["summit", "ridge", "floor"] as const).map((layer) => (
        <section key={layer} aria-labelledby={`alt-${layer}`} className={cx("flex flex-col bg-card", layer === "summit" && "lg:col-span-2")}>
          <h3 id={`alt-${layer}`} className={cx("map-label border-b-1.5 border-rule px-5 pb-2 pt-4 text-[26px] leading-tight", LAYER_TEXT[layer])}>
            {ALTITUDE_TITLE[layer]}
          </h3>
          <ul className={cx("grid grid-cols-1 gap-x-[2px]", layer === "summit" ? "sm:grid-cols-2 lg:grid-cols-3" : "sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2")}>
            {signs[layer].map((sign) => (
              <li key={sign.id} className="flex flex-col gap-2 border-b border-rule/15 px-5 py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <a href={sign.url} target="_blank" rel="noopener noreferrer" className={cx("text-[16px] font-bold tracking-[-0.01em] text-ink underline decoration-transparent decoration-2 underline-offset-4 hover:decoration-accent-line", FOCUS_RING)}>
                    {sign.name}
                    <span className="sr-only"> (opens in a new tab)</span>
                  </a>
                  <span className="shrink-0 font-mono text-[11px] uppercase tracking-[0.1em] text-ink-2">
                    {sign.category}
                    {sign.routable ? " · routable" : ""}
                  </span>
                </div>
                <ConditionSign condition={sign.condition} reason={sign.reason} size="sm" />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** "/elysium": the weather station on the summit. Elysium's blocks, heads, cadence, gas and ecosystem, live. */
export default function ElysiumPage() {
  const snapshot = usePulse();
  const feed = usePulseFeed();
  const ridgeHead = useRidgeHead();
  const floor = useFloorStatus();
  const { pulse, status, recent, lastBlockAt, source, head } = snapshot;
  const meta = STATUS[status];
  const summitStatus: HeadStatus = status === "live" || status === "fallback" ? "live" : status === "stale" ? "stale" : status === "offline" ? "offline" : "connecting";
  const summitHead = useSteady(head?.number ?? pulse?.head ?? null);
  const rows = useRegisterRows(recent, lastBlockAt);
  const perMinute = pulse && pulse.blockTimeMs > 0 ? Math.round(60_000 / pulse.blockTimeMs) : null;

  return (
    <div className="mx-auto flex max-w-[1440px] flex-col gap-16 px-4 pb-10 pt-10 sm:px-6 lg:gap-20 lg:px-10 lg:pt-14">
      <header className="grid gap-8 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)] lg:items-end">
        <div className="flex flex-col gap-6">
          <Tag className="self-start">Sheet 10 · the weather station · Elysium testnet</Tag>
          <h1 className="text-[48px] font-bold leading-[0.98] tracking-[-0.03em] text-balance sm:text-[68px] xl:text-[76px]">Elysium, one block at a time.</h1>
          <p className="max-w-[38rem] text-[18px] leading-relaxed text-ink-2">
            Every block lands on the drum as it is made{perMinute ? <>, about <b className="tnum font-mono text-ink">{perMinute.toLocaleString("en-US")}</b> a minute</> : null}. Heads of all three layers, the cadence, the gas and who is building on the summit.
          </p>
        </div>
        <div className="flex flex-col items-start gap-3 lg:items-end">
          <Badge tone={meta.tone} dot={summitStatus === "live" ? "pulse" : true} size="md">
            {meta.label}
          </Badge>
          <p className="max-w-[28rem] font-mono text-[12px] leading-relaxed text-ink-2 lg:text-right">
            {source === "rpc" ? "Polled from Elysium's public RPC by your browser; the Elyia API is not answering." : source === "api" ? "Streamed by the Elyia API, one event per block." : "Waiting for the first block."}
          </p>
        </div>
      </header>

      <section aria-label="Barograph" className="flex flex-col gap-3">
        <Barograph feed={feed} height={168} speed={80} readout={summitHead !== null ? `#${formatBlockNumber(summitHead)}` : undefined} label="Elysium testnet barograph, one ink tick per block; taller ticks carry more transactions" className="shadow-hard-xl" />
      </section>

      <section aria-labelledby="altimeter-title" className="flex flex-col gap-5">
        <h2 id="altimeter-title" className="caption !text-ink">
          Layer altimeter · heads of the three altitudes
        </h2>
        <div className="grid grid-cols-1 gap-[2px] border-2 border-rule bg-rule md:grid-cols-3">
          <AltitudeCell layer="summit" name="Summit" network="Elysium 99801" head={summitHead} status={summitStatus} note="Kinetiq's Orbit L2. Its blocks are the ticks on the drum." />
          <AltitudeCell layer="ridge" name="Ridge" network="HyperEVM 998" head={ridgeHead.head} status={ridgeHead.status} note="Elysium settles here. Read with eth_blockNumber every 4 s." />
          <AltitudeCell layer="floor" name="Floor" network="HyperCore" head={floor.head} status={floor.status} note="The order books. HyperCore has no cheap public head, so we show whether it answers." />
        </div>
      </section>

      <section aria-labelledby="instruments-title" className="grid gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <h2 id="instruments-title" className="sr-only">
          Instruments
        </h2>
        <div className="border-2 border-rule bg-card p-5 shadow-hard-lg">
          <p className="caption mb-4 !text-ink">Block time · how often each cadence came round</p>
          <BlockTimeHistogram recent={recent} source={source} />
        </div>
        <div className="flex flex-col gap-4 border-2 border-rule bg-card p-5 shadow-hard-lg">
          <Gauge label="Block time · measured" value={pulse ? String(Math.round(pulse.blockTimeMs)) : "—"} unit="ms" note={source === "rpc" ? "measured in your browser over the last ~40 blocks" : "wall clock over the last ~40 blocks; nominal 114 ms"} />
          <Gauge label="Base fee · floor 0.1 gwei" value={pulse ? formatGwei(pulse.gasPriceGwei, { unit: false }) : "—"} unit="gwei" note="paid in HYPE; the floor holds until blocks fill" />
          <Gauge label="Throughput" value={pulse ? formatTps(pulse.tps) : "—"} unit="tx/s" note={pulse ? `${formatGas(String(pulse.gasPerSecond))} gas per second` : "user transactions only"} />
        </div>
      </section>

      <section aria-labelledby="register-title" className="grid gap-6 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <h2 id="register-title" className="text-[30px] font-bold leading-tight tracking-[-0.02em]">
            Summit register
          </h2>
          <SummitRegister rows={rows} caption="Latest Elysium testnet blocks, newest first" empty={<p className="font-mono text-[13px] text-ink-2">Waiting for the first block…</p>} />
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <h2 className="text-[30px] font-bold leading-tight tracking-[-0.02em]">Bridges and retryables</h2>
          <div className="border-2 border-rule bg-card p-5 shadow-hard-lg">
            <ChainFacts />
          </div>
        </div>
      </section>

      <Reveal as="section" className="flex flex-col gap-5">
        <h2 className="text-[30px] font-bold leading-tight tracking-[-0.02em]">The canonical bridge, both sides</h2>
        <div className="border-2 border-rule bg-card p-5 shadow-hard-lg">
          <BridgeContracts />
        </div>
      </Reveal>

      <Reveal as="section" className="flex flex-col gap-6">
        <div className="flex flex-col gap-4">
          <Tag className="self-start">Trail signs · the ecosystem registry</Tag>
          <h2 className="max-w-[22ch] text-[40px] font-bold leading-[1.02] tracking-[-0.02em] text-balance sm:text-[52px]">Who is building on the range.</h2>
          <p className="max-w-[40rem] text-[17px] leading-relaxed text-ink-2">
            Every protocol in Elyia&apos;s registry, filed under the highest altitude it stands on. A sign reads OPEN only once its contracts or endpoints were seen working; everything else is CAUTION with the reason.
          </p>
        </div>
        <Registry />
      </Reveal>

      <nav aria-label="Explorers" className="flex flex-wrap items-center gap-x-6 gap-y-3 border-t-2 border-rule pt-6 font-mono text-[12px] uppercase tracking-[0.12em]">
        <span className="text-ink-2">Explorers</span>
        {EXPLORER ? (
          <a href={EXPLORER.url} target="_blank" rel="noopener noreferrer" className={cx("text-ink underline decoration-accent-line decoration-2 underline-offset-4 hover:decoration-ink", FOCUS_RING)}>
            {EXPLORER.name} ↗<span className="sr-only"> (opens in a new tab)</span>
          </a>
        ) : null}
        {RIDGE_EXPLORER ? (
          <a href={RIDGE_EXPLORER.url} target="_blank" rel="noopener noreferrer" className={cx("text-ink underline decoration-accent-line decoration-2 underline-offset-4 hover:decoration-ink", FOCUS_RING)}>
            HyperEVM testnet · {RIDGE_EXPLORER.name} ↗<span className="sr-only"> (opens in a new tab)</span>
          </a>
        ) : null}
        <a href="https://app.hyperliquid-testnet.xyz/explorer" target="_blank" rel="noopener noreferrer" className={cx("text-ink underline decoration-accent-line decoration-2 underline-offset-4 hover:decoration-ink", FOCUS_RING)}>
          HyperCore testnet ↗<span className="sr-only"> (opens in a new tab)</span>
        </a>
      </nav>
    </div>
  );
}
