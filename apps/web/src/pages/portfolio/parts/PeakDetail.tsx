import { routeHref } from "../../../app/routes/routeTable";
import type { RopeView } from "../../../features/trading/useTopoData";
import { intentHref } from "../../../oracle/preview";
import { PixelRope } from "../../../pixel/PixelRope";
import { ButtonLink } from "../../../ui/Button";
import { cx } from "../../../ui/cx";
import { amount, pct, price, usdFull, usdShort, usdSigned } from "../range/format";
import { LAYER_NAME, LAYER_OF, NETWORK_NAME, type ReliefSource } from "../range/model";

const TONE = { floor: "text-floor", ridge: "text-ridge", summit: "text-summit-ink" } as const;

function Facts({ items }: { readonly items: ReadonlyArray<readonly [string, React.ReactNode, string?]> }) {
  return (
    <dl className="tnum grid grid-cols-2 gap-3 font-mono text-[13px] sm:grid-cols-4">
      {items.map(([term, value, tone]) => (
        <div key={term} className="bg-paper-2/60 px-3 py-2 text-center">
          <dt className="font-tag text-[11px] uppercase text-ink-3">{term}</dt>
          <dd className={cx("mt-1", tone ?? "text-ink")}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** What a selected peak stands for: where it lives, its figures, its rope, and the next move (each opens the planner; nothing signs here). */
export function PeakDetail({ source, ropes, worth }: { readonly source: ReliefSource; readonly ropes: readonly RopeView[]; readonly worth: number }) {
  if (source.kind === "position") {
    const position = source.position;
    const rope = ropes.find((entry) => entry.coin === position.coin && entry.dex === position.dex);
    const notional = Math.abs(position.positionValueUsd ?? position.positionValue);
    const pnl = rope?.unrealizedPnl ?? position.unrealizedPnl;
    return (
      <div className="flex flex-col gap-5">
        <p className="text-center font-tag text-[12px] uppercase text-ink-2">
          <span className="text-floor">FLOOR</span> · HyperCore perp · {position.leverage.type} · {position.side === "long" ? "▲" : "▼"} {position.leverage.value}× {position.side}
        </p>
        <Facts
          items={[
            ["size", `${amount(Number(position.size))} · ${usdShort(notional)}`],
            ["entry → mark", `${price(Number(position.entryPx))} → ${price(rope?.markPx ?? position.markPx)}`],
            ["open PnL", usdSigned(pnl), pnl >= 0 ? "text-up" : "text-down"],
            ["funding", usdSigned(position.fundingSinceOpen), position.fundingSinceOpen >= 0 ? "text-up" : "text-down"],
          ]}
        />
        {rope ? <PixelRope symbol={position.coin} side={rope.side} entry={rope.entryPx} mark={rope.markPx} liquidation={rope.liquidationPx} stop={rope.sl?.px ?? null} takeProfit={rope.tp?.px ?? null} formatPrice={price} /> : null}
        <div className="flex flex-wrap justify-center gap-x-6 gap-y-5 pt-1">
          <ButtonLink to={routeHref("trade", { market: position.dex ? `${position.dex}:${position.coin}` : position.coin })} variant="primary" size="sm" grade={position.leverage.value > 10 ? 5 : 3}>
            Open {position.coin} terminal
          </ButtonLink>
          {!rope?.sl ? (
            <ButtonLink to={intentHref(`set a stop on ${position.coin} at ${position.side === "long" ? "-" : "+"}5%`)} variant="signpost" size="sm">
              Set an anchor
            </ButtonLink>
          ) : null}
          <ButtonLink to={intentHref(`reduce ${position.coin} by 50%`)} variant="ink" size="sm">
            Halve it
          </ButtonLink>
        </div>
      </div>
    );
  }
  const line = source.line;
  const layer = LAYER_OF[line.layer];
  return (
    <div className="flex flex-col gap-5">
      <p className="text-center font-tag text-[12px] uppercase text-ink-2">
        <span className={TONE[layer]}>{LAYER_NAME[layer]}</span> · {NETWORK_NAME[layer]} · {line.account}
      </p>
      <Facts
        items={[
          ["amount", amount(Number(line.amount))],
          ["value", usdFull(line.usd)],
          ["share", worth > 0 && line.usd !== null ? pct(line.usd / worth) : "—"],
          [line.locked ? "locked" : "price", line.locked ? amount(Number(line.locked)) : line.priceUsd !== null ? `$${price(line.priceUsd)}` : "unpriced"],
        ]}
      />
      {line.note ? <p className="text-center text-[13px] text-ink-2">{line.note}</p> : null}
      <div className="flex flex-wrap justify-center gap-x-6 gap-y-5 pt-1">
        {layer !== "summit" ? (
          <ButtonLink to={intentHref(`bridge ${line.asset === "USDC" ? "500 USDC" : `half my ${line.asset}`} to Elysium`)} variant="primary" size="sm" grade={2}>
            Ascend to the Summit
          </ButtonLink>
        ) : (
          <ButtonLink to={intentHref(`move ${line.asset === "USDC" ? "500 USDC" : `half my ${line.asset}`} to HyperCore`)} variant="primary" size="sm" grade={2}>
            Descend to the Floor
          </ButtonLink>
        )}
        {line.underlying && line.underlying !== "USD" ? (
          <ButtonLink to={routeHref("trade", { market: line.underlying })} variant="ink" size="sm">
            Trade {line.underlying}
          </ButtonLink>
        ) : null}
      </div>
    </div>
  );
}
