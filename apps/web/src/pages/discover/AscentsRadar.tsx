import type { SpotMetaAndAssetCtxs } from "@elyia/core/hypercore/info";
import type { NetworkEnvironment } from "@elyia/core/networks";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";

import { Link } from "../../app/routes/Link";
import { routeHref } from "../../app/routes/routeTable";
import { infoClient } from "../../lib/hypercore/runtime";
import { useAutoPause } from "../../motion/useAutoPause";
import { useReducedMotion } from "../../motion/useReducedMotion";
import { ElyEmpty } from "../../pixel/ElyEmpty";
import { ElyLoader } from "../../pixel/ElyLoader";
import { Split } from "../../pixel/layout";
import { PixelCanvas } from "../../pixel/PixelCanvas";
import type { TextSurface } from "../../pixel/scene";
import { ConditionSign } from "../../topo/ConditionSign";
import { cx, FOCUS_RING } from "../../ui/cx";
import { SegmentedControl } from "../../ui/SegmentedControl";
import { Skeleton } from "../../ui/Skeleton";
import { pctSigned, usdShort } from "../portfolio/range/format";
import { PixelFigure } from "../track/flow/FlowPixel";
import { useCompact, useNight } from "../track/flow/pixelHooks";
import { firstAscents, radarBlips, type Ascent } from "./radar";
import { paintRadar } from "./radarScope";

function RadarScope({ ascents, hover, picked, onPick }: { readonly ascents: readonly Ascent[]; readonly hover: string | null; readonly picked: string | null; readonly onPick: (name: string) => void }) {
  const compact = useCompact();
  const night = useNight();
  const blips = useMemo(() => radarBlips(ascents), [ascents]);
  // the end state whenever motion is reduced (the shared loop may repaint a still canvas at t = 0)
  const reduced = useReducedMotion();
  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, info: { readonly w: number; readonly seconds: number; readonly still: boolean }) => paintRadar(ctx as unknown as TextSurface, info.w, { blips, picked, hover, night, seconds: info.seconds, still: info.still || reduced }),
    [blips, picked, hover, night, reduced],
  );
  return (
    <PixelFigure caption={["◆ centre = freshest", "bigger diamond = more traded", "hollow = no trades"]} className="flex h-full flex-col">
      <div className="p-4 sm:p-6">
        <PixelCanvas width={compact ? 110 : 140} height={140} aspect={1} draw={draw} animate fps={12} redrawKey={`${picked}|${hover}|${night}|${blips.length}`} label={`First ascents radar: ${ascents.length} newest HyperCore spot tokens, freshest nearest the centre${picked ? `; picked ${picked}` : ""}`} />
      </div>
      <div className="flex flex-wrap justify-center gap-3 border-t-4 border-rule px-4 py-4" role="group" aria-label="Pick a launch on the radar">
        {ascents.slice(0, 5).map((ascent) => (
          <button key={ascent.name} type="button" aria-pressed={picked === ascent.name} onClick={() => onPick(ascent.name)} className={cx("px-2 py-0.5 font-tag text-[11px] uppercase px-frame-thin px-press", picked === ascent.name ? "bg-signal text-signal-ink" : "bg-card text-ink", FOCUS_RING)}>
            {ascent.name}
          </button>
        ))}
      </div>
    </PixelFigure>
  );
}

/**
 * First ascents: the newest HyperCore spot tokens (by deploy index) on a
 * radar, freshest at the centre, read live from the info API, beside a log
 * book of the same tokens. Elysium pools join when the launch indexer of
 * the discovery API comes online; the panel says so.
 */
export function AscentsRadar({ mode: appMode }: { readonly mode: NetworkEnvironment }) {
  const { ref, active } = useAutoPause<HTMLDivElement>();
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

  const chosen = picked ?? ascents[0]?.name ?? null;
  return (
    <div ref={ref} className="flex flex-col gap-10">
      <div className="flex justify-center">
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
      </div>
      <Split>
        {query.isPending ? (
          <div className="flex items-center justify-center bg-card px-frame px-drop">
            <ElyLoader label="Sweeping the Floor for launches…" size="lg" />
          </div>
        ) : (
          <RadarScope ascents={ascents} hover={hover} picked={chosen} onPick={(name) => setPicked(name)} />
        )}
        <section aria-labelledby="ascents-title" className="flex min-w-0 flex-col bg-card px-frame px-drop">
          <header className="flex flex-col items-center gap-2 border-b-4 border-rule px-5 py-5 text-center">
            <p className="caption">{mode === "mainnet" ? "HyperCore mainnet · read only" : "HyperCore testnet"}</p>
            <h3 id="ascents-title" className="font-display text-[24px] font-bold leading-none text-ink">
              Newest on the Floor
            </h3>
          </header>
          {query.isError ? (
            <ElyEmpty compact className="flex-1 justify-center px-5" title="No answer yet" description="HyperCore's info API did not answer. The radar fills as soon as it does." />
          ) : (
            <ol className="flex flex-col" aria-label="Newest HyperCore spot tokens">
              {(query.isPending ? [] : ascents).map((ascent, rank) => (
                <li key={ascent.name} onMouseEnter={() => setHover(ascent.name)} onMouseLeave={() => setHover(null)} className={cx("grid grid-cols-[1.75rem_minmax(0,1fr)_auto] items-center gap-x-3 border-b-2 border-dashed border-rule/20 px-5 py-2.5", chosen === ascent.name && "bg-signal text-signal-ink")}>
                  <span className="tnum font-tag text-[11px] opacity-70">{String(rank + 1).padStart(2, "0")}</span>
                  <span className="min-w-0">
                    <span className="flex items-baseline gap-2">
                      {tradable ? (
                        <Link to={routeHref("trade", { market: `${ascent.name}-USDC` })} className={cx("truncate font-display text-[16px] font-bold underline decoration-transparent decoration-2 underline-offset-4 hover:decoration-current", FOCUS_RING)} onFocus={() => setHover(ascent.name)} onBlur={() => setHover(null)}>
                          {ascent.name}
                        </Link>
                      ) : (
                        <button type="button" onClick={() => setPicked(ascent.name)} onFocus={() => setHover(ascent.name)} onBlur={() => setHover(null)} className={cx("truncate text-left font-display text-[16px] font-bold", FOCUS_RING)}>
                          {ascent.name}
                        </button>
                      )}
                      <span className="tnum shrink-0 font-mono text-[10px] opacity-70">#{ascent.index}</span>
                      {ascent.evmLinked ? <span className="shrink-0 font-tag text-[9px] uppercase opacity-80">ridge-linked</span> : null}
                    </span>
                    <span className="tnum block truncate font-mono text-[11px] opacity-80">
                      {ascent.dayVolumeUsd > 0 ? `${usdShort(ascent.dayVolumeUsd)} today` : "no volume"}
                      {ascent.change !== null && ascent.dayVolumeUsd > 0 ? <span className={chosen === ascent.name ? "" : ascent.change >= 0 ? "text-up" : "text-down"}> · {ascent.change >= 0 ? "▲" : "▼"} {pctSigned(ascent.change)}</span> : null}
                      {ascent.fullName ? ` · ${ascent.fullName}` : ""}
                    </span>
                  </span>
                  <ConditionSign condition={ascent.condition} size="sm" />
                </li>
              ))}
              {query.isPending
                ? Array.from({ length: 6 }, (_, index) => (
                    <li key={index} className="px-5 py-3">
                      <Skeleton className="h-6 w-full" />
                    </li>
                  ))
                : null}
            </ol>
          )}
          <p className="mt-auto border-t-4 border-dashed border-rule/30 px-5 py-4 text-center font-mono text-[11px] leading-relaxed text-ink-2 text-pretty">
            {tradable ? "" : "Mainnet, read only: the practice wall trades testnet, so these rows do not open the terminal. "}Fresh launches read CAUTION until Shield has checked them. New Elysium pools join this radar when the discovery API&apos;s launch indexer comes online.
          </p>
        </section>
      </Split>
    </div>
  );
}
