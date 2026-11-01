import React, { useId, useState } from "react";

import { Ely } from "../pixel/Ely";
import { dangerGlyph } from "../pixel/glyphs";
import { PixelGlyph } from "../pixel/PixelGlyph";
import { cx } from "../ui/cx";
import { AVALANCHE, avalancheLevel, type AvalancheLevel } from "./geometry/conditions";
import { applyShock, SHOCK_RANGE, type ShockPosition } from "./geometry/shock";

export interface AvalancheBulletinProps {
  readonly positions: readonly ShockPosition[];
  readonly netWorth: number;
  /** The shocked driver ("HYPE"); betas are relative to it. */
  readonly driver?: string;
  /** Largest single exposure as a share of net worth (raises the level). */
  readonly concentration?: number;
  readonly formatUsd?: (usd: number) => string;
  /** The one action ("Plan the hedge"), receives the current shock. */
  readonly action?: (shock: number) => React.ReactNode;
  /** Show the shock slider (default true). */
  readonly slider?: boolean;
  readonly className?: string;
}

const usd = (value: number) => `${value < 0 ? "−" : ""}$${Math.abs(Math.round(value)).toLocaleString("en-US")}`;
const pct = (value: number | null) => (value === null ? "—" : `${(value * 100).toFixed(value < 0.1 ? 1 : 0)}%`);

/** Our own danger-scale pictogram, in pixels: a slope that breaks up as the level rises, with the number. */
export function AvalanchePictogram({ level, size = 44, className }: { readonly level: AvalancheLevel; readonly size?: number; readonly className?: string }) {
  const rows = dangerGlyph(level);
  return (
    <span aria-hidden="true" className={cx("relative inline-flex shrink-0 items-center justify-center bg-card px-frame-thin", className)} style={{ width: size, height: size }}>
      <PixelGlyph rows={rows} scale={Math.max(1, Math.floor((size - 8) / 15))} label={null} />
      <span className="absolute bottom-0.5 right-1 font-display text-[13px] font-bold leading-none text-ink">{level}</span>
    </span>
  );
}

/* Levels 3 and 4 print on solid signal / caution stock with dark ink (both sheets); 5 is a red wash. */
const LEVEL_TINT: Readonly<Record<AvalancheLevel, string>> = {
  1: "bg-card",
  2: "bg-card",
  3: "bg-signal [&_h3]:!text-signal-ink [&_p]:!text-signal-ink",
  4: "bg-warn [&_h3]:!text-warn-on [&_p]:!text-warn-on",
  5: "bg-down/20",
};

/**
 * The avalanche bulletin: portfolio risk on the familiar 1-5 scale, one line
 * of advice, and a shock slider (−30% … +30% on the driver) that recomputes
 * every rope through the pure shock math: which ropes fray, which snap, and
 * what the net worth becomes.
 */
export function AvalancheBulletin({ positions, netWorth, driver = "HYPE", concentration, formatUsd = usd, action, slider = true, className }: AvalancheBulletinProps) {
  const id = useId();
  const [shock, setShock] = useState(0);
  const result = applyShock(positions, netWorth, shock);
  const baseDistances = result.positions.map((p) => p.before).filter((d): d is number => d !== null);
  const level =
    shock === 0
      ? avalancheLevel({ minDistance: baseDistances.length > 0 ? Math.min(...baseDistances) : null, concentration })
      : Math.max(result.level, avalancheLevel({ minDistance: null, concentration })) as AvalancheLevel;
  const info = AVALANCHE[level];
  const shockPct = Math.round(shock * 100);
  return (
    <section className={cx("bg-card px-frame px-drop", className)} aria-labelledby={`${id}-title`}>
      <header className={cx("flex items-center gap-4 border-b-2 border-rule p-4", LEVEL_TINT[level])}>
        <AvalanchePictogram level={level} />
        <div className="min-w-0 flex-1">
          <h3 id={`${id}-title`} className="font-display text-xl font-bold leading-tight text-ink">
            Avalanche bulletin · {level} {info.name}
          </h3>
          <p className="mt-1 text-sm leading-snug text-ink-2" aria-live="polite">
            {result.snapped > 0 ? `${result.snapped} rope${result.snapped > 1 ? "s" : ""} would snap at ${shockPct > 0 ? "+" : ""}${shockPct}% ${driver}. ` : ""}
            {info.advice}
          </p>
        </div>
        {level >= 3 || result.snapped > 0 ? <Ely state="worry" size={66} label={null} className="-my-2 shrink-0" /> : <Ely state="idle" size={66} label={null} className="-my-2 shrink-0" />}
      </header>
      {slider ? (
        <div className="border-b-2 border-dashed border-rule px-5 pb-4 pt-4">
          <div className="flex items-baseline justify-between gap-3">
            <label htmlFor={`${id}-shock`} className="caption">
              Shock slider · what if {driver} moves
            </label>
            <span className={cx("tnum font-display text-lg font-bold", shock < 0 ? "text-down" : shock > 0 ? "text-up" : "text-ink")}>
              {shock > 0 ? "▲ +" : shock < 0 ? "▼ " : ""}
              {shockPct}%
            </span>
          </div>
          <input
            id={`${id}-shock`}
            type="range"
            min={-SHOCK_RANGE * 100}
            max={SHOCK_RANGE * 100}
            step={1}
            value={shockPct}
            onChange={(event) => setShock(Number(event.target.value) / 100)}
            aria-valuetext={`${driver} ${shockPct}%`}
            className="el-range"
            style={{ "--el-range-fill": `${((shockPct + 30) / 60) * 100}%` } as React.CSSProperties}
          />
          <div className="mt-1 flex justify-between font-tag text-[11px] text-ink-3" aria-hidden="true">
            <span>−30%</span>
            <span>0</span>
            <span>+30%</span>
          </div>
        </div>
      ) : null}
      <ul className="divide-y-2 divide-dashed divide-rule px-5 py-1">
        {result.positions.map((position) => {
          const fraying = position.after !== null && position.after < 0.1;
          return (
            <li key={position.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-2 text-sm">
              <span className="font-display font-bold text-ink">{position.symbol}</span>
              <span className="tnum font-mono text-[13px] text-ink-2">
                rope {pct(position.before)}
                {shock !== 0 ? (
                  <>
                    {" → "}
                    <span className={cx("font-semibold", position.snapped ? "text-down" : fraying ? "text-down" : "text-ink")}>{position.snapped ? "SNAPS ✕" : pct(position.after)}</span>
                    {fraying && !position.snapped ? <span className="text-down"> · fraying</span> : null}
                  </>
                ) : null}
              </span>
              {shock !== 0 ? (
                <span className={cx("tnum w-full text-right font-mono text-xs sm:w-auto", position.pnl < 0 ? "text-down" : "text-up")}>
                  {position.pnl < 0 ? "▼ " : "▲ +"}
                  {formatUsd(Math.abs(position.pnl))}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
      <footer className="flex flex-wrap items-center justify-between gap-3 border-t-2 border-rule px-5 py-3">
        <p className="tnum font-mono text-[13px] text-ink-2">
          Net worth {shock === 0 ? "" : "after the shock "}
          <span className="font-display text-base font-bold text-ink">{formatUsd(result.netWorth)}</span>
        </p>
        {action ? action(shock) : null}
      </footer>
    </section>
  );
}
