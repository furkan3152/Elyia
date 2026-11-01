import type { PortfolioSnapshot } from "@elyia/core/api/portfolio";
import { useMemo, useState } from "react";

import { Glyph } from "../../../features/ely/ui";
import { useShockedRopes, type RopeView } from "../../../features/trading/useTopoData";
import { PixelTerrain } from "../../../pixel/PixelTerrain";
import { terrainModel } from "../../../pixel/terrain";
import { cx, FOCUS_RING } from "../../../ui/cx";
import { usdShort } from "../range/format";
import { exposureFold, shockMap, shockOutcome, sortRopes } from "../range/model";
import { peakDollars, shockDrivers, terrainHoldings } from "../range/terrainPlan";
import { useReliefPlan } from "../range/useReliefPlan";
import { signedPct, whatIfPresets } from "./model";

export interface TerrainWhatIfProps {
  readonly snapshot: PortfolioSnapshot;
  readonly ropes: readonly RopeView[];
  readonly sample: boolean;
  readonly phone: boolean;
}

/**
 * The range as a pixel height map (peaks are positions, lakes are shorts)
 * with the What-if slider and four presets driving the terrain and three
 * readouts: net worth after, ropes snapped, peaks standing. Read only.
 */
export function TerrainWhatIf({ snapshot, ropes, sample, phone }: TerrainWhatIfProps) {
  const plan = useReliefPlan(snapshot, ropes, 12);
  const fold = useMemo(() => exposureFold(snapshot), [snapshot]);
  const sorted = useMemo(() => sortRopes(ropes), [ropes]);
  const drivers = useMemo(() => shockDrivers(fold.rows, sorted), [fold.rows, sorted]);
  const presets = whatIfPresets(drivers);
  const [driver, setDriver] = useState<string | null | undefined>(undefined);
  const active = driver === undefined ? (drivers[0] ?? null) : driver;
  const [pct, setPct] = useState(0);
  const [view, setView] = useState<"map" | "list">("map");
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
    <div className="fr flex h-full flex-col p-4">
      <div className="mb-3.5 flex items-center justify-between gap-3">
        <h3 className="disp flex items-center gap-2.5 text-[20px]">
          <Glyph name="peak" scale={3} /> The range
        </h3>
        <div className="seg" role="group" aria-label="View">
          <button type="button" aria-pressed={view === "map"} onClick={() => setView("map")} className={FOCUS_RING}>
            Map
          </button>
          <button type="button" aria-pressed={view === "list"} onClick={() => setView("list")} className={FOCUS_RING}>
            List
          </button>
        </div>
      </div>
      <div className="relative">
        {view === "map" ? (
          holdings.length === 0 ? (
            <p className="fr flat grid min-h-[200px] place-items-center p-6 text-center text-[13px] text-ink-2">An empty range: nothing priced on any layer yet. Bridge or deposit and the first hill rises here.</p>
          ) : (
            <PixelTerrain holdings={holdings} shock={pct} label={label} formatUsd={(value) => usdShort(byHeight.get(value.toFixed(4)) ?? 0)} resolution={phone ? 120 : 180} ground="dry" aspect={phone ? 0.6 : 0.54} />
          )
        ) : (
          <ul className="fr flat flex max-h-[300px] flex-col overflow-y-auto text-[12.5px]" aria-label="Holdings">
            {holdings.map((holding) => (
              <li key={holding.id} className="flex items-center justify-between gap-3 px-3 py-1.5 shadow-[inset_0_-2px_0_0_rgb(var(--paper-2))]">
                <span className="truncate">
                  {holding.side === "short" ? "▼ " : "▲ "}
                  {holding.label}
                </span>
                <span className="num">{usdShort(peakDollars(holding, pct))}</span>
              </li>
            ))}
          </ul>
        )}
        {sample ? <span className="pointer-events-none absolute left-1/2 top-2 -translate-x-1/2 bg-signal px-2 py-0.5 font-tag text-[10px] uppercase text-[#16201B]">Sample range</span> : null}
      </div>
      <div className="mt-4 flex items-center gap-3.5 font-tag text-[11px] uppercase">
        <label htmlFor="whatif">What if · {moved}</label>
        <input
          id="whatif"
          type="range"
          min={-30}
          max={30}
          step={1}
          value={pct}
          onChange={(event) => setPct(Number(event.target.value))}
          className="el-range flex-1"
          style={{ ["--el-range-fill" as string]: `${((pct + 30) / 60) * 100}%` }}
          aria-valuetext={`${signedPct(pct)} on ${moved}`}
        />
        <output htmlFor="whatif" className="disp num w-14 text-right text-[18px] normal-case">
          {signedPct(pct)}
        </output>
      </div>
      <div className="presets mt-3.5">
        {presets.map((preset) => (
          <button
            key={preset.label}
            type="button"
            onClick={() => {
              setDriver(preset.driver);
              setPct(preset.pct);
            }}
            aria-pressed={pct === preset.pct && active === preset.driver && preset.pct !== 0}
            className={cx("b sm w-full !px-2 !text-[13px]", pct === preset.pct && active === preset.driver && preset.pct !== 0 && "acc", FOCUS_RING)}
          >
            {preset.label}
          </button>
        ))}
      </div>
      <div className="mt-3.5 grid grid-cols-3 gap-3">
        <div className="ro fr flat">
          <b>Net worth</b>
          <span className="num !text-[20px]">{usdShort(outcome.netWorth)}</span>
          <i>{pct === 0 ? "now" : `${outcome.change >= 0 ? "▲" : "▼"} ${usdShort(Math.abs(outcome.change))}`}</i>
        </div>
        <div className="ro fr flat">
          <b>Ropes snapped</b>
          <span className={cx("num !text-[20px]", outcome.snapped.length > 0 ? "t-down" : "t-up")}>{outcome.snapped.length}</span>
          <i>{outcome.snapped.length > 0 ? outcome.snapped.join(", ") : outcome.fraying.length > 0 ? `${outcome.fraying.join(", ")} fraying` : "all holding"}</i>
        </div>
        <div className="ro fr flat">
          <b>Peaks standing</b>
          <span className="num !text-[20px]">
            {standing} / {hills}
          </span>
          <i>{hills - standing > 0 ? `${hills - standing} flooded` : "none flooded"}</i>
        </div>
      </div>
      <p className="mt-auto pt-4 text-center font-tag text-[10px] uppercase text-ink-3">Peaks are positions · lakes are shorts · a snapped rope floods its peak</p>
    </div>
  );
}
