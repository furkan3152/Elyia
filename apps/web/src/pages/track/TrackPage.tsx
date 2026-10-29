import { useState } from "react";
import type { Hex } from "viem";

import { navigate } from "../../app/routes/history";
import { routeHref } from "../../app/routes/routeTable";
import { useRouteParam } from "../../app/routes/useRoute";
import { Page } from "../../app/shell/Page";
import { useUiStore } from "../../app/state/uiStore";
import { Reveal } from "../../motion/Reveal";
import { Button } from "../../ui/Button";
import { cx, FOCUS_RING } from "../../ui/cx";
import { getJourneys, watchAddress, type JourneyRecord } from "./flow/journeyStore";
import { HASH, parseTrackQuery } from "./flow/trace";
import { IntentView } from "./IntentView";
import { JourneysLog, WatchList } from "./Logs";
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
    <div className="flex flex-col gap-4">
      <div>
        <p className="caption">
          Journey · route {record.routeId} · {record.source === "offline" ? "planned in this browser" : "planner"}
        </p>
        <p className="mt-1.5 font-mono text-[17px] text-ink">“{record.sentence}”</p>
      </div>
      {record.legs.length > 1 ? (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Proofs of this journey">
          {record.legs.map((item, at) => (
            <button key={item.reference} type="button" onClick={() => setIndex(at)} aria-pressed={at === index} className={cx("border-2 px-2.5 py-1 font-mono text-[11px]", at === index ? "border-rule bg-ink text-paper" : "border-rule/40 bg-card text-ink-2 hover:border-rule", FOCUS_RING)}>
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
      {leg && HASH.test(leg.reference) ? (
        <TraceView key={leg.reference} hash={leg.reference as Hex} />
      ) : (
        <p className="border-2 border-rule bg-card p-4 text-[15px] text-ink-2 shadow-hard">{leg ? `HyperCore action ${leg.reference}: accepted by HyperCore when it was signed; it shows in your account history.` : "Nothing was signed on this journey yet."}</p>
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
    <Page className="pb-16">
      <section className="max-w-[1040px] pb-8 pt-4 sm:pt-10" aria-labelledby="track-title">
        <p className="label-tab mb-5">Sheet 04 · Route card · track · {mode === "testnet" ? "practice wall" : "mainnet"}</p>
        <h1 id="track-title" className="text-[44px] font-bold leading-[0.98] tracking-[-0.03em] text-ink sm:text-[72px]">
          Where is my money?
        </h1>
        <p className="mt-4 max-w-2xl text-[17px] leading-relaxed text-ink-2 sm:text-[19px]">Paste a transaction, a journey or an address. Elyia follows it across the Ridge and the Summit from the chain itself: deposits, retryable tickets, the long trail down.</p>
        <form
          className="mt-7 flex flex-col gap-3 sm:flex-row"
          onSubmit={(event) => {
            event.preventDefault();
            submit(text);
          }}
        >
          <label className="relative flex min-w-0 flex-1 items-stretch border-2 border-rule bg-card shadow-hard-lg">
            <span className="el-blade flex shrink-0 items-center bg-ink pl-4 pr-7 font-sans text-[15px] font-bold uppercase tracking-[0.06em] text-paper">Track</span>
            <input value={text} onChange={(event) => setText(event.target.value)} placeholder="0x… tx hash · int_… journey · 0x… address" spellCheck={false} autoComplete="off" className="h-14 min-w-0 flex-1 bg-transparent px-4 font-mono text-[15px] text-ink outline-none placeholder:text-ink-3" aria-label="Transaction hash, journey id or address" />
          </label>
          <Button type="submit" variant="primary" size="xl">
            Follow →
          </Button>
        </form>
        {problem ? (
          <p className="mt-2 text-sm font-semibold text-down" role="alert">
            {problem}
          </p>
        ) : null}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3">try</span>
          {SAMPLES.map((sample) => (
            <button key={sample.hash} type="button" onClick={() => navigate(routeHref("track", { id: sample.hash }))} className={cx("border-1.5 border-rule/50 bg-card px-2.5 py-1 font-mono text-[12px] text-ink-2 hover:border-rule hover:text-ink", FOCUS_RING)}>
              {sample.label}
            </button>
          ))}
        </div>
      </section>

      {query ? (
        <section className="mb-10" aria-label="Followed">
          {query.kind === "hash" ? <TraceView key={query.hash} hash={query.hash} /> : null}
          {query.kind === "intent" ? <IntentView key={query.id} id={query.id} /> : null}
          {query.kind === "journey" ? (
            local ? (
              <LocalJourney key={local.id} record={local} />
            ) : (
              <p className="border-2 border-rule bg-card p-4 text-[15px] text-ink-2 shadow-hard">This journey is not in this browser. Journeys planned offline live only where they were signed; paste one of its transaction hashes instead.</p>
            )
          ) : null}
          {query.kind === "address" || query.kind === "unknown" ? <p className="border-2 border-rule bg-card p-4 text-[15px] text-ink-2 shadow-hard">That is not something Elyia can follow. Paste a transaction hash or an Elyia journey id.</p> : null}
        </section>
      ) : null}

      <Reveal className="grid grid-cols-1 items-start gap-6 lg:grid-cols-12 xl:gap-8">
        <JourneysLog activeId={query?.kind === "intent" || query?.kind === "journey" ? query.id : null} className="lg:col-span-7" />
        <WatchList className="lg:col-span-5" />
      </Reveal>
    </Page>
  );
}
