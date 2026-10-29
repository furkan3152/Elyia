import type { PortfolioHistory, PortfolioSnapshot } from "@elyia/core/api/portfolio";

import { Altimeter } from "../../../topo/Altimeter";
import { useMeasuredWidth } from "../../../topo/useMeasuredWidth";
import { cx } from "../../../ui/cx";
import { pct, usdFull, usdShort, usdSigned } from "../range/format";
import { layerSplit, LAYER_NAME, NETWORK_NAME, type LayerShare } from "../range/model";
import { dayChange, SOURCE_LABEL } from "../range/labels";
import type { RangeSource } from "../range/useRange";

const FILL = { floor: "bg-floor", ridge: "bg-ridge", summit: "bg-summit" } as const;
const TONE = { floor: "text-floor", ridge: "text-ridge", summit: "text-summit-ink" } as const;

/**
 * The FLOOR / RIDGE / SUMMIT split: one ruled bar, each layer's width its
 * share of the net worth, the figures under it (never colour alone: every
 * segment is named).
 */
export function LayerSplitBar({ split, compact = false, className }: { readonly split: readonly LayerShare[]; readonly compact?: boolean; readonly className?: string }) {
  const visible = split.filter((entry) => entry.share > 0);
  return (
    <div className={className}>
      <div className={cx("flex w-full overflow-hidden border-2 border-rule bg-paper-2", compact ? "h-3" : "h-5")} role="img" aria-label={`Layer split: ${split.map((entry) => `${LAYER_NAME[entry.layer]} ${NETWORK_NAME[entry.layer]} ${usdShort(entry.usd)}, ${pct(entry.share)}`).join("; ")}`}>
        {visible.map((entry, index) => (
          <span key={entry.layer} className={cx("h-full", FILL[entry.layer], index > 0 && "border-l-2 border-rule")} style={{ width: `${Math.max(entry.share * 100, 1.2)}%` }} />
        ))}
      </div>
      <ul className={cx("mt-2 grid grid-cols-3 gap-2 font-mono", compact ? "text-[11px]" : "text-xs")} aria-hidden="true">
        {split.map((entry, index) => (
          <li key={entry.layer} className={cx("min-w-0", index === 1 && "text-center", index === 2 && "text-right")}>
            <span className={cx("font-semibold tracking-[0.1em]", TONE[entry.layer])}>{LAYER_NAME[entry.layer]}</span>
            <span className="tnum block text-ink sm:inline sm:pl-1.5">{entry.status === "unavailable" || entry.status === "error" ? "not read" : usdShort(entry.usd)}</span>
            {!compact ? <span className="tnum block text-ink-3">{pct(entry.share)}</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

export interface NetWorthProps {
  readonly snapshot: PortfolioSnapshot;
  readonly history: PortfolioHistory | null;
  readonly source: RangeSource;
  readonly size?: "md" | "lg";
  readonly className?: string;
}

/** Altimeter net worth, today's move and the layer split. Money rolls digit by digit, never tweens. */
export function NetWorth({ snapshot, history, source, size = "lg", className }: NetWorthProps) {
  const split = layerSplit(snapshot);
  const today = dayChange(history);
  const upnl = snapshot.totals.unrealizedPnlUsd;
  // The odometer keeps whole wheels: a long figure on a phone steps down a size instead of being cut.
  const [measure, width] = useMeasuredWidth<HTMLDivElement>(0);
  const digits = usdFull(snapshot.totals.netWorthUsd).length;
  const fit = width === 0 ? size : size === "lg" && width < digits * 46 ? (width < digits * 37 ? "sm" : "md") : size === "md" && width < digits * 37 ? "sm" : size;
  return (
    <div className={className} ref={measure}>
      <p className="caption flex flex-wrap items-center gap-x-2">
        <span className="!text-ink">Altimeter · net worth</span>
        <span aria-hidden="true">·</span>
        <span className={source === "sample" ? "bg-signal px-1 text-signal-ink" : undefined}>{SOURCE_LABEL[source]}</span>
      </p>
      <div className="mt-3 overflow-x-auto scrollbar-none">
        <Altimeter value={usdFull(snapshot.totals.netWorthUsd)} label={source === "sample" ? "Net worth (sample)" : "Net worth"} size={fit} markLatest />
      </div>
      <p className="tnum mt-3 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[13px] text-ink-2">
        {today !== null ? (
          <span>
            <span className={today >= 0 ? "text-up" : "text-down"}>{usdSigned(today)}</span> today
          </span>
        ) : null}
        {snapshot.positions.length > 0 ? (
          <span>
            open PnL <span className={upnl >= 0 ? "text-up" : "text-down"}>{usdSigned(upnl)}</span>
          </span>
        ) : null}
        {snapshot.totals.unpricedLines > 0 ? <span>{snapshot.totals.unpricedLines} unpriced</span> : null}
      </p>
      <LayerSplitBar split={split} className="mt-5" />
    </div>
  );
}
