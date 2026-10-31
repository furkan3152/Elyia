import type { PortfolioSnapshot } from "@elyia/core/api/portfolio";
import { useMemo, useState } from "react";

import { navigate } from "../../../app/routes/history";
import { useShockedRopes, type RopeView } from "../../../features/trading/useTopoData";
import { intentHref } from "../../../oracle/preview";
import { Ely } from "../../../pixel/Ely";
import { ElyEmpty } from "../../../pixel/ElyEmpty";
import { Cards } from "../../../pixel/layout";
import { PixelTerrain } from "../../../pixel/PixelTerrain";
import { terrainModel } from "../../../pixel/terrain";
import { AvalanchePictogram } from "../../../topo/AvalancheBulletin";
import { AVALANCHE, avalancheLevel, type AvalancheLevel } from "../../../topo/geometry/conditions";
import { useMeasuredWidth } from "../../../topo/useMeasuredWidth";
import { Chip } from "../../../ui/Badge";
import { Button } from "../../../ui/Button";
import { cx } from "../../../ui/cx";
import { Dialog } from "../../../ui/Dialog";
import { Slider } from "../../../ui/Slider";
import { Stat } from "../../../ui/Stat";
import { pct, usdFull, usdShort, usdSigned } from "../range/format";
import { exposureFold, hedgeSuggestion, layerSplit, LAYER_NAME, NETWORK_NAME, shockMap, shockOutcome, sortRopes } from "../range/model";
import { peakDollars, shockDrivers, terrainHoldings } from "../range/terrainPlan";
import { useReliefPlan } from "../range/useReliefPlan";
import { PeakDetail } from "./PeakDetail";

const TONE = { floor: "text-floor", ridge: "text-ridge", summit: "text-summit-ink" } as const;
const SHOCK_TICKS = [-30, -20, -10, 0, 10, 20, 30] as const;

const signed = (value: number) => `${value > 0 ? "▲ +" : value < 0 ? "▼ " : ""}${value}%`;

export interface RangeTerrainProps {
  readonly snapshot: PortfolioSnapshot;
  readonly ropes: readonly RopeView[];
  readonly sample: boolean;
  readonly className?: string;
}

/**
 * The portfolio's hero: the range as a big pixel elevation map, Floor |
 * Ridge | Summit from left to right, a hill per holding (height = USD) and a
 * lake per short. The shock slider moves one market or the whole range:
 * hills sink, a rope shorter than the fall snaps and its hill collapses
 * into a lake, Ely (on the tallest peak) starts to worry, and the Guide
 * proposes the hedge, one tap from the planner. Tap a peak for its detail.
 * Read only: nothing here signs.
 */
export function RangeTerrain({ snapshot, ropes, sample, className }: RangeTerrainProps) {
  const plan = useReliefPlan(snapshot, ropes, 14);
  const fold = useMemo(() => exposureFold(snapshot), [snapshot]);
  const sorted = useMemo(() => sortRopes(ropes), [ropes]);
  const drivers = useMemo(() => shockDrivers(fold.rows, sorted), [fold.rows, sorted]);
  const [driverChoice, setDriver] = useState<string | null | undefined>(undefined);
  // Default: the largest exposure when a rope hangs on it (or nothing is roped); otherwise the whole range, so the ropes feel it.
  const fallback = drivers[0] !== undefined && (ropes.length === 0 || ropes.some((rope) => rope.coin === drivers[0])) ? drivers[0] : null;
  const driver = driverChoice === undefined ? fallback : driverChoice;
  const [shockPct, setShockPct] = useState(0);
  const [measure, width] = useMeasuredWidth<HTMLDivElement>(900);
  const phone = width < 600;
  // Phones draw the eight largest hills so every label keeps its size.
  const holdings = useMemo(() => terrainHoldings(plan, ropes, driver, phone ? 8 : 12), [plan, ropes, driver, phone]);
  const shock = shockPct / 100;
  const [selected, setSelected] = useState<string | null>(null);


  const map = useMemo(() => shockMap(driver, shock), [driver, shock]);
  const shocked = useShockedRopes(ropes, map);
  const outcome = shockOutcome(snapshot, shocked, driver, shock);
  const hedge = hedgeSuggestion(snapshot, shocked, ropes, driver, shock);
  const model = useMemo(() => terrainModel(holdings, 40, 20, shockPct, { ground: "dry" }), [holdings, shockPct]);
  const hills = holdings.filter((holding) => holding.side !== "short").length;
  const standing = model.peaks.filter((peak, index) => !peak.lake && holdings[index]?.side !== "short").length;

  const worth = snapshot.totals.netWorthUsd;
  const largest = fold.rows[0] ? Math.abs(fold.rows[0].netUsd ?? 0) : 0;
  const concentration = worth > 0 ? largest / worth : 0;
  const before = ropes.map((rope) => rope.distance).filter((d): d is number => d !== null);
  const after = shocked.map((rope) => rope.distance).filter((d): d is number => d !== null);
  const baseLevel = avalancheLevel({ minDistance: before.length ? Math.min(...before) : null, concentration });
  const level = (shock === 0 ? baseLevel : Math.max(baseLevel, avalancheLevel({ minDistance: after.length ? Math.min(...after) : null, snapped: outcome.snapped.length, concentration }))) as AvalancheLevel;
  const moved = driver === null ? "the whole range" : driver;
  const summary =
    shock === 0
      ? "Drag the shock to test a move before the market does."
      : outcome.snapped.length > 0
        ? `${outcome.snapped.join(", ")} ${outcome.snapped.length > 1 ? "snap" : "snaps"} at ${signed(shockPct)} ${moved}.`
        : outcome.fraying.length > 0
          ? `${outcome.fraying.join(", ")} ${outcome.fraying.length > 1 ? "fray" : "frays"} at ${signed(shockPct)} ${moved}.`
          : `Every rope holds at ${signed(shockPct)} ${moved}.`;
  const elyState = outcome.snapped.length > 0 || level >= 4 ? "worry" : hedge ? "talk" : shock === 0 ? "watch" : "idle";

  const split = layerSplit(snapshot);
  const offMap = plan.holdings.slice(holdings.length);
  const hidden = { count: plan.hidden.count + offMap.length, usd: plan.hidden.usd + offMap.reduce((sum, holding) => sum + (plan.exactUsd.get(holding.id) ?? 0), 0) };
  const source = selected ? plan.sources.get(selected) : undefined;
  const selectedHolding = holdings.find((holding) => holding.id === selected);
  // Map heights are square-rooted: the labels look up the exact dollars of the peak that carries each height.
  const byHeight = new Map(model.peaks.map((peak, index) => [peak.value.toFixed(4), holdings[index] ? peakDollars(holdings[index]!, shockPct) : 0]));
  const formatUsd = (value: number) => usdShort(byHeight.get(value.toFixed(4)) ?? 0);
  const mapLabel =
    `${sample ? "Sample portfolio" : "Portfolio"} elevation map: ${holdings.length} holdings, ${usdShort(worth)} in total, Floor, Ridge and Summit from left to right. ` +
    holdings
      .slice(0, 6)
      .map((holding) => `${holding.label}${holding.side === "short" ? " short" : ""} ${usdShort(holding.exactUsd)}`)
      .join(", ") +
    (shockPct !== 0 ? `. Shock ${signed(shockPct)} on ${moved}: ${outcome.snapped.length} rope${outcome.snapped.length === 1 ? "" : "s"} snapped.` : ".");

  return (
    <div className={className}>
      <div ref={measure} className="relative bg-card px-frame px-drop-lg">
        {holdings.length === 0 ? (
          <ElyEmpty title="An empty range" description="Nothing priced on any layer yet. Bridge or deposit and your first hill rises here." />
        ) : (
          <PixelTerrain
            holdings={holdings}
            shock={shockPct}
            onSelect={(holding) => setSelected(holding.id)}
            selectedId={selected}
            label={mapLabel}
            formatUsd={formatUsd}
            resolution={phone ? 120 : 220}
            ground="dry"
            aspect={phone ? 0.95 : 0.5}
          />
        )}
        {sample ? <span className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 bg-signal px-2 py-0.5 font-tag text-[11px] uppercase text-signal-ink px-frame-thin">Sample range</span> : null}
        {/* region seams: three equal regions, Floor | Ridge | Summit */}
        <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-1/3 border-l-2 border-dashed border-[#16201B]/25" />
        <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-2/3 border-l-2 border-dashed border-[#16201B]/25" />
      </div>
      <ul className="mt-5 grid grid-cols-3 text-center" aria-label="Regions of the map">
        {split.map((entry) => (
          <li key={entry.layer} className="flex flex-col items-center">
            <span className={cx("font-tag text-[11px] uppercase sm:text-[13px]", TONE[entry.layer])}>
              {LAYER_NAME[entry.layer]} <span className="hidden text-ink-2 sm:inline">· {NETWORK_NAME[entry.layer]}</span>
            </span>
            <span className="tnum font-mono text-xs text-ink-2">{entry.status === "unavailable" || entry.status === "error" ? "not read" : usdShort(entry.usd)}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-center font-mono text-[11px] text-ink-3">
        Tap a peak label for its detail{hidden.count > 0 ? ` · + ${hidden.count} ${hidden.usd < 1 ? "dust" : "small"} holding${hidden.count === 1 ? "" : "s"}${hidden.usd >= 1 ? ` (${usdShort(hidden.usd)})` : ""} not drawn` : ""}
      </p>

      <div className="mx-auto mt-10 flex max-w-[640px] flex-col items-center gap-6">
        <div className="flex flex-wrap items-center justify-center gap-3" role="radiogroup" aria-label="Market the shock moves">
          {[...drivers, null].map((coin) => (
            <Chip key={coin ?? "all"} role="radio" aria-checked={coin === driver} selected={coin === driver} mono onClick={() => setDriver(coin)} className="font-tag uppercase">
              {coin ?? "whole range"}
            </Chip>
          ))}
        </div>
        <Slider
          className="w-full"
          label={`Market shock · ${moved}`}
          value={shockPct}
          onChange={setShockPct}
          min={-30}
          max={30}
          ticks={SHOCK_TICKS}
          format={signed}
        />
      </div>

      <Cards n={3} className="mt-10">
        <Stat label={shock === 0 ? "Net worth" : "Net worth after"} value={usdFull(outcome.netWorth)} hint={shock === 0 ? `${ropes.length} rope${ropes.length === 1 ? "" : "s"} out` : <span className={outcome.change < 0 ? "text-down" : "text-up"}>{usdSigned(outcome.change)}</span>} size="lg" />
        <Stat
          label="Ropes snapped"
          value={outcome.snapped.length === 0 ? `▲ 0 / ${ropes.length}` : `▼ ${outcome.snapped.length} / ${ropes.length}`}
          tone={outcome.snapped.length > 0 ? "down" : "up"}
          hint={outcome.fraying.length > 0 ? `${outcome.fraying.join(", ")} fraying` : outcome.snapped.length > 0 ? outcome.snapped.join(", ") : "all holding"}
          size="lg"
        />
        <Stat label="Peaks standing" value={`${standing} / ${hills}`} hint={hills - standing > 0 ? `${hills - standing} collapsed into lakes` : "no lakes from the shock"} size="lg" />
      </Cards>

      <div className="mx-auto mt-10 flex max-w-[720px] flex-col items-center bg-card px-6 pb-7 pt-5 text-center px-frame px-drop" role="region" aria-label="Avalanche bulletin and the Guide's hedge">
        <div className="flex items-end justify-center gap-6">
          <AvalanchePictogram level={level} size={44} />
          <Ely state={elyState} size={88} label={`Ely ${elyState === "worry" ? "is worried" : elyState === "talk" ? "has a suggestion" : "is on watch"}`} />
          <span className="flex h-11 w-11 items-center justify-center bg-paper-2 font-display text-2xl font-bold text-ink px-frame-thin" aria-hidden="true">
            {level}
          </span>
        </div>
        <p className={cx("mt-4 font-tag text-[13px] uppercase", level >= 4 ? "text-down" : "text-ink")}>
          Avalanche {level} · {AVALANCHE[level].name}
          {sample ? " · sample" : ""}
        </p>
        <p className="mt-2 max-w-[560px] text-[15px] leading-relaxed text-ink-2 text-pretty" aria-live="polite">
          {summary} {AVALANCHE[level].advice}
        </p>
        {hedge ? (
          <>
            <p className="mt-3 max-w-[560px] text-[15px] leading-relaxed text-ink">
              <span className="font-tag text-[12px] uppercase text-accent">The Guide suggests · </span>
              {hedge.text}
            </p>
            <Button className="mt-6" variant="primary" size="lg" grade={hedge.sentence.startsWith("short") ? 3 : 2} onClick={() => navigate(intentHref(hedge.sentence))}>
              Plan the hedge ▸
            </Button>
          </>
        ) : shock !== 0 ? (
          <p className="mt-3 text-sm text-ink-2">Nothing to hedge at this move: the range absorbs it.</p>
        ) : sorted[0] && sorted[0].distance !== null ? (
          <p className="mt-3 font-mono text-xs text-ink-2">
            nearest rope · {sorted[0].coin} {pct(sorted[0].distance)} to the crevasse
          </p>
        ) : null}
      </div>

      <Dialog open={source !== undefined} onClose={() => setSelected(null)} title={selectedHolding ? `${selectedHolding.label} · ${usdShort(selectedHolding.exactUsd)}` : "Peak"} size="lg">
        {source ? <PeakDetail source={source} ropes={ropes} worth={worth} /> : null}
      </Dialog>
    </div>
  );
}
