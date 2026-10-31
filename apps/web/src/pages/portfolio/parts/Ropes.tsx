import { useMemo } from "react";

import { Link } from "../../../app/routes/Link";
import { routeHref } from "../../../app/routes/routeTable";
import type { RopeView } from "../../../features/trading/useTopoData";
import { intentHref } from "../../../oracle/preview";
import { Ely } from "../../../pixel/Ely";
import { PixelRope } from "../../../pixel/PixelRope";
import { ButtonLink } from "../../../ui/Button";
import { cx, FOCUS_RING } from "../../../ui/cx";
import { pct, price, usdShort, usdSigned } from "../range/format";
import { sortRopes } from "../range/model";
import { frayingRope } from "../range/ropes";

const BAND_WORD = { critical: "critical", danger: "fraying", watch: "watch", safe: "safe", unknown: "no crevasse" } as const;

/**
 * Open positions as pixel ropes, nearest the crevasse first: each row is a
 * link to its terminal with the compact rope, the distance in words and the
 * open PnL (▲/▼). A rope under 10% puts Ely on the rope, worried, above the
 * list. No ropes: Ely asleep and one way to open the first.
 */
export function RopeList({ ropes, max = 5, sample = false, className }: { readonly ropes: readonly RopeView[]; readonly max?: number; readonly sample?: boolean; readonly className?: string }) {
  const sorted = useMemo(() => sortRopes(ropes).slice(0, max), [ropes, max]);
  const fraying = frayingRope(ropes);
  if (sorted.length === 0) {
    return (
      <div className={cx("flex flex-1 flex-col items-center justify-center gap-3 px-4 py-6 text-center", className)}>
        <Ely state="sleep" size={88} label="Ely asleep: no ropes out" />
        <p className="font-display text-xl font-bold text-ink">No ropes out.</p>
        <p className="max-w-[320px] text-sm text-ink-2">Every position you open hangs here, from the crevasse to the flag.</p>
        <ButtonLink to={intentHref("long ETH 3x with 100 USDC, stop at -4%")} variant="signpost" size="sm">
          long ETH 3x with 100 USDC
        </ButtonLink>
      </div>
    );
  }
  return (
    <div className={cx("flex flex-1 flex-col", className)}>
      {fraying ? (
        <div className="flex items-center justify-center gap-3 border-b-4 border-dashed border-down/40 bg-down/10 px-4 py-2.5" role="status">
          <Ely state="worry" size={52} label={null} />
          <p className="text-left text-[13px] leading-snug text-ink">
            <span className="font-tag text-[12px] uppercase text-down">Holding on</span>
            <br />
            {fraying.coin} is {pct(fraying.distance)} from the crevasse{sample ? " (sample)" : ""}. Add margin or set an anchor.
          </p>
        </div>
      ) : null}
      <FeaturedRope rope={sorted[0]!} />
      {sorted.length > 1 ? (
        <ul className="flex flex-col divide-y-2 divide-dashed divide-rule/15 border-t-4 border-dashed border-rule/20">
          {sorted.slice(1).map((rope) => (
            <li key={`${rope.dex}|${rope.coin}`}>
              <RopeRow rope={rope} />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

const marketOf = (rope: RopeView) => (rope.dex ? `${rope.dex}:${rope.coin}` : rope.coin);

/** The nearest rope, drawn full size: Ely climbing at the live mark, the crevasse, the anchor and the flag. */
function FeaturedRope({ rope }: { readonly rope: RopeView }) {
  const danger = rope.band === "critical" || rope.band === "danger";
  return (
    <div className="flex flex-1 flex-col justify-center gap-4 px-5 py-6">
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-baseline gap-3">
        <span className="font-mono text-xs text-ink-3">
          {rope.side} · {usdShort(rope.positionValue)}
        </span>
        <Link to={routeHref("trade", { market: marketOf(rope) })} className={cx("font-display text-[22px] font-bold text-ink underline decoration-dotted underline-offset-4 hover:text-accent", FOCUS_RING)}>
          {rope.coin} {rope.side === "long" ? "▲" : "▼"} {rope.leverage}×
        </Link>
        <span className={cx("tnum text-right font-mono text-xs", rope.unrealizedPnl >= 0 ? "text-up" : "text-down")}>{usdSigned(rope.unrealizedPnl, true)}</span>
      </div>
      <PixelRope symbol={rope.coin} side={rope.side} entry={rope.entryPx} mark={rope.markPx} liquidation={rope.liquidationPx} stop={rope.sl?.px ?? null} takeProfit={rope.tp?.px ?? null} formatPrice={price} />
      <p className={cx("text-center font-tag text-[12px] uppercase", danger ? "text-down" : "text-ink-2")}>
        {rope.distance === null ? "no crevasse" : `${pct(rope.distance)} to the crevasse · ${BAND_WORD[rope.band]}`}
      </p>
    </div>
  );
}

/** A compact rope row: a link to its terminal. */
function RopeRow({ rope }: { readonly rope: RopeView }) {
  const danger = rope.band === "critical" || rope.band === "danger";
  return (
    <Link to={routeHref("trade", { market: marketOf(rope) })} className={cx("grid grid-cols-[6rem_minmax(0,1fr)_6.5rem] items-center gap-x-3 px-4 py-3 hover:bg-paper-2/60 sm:grid-cols-[7rem_minmax(0,1fr)_7.5rem]", FOCUS_RING)}>
      <span className="min-w-0">
        <span className="block truncate font-display text-[16px] font-bold text-ink">
          {rope.coin} {rope.side === "long" ? "▲" : "▼"} {rope.leverage}×
        </span>
        <span className="font-mono text-[11px] text-ink-3">
          {rope.side} · {usdShort(rope.positionValue)}
        </span>
      </span>
      <PixelRope variant="compact" symbol={rope.coin} side={rope.side} entry={rope.entryPx} mark={rope.markPx} liquidation={rope.liquidationPx} stop={rope.sl?.px ?? null} takeProfit={rope.tp?.px ?? null} formatPrice={price} />
      <span className="tnum flex flex-col items-end gap-0.5 font-mono text-xs">
        <span className={danger ? "font-semibold text-down" : "text-ink"}>{rope.distance === null ? "no crevasse" : `${pct(rope.distance)} · ${BAND_WORD[rope.band]}`}</span>
        <span className={rope.unrealizedPnl >= 0 ? "text-up" : "text-down"}>{usdSigned(rope.unrealizedPnl, true)}</span>
      </span>
    </Link>
  );
}
