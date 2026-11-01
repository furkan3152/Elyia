import { useMemo, useState } from "react";

import { Link } from "../../app/routes/Link";
import { routeHref } from "../../app/routes/routeTable";
import { Cards, Section } from "../../pixel/layout";
import { PixelTerrain } from "../../pixel/PixelTerrain";
import { terrainModel, type TerrainHolding } from "../../pixel/terrain";
import { Badge } from "../../ui/Badge";
import { cx, FOCUS_RING } from "../../ui/cx";
import { Slider } from "../../ui/Slider";
import { useMeasuredWidth } from "../../topo/useMeasuredWidth";
import { layerShares, shockedNetWorth, shortAddress, terrainHoldings, usd } from "./model";
import { Readout } from "./PulseReadouts";
import type { TraderView } from "./useTrader";

const LAYER = {
  floor: { name: "Floor", net: "HyperCore", fill: "bg-floor", text: "text-floor" },
  ridge: { name: "Ridge", net: "HyperEVM", fill: "bg-ridge", text: "text-ridge" },
  summit: { name: "Summit", net: "Elysium", fill: "bg-summit-ink", text: "text-summit-ink" },
} as const;

function compact(value: number): string {
  if (value >= 100_000) return `$${Math.round(value / 1000)}k`;
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

/** The net worth split by altitude: one pixel bar in three bands, each named (never colour alone). */
function LayerBar({ trader }: { readonly trader: TraderView }) {
  const shares = layerShares(trader.snapshot);
  return (
    <div className="px-4 pb-4 pt-4 sm:px-6">
      <div className="flex h-4 w-full bg-paper-2 px-frame-thin" aria-hidden="true">
        {shares.map((share) => (share.share > 0 ? <span key={share.layer} className={cx("h-full", LAYER[share.layer].fill)} style={{ width: `${(share.share * 100).toFixed(2)}%` }} /> : null))}
      </div>
      <ul className="m-0 mt-4 grid list-none grid-cols-3 gap-2 p-0 text-center">
        {shares.map((share) => (
          <li key={share.layer} className="flex min-w-0 flex-col items-center">
            <span className={cx("font-tag text-[11px] uppercase", LAYER[share.layer].text)}>
              {LAYER[share.layer].name}
              <span className="hidden sm:inline"> · {LAYER[share.layer].net}</span>
            </span>
            <span className="tnum font-mono text-[12px] text-ink-2">
              {usd(share.usd)} · {Math.round(share.share * 100)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The trader's book as a pixel elevation map with the shock slider: drag the
 * market down and the hills sink; a rope shorter than the fall snaps into a
 * lake and Ely starts to worry. The readouts below re-price the real book.
 */
export function TerrainSection({ trader }: { readonly trader: TraderView }) {
  const [shock, setShock] = useState(0);
  const [selected, setSelected] = useState<TerrainHolding | null>(null);
  const holdings = useMemo(() => terrainHoldings(trader.snapshot), [trader.snapshot]);
  const model = useMemo(() => terrainModel(holdings, 40, 22, shock), [holdings, shock]);
  const priced = useMemo(() => shockedNetWorth(trader.snapshot, shock), [trader.snapshot, shock]);
  const hills = holdings.filter((holding) => holding.side !== "short");
  const standing = model.peaks.filter((peak) => !peak.lake).length;
  const change = priced.netWorth - trader.snapshot.totals.netWorthUsd;
  const { sample, snapshot } = trader;
  const [measure, width] = useMeasuredWidth<HTMLDivElement>(1000);
  const narrow = width < 640;

  return (
    <Section
      id="terrain"
      tag="Portfolio · pixel elevation map"
      title="Your money is terrain. Shocks bring the peaks down."
      lede="Every holding is a hill, every short a lake. Drag the shock: the hills sink, a rope shorter than the fall snaps and its hill becomes a lake, and Ely, standing on the tallest peak, starts to worry."
    >
      <div ref={measure} className="mx-auto max-w-[1000px]">
        <div className="mb-6 flex justify-center">
          {sample ? (
            <Badge tone="signal" variant="solid">
              Sample range{trader.loading ? " · reaching the API" : ""}
            </Badge>
          ) : (
            <Badge tone="up" dot="pulse">
              Live · <span className="normal-case">{shortAddress(snapshot.address)}</span> · net worth {usd(snapshot.totals.netWorthUsd)}
            </Badge>
          )}
        </div>
        <figure className="m-0 bg-card px-frame px-drop-lg">
          <PixelTerrain
            holdings={holdings}
            shock={shock}
            onSelect={setSelected}
            selectedId={selected?.id ?? null}
            formatUsd={compact}
            aspect={narrow ? 0.95 : 0.55}
            resolution={narrow ? 120 : 200}
            label={`${sample ? "Sample portfolio" : `Live portfolio of testnet trader ${shortAddress(snapshot.address)}`} as a pixel elevation map at a ${shock}% shock: ${model.peaks.map((peak) => `${peak.holding.label} ${peak.snapped ? "rope snapped" : peak.lake ? "short (lake)" : compact(peak.value)}`).join(", ")}`}
          />
          <figcaption className="border-t-2 border-rule">
            <LayerBar trader={trader} />
          </figcaption>
        </figure>

        <div className="mx-auto mt-12 max-w-[560px]">
          <Slider
            label="Market shock"
            value={shock}
            onChange={setShock}
            min={-30}
            max={30}
            ticks={narrow ? [-30, 0, 30] : [-30, -20, -10, 0, 10, 20, 30]}
            format={(value) => `${value > 0 ? "▲ +" : value < 0 ? "▼ " : ""}${value}%`}
            dangerFrom={31}
          />
        </div>
        <p className="mt-4 min-h-6 text-center font-mono text-[13px] text-ink-2" aria-live="polite">
          {selected ? (
            <>
              <span className="font-tag uppercase text-ink">{selected.label}</span> · {usd(selected.usd)}
              {typeof selected.rope === "number" ? ` · rope ${Math.round(selected.rope)}%` : " · no rope"}
            </>
          ) : (
            "Select a peak label to read it."
          )}
        </p>

        <Cards n={3} className="mt-8">
          <Readout label="Net worth at this shock" note={shock === 0 || change === 0 ? "as read now" : `${change > 0 ? "▲ +" : "▼ −"}${usd(Math.abs(change))} · estimate`}>
            <span className="tnum font-display text-[30px] font-bold leading-none text-ink sm:text-[34px]">{usd(priced.netWorth)}</span>
          </Readout>
          <Readout label="Ropes snapped" note={model.snaps ? "Ely is worried" : "every rope holds"}>
            <span className={cx("tnum font-display text-[30px] font-bold leading-none sm:text-[34px]", model.snaps ? "text-down" : "text-up")}>{model.snaps ? `▼ ${model.snaps}` : "▲ 0"}</span>
          </Readout>
          <Readout label="Peaks standing" note="hills still above the water">
            <span className="tnum font-display text-[30px] font-bold leading-none text-ink sm:text-[34px]">
              {standing} / {hills.length}
            </span>
          </Readout>
        </Cards>
        <p className="mt-10 text-center font-mono text-[12px] leading-relaxed text-ink-2">
          {sample ? "A sample range, labelled as such: the Elyia API did not answer." : "A real trader on the HyperCore testnet, read now and every 30 s."} USD at HyperCore mainnet reference prices.{" "}
          <Link to={sample ? routeHref("portfolio") : routeHref("portfolio", { address: snapshot.address })} className={cx("text-ink underline decoration-accent-line decoration-2 underline-offset-4 hover:decoration-ink", FOCUS_RING)}>
            Survey {sample ? "your own" : "this one"} →
          </Link>
        </p>
      </div>
    </Section>
  );
}
