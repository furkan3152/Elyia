import { useState } from "react";
import type { Hex } from "viem";

import { navigate } from "../../app/routes/history";
import { routeHref } from "../../app/routes/routeTable";
import { useRouteParam } from "../../app/routes/useRoute";
import { useUiStore } from "../../app/state/uiStore";
import { ElyEmpty } from "../../pixel/ElyEmpty";
import { Page, Section, Split } from "../../pixel/layout";
import { Button } from "../../ui/Button";
import { cx, FOCUS_RING } from "../../ui/cx";
import { sheetTag } from "./flow/pixelHooks";
import { getJourneys, watchAddress, type JourneyRecord } from "./flow/journeyStore";
import { HASH, parseTrackQuery } from "./flow/trace";
import { IntentView } from "./IntentView";
import { JourneysLog, WatchList } from "./Logs";
import { TraceScene } from "./TraceScene";
import { TraceView } from "./TraceView";

/** Live samples from the practice wall, so the page can be tried without a wallet. */
const SAMPLES = [
  { label: "HYPE deposit · up to the Summit", hash: "0x264dafab0cb68df8fc676e74a1e75fe7b2dbeae3e08cd8e1d2664f05ae74a40c" },
  { label: "Stalled ticket · needs a redeem", hash: "0x42892d7ccfab8a912fb26c8a603e90a95aea04fb0aa9187611b5ae1733e2f881" },
  { label: "Withdrawal · the long trail down", hash: "0x04bea91d82481b903770287c0015f201572055ce474bfa86cdb4eb910b2ab88b" },
] as const;

function LocalJourney({ record }: { readonly record: JourneyRecord }) {
  const main = record.legs.find((leg) => HASH.test(leg.reference)) ?? null;
  const [index, setIndex] = useState(main ? record.legs.indexOf(main) : 0);
  const leg = record.legs[index];
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col items-center gap-2 text-center">
        <p className="caption">
          Journey · route {record.routeId} · {record.source === "offline" ? "planned in this browser" : "planner"}
        </p>
        <p className="font-mono text-[17px] text-ink">“{record.sentence}”</p>
      </div>
      {record.legs.length > 1 ? (
        <div className="flex flex-wrap justify-center gap-4" role="group" aria-label="Proofs of this journey">
          {record.legs.map((item, at) => (
            <button key={item.reference} type="button" onClick={() => setIndex(at)} aria-pressed={at === index} className={cx("px-3 py-1 font-mono text-[11px] px-frame-thin px-press", at === index ? "px-btn px-btn-thin px-btn-accent text-accent-ink" : "bg-card text-ink-2", FOCUS_RING)}>
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
      {leg && HASH.test(leg.reference) ? (
        <TraceView key={leg.reference} hash={leg.reference as Hex} />
      ) : (
        <ElyEmpty title={leg ? "Accepted on the Floor" : "Nothing signed yet"} description={leg ? `HyperCore action ${leg.reference}: accepted by HyperCore when it was signed; it shows in your account history.` : "Nothing was signed on this journey yet."} />
      )}
    </div>
  );
}

/**
 * "/app/track/:id?": where is my money. Paste a transaction hash (followed
 * across HyperEVM and Elysium from the chain itself: deposits, retryable
 * tickets, withdrawals), an Elyia intent id (the planner's verified
 * journey) or an address (watched, read only). Journeys signed in this
 * browser and watched addresses sit below.
 */
export default function TrackPage() {
  const id = useRouteParam("id") ?? null;
  const mode = useUiStore((state) => state.mode);
  const [text, setText] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const query = id ? parseTrackQuery(id) : null;
  const local = query?.kind === "journey" ? (getJourneys().find((item) => item.id === query.id) ?? null) : null;

  const submit = (raw: string) => {
    const parsed = parseTrackQuery(raw);
    setProblem(null);
    if (parsed.kind === "address") {
      watchAddress(parsed.address, "");
      setText("");
      return;
    }
    if (parsed.kind === "unknown") {
      setProblem("Paste a transaction hash (0x + 64 hex), an Elyia intent id (int_…) or an address (0x + 40 hex).");
      return;
    }
    navigate(routeHref("track", { id: parsed.kind === "hash" ? parsed.hash : parsed.id }));
    setText("");
  };

  return (
    <Page className="!pt-0">
      <Section
        level={1}
        tag={sheetTag("04", "Route card · track", mode)}
        title="Where is my money?"
        lede="Paste a transaction, a journey or an address. Elyia follows it across the Ridge and the Summit from the chain itself: deposits, retryable tickets, the long trail down."
      >
        <form
          className="mx-auto flex max-w-[860px] flex-col items-stretch gap-6 sm:flex-row"
          onSubmit={(event) => {
            event.preventDefault();
            submit(text);
          }}
        >
          <label className="relative flex min-w-0 flex-1 items-stretch bg-card px-frame px-drop">
            <span className="flex shrink-0 items-center bg-ink px-4 font-tag text-[13px] uppercase text-paper">Track</span>
            <input value={text} onChange={(event) => setText(event.target.value)} placeholder="0x… tx hash · int_… journey · 0x… address" spellCheck={false} autoComplete="off" className={cx("h-14 min-w-0 flex-1 bg-transparent px-4 font-mono text-[15px] text-ink outline-none placeholder:text-ink-3", FOCUS_RING)} aria-label="Transaction hash, journey id or address" />
          </label>
          <Button type="submit" variant="primary" size="xl">
            Follow →
          </Button>
        </form>
        {problem ? (
          <p className="mt-4 text-center text-sm font-semibold text-down" role="alert">
            {problem}
          </p>
        ) : null}
        <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
          <span className="font-tag text-[11px] uppercase text-ink-3">try a live one</span>
          {SAMPLES.map((sample) => (
            <button key={sample.hash} type="button" onClick={() => navigate(routeHref("track", { id: sample.hash }))} className={cx("px-btn px-btn-thin px-btn-paper px-3 py-1.5 font-mono text-[12px] text-ink", FOCUS_RING)}>
              {sample.label}
            </button>
          ))}
        </div>

        <div className="mt-14" aria-label="Followed">
          {!query ? (
            <TraceScene stations={[]} idleText="PASTE A HASH ABOVE" idleMood="walk" caption={["◆ nothing followed yet", "1 station = 1 stage of the journey", "read from chain"]} label="The three layers, waiting for a hash to trace" />
          ) : null}
          {query?.kind === "hash" ? <TraceView key={query.hash} hash={query.hash} /> : null}
          {query?.kind === "intent" ? <IntentView key={query.id} id={query.id} /> : null}
          {query?.kind === "journey" ? (
            local ? (
              <LocalJourney key={local.id} record={local} />
            ) : (
              <ElyEmpty title="Not in this browser" description="Journeys planned offline live only where they were signed; paste one of its transaction hashes instead." />
            )
          ) : null}
          {query?.kind === "address" || query?.kind === "unknown" ? <ElyEmpty title="Nothing to follow" description="That is not something Elyia can follow. Paste a transaction hash or an Elyia journey id." /> : null}
        </div>
      </Section>

      <Section id="logs" tag="This browser · read only" title="Your journeys and your watch." lede="Every route you sign on the bridge, swap or earn pages lands in the log with its proofs. Watch any address: watching never moves anything.">
        <Split>
          <JourneysLog activeId={query?.kind === "intent" || query?.kind === "journey" ? query.id : null} />
          <WatchList />
        </Split>
      </Section>
    </Page>
  );
}
