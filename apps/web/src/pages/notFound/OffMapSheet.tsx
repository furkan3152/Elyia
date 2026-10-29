import { useMemo } from "react";

import { cssVars, seededRandom } from "../../motion/tokens";
import { useAutoPause } from "../../motion/useAutoPause";
import { isolines, sampleField, simplify, smoothPath, type Point } from "../../topo/geometry/contours";
import { cx } from "../../ui/cx";
import type { OffMapReading } from "./offMap";

const W = 900;
const H = 560;
/** Where the surveyed sheet tears off. */
const EDGE = 590;
const CAMP: Point = [372, 318];

interface SheetArt {
  readonly contours: readonly { d: string; index: boolean }[];
  readonly tear: string;
  readonly tearLine: string;
}

/** The surveyed part: real marching-squares contours of three hills, clipped by a torn edge. */
function buildArt(): SheetArt {
  const hills = [
    { x: 200, y: 180, s: 85, h: 1 },
    { x: 300, y: 250, s: 60, h: 0.5 },
    { x: 430, y: 360, s: 70, h: 0.8 },
    { x: 520, y: 130, s: 55, h: 0.6 },
    { x: 130, y: 440, s: 65, h: 0.5 },
    { x: 560, y: 470, s: 50, h: 0.35 },
    { x: 330, y: 470, s: 40, h: -0.25 },
  ];
  const field = sampleField(EDGE + 40, H, 8, (x, y) => hills.reduce((sum, hill) => sum + hill.h * Math.exp(-((x - hill.x) ** 2 + (y - hill.y) ** 2) / (2 * hill.s * hill.s)), 0));
  const contours: { d: string; index: boolean }[] = [];
  const levels = 14;
  for (let level = 1; level <= levels; level += 1) {
    for (const line of isolines(field, (field.max * level) / (levels + 1))) {
      const points = simplify(line.points, 0.6);
      if (points.length < 3) continue;
      contours.push({ d: smoothPath(points, line.closed), index: level % 5 === 0 });
    }
  }
  const random = seededRandom(404);
  const edge: Point[] = [];
  for (let y = 0; y <= H; y += 13) edge.push([EDGE + (random() - 0.5) * 22 + Math.sin(y / 37) * 6, y]);
  const last = edge[edge.length - 1]!;
  if (last[1] < H) edge.push([EDGE, H]);
  const tearLine = `M${edge.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join("L")}`;
  const tear = `M0,0L${edge.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join("L")}L0,${H}Z`;
  return { contours, tear, tearLine };
}

let cached: SheetArt | null = null;

export interface OffMapSheetProps {
  readonly reading: OffMapReading;
  /** The lost path, printed on the marker. */
  readonly path: string;
  readonly className?: string;
}

/**
 * The 404 artifact: a survey sheet whose right edge is torn off, and the
 * yellow YOU ARE HERE pin out on the blank paper beyond it, with the trail
 * back to base camp drawing on. Decorative: the page states the same facts
 * in text, so the drawing is aria-hidden.
 */
export function OffMapSheet({ reading, path, className }: OffMapSheetProps) {
  const art = useMemo(() => (cached ??= buildArt()), []);
  const { ref, seen } = useAutoPause<HTMLDivElement>();
  const markerY = Math.round(70 + reading.y * (H - 160));
  const marker: Point = [778, markerY];
  // The way back: from the pin, over the torn edge, to the hut.
  const trail = `M${marker[0]},${marker[1]} C${marker[0] - 70},${marker[1] + 40} ${EDGE + 40},${CAMP[1] - 120} ${EDGE - 20},${CAMP[1] - 70} S${CAMP[0] + 80},${CAMP[1] - 10} ${CAMP[0] + 10},${CAMP[1] - 4}`;
  const shown = path.length > 26 ? `${path.slice(0, 25)}…` : path;
  return (
    <div ref={ref} className={cx("relative", className)} data-el-hold={seen ? undefined : ""}>
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" aria-hidden="true" focusable="false">
        <defs>
          <clipPath id="off-sheet">
            <path d={art.tear} />
          </clipPath>
          <pattern id="off-unsurveyed" width="18" height="18" patternUnits="userSpaceOnUse">
            <circle cx="9" cy="9" r="0.9" className="fill-ink-3" opacity="0.45" />
          </pattern>
        </defs>

        {/* the blank paper beyond the edge */}
        <rect x={EDGE - 30} y="0" width={W - EDGE + 30} height={H} fill="url(#off-unsurveyed)" />
        <text x={W - 34} y={H - 34} textAnchor="end" className="map-label fill-ink-3" fontSize="30">
          unsurveyed
        </text>

        {/* the surveyed sheet, torn */}
        <g clipPath="url(#off-sheet)">
          <rect width={EDGE + 40} height={H} className="fill-card" />
          <g fill="none" className="stroke-contour">
            {art.contours.map((contour, index) => (
              <path
                key={index}
                d={contour.d}
                pathLength={1}
                strokeWidth={contour.index ? 1.6 : 0.9}
                opacity={contour.index ? 0.95 : 0.6}
                className="el-draw"
                style={cssVars({ "--el-delay": `${(index % 18) * 55}ms`, "--el-draw-dur": "1600ms" })}
              />
            ))}
          </g>
          {/* graticule crosses */}
          <g className="stroke-ink-3" strokeWidth="1" opacity="0.5">
            {[120, 270, 420].flatMap((x) => [110, 260, 410].map((y) => <path key={`${x}-${y}`} d={`M${x - 5},${y}h10M${x},${y - 5}v10`} />))}
          </g>
          <text x="40" y="60" className="map-label fill-floor" fontSize="30">
            The Floor
          </text>
          <text x="420" y="70" className="map-label fill-ridge" fontSize="28">
            The Ridge
          </text>
          <text x="60" y="520" className="map-label fill-summit-ink" fontSize="28">
            The Summit
          </text>
        </g>
        {/* the torn edge itself, inked */}
        <path d={art.tearLine} fill="none" className="stroke-rule" strokeWidth="2" strokeLinejoin="round" />
        {/* neat-line on the three surviving sides, with ticks */}
        <path d={`M${EDGE},1 H1 V${H - 1} H${EDGE}`} fill="none" className="stroke-rule" strokeWidth="2" />
        <g className="stroke-rule" strokeWidth="1.5">
          {[60, 150, 240, 330, 420, 510].map((x) => (
            <path key={`t${x}`} d={`M${x},1v8M${x},${H - 1}v-8`} />
          ))}
          {[80, 180, 280, 380, 480].map((y) => (
            <path key={`l${y}`} d={`M1,${y}h8`} />
          ))}
        </g>

        {/* base camp hut */}
        <g transform={`translate(${CAMP[0]} ${CAMP[1]})`}>
          <path d="M-13,9 L0,-12 L13,9 Z" className="fill-ink" />
          <text x="20" y="5" className="fill-ink font-mono" fontSize="13" fontWeight="600" letterSpacing="1.5">
            BASE CAMP
          </text>
        </g>

        {/* the way back */}
        <path d={trail} fill="none" className="stroke-accent-line el-draw" strokeWidth="3" strokeLinecap="round" pathLength={1} style={cssVars({ "--el-delay": "900ms", "--el-draw-dur": "1400ms" })} />

        {/* YOU ARE HERE */}
        <g transform={`translate(${marker[0]} ${marker[1]})`}>
          <circle r="22" className="fill-signal/30 stroke-signal" strokeWidth="1.5" strokeDasharray="3 4" />
          <path d="M0,-15 L15,0 L0,15 L-15,0 Z" className="fill-signal stroke-rule" strokeWidth="2" />
          <circle r="3" className="fill-rule" />
          <g transform="translate(-92 30)">
            <rect width="184" height="46" className="fill-card stroke-rule" strokeWidth="2" />
            <text x="10" y="18" className="fill-ink font-mono" fontSize="11" fontWeight="600" letterSpacing="1.8">
              YOU ARE HERE
            </text>
            <text x="10" y="35" className="fill-ink-2 font-mono" fontSize="11.5">
              {shown}
            </text>
          </g>
        </g>
      </svg>
    </div>
  );
}
