import { useCallback, useEffect, useState } from "react";
import { useAccount } from "wagmi";

import { navigate } from "../../app/routes/history";
import { routeHref } from "../../app/routes/routeTable";
import { useSearchParam } from "../../app/routes/useRoute";
import { Page } from "../../app/shell/Page";
import { WalletButton } from "../../app/shell/WalletButton";
import { readStorage, writeStorage } from "../../app/state/storage";
import { Reveal } from "../../motion/Reveal";
import { intentHref } from "../../oracle/preview";
import { ButtonLink } from "../../ui/Button";
import { cx } from "../../ui/cx";
import { Skeleton } from "../../ui/Skeleton";
import { ExposureFold } from "../portfolio/parts/ExposureFold";
import { NetWorth } from "../portfolio/parts/NetWorth";
import { ReliefSheet } from "../portfolio/parts/ReliefSheet";
import { BulletinLine } from "../portfolio/parts/ShockBulletin";
import { WatchField } from "../portfolio/parts/WatchField";
import { shortAddr } from "../portfolio/range/format";
import { EXAMPLE_ADDRESS } from "../portfolio/range/sample";
import { useRange, type RangeData } from "../portfolio/range/useRange";
import { GuideRadio, QuickSignposts, RecentRoutes, RopesCard } from "./DeckCards";
import { IntentDraft } from "./IntentDraft";
import { parseRoutes, pushRoute, ROUTES_KEY, type LoggedRoute } from "./routesLog";
import { WhereBox } from "./WhereBox";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/u;

function useRoutesLog(): readonly [readonly LoggedRoute[], (sentence: string) => void] {
  const [routes, setRoutes] = useState<readonly LoggedRoute[]>(() => parseRoutes(readStorage(ROUTES_KEY)));
  const add = useCallback((sentence: string) => {
    setRoutes((previous) => {
      const next = pushRoute(previous, sentence, Date.now());
      writeStorage(ROUTES_KEY, JSON.stringify(next));
      return next;
    });
  }, []);
  return [routes, add] as const;
}

/**
 * "/app": base camp. One sentence box ("WHERE TO?") and, under it, the
 * followed range at a glance: the altimeter and layer split, a compact
 * Relief, the ropes nearest the crevasse, the avalanche line, recent routes,
 * the Guide's radio and the signposts. Not connected, it teaches with a
 * labelled sample and lets you watch any address (`?as=0x…`).
 */
export default function DeckPage() {
  const intent = useSearchParam("intent");
  const asParam = useSearchParam("as");
  const { address: connected } = useAccount();
  const viewAs = asParam && ADDRESS.test(asParam) ? asParam.toLowerCase() : null;
  const followed = viewAs ?? connected ?? null;
  const range = useRange(followed);
  const [routes, logRoute] = useRoutesLog();
  // A sentence that arrives from ⌘K or the landing is logged once.
  useEffect(() => {
    if (intent) logRoute(intent.slice(0, 500));
  }, [intent, logRoute]);
  const sentence = intent ? intent.slice(0, 500) : null;
  const watching = viewAs !== null && (!connected || viewAs !== connected.toLowerCase());

  return (
    <Page className="pb-16">
      <section className="max-w-[1040px] pb-10 pt-4 sm:pt-10" aria-labelledby="deck-title">
        <p className="label-tab mb-5">Sheet 01 · Deck · base camp{watching ? ` · watching ${shortAddr(viewAs)}` : ""}</p>
        <h1 id="deck-title" className="text-[52px] font-bold leading-[0.98] tracking-[-0.03em] text-ink sm:text-[80px]">
          Where to?
        </h1>
        <p className="mb-7 mt-4 max-w-2xl text-[17px] leading-relaxed text-ink-2 sm:text-[19px]">One sentence. The Guide surveys the route across the Floor, the Ridge and the Summit; you sign every step.</p>
        <WhereBox key={sentence ?? ""} initial={sentence ?? ""} onPlan={logRoute} viewAs={viewAs} />
        {sentence ? (
          <div className="mt-6">
            <IntentDraft sentence={sentence} account={followed?.toLowerCase() ?? null} />
          </div>
        ) : null}
      </section>

      {range.source === "sample" ? <Teaching range={range} routes={routes} onReplan={(text) => navigate(intentHref(text))} /> : <Range range={range} routes={routes} watching={watching} />}
    </Page>
  );
}

function Range({ range, routes, watching }: { readonly range: RangeData; readonly routes: readonly LoggedRoute[]; readonly watching: boolean }) {
  const portfolioHref = range.address ? routeHref("portfolio", { address: range.address }) : routeHref("portfolio");
  if (!range.snapshot) {
    return (
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12" aria-busy="true" aria-label="Surveying the range">
        <Skeleton className="h-72 lg:col-span-5" />
        <Skeleton className="h-72 lg:col-span-7" />
      </div>
    );
  }
  const snapshot = range.snapshot;
  return (
    <div className="flex flex-col gap-6 xl:gap-8">
      {watching ? (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 border-2 border-rule bg-paper-2 px-3 py-2 text-[13px] text-ink-2">
          <span className="font-semibold text-ink">Watching {shortAddr(range.address)}</span> read only: nothing you do here can move its money.
          <ButtonLink to={routeHref("deck")} variant="ghost" size="xs" className="ml-auto">
            Stop watching ✕
          </ButtonLink>
        </p>
      ) : null}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 xl:gap-8">
        <div className="flex flex-col gap-4 lg:col-span-5">
          <div className="border-2 border-rule bg-card p-4 shadow-hard sm:p-5">
            <NetWorth snapshot={snapshot} history={range.history} source={range.source} size="md" />
          </div>
          <BulletinLine snapshot={snapshot} ropes={range.ropes} />
          <div className="border-2 border-rule bg-card p-4 shadow-hard">
            <ExposureFold snapshot={snapshot} max={3} />
          </div>
          <ButtonLink to={portfolioHref} variant="primary" size="lg" fullWidth>
            Open the full survey →
          </ButtonLink>
        </div>
        <div className="lg:col-span-7">
          <ReliefSheet snapshot={snapshot} ropes={range.ropes} compact label={`Your range · ${snapshot.positions.length} rope${snapshot.positions.length === 1 ? "" : "s"} out`} onSelect={() => navigate(portfolioHref)} />
        </div>
      </div>
      <Reveal className="grid grid-cols-1 items-start gap-6 lg:grid-cols-12 xl:gap-8">
        <RopesCard ropes={range.ropes} sample={false} className="lg:col-span-7" />
        <QuickSignposts portfolioHref={portfolioHref} className="lg:col-span-5 lg:pt-1" />
      </Reveal>
      <Reveal className="grid grid-cols-1 items-start gap-6 lg:grid-cols-12 xl:gap-8">
        <RecentRoutes routes={routes} onReplan={(text) => navigate(intentHref(text))} className="lg:col-span-7" />
        <GuideRadio ropes={range.ropes} history={range.history} sample={false} className="lg:col-span-5" />
      </Reveal>
    </div>
  );
}

/** Not connected: what a range looks like (labelled sample), how to get one, and a field to watch any address. */
function Teaching({ range, routes, onReplan }: { readonly range: RangeData; readonly routes: readonly LoggedRoute[]; readonly onReplan: (sentence: string) => void }) {
  const steps = [
    ["Connect a wallet", "Your key never leaves it. Elyia reads your three layers and plans; you sign."],
    ["Or watch any range", "Paste an address: positions, ropes and history, live and read only."],
    ["Say where to", "One sentence becomes a route card. Every step is quoted, checked by the Rule Book and proven on chain."],
  ] as const;
  return (
    <div className="flex flex-col gap-8">
      <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <p className="caption">Your range · not surveyed yet</p>
          <h2 className="mt-2 text-[32px] font-bold leading-[1.05] tracking-[-0.02em] text-ink sm:text-[40px]">Bring a range to survey.</h2>
          <ol className="mt-6 flex flex-col gap-4">
            {steps.map(([title, body], index) => (
              <li key={title} className="grid grid-cols-[2.25rem_minmax(0,1fr)] gap-3">
                <span className={cx("flex h-9 w-9 items-center justify-center border-2 border-rule font-mono text-sm font-semibold shadow-hard", index === 0 ? "bg-signal text-signal-ink" : "bg-card text-ink")}>{index + 1}</span>
                <span>
                  <span className="block text-[17px] font-bold text-ink">{title}</span>
                  <span className="block text-[15px] leading-snug text-ink-2">{body}</span>
                </span>
              </li>
            ))}
          </ol>
          <div className="mt-6 flex flex-col gap-3">
            <WalletButton />
            <WatchField hrefFor={(address) => `${routeHref("deck")}?as=${address}`} example={EXAMPLE_ADDRESS} size="lg" />
          </div>
        </div>
        <div className="lg:col-span-7">
          {range.snapshot ? <ReliefSheet snapshot={range.snapshot} ropes={range.ropes} compact sample label="What a range looks like · sample" /> : null}
          <p className="mt-3 font-mono text-[11px] text-ink-3">Hills are holdings (height = USD), dashed basins are shorts, hatched cliffs are leverage, regions are the three layers.</p>
        </div>
      </div>
      <Reveal className="grid grid-cols-1 items-start gap-6 lg:grid-cols-12 xl:gap-8">
        <RopesCard ropes={range.ropes} sample className="lg:col-span-7" />
        <QuickSignposts portfolioHref={routeHref("portfolio")} className="lg:col-span-5 lg:pt-1" />
      </Reveal>
      <Reveal className="grid grid-cols-1 items-start gap-6 lg:grid-cols-12 xl:gap-8">
        <RecentRoutes routes={routes} onReplan={onReplan} className="lg:col-span-7" />
        <GuideRadio ropes={range.ropes} history={range.history} sample className="lg:col-span-5" />
      </Reveal>
    </div>
  );
}
