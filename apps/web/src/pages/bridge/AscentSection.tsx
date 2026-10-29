import React, { useId, useRef } from "react";

import { useAnimationFrame } from "../../motion/useAnimationFrame";

import { useAutoPause } from "../../motion/useAutoPause";
import { cx } from "../../ui/cx";
import { formatEta } from "../track/flow/routeModel";
import { packFigure, type Packs } from "../track/flow/usePacks";
import { LANES, type BridgeAsset, type Lane, type LaneId } from "./lanes";
import { arrowHead, cablePoint, CAMPS, GROUND, LANE_GEOMETRY, SECTION_FILL, SECTION_H, SECTION_PATH, SECTION_W } from "./sectionGeometry";

export interface AscentSectionProps {
  readonly selected: LaneId;
  readonly onSelect: (lane: LaneId) => void;
  readonly asset: BridgeAsset;
  readonly packs: Packs;
  readonly className?: string;
}

const LAYER_COLOR = { floor: "rgb(var(--floor))", ridge: "rgb(var(--ridge))", summit: "rgb(var(--summit-ink))" } as const;
const BANDS = [
  { layer: "summit", name: "The Summit", net: "ELYSIUM", y: 0 },
  { layer: "ridge", name: "The Ridge", net: "HYPEREVM", y: SECTION_H / 3 },
  { layer: "floor", name: "The Floor", net: "HYPERCORE", y: (2 * SECTION_H) / 3 },
] as const;

function laneTag(lane: Lane, asset: BridgeAsset): string {
  const eta = formatEta(lane.seconds(lane.assets.includes(asset) ? asset : lane.assets[0]!)).replace("~", "");
  return `${lane.tag} · ${eta}`;
}

/** A hut: a square room under a pitched roof, on the ground line. */
function Hut({ x, y, label, active }: { readonly x: number; readonly y: number; readonly label: string; readonly active: boolean }) {
  return (
    <g aria-hidden="true">
      <path d={`M${x - 11},${y} V${y - 14} L${x},${y - 25} L${x + 11},${y - 14} V${y} Z`} fill={active ? "rgb(var(--signal))" : "rgb(var(--card))"} stroke="rgb(var(--ink))" strokeWidth="2" strokeLinejoin="round" />
      <rect x={x - 3.5} y={y - 9} width="7" height="9" fill="rgb(var(--ink))" />
      <text x={x} y={y + 18} textAnchor="middle" fontFamily="IBM Plex Mono, monospace" fontSize="11.5" fontWeight="600" letterSpacing="1" fill="rgb(var(--ink))" paintOrder="stroke" stroke="rgb(var(--card))" strokeWidth="3">
        {label}
      </text>
    </g>
  );
}

/** A trail post (spot / perps on the Floor). */
function Post({ x, y, label, active }: { readonly x: number; readonly y: number; readonly label: string; readonly active: boolean }) {
  return (
    <g aria-hidden="true">
      <path d={`M${x},${y} V${y - 26}`} stroke="rgb(var(--ink))" strokeWidth="2.5" />
      <path d={`M${x - 15},${y - 34} H${x + 9} L${x + 15},${y - 28} L${x + 9},${y - 22} H${x - 15} Z`} fill={active ? "rgb(var(--signal))" : "rgb(var(--card))"} stroke="rgb(var(--ink))" strokeWidth="1.8" />
      <text x={x - 3} y={y - 24.5} textAnchor="middle" fontFamily="IBM Plex Mono, monospace" fontSize="8.5" fontWeight="700" fill="rgb(var(--ink))">
        {label}
      </text>
    </g>
  );
}

/**
 * The ascent section: the range cut open. Three camps on their terraces
 * (Floor = HyperCore, Ridge = HyperEVM, Summit = Elysium), your pack at each
 * camp, and every bridge lane drawn between them with its real time: the
 * cable car up to the Summit, the long trail down (the challenge period),
 * the Core link and the spot/perps traverse. Lanes are buttons; the chosen
 * one is inked and draws on; the gondola rides while the cable car is chosen.
 */
export function AscentSection({ selected, onSelect, asset, packs, className }: AscentSectionProps) {
  const id = useId();
  const { ref, active } = useAutoPause<HTMLDivElement>();
  const lane = LANES.find((item) => item.id === selected)!;
  const gondola = useRef<SVGGElement>(null);
  const riding = selected === "up-summit";
  // The gondola rides the cable while its lane is chosen (slow, eased, paused off screen).
  const running = useAnimationFrame(
    ({ time }) => {
      const t = (1 - Math.cos((time / 4200) * Math.PI)) / 2;
      const point = cablePoint(0.06 + t * 0.88);
      gondola.current?.setAttribute("transform", `translate(${point.x.toFixed(1)},${point.y.toFixed(1)})`);
    },
    { enabled: active && riding },
  );
  const rest = cablePoint(riding ? 0.5 : 0.06);
  const camp = (layer: "floor" | "ridge" | "summit") => lane.from === layer || lane.to === layer;
  const pack = (layer: "summit" | "ridge" | "floor") => {
    const values = packs[layer];
    if (!packs.address) return null;
    return `${packFigure(values.HYPE)} HYPE · ${packFigure(values.USDC, 2)} USDC`;
  };

  return (
    <div ref={ref} className={cx("relative overflow-x-auto border-2 border-rule bg-card shadow-hard-lg", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b-2 border-rule px-4 py-2.5">
        <p className="caption">Section · the range cut open · {LANES.length} lanes</p>
        <p className="caption !text-ink-3">tap a lane</p>
      </div>
      <div className="min-w-[540px]">
        <svg viewBox={`0 0 ${SECTION_W} ${SECTION_H}`} width="100%" role="group" aria-label={`Cross-section of the three layers with ${LANES.length} bridge lanes; chosen: ${lane.title}, ${laneTag(lane, asset)}`} className="block">
          <defs>
            <pattern id={`${id}-hatch`} width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <path d="M0,0V7" stroke="rgb(var(--contour))" strokeOpacity="0.55" strokeWidth="1.2" />
            </pattern>
          </defs>
          {BANDS.map((band, index) => (
            <g key={band.layer} aria-hidden="true">
              <rect x="0" y={band.y} width={SECTION_W} height={SECTION_H / 3} fill={LAYER_COLOR[band.layer]} fillOpacity={0.05 + index * 0.02} />
              {index > 0 ? <path d={`M0,${band.y}H${SECTION_W}`} stroke="rgb(var(--ink))" strokeOpacity="0.35" strokeDasharray="1 4" /> : null}
              <text x="14" y={band.y + 28} fontFamily="Instrument Serif, Georgia, serif" fontStyle="italic" fontSize="22" fill={LAYER_COLOR[band.layer]}>
                {band.name}
              </text>
              <text x="14" y={band.y + 45} fontFamily="IBM Plex Mono, monospace" fontSize="10.5" letterSpacing="1.2" fill={LAYER_COLOR[band.layer]}>
                {band.net}
              </text>
            </g>
          ))}
          {/* the ground: a geological section, hatched */}
          <path d={SECTION_FILL} fill={`url(#${id}-hatch)`} aria-hidden="true" />
          <path d={SECTION_PATH} fill="none" stroke="rgb(var(--ink))" strokeWidth="2.2" strokeLinejoin="round" aria-hidden="true" />

          {/* lanes, the chosen one last so it draws on top */}
          {[...LANES].sort((a, b) => (a.id === selected ? 1 : 0) - (b.id === selected ? 1 : 0)).map((item) => {
            const geometry = LANE_GEOMETRY[item.id];
            const chosen = item.id === selected;
            const dashed = item.id === "down-ridge";
            const activate = () => onSelect(item.id);
            return (
              <g
                key={item.id}
                role="button"
                tabIndex={0}
                aria-pressed={chosen}
                aria-label={`${item.title}, ${laneTag(item, asset)}`}
                onClick={activate}
                onKeyDown={(event: React.KeyboardEvent) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    activate();
                  }
                }}
                className="group cursor-pointer outline-none [&:focus-visible_.el-lane-halo]:opacity-100"
              >
                {/* wide invisible hit area */}
                <path d={geometry.d} fill="none" stroke="transparent" strokeWidth="18" />
                <path d={geometry.d} fill="none" stroke="rgb(var(--signal))" strokeWidth="9" strokeLinecap="round" className={cx("el-lane-halo transition-opacity duration-fast", chosen ? "opacity-100" : "opacity-0")} />
                <path
                  key={chosen ? `${item.id}-on` : item.id}
                  d={geometry.d}
                  pathLength={dashed ? undefined : 1}
                  fill="none"
                  stroke="rgb(var(--ink))"
                  strokeOpacity={chosen ? 1 : 0.42}
                  strokeWidth={chosen ? 2.6 : 1.6}
                  strokeDasharray={dashed ? "5 4" : undefined}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className={cx(chosen && (dashed ? "el-draw-fade" : "el-draw"), "transition-[stroke-opacity] duration-fast group-hover:[stroke-opacity:0.85]")}
                />
                <path d={arrowHead(geometry.arrive, geometry.heading, chosen ? 11 : 8)} fill="rgb(var(--ink))" fillOpacity={chosen ? 1 : 0.42} />
                <text
                  x={geometry.label.x}
                  y={geometry.label.y}
                  textAnchor={geometry.anchor}
                  fontFamily="IBM Plex Mono, monospace"
                  fontSize="11.5"
                  fontWeight={chosen ? 700 : 500}
                  letterSpacing="0.6"
                  fill="rgb(var(--ink))"
                  fillOpacity={chosen ? 1 : 0.62}
                  paintOrder="stroke"
                  stroke="rgb(var(--card))"
                  strokeWidth="4"
                >
                  {laneTag(item, asset).toUpperCase()}
                </text>
              </g>
            );
          })}

          {/* the cable car's pylon tops and gondola */}
          <g aria-hidden="true">
            <path d={`M${CAMPS.ridge.x + 14},${GROUND.ridge} V${GROUND.ridge - 24} M${CAMPS.summit.x - 12},${GROUND.summit} V${GROUND.summit - 24}`} stroke="rgb(var(--ink))" strokeWidth="2.2" />
            <g ref={gondola} transform={running ? undefined : `translate(${rest.x.toFixed(1)},${rest.y.toFixed(1)})`}>
              <path d="M0,0 V7" stroke="rgb(var(--ink))" strokeWidth="1.6" />
              <rect x="-9" y="7" width="18" height="12" fill={selected === "up-summit" ? "rgb(var(--signal))" : "rgb(var(--card))"} stroke="rgb(var(--ink))" strokeWidth="1.8" />
              <path d="M-5,11 H5" stroke="rgb(var(--ink))" strokeWidth="1.4" />
            </g>
          </g>

          <Post x={CAMPS.spot.x} y={CAMPS.spot.y} label="SPOT" active={selected === "to-perps" || selected === "to-spot" || selected === "up-ridge" || (selected === "down-floor" && asset === "HYPE")} />
          <Post x={CAMPS.perps.x} y={CAMPS.perps.y} label="PERPS" active={selected === "to-perps" || selected === "to-spot" || (selected === "down-floor" && asset === "USDC")} />
          <Hut x={CAMPS.ridge.x} y={CAMPS.ridge.y} label="RIDGE HUT" active={camp("ridge")} />
          <Hut x={CAMPS.summit.x} y={CAMPS.summit.y} label="SUMMIT HUT" active={camp("summit")} />
          <text x={(CAMPS.spot.x + CAMPS.perps.x) / 2} y={GROUND.floor + 44} textAnchor="middle" fontFamily="IBM Plex Mono, monospace" fontSize="11.5" fontWeight="600" letterSpacing="1" fill="rgb(var(--ink))" aria-hidden="true">
            FLOOR STATION
          </text>

          {/* your pack at each camp */}
          {(
            [
              ["summit", CAMPS.summit.x, GROUND.summit + 36, "end"],
              ["ridge", CAMPS.ridge.x + 30, GROUND.ridge + 36, "start"],
              ["floor", 236, GROUND.floor + 44, "start"],
            ] as const
          ).map(([layer, x, y, anchor]) => {
            const text = pack(layer);
            return text ? (
              <text key={layer} x={layer === "summit" ? SECTION_W - 14 : x} y={y} textAnchor={anchor} fontFamily="IBM Plex Mono, monospace" fontSize="11" fill="rgb(var(--ink))" paintOrder="stroke" stroke="rgb(var(--card))" strokeWidth="3">
                <tspan fill="rgb(var(--ink-3))">PACK </tspan>
                {text}
              </text>
            ) : null;
          })}
        </svg>
      </div>
      <p className="border-t-1.5 border-rule/40 px-4 py-2 font-mono text-[11px] text-ink-3">
        {packs.address ? "pack = what you can move from each camp, read live" : "connect a wallet to read your pack at each camp"} · times are the practice wall’s
      </p>
    </div>
  );
}
