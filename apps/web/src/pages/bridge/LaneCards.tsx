import { useCallback } from "react";

import { Cards } from "../../pixel/layout";
import { PixelCanvas } from "../../pixel/PixelCanvas";
import { Blaze } from "../../topo/Blaze";
import type { Layer } from "../../topo/geometry/relief";
import { cx, FOCUS_RING } from "../../ui/cx";
import { INK, STRATA, SUN } from "../track/flow/pixelArt";
import { formatEta } from "../track/flow/routeModel";
import { laneAsset, LANES, type BridgeAsset, type Lane, type LaneId } from "./lanes";

const GW = 23;
const GH = 19;
const ROW: Readonly<Record<Layer, number>> = { summit: 2, ridge: 8, floor: 14 };

/** Paints `core` pixels with a one-pixel ink outline all round (the arrow on the lane glyph). */
function outlined(ctx: CanvasRenderingContext2D, core: ReadonlyArray<readonly [number, number]>, color: string): void {
  ctx.fillStyle = INK;
  for (const [x, y] of core) ctx.fillRect(x - 1, y - 1, 3, 3);
  ctx.fillStyle = color;
  for (const [x, y] of core) ctx.fillRect(x, y, 1, 1);
}

/** The lane glyph: the three layers as stacked bars, the lane as an outlined arrow between them. */
function paintLaneGlyph(ctx: CanvasRenderingContext2D, lane: Lane, chosen: boolean): void {
  ctx.clearRect(0, 0, GW, GH);
  for (const layer of ["summit", "ridge", "floor"] as const) {
    const colors = STRATA[layer];
    const y = ROW[layer];
    ctx.fillStyle = INK;
    ctx.fillRect(0, y - 1, GW, 5);
    ctx.fillStyle = colors[2]!;
    ctx.fillRect(1, y, GW - 2, 3);
    ctx.fillStyle = colors[0]!;
    ctx.fillRect(1, y, GW - 2, 1);
  }
  const color = chosen ? "#FFF9EC" : SUN;
  const core: Array<readonly [number, number]> = [];
  if (lane.from === lane.to) {
    // a traverse on the Floor: a horizontal arrow
    const y = ROW.floor + 1;
    const right = lane.id === "to-perps";
    for (let x = 6; x <= 16; x += 1) core.push([x, y]);
    const tip = right ? 17 : 5;
    const back = right ? -1 : 1;
    core.push([tip, y], [tip + back, y - 1], [tip + back, y + 1], [tip + back * 2, y - 2], [tip + back * 2, y + 2]);
  } else {
    const x = 11;
    const from = ROW[lane.from] + 1;
    const to = ROW[lane.to] + 1;
    const dir = to < from ? -1 : 1;
    for (let y = from; y !== to; y += dir) core.push([x, y]);
    core.push([x, to], [x - 1, to - dir], [x + 1, to - dir], [x - 2, to - dir * 2], [x + 2, to - dir * 2]);
  }
  outlined(ctx, core, color);
}

function LaneCard({ lane, asset, chosen, onSelect }: { readonly lane: Lane; readonly asset: BridgeAsset; readonly chosen: boolean; readonly onSelect: (id: LaneId) => void }) {
  const draw = useCallback((ctx: CanvasRenderingContext2D) => paintLaneGlyph(ctx, lane, chosen), [lane, chosen]);
  const eta = formatEta(lane.seconds(laneAsset(lane, asset)));
  return (
    <li className="flex">
      <button
        type="button"
        aria-pressed={chosen}
        onClick={() => onSelect(lane.id)}
        className={cx("flex w-full flex-col items-center gap-3 px-3 py-5 text-center px-frame px-drop px-press", chosen ? "bg-signal text-signal-ink" : "bg-card text-ink", FOCUS_RING)}
      >
        <PixelCanvas width={GW} height={GH} scale={3} draw={draw} redrawKey={`${lane.id}|${chosen}`} decorative />
        <span className="font-display text-[17px] font-bold leading-tight">{lane.title}</span>
        <span className="tnum font-mono text-[13px]">{eta}</span>
        <span className="mt-auto flex items-center gap-2 font-tag text-[10px] uppercase opacity-80">
          {lane.carrier}
          <Blaze grade={lane.grade} size={11} />
        </span>
      </button>
    </li>
  );
}

/** The six lanes as equal pixel signpost cards (six across, three on tablets, two on phones). */
export function LaneCards({ selected, asset, onSelect }: { readonly selected: LaneId; readonly asset: BridgeAsset; readonly onSelect: (id: LaneId) => void }) {
  return (
    <Cards n={6} as="ul" className="mx-auto max-w-[1200px]">
      {LANES.map((lane) => (
        <LaneCard key={lane.id} lane={lane} asset={asset} chosen={lane.id === selected} onSelect={onSelect} />
      ))}
    </Cards>
  );
}
