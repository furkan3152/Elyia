import type { PortfolioSnapshot } from "@elyia/core/api/portfolio";
import { useEffect, useMemo, useState } from "react";

import { routeHref } from "../../../app/routes/routeTable";
import type { RopeView } from "../../../features/trading/useTopoData";
import { intentHref } from "../../../oracle/preview";
import { KeySwatch } from "../../../topo/keySwatch";
import { MapKey, MapSheet, NorthArrow, ScaleBar } from "../../../topo/MapSheet";
import { Relief } from "../../../topo/Relief";
import { Rope } from "../../../topo/Rope";
import { ButtonLink } from "../../../ui/Button";
import { cx } from "../../../ui/cx";
import { useMeasuredWidth } from "../../../topo/useMeasuredWidth";
import { amount, pct, price, usdFull, usdShort, usdSigned } from "../range/format";
import { LAYER_NAME, LAYER_OF, NETWORK_NAME, type ReliefSource } from "../range/model";
import { useReliefPlan } from "../range/useReliefPlan";

const TONE = { floor: "text-floor", ridge: "text-ridge", summit: "text-summit-ink" } as const;

export interface ReliefSheetProps {
  readonly snapshot: PortfolioSnapshot;
  readonly ropes: readonly RopeView[];
  readonly selectedId?: string | null;
  readonly onSelect?: (id: string | null) => void;
  /** Sheet label (top left). */
  readonly label: string;
  /** Compact: the deck's card (no furniture row, shorter sheet). */
  readonly compact?: boolean;
  readonly sample?: boolean;
  readonly className?: string;
}


/** A round number of dollars for one scale-bar step (about a quarter of the largest hill). */
function scaleStep(maxUsd: number): number {
  const raw = maxUsd / 4;
  if (!(raw > 0)) return 1;
  const power = 10 ** Math.floor(Math.log10(raw));
  for (const nice of [1, 2, 2.5, 5, 10]) if (nice * power >= raw) return nice * power;
  return 10 * power;
}

/**
 * The range as a map sheet: the live Relief (hills = holdings, basins =
 * shorts, cliffs = leverage, regions = layers) in its frame with the net
 * worth in the elevation slot, a key, a scale bar and a north arrow.
 * Clicking a peak selects it.
 */
export function ReliefSheet({ snapshot, ropes, selectedId, onSelect, label, compact = false, sample = false, className }: ReliefSheetProps) {
  const plan = useReliefPlan(snapshot, ropes, compact ? 9 : 14);
  // Contours draw on once, when the sheet is first surveyed; later live updates redraw in place.
  const [drawOn, setDrawOn] = useState(true);
  useEffect(() => {
    const timer = window.setTimeout(() => setDrawOn(false), 4_000);
    return () => window.clearTimeout(timer);
  }, []);
  const [measure, width] = useMeasuredWidth<HTMLDivElement>(0);
  const narrow = width > 0 && width < 620;
  // On a phone the sheet turns portrait so labels keep their size; the map never pans.
  const mapW = narrow ? 560 : 900;
  const mapH = narrow ? 700 : 620;
  const interval = useMemo(() => {
    const max = plan.holdings[0]?.usd ?? 0;
    return max > 0 ? max / 16 : undefined;
  }, [plan.holdings]);
  // Peak labels print the exact value; anything else (contour interval, scale) is unscaled.
  const byHeight = useMemo(() => {
    const map = new Map<number, number>();
    for (const holding of plan.holdings) if (!map.has(holding.usd)) map.set(holding.usd, plan.exactUsd.get(holding.id) ?? holding.usd / plan.scale);
    return map;
  }, [plan]);
  const unscale = (value: number) => value / plan.scale;
  const labelUsd = (value: number) => byHeight.get(value) ?? unscale(value);
  const maxUsd = plan.holdings[0] ? unscale(plan.holdings[0].usd) : 0;
  const step = scaleStep(maxUsd);
  const summary =
    `${sample ? "Sample portfolio relief" : "Portfolio relief"}: ${plan.holdings.length} holdings drawn, ${usdShort(snapshot.totals.netWorthUsd)} in total. ` +
    plan.holdings
      .slice(0, 6)
      .map((holding) => `${holding.symbol}${holding.side === "short" ? " short" : ""} ${usdShort(labelUsd(holding.usd))} on the ${holding.layer}`)
      .join(", ") +
    (plan.hidden.count > 0 ? `; ${plan.hidden.count} small holdings not drawn.` : ".");

  return (
    <MapSheet
      className={className}
      label={label}
      elevation={
        <>
          NET WORTH <b className="text-sm text-ink">{usdFull(snapshot.totals.netWorthUsd)}</b>
          {snapshot.totals.unrealizedPnlUsd !== 0 ? <span className={snapshot.totals.unrealizedPnlUsd > 0 ? "text-up" : "text-down"}> {usdSigned(snapshot.totals.unrealizedPnlUsd, true)}</span> : null}
          <span className="hidden sm:inline"> · contour {usdShort(unscale(interval ?? 0))}</span>
        </>
      }
      titleBlock={compact ? undefined : { name: "Sheet 03 · Your range", date: new Date(snapshot.generatedAt).toISOString().slice(0, 10), mode: snapshot.mode === "testnet" ? "practice wall" : "mainnet", scale: `1 : ${Math.round(1 / plan.scale).toLocaleString("en-US")}` }}
      furniture={
        compact ? undefined : (
          <>
            <MapKey
              items={[
                { swatch: KeySwatch.line("rgb(var(--contour))"), label: `holding · ${usdShort(unscale(interval ?? 0))} contours` },
                { swatch: KeySwatch.line("rgb(var(--down))", true), label: "short basin" },
                { swatch: KeySwatch.peak(), label: "peak · tap for detail" },
              ]}
            />
            <ScaleBar labels={["0", usdShort(step), usdShort(step * 2)]} label={`Scale: one bar is ${usdShort(step)} of height`} />
            <NorthArrow />
          </>
        )
      }
    >
      <div ref={measure} className="relative">
        {plan.holdings.length === 0 ? (
          <div className="flex aspect-[900/520] flex-col items-center justify-center gap-2 p-6 text-center">
            <p className="map-label text-2xl text-ink-2">An empty range</p>
            <p className="max-w-sm text-sm text-ink-2">Nothing priced on any layer yet. Bridge or deposit and your first hill rises here.</p>
          </div>
        ) : (
          <Relief
            key={`${mapW}x${mapH}`}
            holdings={plan.holdings}
            width={mapW}
            height={mapH}
            interval={interval}
            drawOn={drawOn}
            formatUsd={(value) => usdShort(labelUsd(value))}
            furniture={false}
            minWidth={0}
            label={summary}
            selectedId={selectedId ?? null}
            onSelect={onSelect ? (holding) => onSelect(holding.id === selectedId ? null : holding.id) : undefined}
          />
        )}
        {plan.hidden.count > 0 ? (
          <p className="border-t-1.5 border-rule/40 px-3.5 py-1.5 font-mono text-[11px] text-ink-2">
            + {plan.hidden.count} small holding{plan.hidden.count === 1 ? "" : "s"} · {usdShort(plan.hidden.usd)} not drawn
          </p>
        ) : null}
        {sample ? <span className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rotate-[4deg] border-2 border-rule bg-signal px-2 py-0.5 font-mono text-[11px] font-semibold tracking-[0.14em] text-signal-ink">SAMPLE</span> : null}
      </div>
    </MapSheet>
  );
}

/** What a selected peak stands for: the holding, its share, its rope, and the next move. */
export function PeakDetail({ source, ropes, worth, onClose, className }: { readonly source: ReliefSource; readonly ropes: readonly RopeView[]; readonly worth: number; readonly onClose: () => void; readonly className?: string }) {
  if (source.kind === "position") {
    const position = source.position;
    const rope = ropes.find((entry) => entry.coin === position.coin && entry.dex === position.dex);
    const notional = Math.abs(position.positionValueUsd ?? position.positionValue);
    return (
      <article className={cx("border-2 border-rule bg-card p-4 shadow-hard", className)} aria-label={`${position.coin} position`}>
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="caption">
              <span className="text-floor">FLOOR</span> · HyperCore perp · {position.leverage.type}
            </p>
            <h3 className="mt-1 text-2xl font-bold tracking-[-0.01em] text-ink">
              {position.coin} {position.side === "long" ? "▲" : "▼"} {position.leverage.value}× {position.side}
            </h3>
          </div>
          <button type="button" onClick={onClose} className="font-mono text-xs text-ink-2 underline decoration-dotted underline-offset-2 hover:text-ink">
            close ✕
          </button>
        </header>
        <dl className="tnum mt-3 grid grid-cols-2 gap-x-4 gap-y-2 font-mono text-[13px] sm:grid-cols-4">
          <div>
            <dt className="text-ink-3">size</dt>
            <dd className="text-ink">
              {amount(Number(position.size))} · {usdShort(notional)}
            </dd>
          </div>
          <div>
            <dt className="text-ink-3">entry → mark</dt>
            <dd className="text-ink">
              {price(Number(position.entryPx))} → {price(rope?.markPx ?? position.markPx)}
            </dd>
          </div>
          <div>
            <dt className="text-ink-3">open PnL</dt>
            <dd className={position.unrealizedPnl >= 0 ? "text-up" : "text-down"}>{usdSigned(rope?.unrealizedPnl ?? position.unrealizedPnl)}</dd>
          </div>
          <div>
            <dt className="text-ink-3">funding since open</dt>
            <dd className={position.fundingSinceOpen >= 0 ? "text-up" : "text-down"}>{usdSigned(position.fundingSinceOpen)}</dd>
          </div>
        </dl>
        {rope ? (
          <div className="mt-4">
            <Rope symbol={position.coin} side={rope.side} entry={rope.entryPx} mark={rope.markPx} liquidation={rope.liquidationPx} stop={rope.sl?.px ?? null} takeProfit={rope.tp?.px ?? null} formatPrice={price} />
          </div>
        ) : null}
        <div className="mt-4 flex flex-wrap gap-2">
          <ButtonLink to={routeHref("trade", { market: position.dex ? `${position.dex}:${position.coin}` : position.coin })} variant="primary" size="sm" grade={position.leverage.value > 10 ? 5 : 3}>
            Open {position.coin} terminal
          </ButtonLink>
          {!rope?.sl ? (
            <ButtonLink to={intentHref(`set a stop on ${position.coin} at ${position.side === "long" ? "-" : "+"}5%`)} variant="signpost" size="sm">
              Set an anchor
            </ButtonLink>
          ) : null}
          <ButtonLink to={intentHref(`reduce ${position.coin} by 50%`)} variant="ink" size="sm">
            Halve it
          </ButtonLink>
        </div>
      </article>
    );
  }
  const line = source.line;
  const layer = LAYER_OF[line.layer];
  return (
    <article className={cx("border-2 border-rule bg-card p-4 shadow-hard", className)} aria-label={`${line.asset} holding`}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="caption">
            <span className={TONE[layer]}>{LAYER_NAME[layer]}</span> · {NETWORK_NAME[layer]} · {line.account}
          </p>
          <h3 className="mt-1 text-2xl font-bold tracking-[-0.01em] text-ink">{line.account === "staking" ? `Staked ${line.asset}` : line.asset}</h3>
        </div>
        <button type="button" onClick={onClose} className="font-mono text-xs text-ink-2 underline decoration-dotted underline-offset-2 hover:text-ink">
          close ✕
        </button>
      </header>
      <dl className="tnum mt-3 grid grid-cols-2 gap-x-4 gap-y-2 font-mono text-[13px] sm:grid-cols-4">
        <div>
          <dt className="text-ink-3">amount</dt>
          <dd className="text-ink">{amount(Number(line.amount))}</dd>
        </div>
        <div>
          <dt className="text-ink-3">value</dt>
          <dd className="text-ink">{usdFull(line.usd)}</dd>
        </div>
        <div>
          <dt className="text-ink-3">share of range</dt>
          <dd className="text-ink">{worth > 0 && line.usd !== null ? pct(line.usd / worth) : "—"}</dd>
        </div>
        <div>
          <dt className="text-ink-3">{line.locked ? "locked" : "price"}</dt>
          <dd className="text-ink">{line.locked ? amount(Number(line.locked)) : line.priceUsd !== null ? `$${price(line.priceUsd)}` : "unpriced"}</dd>
        </div>
      </dl>
      {line.note ? <p className="mt-2 text-[13px] text-ink-2">{line.note}</p> : null}
      <div className="mt-4 flex flex-wrap gap-2">
        {layer !== "summit" ? (
          <ButtonLink to={intentHref(`bridge ${line.asset === "USDC" ? "500 USDC" : `half my ${line.asset}`} to Elysium`)} variant="primary" size="sm" grade={2}>
            Ascend to the Summit
          </ButtonLink>
        ) : (
          <ButtonLink to={intentHref(`move ${line.asset === "USDC" ? "500 USDC" : `half my ${line.asset}`} to HyperCore`)} variant="primary" size="sm" grade={2}>
            Descend to the Floor
          </ButtonLink>
        )}
        {line.underlying && line.underlying !== "USD" ? (
          <ButtonLink to={routeHref("trade", { market: line.underlying })} variant="ink" size="sm">
            Trade {line.underlying}
          </ButtonLink>
        ) : null}
      </div>
    </article>
  );
}
