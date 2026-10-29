import { useMemo } from "react";

import { routeHref } from "../../app/routes/routeTable";
import { Reveal } from "../../motion/Reveal";
import { Rope } from "../../topo/Rope";
import { Badge, Tag } from "../../ui/Badge";
import { ButtonLink } from "../../ui/Button";
import { cx } from "../../ui/cx";
import { pickRopes, shortAddress, signedUsd, usd, type RopeLine } from "./model";
import type { TraderView } from "./useTrader";

function price(value: number): string {
  const abs = Math.abs(value);
  const digits = abs >= 1000 ? 0 : abs >= 100 ? 1 : abs >= 1 ? 3 : 5;
  return value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function RopeRow({ rope }: { readonly rope: RopeLine }) {
  const pct = rope.ropePct;
  const fraying = pct !== null && pct < 10;
  return (
    <li className="flex flex-col gap-1 border-t-1.5 border-rule px-4 pb-3 pt-3.5 first:border-t-0 sm:px-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="flex items-baseline gap-2 text-[17px] font-bold tracking-[-0.01em]">
          <span aria-hidden="true" className={rope.side === "long" ? "text-up" : "text-down"}>
            {rope.side === "long" ? "▲" : "▼"}
          </span>
          {rope.coin} {rope.leverage}× · {rope.side === "long" ? "Long" : "Short"}
          <span className="tnum font-mono text-[12px] font-normal text-ink-2">
            {usd(rope.usd)} · <span className={rope.pnl > 0 ? "text-up" : rope.pnl < 0 ? "text-down" : ""}>{signedUsd(rope.pnl)}</span>
          </span>
        </p>
        <p className={cx("tnum font-mono text-[12px] uppercase tracking-[0.08em]", fraying ? "text-down" : "text-ink-2")}>
          rope left <b className={cx("text-[14px]", fraying ? "text-down" : "text-ink")}>{pct !== null ? `${pct.toFixed(pct < 10 ? 1 : 0)}%` : "—"}</b>
          {fraying ? " · fraying" : ""}
        </p>
      </div>
      <Rope symbol={rope.coin} side={rope.side} entry={rope.entry} mark={rope.mark} liquidation={rope.liquidation} formatPrice={price} />
    </li>
  );
}

/** "How much rope do you have left?": three real positions as ropes, from crevasse to climber. */
export function RopeSection({ trader }: { readonly trader: TraderView }) {
  const ropes = useMemo(() => pickRopes(trader.snapshot), [trader.snapshot]);
  return (
    <section aria-labelledby="rope-title" className="mx-auto grid max-w-[1440px] gap-10 px-4 py-20 sm:px-6 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-16 lg:px-10 lg:py-28">
      <Reveal className="flex flex-col gap-6 lg:pt-4">
        <Tag className="self-start">The rope · every position, tied off</Tag>
        <h2 id="rope-title" className="text-[40px] font-bold leading-[1.02] tracking-[-0.02em] text-balance sm:text-[56px]">
          How much rope do you have left?
        </h2>
        <p className="max-w-[34rem] text-[18px] leading-relaxed text-ink-2">
          Each position hangs between the <b className="text-ink">crevasse</b> (liquidation) and the <b className="text-ink">summit flag</b> (take-profit). The <b className="text-ink">anchor</b> is your stop; the climber moves with the mark. When the rope frays, the Guide radios you before you fall.
        </p>
        <ul className="grid max-w-[34rem] grid-cols-2 gap-x-6 gap-y-2 font-mono text-[12px] text-ink-2">
          <li>
            <span className="text-down">✕</span> crevasse · liquidation
          </li>
          <li>⚓ anchor · your stop</li>
          <li>● climber · the mark</li>
          <li>⚑ flag · take-profit</li>
        </ul>
        <div>
          <ButtonLink to={routeHref("trade")} variant="ink" size="lg">
            Tie in on the Floor →
          </ButtonLink>
        </div>
      </Reveal>
      <Reveal delay={120}>
        <div className="border-2 border-rule bg-card shadow-hard-xl">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b-2 border-rule px-4 py-2.5 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-2 sm:px-5">
            <span>Ropes · {trader.sample ? "sample book" : `live book · ${shortAddress(trader.snapshot.address)}`}</span>
            {trader.sample ? (
              <Badge tone="signal" variant="solid">
                Sample
              </Badge>
            ) : (
              <span>HyperCore testnet · marks from the venue</span>
            )}
          </div>
          <ol aria-label="Three positions as ropes">
            {ropes.map((rope) => (
              <RopeRow key={rope.id} rope={rope} />
            ))}
          </ol>
        </div>
      </Reveal>
    </section>
  );
}
