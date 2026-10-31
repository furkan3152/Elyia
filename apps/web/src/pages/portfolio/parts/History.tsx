import type { PortfolioHistory } from "@elyia/core/api/portfolio";
import { useCallback, useMemo, useState } from "react";

import { routeHref } from "../../../app/routes/routeTable";
import { hyperCoreExplorerUrl } from "../../../lib/hypercore/endpoints";
import { SUN, INK } from "../../../pixel/ely";
import { PixelCanvas } from "../../../pixel/PixelCanvas";
import { PixelProfile } from "../../../pixel/PixelProfile";
import { LAND, WATER } from "../../../pixel/terrain";
import { shade } from "../../../pixel/topo";
import { SummitRegister } from "../../../topo/SummitRegister";
import { Button } from "../../../ui/Button";
import { cx } from "../../../ui/cx";
import { Panel } from "../../../ui/Panel";
import { SegmentedControl } from "../../../ui/SegmentedControl";
import { dayLabel, pctSigned, usdShort, usdSigned } from "../range/format";
import { calendarGrid, registerEntries, type CalendarCell, type EquityRange, type RegisterEntry } from "../range/model";
import { useEquity } from "../range/useEquity";
import { useSheetColors } from "./sheetColors";

const RANGE_WORD: Readonly<Record<EquityRange, string>> = { day: "day", week: "7-day", month: "30-day", allTime: "all-time" };

/** The profile's range switch (1D / 7D / 30D / ALL), centred under the section head. */
export function EquityRangeControl({ range, onRange }: { readonly range: EquityRange; readonly onRange: (range: EquityRange) => void }) {
  return (
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
  );
}

/**
 * The elevation profile: equity as a stepped pixel ridgeline in altitude
 * bands, camps at the biggest events, the summit flag at the high and the
 * deepest drawdown flooded as a valley lake.
 */
export function EquityProfile({ history, sample, range, className }: { readonly history: PortfolioHistory | null; readonly sample: boolean; readonly range: EquityRange; readonly className?: string }) {
  const { series, camps, facts } = useEquity(history, range);
  const climb = facts.change !== null && facts.change >= 0;
  const caption = facts.change === null ? undefined : `a ${RANGE_WORD[range]} ${climb ? "climb" : "descent"} · ${usdSigned(facts.change, true)} · ${pctSigned(facts.changePct)}`;
  return (
    <Panel variant="sheet" padding="lg" className={className}>
      <p className="mb-5 text-center font-tag text-[12px] uppercase text-ink-2">
        <span className="text-ink">{sample ? "Sample equity" : "HyperCore account value"}</span>
        {facts.high !== null ? ` · high ${usdShort(facts.high)} · max drawdown ${(facts.drawdown * 100).toFixed(1)}%` : ""}
      </p>
      {series.length < 2 ? (
        <p className="flex h-[200px] items-center justify-center text-sm text-ink-2">{history ? "No equity curve for this range yet." : "Reading the profile…"}</p>
      ) : (
        <PixelProfile
          series={series}
          camps={camps}
          height={64}
          formatValue={usdShort}
          label={`${sample ? "Sample equity" : "HyperCore account value"} over the ${RANGE_WORD[range]} range, from ${usdShort(facts.start)} to ${usdShort(facts.end)}; high ${usdShort(facts.high)}; deepest drawdown ${(facts.drawdown * 100).toFixed(1)}%`}
          caption={caption}
          startLabel={dayLabel(series[0]!.t)}
          endLabel="NOW"
        />
      )}
    </Panel>
  );
}

const WEEKDAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"] as const;
const TILE = 16;

/** One day as a pixel tile (pure painting): a gain rises as a hill in land bands, a loss sinks as a lake; the best day wears a crown. */
function paintTile(ctx: CanvasRenderingContext2D, cell: CalendarCell, best: boolean, paper: string): void {
  ctx.clearRect(0, 0, TILE, TILE);
  const net = cell.entry?.net ?? 0;
  if (!cell.entry || net === 0) {
    ctx.fillStyle = paper;
    for (let x = 2; x < TILE; x += 4) ctx.fillRect(x, TILE - 3, 1, 1);
    return;
  }
  const level = Math.max(1, Math.round(cell.intensity * 4)); // 1..4 steps of height or depth
  if (net > 0) {
    const peak = 3 + level * 3;
    for (let x = 0; x < TILE; x += 1) {
      const d = Math.abs(x + 0.5 - TILE / 2);
      const h = Math.max(0, Math.round(peak - d * (peak / (TILE / 2 - 1))));
      for (let y = TILE - h; y < TILE; y += 1) {
        const band = Math.min(LAND.length - 1, Math.floor(((TILE - y) / 16) * 6) + 1);
        ctx.fillStyle = y === TILE - h ? shade(LAND[band]!, -0.3) : LAND[band]!;
        ctx.fillRect(x, y, 1, 1);
      }
    }
    if (best) {
      const top = TILE - peak - 4;
      ctx.fillStyle = SUN;
      ctx.fillRect(6, top + 1, 4, 2);
      ctx.fillRect(6, top, 1, 1);
      ctx.fillRect(9, top, 1, 1);
      ctx.fillStyle = INK;
      ctx.fillRect(6, top + 3, 4, 1);
    }
    return;
  }
  const depth = 2 + level * 3;
  for (let y = TILE - depth; y < TILE; y += 1) {
    for (let x = 0; x < TILE; x += 1) {
      ctx.fillStyle = (x + y) % 7 === 0 ? WATER.glint : y - (TILE - depth) > depth / 2 ? WATER.deep : WATER.shallow;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  ctx.fillStyle = WATER.shore;
  ctx.fillRect(0, TILE - depth, TILE, 1);
}

function DayTile({ cell, best, today }: { readonly cell: CalendarCell; readonly best: boolean; readonly today: boolean }) {
  const colors = useSheetColors();
  const draw = useCallback((ctx: CanvasRenderingContext2D) => paintTile(ctx, cell, best, colors.ink3), [cell, best, colors.ink3]);
  const net = cell.entry?.net ?? 0;
  const up = net > 0;
  return (
    <div
      className={cx("relative aspect-square bg-card px-frame-thin", today && "outline-dashed outline-4 outline-offset-4 outline-signal")}
      title={cell.entry ? `${cell.day}: ${usdSigned(net)} · ${cell.entry.fills} fills · funding ${usdSigned(cell.entry.funding)}` : `${cell.day}: no activity`}
    >
      <PixelCanvas width={TILE} height={TILE} contain draw={draw} decorative redrawKey={`${cell.day}|${net}|${best}|${colors.night}`} className="absolute inset-0 flex !h-full items-end" />
      <span className={cx("absolute left-1 top-0.5 font-tag text-[10px] leading-none sm:left-1.5 sm:top-1 sm:text-[11px]", cell.entry ? "text-ink" : "text-ink-3")}>{cell.date}</span>
      {cell.entry && net !== 0 ? (
        <span className={cx("tnum absolute bottom-0.5 right-1 bg-card px-0.5 font-mono text-[10px] font-semibold leading-none sm:bottom-1 sm:right-1.5 sm:text-[11px]", up ? "text-up" : "text-down")}>
          {up ? "▲" : "▼"}
          <span className="hidden md:inline">{usdShort(Math.abs(net)).replace("$", "")}</span>
          <span className="sr-only"> {usdSigned(net)}</span>
        </span>
      ) : null}
    </div>
  );
}

/** The PnL calendar as pixel tiles: realised PnL − fees + funding per UTC day, gains as hills, losses as lakes, ▲/▼ on every figure. */
export function PnlCalendar({ history, now, sample, className }: { readonly history: PortfolioHistory | null; readonly now: number; readonly sample: boolean; readonly className?: string }) {
  const grid = useMemo(() => calendarGrid(history?.calendar ?? [], now, 35), [history, now]);
  const today = new Date(now).toISOString().slice(0, 10);
  return (
    <Panel variant="sheet" padding="lg" className={className}>
      <p className="mb-5 text-center font-tag text-[12px] uppercase text-ink-2">
        <span className="text-ink">35 UTC days{sample ? " · sample" : ""}</span> · net <span className={grid.total >= 0 ? "text-up" : "text-down"}>{usdSigned(grid.total, true)}</span>
      </p>
      <table className="w-full table-fixed border-separate" style={{ borderSpacing: "8px" }}>
        <caption className="sr-only">Net PnL per day: realised PnL minus fees plus funding</caption>
        <thead>
          <tr>
            {WEEKDAYS.map((day) => (
              <th key={day} scope="col" className="pb-1 font-tag text-[10px] font-normal text-ink-3 sm:text-[11px]">
                {day}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grid.weeks.map((week, index) => (
            <tr key={index}>
              {week.map((cell, column) => (
                <td key={column} className="p-0 align-top">
                  {cell.day ? <DayTile cell={cell} best={grid.best?.day === cell.day} today={cell.day === today} /> : null}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="tnum mt-4 flex flex-wrap justify-center gap-x-5 gap-y-1 font-mono text-xs text-ink-2">
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
      <p className="mt-2 text-center font-tag text-[11px] uppercase text-ink-3">hill = a gain · lake = a loss · crown = the best day</p>
    </Panel>
  );
}

export type RegisterFilter = "all" | "fill" | "funding" | "ledger";

/** The Summit Register: fills, funding and transfers as a ruled log book, with filters (centred) and more pages. */
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
    <div className={className}>
      <div className="mb-8 flex justify-center">
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
            { value: "ledger", label: `Moves ${counts.ledger}` },
          ]}
        />
      </div>
      <SummitRegister className="hidden sm:block" rows={rows} caption="Activity register: fills, funding and transfers" empty={history ? "Nothing logged in this range yet." : "Reading the register…"} />
      {/* Phones: the same log book as ruled entries, nothing cut at the edge. */}
      <ol className="divide-y-2 divide-dashed divide-rule/20 bg-card px-frame px-drop sm:hidden" aria-label="Activity register">
        {rows.length === 0 ? <li className="px-3 py-3 text-sm text-ink-2">{history ? "Nothing logged in this range yet." : "Reading the register…"}</li> : null}
        {rows.map((row) => (
          <li key={row.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 px-3 py-2.5">
            <span className="font-tag text-[11px] uppercase text-ink-3">{row.when} · FLOOR</span>
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
        <div className="mt-8 flex justify-center">
          <Button variant="ink" size="sm" onClick={() => setLimit((value) => value + 24)}>
            Older entries ({shown.length - limit})
          </Button>
        </div>
      ) : null}
    </div>
  );
}
