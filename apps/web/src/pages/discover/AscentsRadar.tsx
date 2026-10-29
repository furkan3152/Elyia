import type { SpotMetaAndAssetCtxs } from "@elyia/core/hypercore/info";
import type { NetworkEnvironment } from "@elyia/core/networks";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { Link } from "../../app/routes/Link";
import { routeHref } from "../../app/routes/routeTable";
import { infoClient } from "../../lib/hypercore/runtime";
import { seededRandom } from "../../motion/tokens";
import { useAutoPause } from "../../motion/useAutoPause";
import { ConditionSign } from "../../topo/ConditionSign";
import { cx, FOCUS_RING } from "../../ui/cx";
import { SegmentedControl } from "../../ui/SegmentedControl";
import { Skeleton } from "../../ui/Skeleton";
import { pctSigned, usdShort } from "../portfolio/range/format";
import { firstAscents, radarBlips, type Ascent } from "./radar";

const SIZE = 360;
const C = SIZE / 2;
const R = C - 22;

/** Rings drawn like contour lines: each a closed, slightly wandering loop (seeded, static). */
function ringPath(radius: number, seed: number): string {
  const random = seededRandom(seed);
  const n = 48;
  const phase = random() * Math.PI * 2;
  const wobble = 1.2 + random() * 1.6;
  const points = Array.from({ length: n }, (_, index) => {
    const t = (index / n) * Math.PI * 2;
    const r = radius + Math.sin(t * 3 + phase) * wobble + Math.sin(t * 5 + phase * 2) * wobble * 0.5;
    return [C + Math.cos(t) * r, C + Math.sin(t) * r] as const;
  });
  return `M${points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join("L")}Z`;
}

const RINGS = [0.25, 0.5, 0.75, 1].map((f, index) => ringPath(R * f, 31 + index));

function RadarScope({ ascents, active, onPick, picked }: { readonly ascents: readonly Ascent[]; readonly active: string | null; readonly onPick: (name: string) => void; readonly picked: string | null }) {
  const blips = useMemo(() => radarBlips(ascents), [ascents]);
  return (
    <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="block h-auto w-full" role="group" aria-label={`First ascents radar: ${ascents.length} newest HyperCore spot tokens, freshest nearest the centre`}>
      <style>{"@keyframes el-radar-sweep{to{transform:rotate(360deg)}}"}</style>
      <defs>
        <linearGradient id="sweep-fade" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" className="[stop-color:rgb(var(--accent-line))]" stopOpacity="0" />
          <stop offset="1" className="[stop-color:rgb(var(--accent-line))]" stopOpacity="0.28" />
        </linearGradient>
      </defs>
      <circle cx={C} cy={C} r={R + 10} className="fill-card stroke-rule" strokeWidth="2" />
      <g fill="none" className="stroke-contour">
        {RINGS.map((d, index) => (
          <path key={index} d={d} strokeWidth={index === 3 ? 1.6 : 1} opacity={index === 3 ? 0.9 : 0.6} />
        ))}
      </g>
      <g className="stroke-ink-3" strokeWidth="1" opacity="0.55">
        <path d={`M${C},${C - R} V${C + R} M${C - R},${C} H${C + R}`} strokeDasharray="2 5" />
      </g>
      {/* compass ticks */}
      <g className="stroke-rule" strokeWidth="1.5">
        {Array.from({ length: 36 }, (_, index) => {
          const t = (index / 36) * Math.PI * 2;
          const inner = R + (index % 9 === 0 ? 2 : 6);
          return <path key={index} d={`M${C + Math.cos(t) * inner},${C + Math.sin(t) * inner} L${C + Math.cos(t) * (R + 10)},${C + Math.sin(t) * (R + 10)}`} />;
        })}
      </g>
      <g className="fill-ink font-mono" fontSize="10" fontWeight="600" textAnchor="middle" letterSpacing="1">
        <text x={C} y={14}>N</text>
        <text x={SIZE - 8} y={C + 4}>E</text>
        <text x={C} y={SIZE - 4}>S</text>
        <text x={8} y={C + 4}>W</text>
      </g>
      {/* the sweep: one turn every 8 s, a moving wedge (never a flash) */}
      <g className="el-loop" style={{ transformOrigin: `${C}px ${C}px`, animation: "el-radar-sweep 8s linear infinite" }}>
        <path d={`M${C},${C} L${C + R},${C} A${R},${R} 0 0 0 ${C + Math.cos(-0.7) * R},${C + Math.sin(-0.7) * R} Z`} fill="url(#sweep-fade)" />
        <path d={`M${C},${C} L${C + R},${C}`} className="stroke-accent-line" strokeWidth="1.6" />
      </g>
      <circle cx={C} cy={C} r="4" className="fill-rule" />
      {blips.map((blip) => {
        const x = C + Math.cos(blip.angle) * blip.r * R;
        const y = C + Math.sin(blip.angle) * blip.r * R;
        const s = Math.max(5, blip.size * SIZE);
        const on = active === blip.ascent.name || picked === blip.ascent.name;
        return (
          <g key={blip.ascent.name} transform={`translate(${x.toFixed(1)} ${y.toFixed(1)})`}>
            <path
              d={`M0,${-s} L${s},0 L0,${s} L${-s},0 Z`}
              className={cx(blip.ascent.condition === "closed" ? "fill-card stroke-ink-3" : on ? "fill-signal stroke-rule" : "fill-ridge stroke-rule", "cursor-pointer")}
              strokeWidth="1.5"
              onClick={() => onPick(blip.ascent.name)}
            />
            {on || blip.r < 0.5 ? (
              <text x={s + 4} y={4} className="pointer-events-none fill-ink font-mono" fontSize="11" fontWeight="600">
                {blip.ascent.name}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

/**
 * First ascents: the newest HyperCore spot tokens (by deploy index) on a
 * radar, freshest at the centre, read live from the info API, beside a log
 * book of the same tokens. Elysium pools join when the launch indexer of
 * the discovery API comes online; the panel says so.
 */
export function AscentsRadar({ mode: appMode }: { readonly mode: NetworkEnvironment }) {
  const { ref, active } = useAutoPause<HTMLElement>();
  // Launches worth hunting happen on mainnet; reading them is public and spends nothing.
  const [mode, setMode] = useState<NetworkEnvironment>("mainnet");
  const tradable = mode === appMode;
  const [hover, setHover] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ["hypercore", mode, "spotMetaAndAssetCtxs"],
    queryFn: () => infoClient(mode).post<SpotMetaAndAssetCtxs>({ type: "spotMetaAndAssetCtxs" }),
    staleTime: 60_000,
    refetchInterval: active ? 120_000 : false,
    retry: 1,
  });
  const ascents = useMemo(() => (query.data ? firstAscents(query.data, 10) : []), [query.data]);

  return (
    <section ref={ref} aria-labelledby="ascents-title" className="flex min-w-0 flex-col border-2 border-rule bg-card shadow-hard-xl">
      <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b-2 border-rule px-4 py-2.5">
        <h2 id="ascents-title" className="caption !text-ink">
          First ascents · newest on the Floor
        </h2>
        <SegmentedControl
          size="sm"
          label="Which Floor"
          value={mode}
          onChange={(next) => {
            setMode(next);
            setPicked(null);
          }}
          options={[
            { value: "mainnet", label: "Mainnet · read only" },
            { value: "testnet", label: "Testnet" },
          ]}
        />
      </header>
      <div className="grid grid-cols-1 gap-0 md:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        <div className="border-b-1.5 border-rule p-4 md:border-b-0 md:border-r-1.5">
          {query.isPending ? <Skeleton className="aspect-square w-full" /> : <RadarScope ascents={ascents} active={hover} picked={picked} onPick={(name) => setPicked((current) => (current === name ? null : name))} />}
          <p className="mt-3 font-mono text-[11px] leading-relaxed text-ink-3">Centre = freshest deploy · bearing fixed per token · bigger diamond = more traded today · hollow = no trades yet.</p>
        </div>
        <div className="flex min-w-0 flex-col">
          {query.isError ? (
            <p className="p-4 text-[15px] text-ink-2">HyperCore&apos;s info API did not answer. The radar fills as soon as it does.</p>
          ) : (
            <ol className="divide-y divide-rule/15" aria-label="Newest HyperCore spot tokens">
              {(query.isPending ? [] : ascents).map((ascent, rank) => (
                <li key={ascent.name} onMouseEnter={() => setHover(ascent.name)} onMouseLeave={() => setHover(null)} className={cx("grid grid-cols-[1.75rem_minmax(0,1fr)_auto] items-center gap-x-3 px-4 py-2", picked === ascent.name && "bg-signal/25")}>
                  <span className="tnum font-mono text-[11px] text-ink-3">{String(rank + 1).padStart(2, "0")}</span>
                  <span className="min-w-0">
                    <span className="flex items-baseline gap-2">
                      {tradable ? (
                        <Link to={routeHref("trade", { market: `${ascent.name}-USDC` })} className={cx("truncate text-[15px] font-bold text-ink underline decoration-transparent decoration-2 underline-offset-4 hover:decoration-accent-line", FOCUS_RING)} onFocus={() => setHover(ascent.name)} onBlur={() => setHover(null)}>
                          {ascent.name}
                        </Link>
                      ) : (
                        <span className="truncate text-[15px] font-bold text-ink">{ascent.name}</span>
                      )}
                      <span className="tnum shrink-0 font-mono text-[10px] text-ink-3">#{ascent.index}</span>
                      {ascent.evmLinked ? <span className="shrink-0 font-mono text-[10px] font-semibold tracking-[0.1em] text-ridge">RIDGE-LINKED</span> : null}
                    </span>
                    <span className="tnum block truncate font-mono text-[11px] text-ink-2">
                      {ascent.dayVolumeUsd > 0 ? `${usdShort(ascent.dayVolumeUsd)} today` : "no volume"}
                      {ascent.change !== null && ascent.dayVolumeUsd > 0 ? <span className={ascent.change >= 0 ? "text-up" : "text-down"}> · {pctSigned(ascent.change)}</span> : null}
                      {ascent.fullName ? ` · ${ascent.fullName}` : ""}
                    </span>
                  </span>
                  <ConditionSign condition={ascent.condition} size="sm" />
                </li>
              ))}
              {query.isPending
                ? Array.from({ length: 6 }, (_, index) => (
                    <li key={index} className="px-4 py-3">
                      <Skeleton className="h-6 w-full" />
                    </li>
                  ))
                : null}
            </ol>
          )}
          <p className="mt-auto border-t-1.5 border-dashed border-rule/60 px-4 py-2.5 font-mono text-[11px] leading-relaxed text-ink-2">
            {tradable ? "" : `Mainnet, read only: the practice wall trades testnet, so these rows do not open the terminal. `}Fresh launches read CAUTION until Shield has checked them. New Elysium pools join this radar when the discovery API&apos;s launch indexer comes online.
          </p>
        </div>
      </div>
    </section>
  );
}
