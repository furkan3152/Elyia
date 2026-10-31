import { useMemo } from "react";

import { routeHref } from "../../app/routes/routeTable";
import { useRoute } from "../../app/routes/useRoute";
import { openOracle } from "../../oracle/oracleStore";
import { Cards, Page, Section } from "../../pixel/layout";
import { Signpost, type SignpostProps } from "../../topo/Signpost";
import { Button, ButtonLink } from "../../ui/Button";
import { Kbd } from "../../ui/Kbd";
import { modShortcutLabel } from "../../ui/platform";
import { Readout } from "../landing/PulseReadouts";
import { nearestTrails, offMapReading } from "./offMap";
import { OffMapSheet } from "./OffMapSheet";

type Blade = Omit<SignpostProps, "index" | "swing" | "direction">;

/**
 * The junction: one pole on the centre axis, blades pointing out to both
 * sides (nearest guess on the left, the next on the right, and so on). On a
 * phone the blades stack under the pole, all pointing right.
 */
function Junction({ blades, guessed }: { readonly blades: readonly Blade[]; readonly guessed: boolean }) {
  const left = blades.filter((_, index) => index % 2 === 0);
  const right = blades.filter((_, index) => index % 2 === 1);
  return (
    <div role="group" aria-label="Ways back" className="mx-auto max-w-[920px]">
      <p className="mb-6 text-center font-tag text-[11px] uppercase text-ink-2">{guessed ? "Trails back · nearest to what you typed first" : "Trails back"}</p>
      {/* wide: mirrored about the pole */}
      <div className="relative hidden gap-x-4 md:grid" style={{ gridTemplateColumns: "minmax(0,1fr) 16px minmax(0,1fr)" }}>
        <span aria-hidden="true" className="absolute bottom-[-24px] left-1/2 top-[-8px] w-4 -translate-x-1/2 bg-ridge px-frame-thin" />
        <ul className="col-start-1 m-0 flex list-none flex-col gap-5 p-0">
          {left.map((blade, index) => (
            <li key={index}>
              <Signpost {...blade} direction="left" index={index * 2} />
            </li>
          ))}
        </ul>
        <ul className="col-start-3 m-0 flex list-none flex-col gap-5 p-0">
          {right.map((blade, index) => (
            <li key={index}>
              <Signpost {...blade} direction="right" index={index * 2 + 1} />
            </li>
          ))}
        </ul>
      </div>
      {/* phone: one column */}
      <ul className="m-0 flex list-none flex-col gap-5 p-0 md:hidden">
        {blades.map((blade, index) => (
          <li key={index}>
            <Signpost {...blade} direction="right" index={index} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * 404 for the site and the deck (the router picks the layout): "off the
 * map". Ely is lost on a torn pixel survey sheet and walks the trail back to
 * base camp; the signposts point at the trails the lost path most likely
 * meant (typo-aware), then the usual ways home.
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
        { destination: "Bridge", eta: "Ridge ↔ Summit", detail: "up to the Summit and back down", to: routeHref("bridge") },
      ]
    : [
        { destination: "The landing", eta: "home", detail: "what Elyia is, in one sheet", to: "/" },
        { destination: "Open the deck", eta: "/app", detail: "trade, bridge, earn, one sentence", to: routeHref("deck") },
        { destination: "Elysium weather station", eta: "live", detail: "114 ms blocks on the drum", to: routeHref("elysium") },
        { destination: "Developers", eta: "API", detail: "the field manual and a live console", to: routeHref("developers") },
      ];
  const known = new Set(guesses.map((guess) => guess.trail.path));
  const blades: Blade[] = [
    ...guesses.map((guess) => ({ destination: guess.trail.name, eta: guess.trail.path, detail: "the nearest trail to what you typed", to: guess.trail.path, highlight: true })),
    ...home.filter((blade) => !known.has(blade.to)).map((blade, index) => ({ ...blade, highlight: guesses.length === 0 && index === 0 })),
  ].slice(0, 4);
  // an even count keeps the junction symmetric about its pole
  if (blades.length % 2 === 1 && blades.length > 1) blades.pop();

  return (
    <Page className="!pt-0">
      <Section
        id="off-map"
        level={1}
        tag="Sheet 404 · off the map"
        title="Off the map."
        lede={
          <>
            Nobody has surveyed <code className="break-all bg-paper-2 px-1.5 py-0.5 font-mono text-[0.9em] text-ink">{path}</code> yet. Ely got lost there too, and is walking back to base camp. Follow a signpost, or say where you meant to go.
          </>
        }
      >
        <OffMapSheet reading={reading} path={path} />
        <Cards n={3} className="mx-auto mt-12 max-w-[968px]">
          <Readout label="Position" note="stable for this address">
            <span className="tnum font-display text-[26px] font-bold leading-none text-ink">
              {reading.lat} {reading.lon}
            </span>
          </Readout>
          <Readout label="Elevation" note="above the sheet's datum">
            <span className="tnum font-display text-[26px] font-bold leading-none text-ink">{reading.elevation.toLocaleString("en-US")} m</span>
          </Readout>
          <Readout label="Off the sheet" note="past the torn edge">
            <span className="tnum font-display text-[26px] font-bold leading-none text-ink">{reading.offEdgeKm} km</span>
          </Readout>
        </Cards>
      </Section>

      <Section id="trails-back" tag="The junction · typo-aware" title="The way back is signposted.">
        <Junction blades={blades} guessed={guesses.length > 0} />
        <div className="mt-16 flex flex-wrap items-center justify-center gap-x-6 gap-y-7">
          <Button variant="primary" size="lg" onClick={() => openOracle()}>
            Where to? →
          </Button>
          <ButtonLink to={inDeck ? routeHref("deck") : "/"} variant="ink" size="lg">
            ← {inDeck ? "Back to base camp" : "Back home"}
          </ButtonLink>
        </div>
        <p className="mt-6 flex items-center justify-center gap-2 font-tag text-[11px] uppercase text-ink-2">
          or press <Kbd>{modShortcutLabel("K")}</Kbd> anywhere
        </p>
      </Section>
    </Page>
  );
}
