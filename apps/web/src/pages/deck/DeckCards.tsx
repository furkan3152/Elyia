import type { PortfolioHistory } from "@elyia/core/api/portfolio";
import React, { useMemo } from "react";

import { useNow } from "../../hooks/useNow";

import { routeHref } from "../../app/routes/routeTable";
import type { RopeView } from "../../features/trading/useTopoData";
import { intentHref } from "../../oracle/preview";
import { Blaze } from "../../topo/Blaze";
import { RadioLog } from "../../topo/RadioLog";
import { Signpost } from "../../topo/Signpost";
import { cx, FOCUS_RING } from "../../ui/cx";
import { Panel, PanelHeader } from "../../ui/Panel";
import { clock } from "../portfolio/range/format";
import { LAYER_NAME } from "../portfolio/range/model";
import { radioEntries } from "./radio";
import { sketchRoute, type LoggedRoute } from "./routesLog";

const TONE = { floor: "text-floor", ridge: "text-ridge", summit: "text-summit-ink" } as const;

/** A deck card: a pixel sheet with a ruled Silkscreen header, its body filling the height (rows stay equal). */
export function DeckCard({ title, aside, children, className }: { readonly title: React.ReactNode; readonly aside?: React.ReactNode; readonly children: React.ReactNode; readonly className?: string }) {
  return (
    <Panel as="section" variant="sheet" padding="none" className={cx("flex min-w-0 flex-col", className)}>
      <PanelHeader ruled title={title} aside={aside} />
      <div className="flex flex-1 flex-col">{children}</div>
    </Panel>
  );
}

interface Blade {
  readonly destination: string;
  readonly eta: string;
  readonly detail: string;
  readonly grade: 1 | 2 | 3;
  readonly to: string;
  readonly highlight: boolean;
}

/**
 * The junction: six trail blades on one pole, mirrored on the axis (three
 * point west, three point east). One tap opens the route; you sign.
 */
export function Junction({ portfolioHref, className }: { readonly portfolioHref: string; readonly className?: string }) {
  const west: readonly Blade[] = [
    { destination: "Trade", eta: "0.2 s", detail: "perps · the Floor", grade: 3, to: routeHref("trade"), highlight: true },
    { destination: "To perps", eta: "~5 s", detail: "EVM USDC → Floor", grade: 2, to: intentHref("move all my HyperEVM USDC to perps"), highlight: false },
    { destination: "Survey", eta: "now", detail: "the full sheet", grade: 1, to: portfolioHref, highlight: false },
  ];
  const east: readonly Blade[] = [
    { destination: "Elysium", eta: "~1 min", detail: "bridge to the Summit", grade: 2, to: intentHref("bridge 20 HYPE to Elysium"), highlight: true },
    { destination: "kHYPE", eta: "1 s", detail: "stake on the Ridge", grade: 1, to: intentHref("stake 10 HYPE to kHYPE"), highlight: false },
    { destination: "Sweep", eta: "1 route", detail: "dust → USDC", grade: 1, to: `${portfolioHref}#jobs`, highlight: false },
  ];
  return (
    <div className={cx("relative flex flex-1 flex-col justify-center px-4 py-6 sm:px-6", className)} role="group" aria-label="The junction: quick routes">
      <div className="relative">
        {/* the pole on the axis, a sun cap on top */}
        <span aria-hidden="true" className="absolute -bottom-3 left-1/2 -top-5 hidden w-3 -translate-x-1/2 bg-ridge px-frame-thin md:block" />
        <span aria-hidden="true" className="absolute -top-7 left-1/2 hidden h-3 w-6 -translate-x-1/2 bg-signal px-frame-thin md:block" />
        <ul className="relative grid grid-cols-1 gap-x-14 gap-y-5 md:grid-cols-2">
          {west.map((blade, index) => (
            <React.Fragment key={blade.destination}>
              <li>
                <Signpost {...blade} direction="left" index={index * 2} />
              </li>
              <li>
                <Signpost {...east[index]!} direction="right" index={index * 2 + 1} />
              </li>
            </React.Fragment>
          ))}
        </ul>
      </div>
      <p className="mt-9 text-center font-tag text-[11px] uppercase text-ink-2">The junction · one tap · you sign</p>
    </div>
  );
}

/** Recent route cards planned from this browser, as pixel ticket stubs; examples while empty. */
export function RecentRoutes({ routes, onReplan, className }: { readonly routes: readonly LoggedRoute[]; readonly onReplan: (sentence: string) => void; readonly className?: string }) {
  const shown = (
    routes.length > 0
      ? routes
      : [
          { sentence: "bridge 20 HYPE to Elysium and swap half to USDC", at: 0 },
          { sentence: "long ETH 5x with 200 USDC, stop at -3%", at: 0 },
          { sentence: "stake 10 HYPE to kHYPE", at: 1 },
          { sentence: "move all my HyperEVM USDC to perps", at: 2 },
        ]
  ).slice(0, 4);
  const examples = routes.length === 0;
  return (
    <ul className={cx("grid flex-1 grid-cols-1 content-center gap-6 p-5 sm:grid-cols-2", className)}>
      {shown.map((route) => {
        const sketch = sketchRoute(route.sentence);
        return (
          <li key={`${route.sentence}-${route.at}`} className="flex">
            <button
              type="button"
              onClick={() => onReplan(route.sentence)}
              className={cx("group flex w-full flex-col bg-card text-left px-frame-thin px-drop px-press", examples && "bg-paper-2/60", FOCUS_RING)}
            >
              <span className="flex items-center justify-between gap-2 border-b-2 border-dashed border-rule px-3 py-1.5 font-tag text-[11px] uppercase text-ink-2">
                <span>{examples ? "example" : `route · ${clock(route.at).slice(0, 5)} UTC`}</span>
                <span className="flex items-center gap-1.5">
                  <Blaze grade={sketch.grade} size={11} /> T{sketch.grade}
                </span>
              </span>
              <span className="block px-3 py-2.5 font-mono text-[13px] leading-snug text-ink">“{route.sentence}”</span>
              <span className="mt-auto flex items-center justify-between gap-2 px-3 pb-2 font-tag text-[11px] uppercase">
                <span className="flex gap-2">
                  {sketch.layers.map((layer) => (
                    <span key={layer} className={TONE[layer]}>
                      {LAYER_NAME[layer]}
                    </span>
                  ))}
                </span>
                <span className="text-accent">plan again ▸</span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The Guide's base-camp radio, read off the followed range: the latest
 * fills, funding and transfers, plus a call on every rope that frays.
 */
export function GuideRadio({ ropes, history, sample, className }: { readonly ropes: readonly RopeView[]; readonly history: PortfolioHistory | null; readonly sample: boolean; readonly className?: string }) {
  const now = useNow(30_000);
  const entries = useMemo(() => radioEntries(ropes, history, now), [ropes, history, now]);
  return <RadioLog className={className} entries={entries} title={`Radio log · base camp${sample ? " · sample" : ""}`} aside={sample ? "sample" : "live from HyperCore"} footer="the Guide proposes · you sign · it never withdraws" maxHeight="320px" />;
}
