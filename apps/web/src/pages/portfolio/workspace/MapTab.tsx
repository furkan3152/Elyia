import type { PortfolioSnapshot } from "@elyia/core/api/portfolio";
import { useMemo, useState } from "react";

import { useShockedRopes, type RopeView } from "../../../features/trading/useTopoData";
import { PixelTerrain } from "../../../pixel/PixelTerrain";
import { terrainModel } from "../../../pixel/terrain";
import { cx, FOCUS_RING } from "../../../ui/cx";
import { usdShort } from "../range/format";
import { exposureFold, shockMap, shockOutcome, sortRopes } from "../range/model";
import { peakDollars, shockDrivers, terrainHoldings } from "../range/terrainPlan";
import { useReliefPlan } from "../range/useReliefPlan";
import { signedPct, whatIfPresets } from "../v2/model";

export interface MapTabProps {
  readonly snapshot: PortfolioSnapshot;
  readonly ropes: readonly RopeView[];
  readonly sample: boolean;
  readonly phone: boolean;
}

/**
 * Map: the range as a pixel height map (peaks are positions, lakes are
 * shorts) with the What-if control docked under it: the slider, four
 * presets and three readouts (net worth after, ropes snapped, peaks
 * standing). Read only: nothing here drafts or signs.
 */
export function MapTab({ snapshot, ropes, sample, phone }: MapTabProps) {
  const plan = useReliefPlan(snapshot, ropes, 12);
  const fold = useMemo(() => exposureFold(snapshot), [snapshot]);
  const sorted = useMemo(() => sortRopes(ropes), [ropes]);
  const drivers = useMemo(() => shockDrivers(fold.rows, sorted), [fold.rows, sorted]);
  const presets = whatIfPresets(drivers);
  const [driver, setDriver] = useState<string | null | undefined>(undefined);
  const active = driver === undefined ? (drivers[0] ?? null) : driver;
  const [pct, setPct] = useState(0);
  const holdings = useMemo(() => terrainHoldings(plan, ropes, active, phone ? 8 : 10), [plan, ropes, active, phone]);
  const map = useMemo(() => shockMap(active, pct / 100), [active, pct]);
  const shocked = useShockedRopes(ropes, map);
  const outcome = shockOutcome(snapshot, shocked, active, pct / 100);
  const model = useMemo(() => terrainModel(holdings, 40, 20, pct, { ground: "dry" }), [holdings, pct]);
  const hills = holdings.filter((holding) => holding.side !== "short").length;
  const standing = model.peaks.filter((peak, index) => !peak.lake && holdings[index]?.side !== "short").length;
  const byHeight = new Map(model.peaks.map((peak, index) => [peak.value.toFixed(4), holdings[index] ? peakDollars(holdings[index]!, pct) : 0]));
  const moved = active === null ? "the whole range" : active;
  const label = `${sample ? "Sample portfolio" : "Portfolio"} elevation map: ${holdings.length} holdings; ${pct !== 0 ? `what-if ${signedPct(pct)} on ${moved}: ${outcome.snapped.length} ropes snapped, ` : ""}net worth ${usdShort(outcome.netWorth)}.`;

  return (
    <div className="ws-map">
      <div className="relative min-h-0">
        {holdings.length === 0 ? (
          <p className="fr flat grid min-h-[200px] place-items-center p-6 text-center text-[13px] text-ink-2">An empty range: nothing priced on any layer yet. Bridge or deposit and the first hill rises here.</p>
        ) : (
          <PixelTerrain holdings={holdings} shock={pct} label={label} formatUsd={(value) => usdShort(byHeight.get(value.toFixed(4)) ?? 0)} resolution={phone ? 120 : 200} ground="dry" aspect={phone ? 0.62 : 0.4} />
        )}
        {sample ? <span className="pointer-events-none absolute left-2 top-2 bg-signal px-2 py-0.5 font-tag text-[10px] uppercase text-[#16201B]">Sample range</span> : null}
      </div>
      <div className="ws-dock">
        <div className="ws-whatif">
          <label htmlFor="whatif" className="t-tag whitespace-nowrap">
            What if · {moved}
          </label>
          <input
            id="whatif"
            type="range"
            min={-30}
            max={30}
            step={1}
            value={pct}
            onChange={(event) => setPct(Number(event.target.value))}
            className="el-range min-w-0 flex-1"
            style={{ ["--el-range-fill" as string]: `${((pct + 30) / 60) * 100}%` }}
            aria-valuetext={`${signedPct(pct)} on ${moved}`}
          />
          <output htmlFor="whatif" className="disp num w-12 text-right text-[16px]">
            {signedPct(pct)}
          </output>
        </div>
        <div className="presets">
          {presets.map((preset) => {
            const on = pct === preset.pct && active === preset.driver && preset.pct !== 0;
            return (
              <button
                key={preset.label}
                type="button"
                onClick={() => {
                  setDriver(preset.driver);
                  setPct(preset.pct);
                }}
                aria-pressed={on}
                className={cx("b xs w-full", on && "ink", FOCUS_RING)}
              >
                {preset.label}
              </button>
            );
          })}
        </div>
      </div>
      <div className="ws-readouts">
        <div className="ro fr flat">
          <b>Net worth {pct === 0 ? "now" : "after"}</b>
          <span className="num">{usdShort(outcome.netWorth)}</span>
          <i>{pct === 0 ? "move the slider" : `${outcome.change >= 0 ? "▲" : "▼"} ${usdShort(Math.abs(outcome.change))}`}</i>
        </div>
        <div className="ro fr flat">
          <b>Ropes snapped</b>
          <span className={cx("num", outcome.snapped.length > 0 ? "t-down" : "t-up")}>
            {outcome.snapped.length > 0 ? "▼ " : ""}
            {outcome.snapped.length}
          </span>
          <i>{outcome.snapped.length > 0 ? outcome.snapped.join(", ") : outcome.fraying.length > 0 ? `${outcome.fraying.join(", ")} fraying` : "all holding"}</i>
        </div>
        <div className="ro fr flat">
          <b>Peaks standing</b>
          <span className="num">
            {standing} / {hills}
          </span>
          <i>{hills - standing > 0 ? `${hills - standing} flooded` : "none flooded"}</i>
        </div>
      </div>
      <p className="t-tag t-faint text-center !text-[9px]">Peaks are positions · lakes are shorts · a snapped rope floods its peak</p>
    </div>
  );
}
