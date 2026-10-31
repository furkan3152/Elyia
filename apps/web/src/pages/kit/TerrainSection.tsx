import { useMemo, useState } from "react";

import { Cards, Section } from "../../pixel/layout";
import { PixelTerrain } from "../../pixel/PixelTerrain";
import { SAMPLE_TERRAIN, terrainModel, type TerrainHolding } from "../../pixel/terrain";
import { Badge } from "../../ui/Badge";
import { Slider } from "../../ui/Slider";
import { Stat } from "../../ui/Stat";
import { ImportLine } from "./KeySection";

const usd = (value: number) => `$${Math.round(value).toLocaleString("en-US")}`;
/** The sample's net worth: the hills' value scaled to the reference's $48,213. */
const SCALE = 48_213 / terrainModel(SAMPLE_TERRAIN, 40, 22, 0).netWorth;

/** 03 · The portfolio as pixel terrain, with the shock slider. */
export function TerrainSection() {
  const [shock, setShock] = useState(0);
  const [selected, setSelected] = useState<TerrainHolding | null>(null);
  const model = useMemo(() => terrainModel(SAMPLE_TERRAIN, 40, 22, shock), [shock]);
  const standing = model.peaks.filter((peak) => !peak.lake).length;
  const hills = SAMPLE_TERRAIN.filter((holding) => holding.side !== "short").length;
  return (
    <Section id="terrain" tag="03 · Portfolio · pixel elevation map" title="Your money is terrain. Shocks bring the peaks down." lede="Every position is a hill, shorts are lakes. Drag the shock left: the hills sink, a rope shorter than the fall snaps and its hill becomes a lake, and Ely starts to worry.">
      <ImportLine>{'import { PixelTerrain } from "src/pixel" · Relief wraps it'}</ImportLine>
      <div className="mx-auto max-w-[1000px]">
        <div className="mb-4 flex justify-center">
          <Badge tone="signal" variant="solid">
            Sample portfolio
          </Badge>
        </div>
        <div className="bg-card px-frame px-drop">
          <PixelTerrain holdings={SAMPLE_TERRAIN} shock={shock} onSelect={setSelected} selectedId={selected?.id ?? null} formatUsd={(value) => usd(value * SCALE)} />
        </div>
        <div className="mx-auto mt-10 max-w-[560px]">
          <Slider
            label="Market shock"
            value={shock}
            onChange={setShock}
            min={-30}
            max={30}
            ticks={[-30, -20, -10, 0, 10, 20, 30]}
            format={(value) => `${value > 0 ? "▲ +" : value < 0 ? "▼ " : ""}${value}%`}
            dangerFrom={31}
          />
        </div>
        <p className="mt-4 min-h-6 text-center font-mono text-sm text-ink-2" aria-live="polite">
          {selected ? (
            <>
              <span className="font-tag text-ink">{selected.label}</span> · {usd(selected.usd * SCALE)}
              {typeof selected.rope === "number" ? ` · rope ${selected.rope}%` : " · no rope"}
            </>
          ) : (
            "Select a peak label to read it."
          )}
        </p>
        <Cards n={3} className="mt-8">
          <Stat label="Net worth" value={usd(model.netWorth * SCALE)} size="lg" />
          <Stat label="Ropes snapped" value={model.snaps === 0 ? "▲ 0" : `▼ ${model.snaps}`} tone={model.snaps ? "down" : "up"} size="lg" />
          <Stat label="Peaks standing" value={`${standing} / ${hills}`} size="lg" />
        </Cards>
      </div>
    </Section>
  );
}
