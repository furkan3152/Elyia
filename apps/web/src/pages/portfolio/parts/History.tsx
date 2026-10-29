import type { PortfolioHistory } from "@elyia/core/api/portfolio";
import { useMemo, useState } from "react";

import { routeHref } from "../../../app/routes/routeTable";
import { hyperCoreExplorerUrl } from "../../../lib/hypercore/endpoints";
import { ElevationProfile } from "../../../topo/ElevationProfile";
import { SummitRegister } from "../../../topo/SummitRegister";
import { Button } from "../../../ui/Button";
import { cx } from "../../../ui/cx";
import { SegmentedControl } from "../../../ui/SegmentedControl";
import { dayLabel, pctSigned, usdShort, usdSigned } from "../range/format";
import { calendarGrid, registerEntries, type EquityRange, type RegisterEntry } from "../range/model";
import { useEquity } from "../range/useEquity";

const RANGE_WORD: Readonly<Record<EquityRange, string>> = { day: "day", week: "7-day", month: "30-day", allTime: "all-time" };


/**
 * The elevation profile: equity as a ridgeline (day / week / month / all),
 * camps at the biggest events, the summit flag at the high and the valley at
 * the deepest drawdown (the artifact finds both).
 */
export function EquityProfile({ history, sample, range, onRange, className }: { readonly history: PortfolioHistory | null; readonly sample: boolean; readonly range: EquityRange; readonly onRange: (range: EquityRange) => void; readonly className?: string }) {
  const { series, camps, facts } = useEquity(history, range);
  const climb = facts.change !== null && facts.change >= 0;
  const caption = facts.change === null ? undefined : `a ${RANGE_WORD[range]} ${climb ? "climb" : "descent"} · ${usdSigned(facts.change, true).replace(/^[▲▼] /u, "")} · ${pctSigned(facts.changePct).replace(/^[▲▼] /u, "")}`;
  return (
    <section className={cx("border-2 border-rule bg-card shadow-hard-lg", className)} aria-label="Elevation profile of equity">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b-1.5 border-rule px-4 py-2.5">
        <h2 className="caption !text-ink">
          Elevation profile · {sample ? "sample equity" : "HyperCore account value"}
          {facts.high !== null ? <span className="text-ink-2"> · high {usdShort(facts.high)} · max drawdown {(facts.drawdown * 100).toFixed(1)}%</span> : null}
        </h2>
        <SegmentedControl
          label="Profile range"
          size="sm"
          value={range}
          onChange={onRange}
          options={[
            { value: "day", label: "1D" },
            { value: "week", label: "7D" },
            { value: "month", label: "30D" },
            { value: "allTime", label: "ALL" },
          ]}
        />
      </header>
      <div className="px-2 pb-2 pt-3 sm:px-4">
        {series.length < 2 ? (
          <p className="flex h-[220px] items-center justify-center text-sm text-ink-2">{history ? "No equity curve for this range yet." : "Reading the profile…"}</p>
        ) : (
          <ElevationProfile
            series={series}
            camps={camps}
            height={250}
            formatValue={usdShort}
            label={`${sample ? "Sample equity" : "HyperCore account value"} over the ${RANGE_WORD[range]} range, from ${usdShort(facts.start)} to ${usdShort(facts.end)}; high ${usdShort(facts.high)}; deepest drawdown ${(facts.drawdown * 100).toFixed(1)}%`}
            caption={caption}
            startLabel={dayLabel(series[0]!.t)}
            endLabel="NOW"
          />
        )}
      </div>
    </section>
  );
}

const WEEKDAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"] as const;

/** The PnL calendar: realised PnL − fees + funding per UTC day, five weeks, ▲/▼ on every figure. */
export function PnlCalendar({ history, now, sample, className }: { readonly history: PortfolioHistory | null; readonly now: number; readonly sample: boolean; readonly className?: string }) {
  const grid = useMemo(() => calendarGrid(history?.calendar ?? [], now, 35), [history, now]);
  return (
    <section className={cx("border-2 border-rule bg-card shadow-hard", className)} aria-label="PnL calendar">
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b-1.5 border-rule px-4 py-2.5">
        <h2 className="caption !text-ink">PnL calendar · 35 days{sample ? " · sample" : ""}</h2>
        <span className={cx("tnum font-mono text-[13px] font-semibold", grid.total >= 0 ? "text-up" : "text-down")}>{usdSigned(grid.total, true)}</span>
      </header>
      <table className="w-full table-fixed border-collapse">
        <caption className="sr-only">Net PnL per day: realised PnL minus fees plus funding</caption>
        <thead>
          <tr>
            {WEEKDAYS.map((day) => (
              <th key={day} scope="col" className="pb-1 pt-2.5 font-mono text-[10px] font-medium tracking-[0.1em] text-ink-3">
                {day}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grid.weeks.map((week, index) => (
            <tr key={index}>
              {week.map((cell, column) => {
                if (!cell.day) return <td key={column} className="p-[3px]" />;
                const net = cell.entry?.net ?? 0;
                const up = net > 0;
                const alpha = cell.entry ? 0.14 + cell.intensity * 0.62 : 0;
                const today = cell.day === new Date(now).toISOString().slice(0, 10);
                return (
                  <td key={column} className="p-[3px]">
                    <div
                      className={cx("relative flex h-12 flex-col justify-between border-1.5 px-1 py-0.5 sm:h-14 sm:px-1.5", today ? "border-rule ring-2 ring-signal" : cell.entry ? "border-rule" : "border-rule/20")}
                      style={cell.entry ? { backgroundColor: `rgb(var(--${up ? "up" : "down"}) / ${alpha.toFixed(2)})` } : undefined}
                      title={cell.entry ? `${cell.day}: ${usdSigned(net)} · ${cell.entry.fills} fills · funding ${usdSigned(cell.entry.funding)}` : `${cell.day}: no activity`}
                    >
                      <span className={cx("font-mono text-[10px] leading-none", cell.entry ? "text-ink" : "text-ink-3")}>{cell.date}</span>
                      {cell.entry ? (
                        <span className={cx("tnum truncate font-mono text-[10px] font-semibold leading-none sm:text-[11px]", cell.intensity > 0.55 ? "text-ink" : up ? "text-up" : "text-down")}>
                          {up ? "▲" : net < 0 ? "▼" : ""}
                          <span className="hidden sm:inline">{usdShort(Math.abs(net)).replace("$", "")}</span>
                          <span className="sr-only"> {usdSigned(net)}</span>
                        </span>
                      ) : null}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="tnum flex flex-wrap gap-x-4 gap-y-1 px-4 pb-3 pt-1.5 font-mono text-[11px] text-ink-2">
        {grid.best ? (
          <span>
            best <span className="text-up">{usdSigned(grid.best.net, true)}</span> {grid.best.day.slice(5)}
          </span>
        ) : null}
        {grid.worst ? (
          <span>
            worst <span className="text-down">{usdSigned(grid.worst.net, true)}</span> {grid.worst.day.slice(5)}
          </span>
        ) : null}
        {history ? (
          <span>
            fees {usdShort(history.totals.fees)} · funding {usdSigned(history.totals.funding, true)}
          </span>
        ) : null}
      </p>
    </section>
  );
}

type RegisterFilter = "all" | "fill" | "funding" | "ledger";

/** The Summit Register: fills, funding and transfers as a ruled log book, with filters and more pages. */
export function Register({ history, address, mode, sample, className }: { readonly history: PortfolioHistory | null; readonly address: string | null; readonly mode: "testnet" | "mainnet"; readonly sample: boolean; readonly className?: string }) {
  const [filter, setFilter] = useState<RegisterFilter>("all");
  const [limit, setLimit] = useState(12);
  const entries = useMemo(() => registerEntries(history?.timeline ?? [], 400), [history]);
  const shown = entries.filter((entry) => filter === "all" || entry.kind === filter);
  const rows = shown.slice(0, limit).map((entry: RegisterEntry) => ({
    id: entry.id,
    when: entry.when,
    entry: entry.entry,
    layer: entry.layer,
    amount: entry.amount,
    direction: entry.direction,
    proof: sample
      ? { label: "sample", href: routeHref("system") }
      : entry.hash && /^0x[0-9a-f]{64}$/iu.test(entry.hash)
        ? { label: `${entry.hash.slice(0, 6)}…${entry.hash.slice(-4)}`, href: hyperCoreExplorerUrl(mode, "tx", entry.hash) }
        : address
          ? { label: entry.kind === "funding" ? "hourly · account" : "account", href: hyperCoreExplorerUrl(mode, "address", address) }
          : undefined,
  }));
  const counts = { all: entries.length, fill: entries.filter((e) => e.kind === "fill").length, funding: entries.filter((e) => e.kind === "funding").length, ledger: entries.filter((e) => e.kind === "ledger").length };
  return (
    <section className={className} aria-label="Summit register">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="caption">Summit register{sample ? " · sample" : ""} · UTC</p>
          <h2 className="mt-1 text-2xl font-bold tracking-[-0.01em] text-ink">Every step, in ink.</h2>
        </div>
        <SegmentedControl
          label="Register filter"
          size="sm"
          value={filter}
          onChange={(value) => {
            setFilter(value);
            setLimit(12);
          }}
          options={[
            { value: "all", label: `All ${counts.all}` },
            { value: "fill", label: `Fills ${counts.fill}` },
            { value: "funding", label: `Funding ${counts.funding}` },
            { value: "ledger", label: `Transfers ${counts.ledger}` },
          ]}
        />
      </div>
      <SummitRegister className="hidden sm:block" rows={rows} caption="Activity register: fills, funding and transfers" empty={history ? "Nothing logged in this range yet." : "Reading the register…"} />
      {/* Phones: the same log book as ruled entries, nothing cut at the edge. */}
      <ol className="divide-y divide-rule/20 border-2 border-rule bg-card shadow-hard sm:hidden" aria-label="Activity register">
        {rows.length === 0 ? <li className="px-3 py-3 text-sm text-ink-2">{history ? "Nothing logged in this range yet." : "Reading the register…"}</li> : null}
        {rows.map((row) => (
          <li key={row.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 px-3 py-2.5">
            <span className="font-mono text-[11px] text-ink-3">{row.when} · FLOOR</span>
            <span className={cx("tnum row-span-2 self-center text-right font-mono text-[13px]", row.direction === "up" ? "text-up" : row.direction === "down" ? "text-down" : "text-ink")}>
              {row.direction === "up" ? "▲ " : row.direction === "down" ? "▼ " : ""}
              {row.amount}
            </span>
            <span className="text-sm leading-snug text-ink">
              {row.entry}
              {row.proof ? (
                <a href={row.proof.href} target="_blank" rel="noreferrer" className="ml-1.5 font-mono text-[11px] text-water underline">
                  {row.proof.label}
                </a>
              ) : null}
            </span>
          </li>
        ))}
      </ol>
      {shown.length > limit ? (
        <div className="mt-3 flex justify-center">
          <Button variant="ink" size="sm" onClick={() => setLimit((value) => value + 24)}>
            Older entries ({shown.length - limit})
          </Button>
        </div>
      ) : null}
    </section>
  );
}
