import type { Insight } from "@elyia/core/api/agent";
import type { PortfolioHistory, PortfolioSnapshot } from "@elyia/core/api/portfolio";
import type { NetworkKey } from "@elyia/core/networks";
import { useMemo, useState } from "react";

import { Link } from "../../../app/routes/Link";
import { routeHref } from "../../../app/routes/routeTable";
import type { RopeView } from "../../../features/trading/useTopoData";
import { PixelRope } from "../../../pixel/PixelRope";
import { cx, FOCUS_RING } from "../../../ui/cx";
import { amount, pct, price, usdFull, usdShort, usdSigned } from "../range/format";
import { NETWORK_NAME } from "../range/model";
import { ACTIVITY_FILTERS, activityRows, balanceGroups, LAYER_TITLE, positionRows, type ActivityFilter, type PositionRowView, type RowAction } from "./model";

const WORD_TONE = { risk: "dn", watch: "warn", ok: "", "no liq": "off" } as const;

function RopeCell({ row }: { readonly row: PositionRowView }) {
  const mark = row.word === "ok" ? "▲" : row.word === "no liq" ? "" : "▼";
  return (
    <span className="inline-flex items-center justify-end gap-2">
      <span className={cx("dotc rope-dot", WORD_TONE[row.word])} aria-hidden="true" />
      <span className={cx("num", row.word === "risk" && "t-down")}>
        {row.distance === null ? "—" : `${mark} ${pct(row.distance, 0)}`}
      </span>
      <span className="rope-word t-tag t-mute w-[42px] text-left">{row.word}</span>
    </span>
  );
}

/** The compact pixel rope: entry, the live mark, the stop and target, and the crevasse (liquidation). */
function RopeTrail({ rope }: { readonly rope: RopeView | null }) {
  if (!rope) return null;
  return <PixelRope variant="compact" symbol={rope.coin} side={rope.side} entry={rope.entryPx} mark={rope.markPx} liquidation={rope.liquidationPx} stop={rope.sl?.px ?? null} takeProfit={rope.tp?.px ?? null} formatPrice={price} />;
}

export interface PositionsTabProps {
  readonly ropes: readonly RopeView[];
  readonly insights: readonly Insight[];
  readonly network: NetworkKey;
  readonly sample: boolean;
  readonly onDraft: (action: RowAction) => void;
}

/**
 * Positions: one row per open perp, nearest the edge first. Size, value and
 * PnL are right-aligned and tabular; the rope is a % with ▲/▼, a square and
 * a word. Each row has one Ely draft (Ease / Protect / Anchor / Close) that
 * opens the real sign flow.
 */
export function PositionsTab({ ropes, insights, network, sample, onDraft }: PositionsTabProps) {
  const rows = useMemo(() => positionRows(ropes, insights, network), [ropes, insights, network]);
  const totalValue = rows.reduce((sum, row) => sum + row.valueUsd, 0);
  const totalPnl = rows.reduce((sum, row) => sum + row.pnlUsd, 0);
  const nearest = rows.find((row) => row.distance !== null)?.distance ?? null;
  if (rows.length === 0) {
    return (
      <div className="ws-empty">
        <p className="disp text-[18px]">No open positions.</p>
        <p className="text-[12.5px] text-ink-2">Every perp you open on HyperCore lands here with its rope to liquidation.</p>
        <Link to={routeHref("trade")} className={cx("b sm", FOCUS_RING)}>
          Open the terminal ▸
        </Link>
      </div>
    );
  }
  return (
    <>
    <table className="tbl">
      <caption className="sr-only">Open positions{sample ? " (labelled sample)" : ""}</caption>
      <thead>
        <tr>
          <th scope="col">Asset</th>
          <th scope="col" className="hide-sm">
            Layer
          </th>
          <th scope="col" className="r hide-sm">
            Size
          </th>
          <th scope="col" className="r hide-sm">
            Value
          </th>
          <th scope="col" className="r">
            PnL
          </th>
          <th scope="col" className="hide-sm w-[22%]">
            Entry · mark · liquidation
          </th>
          <th scope="col" className="r">
            Rope
          </th>
          <th scope="col" className="r">
            <span className="sr-only">Ely draft</span>
            <span aria-hidden="true">Ely</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id}>
            <th scope="row">
              <Link to={routeHref("trade", { market: row.market })} className={cx("asset", FOCUS_RING)}>
                <b>
                  {row.side === "long" ? "▲" : "▼"} {row.coin}
                </b>
                <span className="t-faint">
                  {Math.round(row.leverage)}× {row.side}
                </span>
              </Link>
            </th>
            <td className="hide-sm">
              <span className="inline-flex items-center gap-1.5">
                <b className={cx("sq", row.layer)} aria-hidden="true" />
                {LAYER_TITLE[row.layer]}
              </span>
            </td>
            <td className="r num hide-sm">{amount(row.size)}</td>
            <td className="r num hide-sm">{usdShort(row.valueUsd)}</td>
            <td className={cx("r num", row.pnlUsd >= 0 ? "t-up" : "t-down")}>
              {usdSigned(row.pnlUsd, true)}
              <span className="sub">{`${row.roe >= 0 ? "+" : "−"}${pct(Math.abs(row.roe), 1)} roe`}</span>
            </td>
            <td className="hide-sm">
              <RopeTrail rope={ropes.find((rope) => `${rope.dex}|${rope.coin}` === row.id) ?? null} />
            </td>
            <td className="r">
              <RopeCell row={row} />
            </td>
            <td className="r">
              <button type="button" className={cx("b xs", row.word === "risk" && "dn", FOCUS_RING)} onClick={() => onDraft(row.action)} title={row.action.title} aria-label={`${row.action.label} ${row.coin}: ${row.action.title}. Opens the sign flow`}>
                {row.action.label}
              </button>
            </td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <th scope="row">
            {rows.length} position{rows.length === 1 ? "" : "s"}
          </th>
          <td className="hide-sm" />
          <td className="hide-sm" />
          <td className="r num hide-sm">{usdShort(totalValue)}</td>
          <td className={cx("r num", totalPnl >= 0 ? "t-up" : "t-down")}>{usdSigned(totalPnl, true)}</td>
          <td className="hide-sm" />
          <td className="r num t-mute">{nearest === null ? "—" : `nearest ${pct(nearest, 0)}`}</td>
          <td />
        </tr>
      </tfoot>
    </table>
    <p className="t-tag t-faint mt-4 text-center !text-[9px]">The Ely column drafts one move per row · it opens the sign flow · nothing moves until your wallet signs</p>
    </>
  );
}

/** Balances: every line by layer (spot, perp margin, staked, vault, EVM wallets), largest first; dust folded. */
export function BalancesTab({ snapshot }: { readonly snapshot: PortfolioSnapshot }) {
  const [dust, setDust] = useState(false);
  const groups = useMemo(() => balanceGroups(snapshot, dust), [snapshot, dust]);
  const hidden = groups.reduce((sum, group) => sum + group.hidden, 0);
  const worth = snapshot.totals.netWorthUsd;
  return (
    <div className="flex flex-col">
      <table className="tbl">
        <caption className="sr-only">Balances by layer</caption>
        <thead>
          <tr>
            <th scope="col">Asset</th>
            <th scope="col" className="hide-sm">
              Account
            </th>
            <th scope="col" className="r">
              Amount
            </th>
            <th scope="col" className="r hide-sm">
              Price
            </th>
            <th scope="col" className="r">
              Value
            </th>
            <th scope="col" className="r hide-sm">
              Share
            </th>
          </tr>
        </thead>
        {groups.map((group) => (
          <tbody key={group.layer}>
            <tr className="grp">
              <th scope="rowgroup" colSpan={6}>
                <span className="flex items-center justify-between gap-3">
                  <span className="inline-flex items-center gap-2">
                    <b className={cx("sq", group.layer)} aria-hidden="true" />
                    {group.title} · {NETWORK_NAME[group.layer]}
                  </span>
                  <span className="num">
                    {usdFull(group.usd)}
                    {worth > 0 ? ` · ${pct(group.usd / worth, 0)}` : ""}
                  </span>
                </span>
              </th>
            </tr>
            {group.rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="t-faint">
                  Nothing on this layer.
                </td>
              </tr>
            ) : (
              group.rows.map((row) => (
                <tr key={row.id}>
                  <th scope="row" title={row.note ?? undefined}>
                    <span className="asset">
                      <b>{row.asset}</b>
                    </span>
                  </th>
                  <td className="hide-sm t-mute">{row.account}</td>
                  <td className="r num">{amount(row.amount)}</td>
                  <td className="r num hide-sm">{row.priceUsd === null ? "—" : `$${price(row.priceUsd)}`}</td>
                  <td className="r num">{row.usd === null ? "unpriced" : usdFull(row.usd)}</td>
                  <td className="r num hide-sm t-mute">{row.share === null ? "—" : pct(row.share)}</td>
                </tr>
              ))
            )}
          </tbody>
        ))}
      </table>
      {hidden > 0 || dust ? (
        <button type="button" className={cx("why mt-3 self-center", FOCUS_RING)} onClick={() => setDust((value) => !value)} aria-pressed={dust}>
          {dust ? "Hide dust and unpriced" : `Show ${hidden} line${hidden === 1 ? "" : "s"} under $5 or unpriced`}
        </button>
      ) : null}
    </div>
  );
}

/** Activity: fills (one line per order), funding and transfers, newest first, with the 30-day totals on top. */
export function ActivityTab({ history }: { readonly history: PortfolioHistory | null }) {
  const [filter, setFilter] = useState<ActivityFilter>("all");
  const rows = useMemo(() => activityRows(history, filter), [history, filter]);
  const totals = history?.totals;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="seg" role="group" aria-label="Show">
          {ACTIVITY_FILTERS.map((entry) => (
            <button key={entry.id} type="button" aria-pressed={filter === entry.id} onClick={() => setFilter(entry.id)} className={FOCUS_RING}>
              {entry.label}
            </button>
          ))}
        </div>
        {totals ? (
          <dl className="ws-totals">
            <div>
              <dt>Realized</dt>
              <dd className={cx("num", totals.realizedPnl >= 0 ? "t-up" : "t-down")}>{usdSigned(totals.realizedPnl, true)}</dd>
            </div>
            <div>
              <dt>Funding</dt>
              <dd className={cx("num", totals.funding >= 0 ? "t-up" : "t-down")}>{usdSigned(totals.funding, true)}</dd>
            </div>
            <div>
              <dt>Fees</dt>
              <dd className="num t-down">{usdSigned(-Math.abs(totals.fees), true)}</dd>
            </div>
          </dl>
        ) : null}
      </div>
      {!history ? (
        <p className="ws-empty text-[12.5px] text-ink-2">Reading the log book…</p>
      ) : rows.length === 0 ? (
        <p className="ws-empty text-[12.5px] text-ink-2">Nothing in the last {Math.round((history.to - history.from) / 86_400_000)} days.</p>
      ) : (
        <table className="tbl">
          <caption className="sr-only">Activity, newest first</caption>
          <thead>
            <tr>
              <th scope="col">When · UTC</th>
              <th scope="col">Entry</th>
              <th scope="col" className="hide-sm">
                Kind
              </th>
              <th scope="col" className="r">
                Amount
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td className="num t-mute whitespace-nowrap">{row.when}</td>
                <th scope="row" className="font-normal">
                  <span className="line-clamp-1">{row.entry}</span>
                </th>
                <td className="hide-sm t-tag t-faint">{row.kind === "ledger" ? "transfer" : row.kind}</td>
                <td className={cx("r num whitespace-nowrap", row.direction === "up" ? "t-up" : row.direction === "down" ? "t-down" : "")}>
                  {row.direction === "up" ? "▲ " : row.direction === "down" ? "▼ " : ""}
                  {row.amount}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
