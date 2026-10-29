import type { PortfolioSnapshot } from "@elyia/core/api/portfolio";
import React, { useId, useMemo, useState } from "react";

import { navigate } from "../../../app/routes/history";
import type { RopeView } from "../../../features/trading/useTopoData";
import { useShockedRopes } from "../../../features/trading/useTopoData";
import { intentHref } from "../../../oracle/preview";
import { AvalanchePictogram } from "../../../topo/AvalancheBulletin";
import { AVALANCHE, avalancheLevel, type AvalancheLevel } from "../../../topo/geometry/conditions";
import { SHOCK_RANGE } from "../../../topo/geometry/shock";
import { Button } from "../../../ui/Button";
import { cx, FOCUS_RING } from "../../../ui/cx";
import { pct, usdFull, usdSigned } from "../range/format";
import { exposureFold, hedgeSuggestion, shockMap, shockOutcome, sortRopes } from "../range/model";

/* Levels 3 and 4 print on solid signal / caution stock with dark ink (both sheets); 5 is a red wash. */
const LEVEL_TINT: Readonly<Record<AvalancheLevel, string>> = {
  1: "bg-card",
  2: "bg-card",
  3: "bg-signal [&_h3]:!text-signal-ink [&_p]:!text-signal-ink",
  4: "bg-warn [&_h3]:!text-warn-on [&_p]:!text-warn-on",
  5: "bg-down/20",
};

/* Ink on the bulletin's stock: dark ink on signal and caution in both sheets. */
const LINE_INK: Readonly<Record<AvalancheLevel, string>> = { 1: "text-ink", 2: "text-ink", 3: "text-signal-ink", 4: "text-warn-on", 5: "text-ink" };

export interface ShockBulletinProps {
  readonly snapshot: PortfolioSnapshot;
  readonly ropes: readonly RopeView[];
  /** Compact: one line (the deck); full: slider, ropes, hedge (the portfolio). */
  readonly variant?: "full" | "line";
  readonly sample?: boolean;
  readonly className?: string;
}

function useBaseline(snapshot: PortfolioSnapshot, ropes: readonly RopeView[]) {
  return useMemo(() => {
    const fold = exposureFold(snapshot);
    const worth = snapshot.totals.netWorthUsd;
    const largest = fold.rows[0] ? Math.abs(fold.rows[0].netUsd ?? 0) : 0;
    const concentration = worth > 0 ? largest / worth : 0;
    const distances = ropes.map((rope) => rope.distance).filter((d): d is number => d !== null);
    const level = avalancheLevel({ minDistance: distances.length > 0 ? Math.min(...distances) : null, concentration });
    const nearest = sortRopes(ropes)[0] ?? null;
    return { fold, concentration, level, nearest };
  }, [snapshot, ropes]);
}

/** One line for the deck: pictogram, level, the nearest rope, the advice. */
export function BulletinLine({ snapshot, ropes, className }: Omit<ShockBulletinProps, "variant">) {
  const { level, nearest } = useBaseline(snapshot, ropes);
  const info = AVALANCHE[level];
  return (
    <div className={cx("flex items-center gap-3 border-2 border-rule px-3 py-2.5 shadow-hard", LEVEL_TINT[level], className)}>
      <AvalanchePictogram level={level} size={36} />
      <p className={cx("min-w-0 text-sm leading-snug", LINE_INK[level])}>
        <span className="font-bold uppercase tracking-[0.02em]">
          Avalanche {level} · {info.name}
        </span>
        <span className="opacity-90">
          {" · "}
          {nearest && nearest.distance !== null ? `${nearest.coin} rope ${pct(nearest.distance)} to the crevasse. ` : ropes.length === 0 ? "No ropes out. " : ""}
          {info.advice}
        </span>
      </p>
    </div>
  );
}

/**
 * The avalanche bulletin with its shock slider, live on the followed
 * account's ropes (`useShockedRopes`): move one market (or the whole range)
 * −30%…+30% and see which ropes fray or snap, what the range is worth after
 * the move, and the Guide's hedge, one tap from the planner.
 */
export function ShockBulletin({ snapshot, ropes, sample = false, className }: ShockBulletinProps) {
  const id = useId();
  const { fold, concentration, level: baseLevel } = useBaseline(snapshot, ropes);
  const drivers = useMemo(() => {
    const coins = new Set<string>();
    for (const row of fold.rows) if (coins.size < 4) coins.add(row.underlying);
    for (const rope of sortRopes(ropes)) if (coins.size < 5) coins.add(rope.coin);
    return [...coins];
  }, [fold.rows, ropes]);
  const [driverChoice, setDriver] = useState<string | null | undefined>(undefined);
  // Default: the largest exposure when a rope hangs on it (or nothing is roped); otherwise move the whole range so the ropes feel it.
  const fallbackDriver = drivers[0] !== undefined && (ropes.length === 0 || ropes.some((rope) => rope.coin === drivers[0])) ? drivers[0] : null;
  const driver = driverChoice === undefined ? fallbackDriver : driverChoice;
  const [shockPct, setShockPct] = useState(-20);
  const shock = shockPct / 100;
  const map = useMemo(() => shockMap(driver, shock), [driver, shock]);
  const shocked = useShockedRopes(ropes, map);
  const outcome = shockOutcome(snapshot, shocked, driver, shock);
  const hedge = hedgeSuggestion(snapshot, shocked, ropes, driver, shock);
  const shockedDistances = shocked.map((rope) => rope.distance).filter((d): d is number => d !== null);
  const level =
    shock === 0 ? baseLevel : Math.max(baseLevel, avalancheLevel({ minDistance: shockedDistances.length > 0 ? Math.min(...shockedDistances) : null, snapped: outcome.snapped.length, concentration })) as AvalancheLevel;
  const info = AVALANCHE[level];
  const moved = driver === null ? "the whole range" : driver;
  const summary =
    outcome.snapped.length > 0
      ? `${outcome.snapped.join(", ")} ${outcome.snapped.length > 1 ? "snap" : "snaps"} at ${shockPct > 0 ? "+" : ""}${shockPct}% ${moved}.`
      : outcome.fraying.length > 0
        ? `${outcome.fraying.join(", ")} ${outcome.fraying.length > 1 ? "fray" : "frays"} at ${shockPct > 0 ? "+" : ""}${shockPct}% ${moved}.`
        : shock === 0
          ? ""
          : `Every rope holds at ${shockPct > 0 ? "+" : ""}${shockPct}% ${moved}.`;
  const rows = sortRopes(ropes).slice(0, 5);
  return (
    <section className={cx("border-2 border-rule bg-card shadow-hard-lg", className)} aria-labelledby={`${id}-title`}>
      <header className={cx("flex items-start gap-3.5 border-b-2 border-rule p-4", LEVEL_TINT[level])}>
        <AvalanchePictogram level={level} size={48} />
        <div className="min-w-0">
          <h3 id={`${id}-title`} className="text-lg font-bold uppercase leading-tight tracking-[0.02em] text-ink">
            Avalanche bulletin · {level} {info.name}
            {sample ? <span className="ml-2 align-middle font-mono text-[11px] font-semibold tracking-[0.12em]">(sample)</span> : null}
          </h3>
          <p className="mt-1 text-sm leading-snug text-ink-2" aria-live="polite">
            {summary} {info.advice}
          </p>
        </div>
      </header>

      <div className="border-b-1.5 border-rule/40 px-4 pb-3 pt-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="caption" id={`${id}-drivers`}>
            Shock slider · what if
          </span>
          <span className={cx("tnum font-mono text-base font-semibold", shock < 0 ? "text-down" : shock > 0 ? "text-up" : "text-ink")}>
            {shock > 0 ? "▲ +" : shock < 0 ? "▼ " : ""}
            {shockPct}%
          </span>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5" role="radiogroup" aria-labelledby={`${id}-drivers`}>
          {[...drivers, null].map((coin) => {
            const selected = coin === driver;
            return (
              <button
                key={coin ?? "all"}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setDriver(coin)}
                className={cx("h-7 border-1.5 border-rule px-2 font-mono text-[11px] font-semibold uppercase tracking-[0.08em]", selected ? "bg-ink text-paper" : "bg-card text-ink hover:bg-paper-2", FOCUS_RING)}
              >
                {coin ?? "whole range"}
              </button>
            );
          })}
          <span className="self-center font-mono text-[11px] text-ink-3">moves</span>
        </div>
        <input
          type="range"
          min={-SHOCK_RANGE * 100}
          max={SHOCK_RANGE * 100}
          step={1}
          value={shockPct}
          onChange={(event) => setShockPct(Number(event.target.value))}
          aria-label={`Shock ${moved}`}
          aria-valuetext={`${moved} ${shockPct}%`}
          className="el-range mt-3"
          style={{ "--el-range-fill": `${((shockPct + 30) / 60) * 100}%` } as React.CSSProperties}
        />
        <div className="flex justify-between font-mono text-[11px] text-ink-3" aria-hidden="true">
          <span>−30%</span>
          <button type="button" className={cx("text-ink-2 underline decoration-dotted underline-offset-2", FOCUS_RING)} onClick={() => setShockPct(0)} tabIndex={-1}>
            0
          </button>
          <span>+30%</span>
        </div>
      </div>

      {rows.length > 0 ? (
        <ul className="divide-y divide-rule/15 px-4 py-1" aria-label="Ropes under the shock">
          {rows.map((rope) => {
            const after = shocked.find((entry) => entry.coin === rope.coin && entry.markPx > 0);
            const snaps = after?.snaps ?? false;
            const fraying = !snaps && after?.distance !== null && after?.distance !== undefined && after.distance < 0.1;
            return (
              <li key={`${rope.dex}|${rope.coin}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-1 py-2 text-sm">
                <span className="truncate font-bold text-ink">
                  {rope.coin} {rope.side === "long" ? "▲" : "▼"}
                  {rope.leverage}× <span className="font-normal text-ink-3">{rope.side}</span>
                </span>
                <span className="tnum font-mono text-[13px] text-ink-2">
                  rope {pct(rope.distance)}
                  {shock !== 0 && after ? (
                    <>
                      {" → "}
                      <span className={cx("font-semibold", snaps || fraying ? "text-down" : "text-ink")}>{snaps ? "SNAPS ✕" : pct(after.distance)}</span>
                      {fraying ? <span className="text-down"> fraying</span> : null}
                    </>
                  ) : null}
                </span>
                <RopeMeter before={rope.distance} after={shock === 0 ? null : (after?.distance ?? null)} snaps={snaps} />
                {shock !== 0 && after ? <span className={cx("tnum text-right font-mono text-xs", after.pnlChange < 0 ? "text-down" : "text-up")}>{usdSigned(after.pnlChange)}</span> : <span />}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="px-4 py-3 text-sm text-ink-2">No ropes out: the shock only moves what you hold.</p>
      )}

      <footer className="flex flex-col gap-3 border-t-1.5 border-rule/40 px-4 py-3.5">
        <p className="tnum font-mono text-[13px] text-ink-2">
          {shock === 0 ? "Net worth " : "After the move "}
          <span className="font-semibold text-ink">{usdFull(outcome.netWorth)}</span>
          {shock !== 0 ? <span className={outcome.change < 0 ? "text-down" : "text-up"}> {usdSigned(outcome.change)}</span> : null}
        </p>
        {hedge ? (
          <>
            <p className="text-[15px] leading-snug text-ink">
              <span className="font-semibold">The Guide suggests:</span> <span className="italic">{hedge.text}</span>
            </p>
            <Button variant="primary" size="md" className="self-start" grade={hedge.sentence.startsWith("short") ? 3 : 2} onClick={() => navigate(intentHref(hedge.sentence))}>
              Plan the hedge ▸
            </Button>
          </>
        ) : shock !== 0 ? (
          <p className="text-sm text-ink-2">Nothing to hedge at this move: the range absorbs it.</p>
        ) : (
          <p className="text-sm text-ink-2">Drag the slider to test a move before the market does.</p>
        )}
      </footer>
    </section>
  );
}

/** A thin pitch: how much rope is left before (ink) and after (red dashed) the shock, out to 50%. */
function RopeMeter({ before, after, snaps }: { readonly before: number | null; readonly after: number | null; readonly snaps: boolean }) {
  const scale = (d: number | null) => (d === null ? 1 : Math.max(0, Math.min(1, d / 0.5)));
  const b = scale(before);
  const a = after === null ? null : snaps ? 0 : scale(after);
  return (
    <svg viewBox="0 0 200 10" preserveAspectRatio="none" className="h-2.5 w-full" aria-hidden="true">
      <line x1="0" y1="5" x2="200" y2="5" stroke="rgb(var(--rule))" strokeOpacity="0.18" strokeWidth="2" />
      <line x1="0" y1="5" x2={b * 200} y2="5" stroke="rgb(var(--ink))" strokeWidth="2.4" />
      {a !== null ? <line x1="0" y1="5" x2={Math.max(a * 200, 0.1)} y2="5" stroke="rgb(var(--down))" strokeWidth="2.4" strokeDasharray="5 3" /> : null}
      <path d="M0,0v10M20,2v6" stroke="rgb(var(--down))" strokeWidth="2" />
    </svg>
  );
}
