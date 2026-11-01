import { useState } from "react";

import { Link } from "../../app/routes/Link";
import { routeHref } from "../../app/routes/routeTable";
import { ElyEmpty } from "../../pixel/ElyEmpty";
import { LayerChip } from "../../ui/Badge";
import { Button, ButtonLink } from "../../ui/Button";
import { cx } from "../../ui/cx";
import { Input } from "../../ui/Input";
import { forgetJourney, unwatchAddress, useJourneys, useWatched, watchAddress, type JourneyRecord, type WatchedAddress } from "./flow/journeyStore";
import { packFigure, usePacks } from "./flow/usePacks";

function when(at: number): string {
  const date = new Date(at);
  return `${date.getUTCDate().toString().padStart(2, "0")} ${date.toLocaleString("en-US", { month: "short", timeZone: "UTC" }).toUpperCase()} ${date.toISOString().slice(11, 16)}`;
}

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/** Journeys signed in this browser, newest first, as a ruled register. */
export function JourneysLog({ activeId, className }: { readonly activeId: string | null; readonly className?: string }) {
  const journeys = useJourneys();
  return (
    <section className={cx("flex flex-col bg-card px-frame px-drop", className)} aria-labelledby="journeys-log">
      <header className="flex flex-col items-center gap-2 border-b-2 border-rule px-5 py-5 text-center">
        <p className="caption">from bridge · swap · earn</p>
        <h3 id="journeys-log" className="font-display text-[24px] font-bold leading-none text-ink">
          Journeys · {journeys.length}
        </h3>
      </header>
      {journeys.length === 0 ? (
        <ElyEmpty compact className="flex-1 justify-center px-5" title="No journeys yet" description="Every route you sign on the bridge, swap or earn pages lands here with its proofs, so you can find your money later." />
      ) : (
        <ol className="relative">
          {journeys.map((journey: JourneyRecord, index) => (
            <li key={journey.id} className={cx("grid grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-3 border-b-2 border-dashed border-rule py-3 pl-5 pr-4", journey.id === activeId && "bg-signal text-signal-ink")}>
              <span className="tnum font-mono text-[12px] text-ink-2">{String(index + 1).padStart(2, "0")}</span>
              <Link to={routeHref("track", { id: journey.id })} className="min-w-0 hover:underline">
                <span className="block truncate font-mono text-[13px] text-ink">“{journey.sentence}”</span>
                <span className="tnum block font-mono text-[11px] text-ink-3">
                  {when(journey.createdAt)} · route {journey.routeId} · {journey.legs.length} proof{journey.legs.length === 1 ? "" : "s"} · {journey.source === "planner" ? "planner" : "offline plan"}
                </span>
              </Link>
              <span className="flex items-center gap-1.5">
                {journey.layers.map((layer) => (
                  <LayerChip key={layer} layer={layer} />
                ))}
                <button type="button" onClick={() => forgetJourney(journey.id)} className="ml-1 font-mono text-[11px] text-ink-3 hover:text-down" aria-label={`Forget journey ${journey.routeId}`}>
                  ✕
                </button>
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function WatchedRow({ entry }: { readonly entry: WatchedAddress }) {
  const packs = usePacks(entry.address);
  const hype = [packs.summit.HYPE, packs.ridge.HYPE, packs.floor.HYPE].filter((value): value is number => value !== null);
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b-2 border-dashed border-rule px-5 py-3">
      <div className="min-w-0">
        <p className="truncate text-[15px] font-semibold text-ink">
          {entry.label || shortAddress(entry.address)} <span className="font-mono text-[12px] font-normal text-ink-3">{shortAddress(entry.address)}</span>
        </p>
        <p className="tnum font-mono text-[11px] text-ink-2">
          <span className="text-summit-ink">SUMMIT</span> {packFigure(packs.summit.HYPE)} HYPE · <span className="text-ridge">RIDGE</span> {packFigure(packs.ridge.HYPE)} HYPE · <span className="text-floor">FLOOR</span> {packFigure(packs.perps, 2)} USDC margin
          {hype.length === 0 ? " · reading…" : ""}
        </p>
      </div>
      <span className="flex items-center gap-1.5">
        <ButtonLink to={`${routeHref("portfolio", { address: entry.address })}`} variant="ink" size="xs">
          Survey
        </ButtonLink>
        <button type="button" onClick={() => unwatchAddress(entry.address)} className="font-mono text-[11px] text-ink-3 hover:text-down" aria-label={`Stop watching ${entry.label || entry.address}`}>
          ✕
        </button>
      </span>
    </li>
  );
}

/** Watched addresses (this browser): live packs on all three layers, one tap to survey. */
export function WatchList({ className }: { readonly className?: string }) {
  const watched = useWatched();
  const [address, setAddress] = useState("");
  const [label, setLabel] = useState("");
  const valid = /^0x[0-9a-fA-F]{40}$/u.test(address.trim());
  return (
    <section className={cx("flex flex-col bg-card px-frame px-drop", className)} aria-labelledby="watch-list">
      <header className="flex flex-col items-center gap-2 border-b-2 border-rule px-5 py-5 text-center">
        <p className="caption">read only · live packs</p>
        <h3 id="watch-list" className="font-display text-[24px] font-bold leading-none text-ink">
          Watched · {watched.length}
        </h3>
      </header>
      <form
        className="flex flex-col gap-4 border-b-2 border-dashed border-rule p-5 sm:flex-row sm:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          if (!valid) return;
          watchAddress(address.trim(), label);
          setAddress("");
          setLabel("");
        }}
      >
        <Input label="Address" mono value={address} onChange={(event) => setAddress(event.target.value)} placeholder="0x…" containerClassName="min-w-0 flex-1" aria-invalid={address !== "" && !valid ? true : undefined} />
        <Input label="Name" value={label} onChange={(event) => setLabel(event.target.value)} placeholder="whale, team, me" containerClassName="sm:w-40" maxLength={32} />
        <Button type="submit" variant="ink" size="md" disabled={!valid}>
          Watch
        </Button>
      </form>
      {watched.length === 0 ? (
        <ElyEmpty compact className="flex-1 justify-center px-5" title="Nobody watched" description="Watch a wallet, a whale or the team: its HYPE on the Summit and the Ridge and its margin on the Floor, live. Watching never moves anything." />
      ) : (
        <ul>
          {watched.map((entry) => (
            <WatchedRow key={entry.address} entry={entry} />
          ))}
        </ul>
      )}
    </section>
  );
}
