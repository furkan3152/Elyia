import { useMemo } from "react";

import { routeHref } from "../../app/routes/routeTable";
import { useRoute } from "../../app/routes/useRoute";
import { openOracle } from "../../oracle/oracleStore";
import { SignpostCluster } from "../../topo/Signpost";
import { Button, ButtonLink } from "../../ui/Button";
import { Kbd } from "../../ui/Kbd";
import { modShortcutLabel } from "../../ui/platform";
import { nearestTrails, offMapReading } from "./offMap";
import { OffMapSheet } from "./OffMapSheet";

/**
 * 404 for the site and the deck (the router picks the layout): "off the
 * map". The survey sheet tears off, the YOU ARE HERE pin sits on blank paper
 * beyond it, and the signposts point at the trails the lost path most likely
 * meant, then the usual ways home.
 */
export default function NotFoundPage() {
  const { route, location } = useRoute();
  const inDeck = route.kind === "app";
  const path = location.pathname || "/";
  const reading = useMemo(() => offMapReading(path), [path]);
  const guesses = useMemo(() => nearestTrails(path, { inDeck, max: 2 }), [path, inDeck]);
  const home = inDeck
    ? [
        { destination: "Deck · base camp", eta: "home", detail: "the Where to? box and your range", to: routeHref("deck") },
        { destination: "Trade · HyperCore", eta: "0.2 s", detail: "perps and spot on the Floor", to: routeHref("trade") },
        { destination: "Portfolio", eta: "1 sheet", detail: "your range, surveyed", to: routeHref("portfolio") },
      ]
    : [
        { destination: "The landing", eta: "home", detail: "what Elyia is, in one sheet", to: "/" },
        { destination: "Open the deck", eta: "/app", detail: "trade, bridge, earn, one sentence", to: routeHref("deck") },
        { destination: "Elysium weather station", eta: "live", detail: "114 ms blocks on the drum", to: routeHref("elysium") },
      ];
  const known = new Set(guesses.map((guess) => guess.trail.path));
  const blades = [
    ...guesses.map((guess) => ({ destination: guess.trail.name, eta: guess.trail.path, detail: "the nearest trail to what you typed", to: guess.trail.path, highlight: true })),
    ...home.filter((blade) => !known.has(blade.to)).map((blade, index) => ({ ...blade, highlight: guesses.length === 0 && index === 0 })),
  ].slice(0, 4);

  return (
    <div className="mx-auto w-full max-w-[1440px] px-4 pb-16 pt-8 sm:px-6 lg:px-10 lg:pt-14">
      <div className="grid grid-cols-1 items-start gap-10 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-14">
        <div className="flex min-w-0 flex-col">
          <p className="label-tab self-start">Sheet 404 · off the map</p>
          <h1 className="mt-6 text-[52px] font-bold leading-[0.96] tracking-[-0.03em] text-ink text-balance sm:text-[80px]">Off the map.</h1>
          <p className="mt-5 max-w-[34rem] text-[17px] leading-relaxed text-ink-2 sm:text-[19px]">
            Nobody has surveyed <code className="break-all bg-paper-2 px-1.5 py-0.5 font-mono text-[0.85em] text-ink">{path}</code> yet. The trail back is marked; or say where you meant to go and the Guide will draw the route.
          </p>

          <dl className="tnum mt-6 grid max-w-[30rem] grid-cols-3 border-2 border-rule bg-card font-mono text-[12px] shadow-hard">
            <div className="border-r-1.5 border-rule px-3 py-2">
              <dt className="text-[10px] uppercase tracking-[0.14em] text-ink-3">Position</dt>
              <dd className="mt-0.5 text-ink">
                {reading.lat} {reading.lon}
              </dd>
            </div>
            <div className="border-r-1.5 border-rule px-3 py-2">
              <dt className="text-[10px] uppercase tracking-[0.14em] text-ink-3">Elevation</dt>
              <dd className="mt-0.5 text-ink">{reading.elevation.toLocaleString("en-US")} m</dd>
            </div>
            <div className="px-3 py-2">
              <dt className="text-[10px] uppercase tracking-[0.14em] text-ink-3">Off the sheet</dt>
              <dd className="mt-0.5 text-ink">{reading.offEdgeKm} km</dd>
            </div>
          </dl>

          <SignpostCluster className="mt-8 max-w-[30rem] pr-4 sm:pr-0" caption={guesses.length > 0 ? "Trails back · nearest first" : "Trails back"} label="Ways back" blades={blades} />

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Button variant="primary" size="lg" onClick={() => openOracle()}>
              Where to? →
            </Button>
            <span className="flex items-center gap-1.5 font-mono text-[12px] text-ink-2">
              or press <Kbd>{modShortcutLabel("K")}</Kbd> anywhere
            </span>
            <ButtonLink to={inDeck ? routeHref("deck") : "/"} variant="ghost" size="md">
              ← {inDeck ? "Back to base camp" : "Back home"}
            </ButtonLink>
          </div>
        </div>

        <figure className="min-w-0">
          <div className="border-2 border-rule bg-paper shadow-hard-xl">
            <div className="flex items-center justify-between gap-3 border-b-2 border-rule bg-card px-4 py-2">
              <span className="caption !text-ink">Survey sheet · torn at the edge</span>
              <span className="caption hidden sm:inline">1 : 25 000 · not to scale beyond the tear</span>
            </div>
            <OffMapSheet reading={reading} path={path} />
          </div>
          <figcaption className="mt-3 font-mono text-[11px] leading-relaxed text-ink-3">
            The sheet stops where the survey stopped. The pin is the address you asked for; the glacier line is the way back to base camp.
          </figcaption>
        </figure>
      </div>
    </div>
  );
}
