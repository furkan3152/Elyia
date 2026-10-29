import { useMemo } from "react";

import { Link } from "../../app/routes/Link";
import { routeHref } from "../../app/routes/routeTable";
import { Altimeter } from "../../topo/Altimeter";
import type { Layer } from "../../topo/geometry/relief";
import { Relief } from "../../topo/Relief";
import { useMeasuredWidth } from "../../topo/useMeasuredWidth";
import { Badge } from "../../ui/Badge";
import { cx, FOCUS_RING } from "../../ui/cx";
import { layerShares, mapScale, reliefHoldings, shortAddress, signedUsd, usd } from "./model";
import type { TraderView } from "./useTrader";

const LAYER_NAME: Readonly<Record<Layer, string>> = { floor: "Floor", ridge: "Ridge", summit: "Summit" };
const LAYER_FILL: Readonly<Record<Layer, string>> = { floor: "bg-floor", ridge: "bg-ridge", summit: "bg-summit-ink" };
const LAYER_TEXT: Readonly<Record<Layer, string>> = { floor: "text-floor", ridge: "text-ridge", summit: "text-summit-ink" };

/** Where an empty altitude says so (centres of the Relief's region boxes). */
const EMPTY_SPOTS: ReadonlyArray<{ readonly layer: Layer; readonly network: string; readonly x: number; readonly y: number }> = [
  { layer: "ridge", network: "HyperEVM", x: 0.8, y: 0.42 },
  { layer: "summit", network: "Elysium", x: 0.5, y: 0.86 },
];

function compactUsd(value: number): string {
  if (value >= 100_000) return `$${Math.round(value / 1000)}k`;
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

/** The net worth split by altitude: one bar, three bands, each labelled (never colour alone). */
function LayerBar({ trader }: { readonly trader: TraderView }) {
  const shares = layerShares(trader.snapshot);
  return (
    <div className="px-4 pb-3.5 pt-3">
      <div className="flex h-3 w-full overflow-hidden border-1.5 border-rule bg-paper-2" aria-hidden="true">
        {shares.map((share) =>
          share.share > 0 ? <span key={share.layer} className={cx("h-full border-r-1.5 border-rule last:border-r-0", LAYER_FILL[share.layer])} style={{ width: `${(share.share * 100).toFixed(2)}%` }} /> : null,
        )}
      </div>
      <ul className="mt-2 grid grid-cols-3 gap-2 font-mono text-[11px] text-ink-2">
        {shares.map((share) => (
          <li key={share.layer} className="flex min-w-0 flex-col sm:flex-row sm:items-baseline sm:gap-1.5">
            <span className={cx("font-sans text-[12px] font-bold uppercase tracking-[0.06em]", LAYER_TEXT[share.layer])}>{LAYER_NAME[share.layer]}</span>
            <span className="tnum truncate">
              {usd(share.usd)} · {Math.round(share.share * 100)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The hero art: a real trader's book as contour terrain. Live from GET
 * /v1/portfolio/:address (a public HyperCore testnet trader) when the API
 * answers; the labelled sample otherwise. The map is laid out in real pixels,
 * so its labels keep their size on a phone.
 */
export function HeroMap({ trader }: { readonly trader: TraderView }) {
  const [ref, width] = useMeasuredWidth<HTMLDivElement>(640);
  const narrow = width < 520;
  const holdings = useMemo(() => reliefHoldings(trader.snapshot, narrow ? 6 : 8), [trader.snapshot, narrow]);
  const scaled = useMemo(() => mapScale(holdings), [holdings]);
  // A phone keeps a 600 px sheet and pans it sideways (the Floor fills the first view), so labels never pile up.
  const mapWidth = narrow ? 600 : Math.max(320, width);
  const mapHeight = Math.round(narrow ? 440 : Math.min(560, Math.max(360, mapWidth * 0.7)));
  const { snapshot, sample } = trader;
  const pnl = snapshot.totals.unrealizedPnlUsd;

  return (
    <figure className="m-0 flex flex-col gap-3">
      <div className="border-2 border-rule bg-card shadow-hard-xl">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 border-b-2 border-rule px-4 py-2.5">
          <div className="flex min-w-0 items-baseline gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-2">
            <span>Net worth</span>
            <Altimeter value={usd(snapshot.totals.netWorthUsd)} label="Net worth" variant="inline" size="sm" className="text-ink" />
            <span className={cx("tnum normal-case tracking-normal", pnl > 0 ? "text-up" : pnl < 0 ? "text-down" : "text-ink-2")}>{signedUsd(pnl)}</span>
          </div>
          {sample ? (
            <Badge tone="signal" variant="solid">
              Sample range{trader.loading ? " · reaching the API" : ""}
            </Badge>
          ) : (
            <Badge tone="up" dot="pulse">
              Live · <span className="normal-case">{shortAddress(snapshot.address)}</span>
            </Badge>
          )}
        </div>
        <div ref={ref} className="relative min-w-0">
          <Relief
            holdings={scaled.holdings}
            width={mapWidth}
            height={mapHeight}
            minWidth={narrow ? 600 : 0}
            formatUsd={(value) => compactUsd(value / scaled.factor)}
            furniture={!narrow}
            seed={7}
            label={`${sample ? "Sample portfolio" : `Live portfolio of testnet trader ${shortAddress(snapshot.address)}`} as a relief map: ${holdings.map((h) => `${h.symbol}${h.side === "short" ? " short" : ""} ${compactUsd(h.usd)}`).join(", ")}`}
          />
          {narrow ? (
            <p aria-hidden="true" className="pointer-events-none absolute right-2 top-2 border-1.5 border-rule bg-card px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-2">
              Drag ↔ for the Ridge
            </p>
          ) : null}
          {EMPTY_SPOTS.filter(() => !narrow).filter((spot) => !holdings.some((holding) => holding.layer === spot.layer)).map((spot) => (
            <p
              key={spot.layer}
              className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3"
              style={{ left: `${spot.x * 100}%`, top: `${spot.y * 100}%` }}
            >
              unclimbed · {spot.network} $0
            </p>
          ))}
        </div>
        <div className="border-t-2 border-rule">
          <LayerBar trader={trader} />
        </div>
      </div>
      <figcaption className="max-w-[60ch] font-mono text-[12px] leading-relaxed text-ink-2">
        Map 01 · {sample ? "a sample range, labelled as such: the Elyia API did not answer." : <>a real trader on the HyperCore testnet, read now and every 30 s.</>} Hills are holdings, dashed basins are shorts, hatching is
        leverage. USD at HyperCore mainnet reference prices.{" "}
        <Link to={sample ? routeHref("portfolio") : routeHref("portfolio", { address: snapshot.address })} className={cx("text-ink underline decoration-accent-line decoration-2 underline-offset-4 hover:decoration-ink", FOCUS_RING)}>
          Survey {sample ? "your own" : "this one"} →
        </Link>
      </figcaption>
    </figure>
  );
}
