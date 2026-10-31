import { useMemo } from "react";

import { routeHref } from "../../app/routes/routeTable";
import { Cards, Section } from "../../pixel/layout";
import { PixelRope } from "../../pixel/PixelRope";
import { Badge } from "../../ui/Badge";
import { ButtonLink } from "../../ui/Button";
import { cx } from "../../ui/cx";
import { pickRopes, shortAddress, signedUsd, usd, type RopeLine } from "./model";
import type { TraderView } from "./useTrader";

function price(value: number): string {
  const abs = Math.abs(value);
  const digits = abs >= 1000 ? 0 : abs >= 100 ? 1 : abs >= 1 ? 3 : 5;
  return value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

const ROLE: Readonly<Record<RopeLine["role"], string>> = { tight: "Tightest long", short: "Closest short", safe: "Safest long", other: "Largest" };

function RopeCard({ rope }: { readonly rope: RopeLine }) {
  const pct = rope.ropePct;
  const fraying = pct !== null && pct < 10;
  return (
    <li className={cx("flex h-full flex-col bg-card px-frame px-drop", fraying && "px-tone-down")}>
      <div className="flex items-center justify-between gap-3 px-4 pb-2 pt-3 font-tag text-[11px] uppercase text-ink-2">
        <span>{ROLE[rope.role]}</span>
        <span className={cx("tnum", fraying ? "text-down" : "text-ink-2")}>{fraying ? "Fraying" : "Tied off"}</span>
      </div>
      <div className="flex flex-col items-center gap-1 px-4 pt-1 text-center">
        <p className="flex items-baseline gap-2 font-display text-[24px] font-bold leading-none text-ink">
          <span aria-hidden="true" className={rope.side === "long" ? "text-up" : "text-down"}>
            {rope.side === "long" ? "▲" : "▼"}
          </span>
          {rope.coin} {rope.leverage}×<span className="sr-only">{rope.side}</span>
        </p>
        <p className="tnum font-mono text-[12px] text-ink-2">
          {rope.side === "long" ? "Long" : "Short"} · {usd(rope.usd)} · <span className={rope.pnl > 0 ? "text-up" : rope.pnl < 0 ? "text-down" : ""}>{signedUsd(rope.pnl)}</span>
        </p>
      </div>
      <div className="mt-auto px-4 pb-2 pt-5">
        <PixelRope symbol={rope.coin} side={rope.side} entry={rope.entry} mark={rope.mark} liquidation={rope.liquidation} formatPrice={price} />
      </div>
      <p className={cx("flex items-center justify-center gap-2 border-t-4 border-dashed border-rule/30 px-4 py-3 font-tag text-[12px] uppercase", fraying ? "text-down" : "text-ink-2")}>
        Rope left
        <b className={cx("tnum font-display text-[22px] font-bold normal-case", fraying ? "text-down" : "text-ink")}>{pct !== null ? `${pct.toFixed(pct < 10 ? 1 : 0)}%` : "—"}</b>
      </p>
    </li>
  );
}

/** "How much rope do you have left?": a real testnet trader's positions as pixel ropes, from crevasse to flag. */
export function RopeSection({ trader }: { readonly trader: TraderView }) {
  const ropes = useMemo(() => pickRopes(trader.snapshot), [trader.snapshot]);
  return (
    <Section
      id="rope"
      tag="The rope · every position, tied off"
      title="How much rope do you have left?"
      lede={
        <>
          Each position hangs between the crevasse (liquidation) and the summit flag (take-profit). Ely climbs at the mark; under 10% the rope frays, Ely holds on, and the Guide radios you before you fall.
        </>
      }
    >
      <div className="mb-10 flex flex-wrap items-center justify-center gap-4">
        {trader.sample ? (
          <Badge tone="signal" variant="solid">
            Sample book{trader.loading ? " · reaching the API" : ""}
          </Badge>
        ) : (
          <Badge tone="up" dot="pulse">
            Live · testnet trader <span className="normal-case">{shortAddress(trader.snapshot.address)}</span>
          </Badge>
        )}
        <span className="font-tag text-[11px] uppercase text-ink-2">{trader.sample ? "labelled sample · the API did not answer" : "HyperCore testnet · marks from the venue · every 30 s"}</span>
      </div>
      <Cards n={3} as="ol">
        {ropes.map((rope) => (
          <RopeCard key={rope.id} rope={rope} />
        ))}
      </Cards>
      <ul className="mx-auto mt-10 flex max-w-[860px] list-none flex-wrap justify-center gap-x-8 gap-y-2 p-0 font-tag text-[11px] uppercase text-ink-2">
        <li>
          <span className="text-down">✕</span> crevasse · liquidation
        </li>
        <li>⚓ anchor · your stop</li>
        <li>● Ely · the mark</li>
        <li>
          <span className="text-up">⚑</span> flag · take-profit
        </li>
      </ul>
      <div className="mt-10 flex justify-center">
        <ButtonLink to={routeHref("trade")} variant="ink" size="lg">
          Tie in on the Floor →
        </ButtonLink>
      </div>
    </Section>
  );
}
