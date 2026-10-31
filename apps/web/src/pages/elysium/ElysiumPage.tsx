import { NETWORKS } from "@elyia/core/networks";
import { PROTOCOLS } from "@elyia/core/protocols";
import type { PulseBlock } from "@elyia/core/pulse";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useFloorStatus, useRidgeHead, type HeadStatus } from "../../app/shell/useLayerHeads";
import { useResolvedTheme } from "../../app/state/useTheme";
import { usePulse, usePulseFeed } from "../../hooks/usePulse";
import { formatBlockNumber, formatGas, formatGwei, formatTps } from "../../lib/format";
import type { PulseStatus } from "../../lib/pulse/pulseHub";
import { Cards, Page, Section, Split } from "../../pixel/layout";
import { PixelAltimeter } from "../../pixel/PixelAltimeter";
import { PixelBarograph } from "../../pixel/PixelBarograph";
import { PixelCanvas } from "../../pixel/PixelCanvas";
import { PixelGlyph } from "../../pixel/PixelGlyph";
import { ConditionSign } from "../../topo/ConditionSign";
import type { Layer } from "../../topo/geometry/relief";
import { useMeasuredWidth } from "../../topo/useMeasuredWidth";
import { Badge } from "../../ui/Badge";
import { cx, FOCUS_RING } from "../../ui/cx";
import type { Tone } from "../../ui/tones";
import { Readout } from "../landing/PulseReadouts";
import { BridgeContracts, ChainFacts } from "./ChainFacts";
import { BlockTimeHistogram } from "./Histogram";
import { ageLabel } from "./model";
import { BADGE_H, BADGE_W, paintLayerPeak, SIGN_GLYPH } from "./pixelParts";
import { trailSigns, type TrailSign } from "./registry";
import { paintStation, STATION_ASPECT } from "./station";
import { useSteady } from "./useSteady";

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
const LINK = cx("text-ink underline decoration-accent-line decoration-2 underline-offset-4 hover:decoration-ink", FOCUS_RING);

/* The station ------------------------------------------------------------- */

/** The hero: the weather station on the Elysium summit. Ely keeps watch with a lamp by NIGHT; the cups turn with tx/s. */
function StationScene({ tps }: { readonly tps: number | null }) {
  const theme = useResolvedTheme();
  const night = theme === "dark";
  const rate = useRef(tps);
  const [measure, width] = useMeasuredWidth<HTMLDivElement>(1200);
  const narrow = width < 640;
  useEffect(() => {
    rate.current = tps;
  }, [tps]);
  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, info: { readonly w: number; readonly h: number; readonly seconds: number; readonly still: boolean }) => paintStation(ctx, info.w, info.h, { seconds: info.seconds, still: info.still, night, tps: rate.current }),
    [night],
  );
  return (
    <div ref={measure} className="bg-card px-frame px-drop-lg">
      <PixelCanvas
        width={240}
        height={86}
        pixelSize={narrow ? 2 : 5}
        aspect={narrow ? 0.62 : STATION_ASPECT}
        draw={draw}
        animate
        fps={10}
        redrawKey={theme}
        label={night ? "The weather station on the Elysium summit at night: Ely keeps watch with a lamp beam sweeping under the stars; the anemometer turns with the chain's throughput" : "The weather station on the Elysium summit by day: Ely reads the instruments beside the hut; the anemometer turns with the chain's throughput"}
      />
    </div>
  );
}

/* Altimeter heads --------------------------------------------------------- */

function LayerPeak({ layer }: { readonly layer: Layer }) {
  const draw = useCallback((ctx: CanvasRenderingContext2D, info: { readonly seconds: number; readonly still: boolean }) => paintLayerPeak(ctx, layer, info.seconds, info.still), [layer]);
  return <PixelCanvas width={BADGE_W} height={BADGE_H} scale={3} draw={draw} animate={layer === "summit"} fps={4} decorative />;
}

/** One altitude of the layer altimeter: its peak, name, head and how fresh it is. */
function AltitudeCard({ layer, name, network, head, status, note }: { readonly layer: Layer; readonly name: string; readonly network: string; readonly head: number | null; readonly status: HeadStatus; readonly note: string }) {
  return (
    <li className="flex h-full flex-col items-center gap-3 bg-card px-4 pb-5 pt-5 text-center px-frame px-drop">
      <LayerPeak layer={layer} />
      <p className="flex flex-col items-center gap-0.5">
        <span className={cx("font-display text-[24px] font-bold leading-none", LAYER_TEXT[layer])}>{name}</span>
        <span className="font-tag text-[11px] uppercase text-ink-2">
          {network} · <span className={status === "live" ? "text-up" : status === "offline" ? "text-down" : ""}>{HEAD_WORD[status]}</span>
        </span>
      </p>
      <div className="flex min-h-[44px] items-center">
        {head !== null ? (
          <PixelAltimeter value={formatBlockNumber(head)} label={`${name} head`} size="sm" markLatest />
        ) : (
          <span className="font-display text-[26px] font-bold leading-none text-ink-3">{status === "live" ? "answering" : "—"}</span>
        )}
      </div>
      <p className="mt-auto text-[13px] leading-snug text-ink-2">{note}</p>
    </li>
  );
}

/* Register ------------------------------------------------------------------ */

interface RegisterLine {
  readonly id: string;
  readonly number: number;
  readonly txCount: number;
  readonly gas: string;
  readonly fee: string;
  readonly age: string;
}

/** The register redraws twice a second (not per block), newest first; ages are skew-free relative to the newest block's arrival. */
function useRegisterRows(recent: readonly PulseBlock[], lastBlockAt: number | null): RegisterLine[] {
  const latest = useRef({ recent, lastBlockAt });
  useEffect(() => {
    latest.current = { recent, lastBlockAt };
  }, [recent, lastBlockAt]);
  const [rows, setRows] = useState<RegisterLine[]>([]);
  useEffect(() => {
    const build = () => {
      const { recent: blocks, lastBlockAt: arrived } = latest.current;
      const head = blocks[blocks.length - 1];
      const now = Date.now();
      setRows(
        blocks
          .slice(-8)
          .reverse()
          .map((block) => ({
            id: block.hash,
            number: block.number,
            txCount: block.txCount,
            gas: formatGas(block.gasUsed),
            fee: formatGwei(block.baseFeeGwei),
            age: ageLabel(head && arrived !== null ? now - arrived + (head.seenAt - block.seenAt) : null),
          })),
      );
    };
    build();
    const timer = window.setInterval(build, 500);
    return () => window.clearInterval(timer);
  }, []);
  return rows;
}

/** The summit register: the latest blocks, each with its transactions as pixel blocks. */
function BlockRegister({ rows }: { readonly rows: readonly RegisterLine[] }) {
  if (rows.length === 0) return <p className="py-8 text-center font-mono text-[13px] text-ink-2">Waiting for the first block…</p>;
  return (
    <ol aria-label="Latest Elysium testnet blocks, newest first" className="m-0 flex list-none flex-col p-0">
      {rows.map((row, index) => (
        <li key={row.id} className={cx("grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 py-2", index > 0 && "border-t-2 border-dashed border-rule/20")}>
          <span className="flex min-w-0 flex-col">
            {EXPLORER ? (
              <a href={`${EXPLORER.url}/block/${row.number}`} target="_blank" rel="noopener noreferrer" className={cx("tnum self-start font-display text-[18px] font-bold leading-tight text-ink hover:text-summit-ink", FOCUS_RING)}>
                #{formatBlockNumber(row.number)}
                <span className="sr-only"> on the explorer (opens in a new tab)</span>
              </a>
            ) : (
              <span className="tnum font-display text-[18px] font-bold leading-tight text-ink">#{formatBlockNumber(row.number)}</span>
            )}
            <span className="tnum truncate font-mono text-[11px] text-ink-2">
              {row.txCount} {row.txCount === 1 ? "tx" : "txs"} · {row.gas} gas · {row.fee}
            </span>
          </span>
          <span className="flex flex-col items-end gap-1">
            <span aria-hidden="true" className="flex gap-[3px]">
              {Array.from({ length: Math.min(10, row.txCount) }, (_, i) => (
                <span key={i} className={cx("h-2 w-2", index === 0 ? "bg-signal" : "bg-summit")} />
              ))}
              {row.txCount > 10 ? <span className="font-tag text-[9px] leading-none text-ink-2">+</span> : null}
            </span>
            <span className="tnum font-mono text-[11px] text-ink-3">{row.age}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

/* Trail signs ---------------------------------------------------------------- */

const SIGN_PALETTE = { open: { k: "#16201B", b: "#1F7A4C", p: "#8A5A2B" }, caution: { k: "#16201B", b: "#D9822B", p: "#8A5A2B" }, closed: { k: "#16201B", b: "#C62D1F", p: "#8A5A2B" } } as const;

function TrailSignCard({ sign }: { readonly sign: TrailSign }) {
  return (
    <li className="flex h-full items-center gap-4 bg-card px-4 py-3 px-frame px-drop">
      <PixelGlyph rows={SIGN_GLYPH} scale={4} palette={SIGN_PALETTE[sign.condition]} label={null} className="shrink-0" />
      <span className="flex min-w-0 flex-1 flex-col">
        <a href={sign.url} target="_blank" rel="noopener noreferrer" className={cx("font-display text-[18px] font-bold leading-tight text-ink underline decoration-transparent decoration-2 underline-offset-4 hover:decoration-accent-line", FOCUS_RING)}>
          {sign.name}
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
        <span className="truncate font-tag text-[10px] uppercase text-ink-2">
          {sign.category}
          {sign.routable ? " · routable" : ""}
        </span>
        <span className="truncate text-[12px] leading-snug text-ink-3">{sign.reason}</span>
      </span>
      <ConditionSign condition={sign.condition} size="sm" className="shrink-0" />
    </li>
  );
}

const ALTITUDE: Readonly<Record<Layer, { readonly title: string; readonly sub: string }>> = {
  summit: { title: "The Summit", sub: "Elysium" },
  ridge: { title: "The Ridge", sub: "HyperEVM" },
  floor: { title: "The Floor", sub: "HyperCore" },
};

function Registry() {
  const signs = useMemo(() => trailSigns(PROTOCOLS), []);
  return (
    <div className="flex flex-col gap-14">
      {(["summit", "ridge", "floor"] as const).map((layer) => {
        const open = signs[layer].filter((sign) => sign.condition === "open").length;
        return (
          <section key={layer} aria-labelledby={`alt-${layer}`}>
            <header className="mb-8 flex flex-col items-center gap-1 text-center">
              <h3 id={`alt-${layer}`} className={cx("font-display text-[30px] font-bold leading-none", LAYER_TEXT[layer])}>
                {ALTITUDE[layer].title}
              </h3>
              <span className="font-tag text-[11px] uppercase text-ink-2">
                {ALTITUDE[layer].sub} · {signs[layer].length} signs · {open} open
              </span>
            </header>
            <Cards n={3} as="ul">
              {signs[layer].map((sign) => (
                <TrailSignCard key={sign.id} sign={sign} />
              ))}
            </Cards>
          </section>
        );
      })}
    </div>
  );
}

/* The page ------------------------------------------------------------------- */

/** "/elysium": the pixel weather station on the summit. Elysium's blocks, heads, cadence, gas and ecosystem, live. */
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
    <Page className="!pt-0">
      <Section
        id="station"
        level={1}
        tag="Sheet 10 · the weather station · Elysium testnet"
        title="Elysium, one block at a time."
        lede={
          <>
            Every block lands on the drum as it is made{perMinute ? <>, about <b className="tnum text-ink">{perMinute.toLocaleString("en-US")}</b> a minute</> : null}. The heads of all three layers, the cadence, the gas and who is building on the summit, read live.
          </>
        }
        actions={
          <Badge tone={meta.tone} dot={summitStatus === "live" ? "pulse" : true} size="md">
            {meta.label}
          </Badge>
        }
      >
        <StationScene tps={pulse?.tps ?? null} />
        <p className="mt-5 text-center font-tag text-[11px] uppercase text-ink-2">
          {source === "rpc" ? "Polled from Elysium's public RPC by your browser · the Elyia API is not answering" : source === "api" ? "Streamed by the Elyia API · one event per block" : "Waiting for the first block"}
        </p>
      </Section>

      <Section id="drum" tag="Barograph · one tick per block" title="The drum turns once a block." lede="Each pixel tick is one Elysium block, taller with more transactions; the newest is yellow. Below, the instruments that read it.">
        <PixelBarograph feed={feed} height={200} readout={summitHead !== null ? `#${formatBlockNumber(summitHead)}` : undefined} label="Elysium testnet barograph: one pixel tick per block, taller ticks carry more transactions" />
        <Cards n={3} className="mt-12">
          <Readout label="Block time · measured" note={source === "rpc" ? "measured in your browser, last ~40 blocks" : "wall clock, last ~40 blocks · nominal 114 ms"}>
            <Figure value={pulse ? String(Math.round(pulse.blockTimeMs)) : null} unit="ms" />
          </Readout>
          <Readout label="Base fee · floor 0.1 gwei" note="paid in HYPE; the floor holds until blocks fill">
            <Figure value={pulse ? formatGwei(pulse.gasPriceGwei, { unit: false }) : null} unit="gwei" />
          </Readout>
          <Readout label="Throughput" note={pulse ? `${formatGas(String(pulse.gasPerSecond))} gas per second` : "user transactions only"}>
            <Figure value={pulse ? formatTps(pulse.tps) : null} unit="tx/s" />
          </Readout>
        </Cards>
      </Section>

      <Section id="altimeter" tag="Layer altimeter · three heads" title="Three altitudes, one range." lede="The head block of every layer, read where it lives. Digits roll only when they change, at most once a second.">
        <Cards n={3} as="ul">
          <AltitudeCard layer="floor" name="Floor" network="HyperCore" head={floor.head} status={floor.status} note="The order books. HyperCore has no cheap public head, so we show whether it answers." />
          <AltitudeCard layer="ridge" name="Ridge" network="HyperEVM 998" head={ridgeHead.head} status={ridgeHead.status} note="Elysium settles here. Read with eth_blockNumber every 4 s." />
          <AltitudeCard layer="summit" name="Summit" network="Elysium 99801" head={summitHead} status={summitStatus} note="Kinetiq's Orbit L2. Its blocks are the ticks on the drum." />
        </Cards>
      </Section>

      <Section id="cadence" tag="Cadence · the register" title="How often the summit beats." lede="On the left, how often each block time came round; on the right, the latest blocks as they were signed into the summit register.">
        <Split>
          <div className="flex h-full flex-col bg-card p-5 px-frame px-drop sm:p-6">
            <h3 className="mb-5 text-center font-tag text-[12px] uppercase text-ink">Block time · how often each cadence came round</h3>
            <BlockTimeHistogram recent={recent} source={source} />
          </div>
          <div className="flex h-full min-w-0 flex-col bg-card p-5 px-frame px-drop sm:p-6">
            <h3 className="mb-5 text-center font-tag text-[12px] uppercase text-ink">Summit register · newest first</h3>
            <BlockRegister rows={rows} />
          </div>
        </Split>
      </Section>

      <Section id="chain" tag="Chain facts · bridges" title="The canonical bridge, both sides." lede="Elysium's numbers from the verified registry and the chain, and the bridge contracts on HyperEVM and Elysium, with explorer links.">
        <Split>
          <div className="flex h-full flex-col bg-card p-5 px-frame px-drop sm:p-6">
            <h3 className="mb-3 text-center font-tag text-[12px] uppercase text-ink">Elysium testnet · facts</h3>
            <ChainFacts />
          </div>
          <div className="flex h-full flex-col bg-card p-5 px-frame px-drop sm:p-6">
            <h3 className="mb-5 text-center font-tag text-[12px] uppercase text-ink">Bridge contracts · HyperEVM and Elysium</h3>
            <BridgeContracts />
          </div>
        </Split>
      </Section>

      <Section
        id="registry"
        tag="Trail signs · the ecosystem registry"
        title="Who is building on the range."
        lede="Every protocol in Elyia's registry, filed under the highest altitude it stands on. A sign reads OPEN only once its contracts or endpoints were seen working; everything else is CAUTION, with the reason."
      >
        <Registry />
        <nav aria-label="Explorers" className="mt-16 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 font-tag text-[12px] uppercase">
          <span className="text-ink-2">Explorers</span>
          {EXPLORER ? (
            <a href={EXPLORER.url} target="_blank" rel="noopener noreferrer" className={LINK}>
              {EXPLORER.name} ↗<span className="sr-only"> (opens in a new tab)</span>
            </a>
          ) : null}
          {RIDGE_EXPLORER ? (
            <a href={RIDGE_EXPLORER.url} target="_blank" rel="noopener noreferrer" className={LINK}>
              HyperEVM testnet · {RIDGE_EXPLORER.name} ↗<span className="sr-only"> (opens in a new tab)</span>
            </a>
          ) : null}
          <a href="https://app.hyperliquid-testnet.xyz/explorer" target="_blank" rel="noopener noreferrer" className={LINK}>
            HyperCore testnet ↗<span className="sr-only"> (opens in a new tab)</span>
          </a>
        </nav>
      </Section>
    </Page>
  );
}

function Figure({ value, unit }: { readonly value: string | null; readonly unit: string }) {
  return (
    <span className={cx("tnum font-display text-[34px] font-bold leading-none", value === null ? "text-ink-3" : "text-ink")}>
      {value ?? "—"}
      {value !== null ? <span className="ml-1.5 font-tag text-[12px] font-normal uppercase text-ink-2">{unit}</span> : null}
    </span>
  );
}
