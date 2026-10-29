import type { PortfolioHistory } from "@elyia/core/api/portfolio";
import { useMemo } from "react";

import { useNow } from "../../hooks/useNow";

import { routeHref } from "../../app/routes/routeTable";
import type { RopeView } from "../../features/trading/useTopoData";
import { intentHref } from "../../oracle/preview";
import { Blaze } from "../../topo/Blaze";
import { RadioLog, type RadioEntry } from "../../topo/RadioLog";
import { Rope } from "../../topo/Rope";
import { SignpostCluster } from "../../topo/Signpost";
import { ButtonLink } from "../../ui/Button";
import { cx, FOCUS_RING } from "../../ui/cx";
import { Link } from "../../app/routes/Link";
import { clock, pct, price, usdShort, usdSigned } from "../portfolio/range/format";
import { LAYER_NAME, registerEntries, sortRopes } from "../portfolio/range/model";
import { sketchRoute, type LoggedRoute } from "./routesLog";

const TONE = { floor: "text-floor", ridge: "text-ridge", summit: "text-summit-ink" } as const;
const BAND_WORD = { critical: "critical", danger: "fraying", watch: "watch", safe: "safe", unknown: "no crevasse" } as const;

/** Card frame for the deck: caption header, ruled, optional link. */
export function DeckCard({ title, aside, children, className }: { readonly title: React.ReactNode; readonly aside?: React.ReactNode; readonly children: React.ReactNode; readonly className?: string }) {
  return (
    <section className={cx("flex min-w-0 flex-col border-2 border-rule bg-card shadow-hard", className)}>
      <header className="flex min-h-[42px] items-center justify-between gap-3 border-b-1.5 border-rule px-4 py-2">
        <h2 className="caption truncate !text-ink">{title}</h2>
        {aside ? <div className="flex shrink-0 items-center gap-2 font-mono text-[11px] text-ink-2">{aside}</div> : null}
      </header>
      <div className="flex flex-1 flex-col">{children}</div>
    </section>
  );
}

/** Ropes of open positions, nearest to the crevasse first, each a compact rope with its distance and PnL. */
export function RopesCard({ ropes, sample, className }: { readonly ropes: readonly RopeView[]; readonly sample: boolean; readonly className?: string }) {
  const sorted = useMemo(() => sortRopes(ropes).slice(0, 5), [ropes]);
  return (
    <DeckCard
      className={className}
      title={`Ropes · ${ropes.length} out · nearest the crevasse first${sample ? " · sample" : ""}`}
      aside={
        <Link to={routeHref("trade")} className={cx("underline decoration-dotted underline-offset-2 hover:text-ink", FOCUS_RING)}>
          terminal →
        </Link>
      }
    >
      {sorted.length === 0 ? (
        <div className="flex flex-1 flex-col items-start justify-center gap-3 px-4 py-6">
          <p className="text-[15px] text-ink">No ropes out. Every position you open hangs here, from the crevasse to the flag.</p>
          <ButtonLink to={intentHref("long ETH 3x with 100 USDC, stop at -4%")} variant="signpost" size="sm">
            long ETH 3x with 100 USDC
          </ButtonLink>
        </div>
      ) : (
        <ul className="divide-y divide-rule/15">
          {sorted.map((rope) => (
            <li key={`${rope.dex}|${rope.coin}`}>
              <Link to={routeHref("trade", { market: rope.dex ? `${rope.dex}:${rope.coin}` : rope.coin })} className={cx("grid grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-paper-2/60 sm:grid-cols-[7.5rem_minmax(0,1fr)_7.5rem]", FOCUS_RING)}>
                <span className="min-w-0">
                  <span className="block truncate text-[15px] font-bold text-ink">
                    {rope.coin} {rope.side === "long" ? "▲" : "▼"}
                    {rope.leverage}×
                  </span>
                  <span className="font-mono text-[11px] text-ink-3">
                    {rope.side} · {usdShort(rope.positionValue)}
                  </span>
                </span>
                <Rope variant="compact" symbol={rope.coin} side={rope.side} entry={rope.entryPx} mark={rope.markPx} liquidation={rope.liquidationPx} stop={rope.sl?.px ?? null} takeProfit={rope.tp?.px ?? null} formatPrice={price} />
                <span className="tnum col-span-2 flex justify-between gap-3 font-mono text-xs sm:col-span-1 sm:flex-col sm:items-end sm:gap-0.5">
                  <span className={rope.band === "critical" || rope.band === "danger" ? "font-semibold text-down" : "text-ink"}>
                    {rope.distance === null ? "no crevasse" : `${pct(rope.distance)} · ${BAND_WORD[rope.band]}`}
                  </span>
                  <span className={rope.unrealizedPnl >= 0 ? "text-up" : "text-down"}>{usdSigned(rope.unrealizedPnl, true)}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </DeckCard>
  );
}

/** Quick actions as trail signposts. */
export function QuickSignposts({ portfolioHref, className }: { readonly portfolioHref: string; readonly className?: string }) {
  return (
    <SignpostCluster
      className={className}
      caption="The junction · one tap, you sign"
      label="Quick actions"
      blades={[
        { destination: "Trade · HyperCore", eta: "0.2 s", detail: "perps and spot on the Floor", grade: 3, to: routeHref("trade"), highlight: true },
        { destination: "Bridge to Elysium", eta: "~1 min", detail: "HYPE or USDC up to the Summit", grade: 2, to: intentHref("bridge 20 HYPE to Elysium"), highlight: false },
        { destination: "Stake HYPE → kHYPE", eta: "1 s", detail: "Kinetiq on the Ridge", grade: 1, to: intentHref("stake 10 HYPE to kHYPE"), highlight: false },
        { destination: "Move USDC to perps", eta: "~5 s", detail: "HyperEVM → the Floor", grade: 2, to: intentHref("move all my HyperEVM USDC to perps"), highlight: false },
        { destination: "Sweep dust", eta: "1 route", detail: "small tokens → USDC", grade: 1, to: `${portfolioHref}#jobs`, highlight: false },
      ]}
    />
  );
}

/** Recent route cards planned from this browser, as laminated stubs; examples while empty. */
export function RecentRoutes({ routes, onReplan, className }: { readonly routes: readonly LoggedRoute[]; readonly onReplan: (sentence: string) => void; readonly className?: string }) {
  const shown = routes.length > 0 ? routes : [
    { sentence: "bridge 20 HYPE to Elysium and swap half to USDC", at: 0 },
    { sentence: "long ETH 5x with 200 USDC, stop at -3%", at: 0 },
  ];
  const examples = routes.length === 0;
  return (
    <DeckCard className={className} title={examples ? "Routes · your journeys land here · examples" : `Routes · ${routes.length} planned in this browser`}>
      <ul className="grid gap-3 p-4 sm:grid-cols-2">
        {shown.map((route) => {
          const sketch = sketchRoute(route.sentence);
          return (
            <li key={`${route.sentence}-${route.at}`}>
              <button
                type="button"
                onClick={() => onReplan(route.sentence)}
                className={cx("group relative flex h-full w-full flex-col border-2 border-rule bg-card text-left transition-[transform,box-shadow] duration-fast hover:-translate-y-px hover:shadow-hard", examples && "border-dashed", FOCUS_RING)}
              >
                <span className="flex items-center justify-between gap-2 border-b-1.5 border-dashed border-rule/60 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-2">
                  <span>{examples ? "example" : `route · ${clock(route.at).slice(0, 5)} UTC`}</span>
                  <span className="flex items-center gap-1.5">
                    <Blaze grade={sketch.grade} size={11} /> T{sketch.grade}
                  </span>
                </span>
                <span className="block px-3 py-2.5 font-mono text-[13px] leading-snug text-ink">“{route.sentence}”</span>
                <span className="mt-auto flex items-center justify-between gap-2 px-3 pb-2 font-mono text-[10px] font-semibold tracking-[0.1em]">
                  <span className="flex gap-2">
                    {sketch.layers.map((layer) => (
                      <span key={layer} className={TONE[layer]}>
                        {LAYER_NAME[layer]}
                      </span>
                    ))}
                  </span>
                  <span className="text-ink-3 transition-transform duration-fast group-hover:translate-x-0.5">plan again →</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </DeckCard>
  );
}

/**
 * The Guide's base-camp radio, read off the followed range: the latest
 * fills, funding and transfers, plus a call on every rope that frays.
 */
export function GuideRadio({ ropes, history, sample, className }: { readonly ropes: readonly RopeView[]; readonly history: PortfolioHistory | null; readonly sample: boolean; readonly className?: string }) {
  const now = useNow(30_000);
  const entries = useMemo<RadioEntry[]>(() => {
    const out: RadioEntry[] = [];
    const latest = history?.timeline[0]?.time ?? now;
    for (const rope of sortRopes(ropes)) {
      if (rope.distance !== null && rope.distance < 0.25) {
        out.push({ id: `rope-${rope.coin}`, at: now, from: "ALERT", to: "you", message: `${rope.coin} rope ${pct(rope.distance)}${rope.distance < 0.1 ? ", fraying: add margin or set an anchor" : ", watch it"}`, tone: "alert", live: rope.distance < 0.1 });
      }
    }
    for (const entry of registerEntries(history?.timeline ?? [], 6).slice(0, 5)) {
      out.push({ id: entry.id, at: entry.time, from: entry.kind === "funding" ? "FLOOR" : entry.kind === "ledger" ? "BASE" : "FLOOR", message: `${entry.entry}${entry.amount ? ` · ${entry.amount}` : ""}`, tone: entry.kind === "fill" ? "settled" : "plain" });
    }
    if (out.length === 0) out.push({ id: "quiet", at: latest, from: "GUIDE", to: "you", message: "All quiet on the range. Say where to and I will draft the route." });
    return out.slice(0, 6);
  }, [ropes, history, now]);
  return <RadioLog className={className} entries={entries} title={`Radio log · base camp${sample ? " · sample" : ""}`} aside={sample ? "sample" : "live from HyperCore"} footer="the Guide proposes · you sign · it never withdraws" maxHeight="320px" />;
}
