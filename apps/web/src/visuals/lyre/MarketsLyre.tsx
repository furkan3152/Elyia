import { useEffect, useMemo, useRef } from "react";

import { navigate } from "../../app/routes/history";
import { routeHref } from "../../app/routes/routeTable";
import { useHottestMarkets } from "../../hooks/useMarkets";
import { formatRelativeTime } from "../../lib/format";
import { marketStrings } from "../../lib/markets";
import { usePageVisible } from "../../motion/usePageVisible";
import { useReducedMotion } from "../../motion/useReducedMotion";
import { Badge } from "../../ui/Badge";
import { Lyre, type LyreHandle } from "./Lyre";

export interface MarketsLyreProps {
  readonly height?: number;
  readonly className?: string;
}

/**
 * The Lyre of the seven hottest HyperCore markets (the flat-portfolio state).
 * Live data plucks a string when its mark moves between refreshes; the demo
 * set (API unreachable) plucks on a fixed rhythm and is labelled "demo".
 * Clicking a string opens its terminal.
 */
export function MarketsLyre({ height = 300, className }: MarketsLyreProps) {
  const { markets, source, updatedAt } = useHottestMarkets(7);
  const strings = useMemo(() => marketStrings(markets), [markets]);
  const lyreRef = useRef<LyreHandle>(null);
  const previousMarks = useRef<Map<string, number>>(new Map());
  const reduced = useReducedMotion();
  const visible = usePageVisible();

  // Live: pluck strings whose mark moved since the previous refresh.
  useEffect(() => {
    if (source !== "live") return;
    for (const market of markets) {
      const before = previousMarks.current.get(market.coin);
      if (market.markPx !== null && before !== undefined && before !== market.markPx) {
        lyreRef.current?.pluck(market.coin, Math.min(1, 0.4 + Math.abs(market.markPx / before - 1) * 60));
      }
      if (market.markPx !== null) previousMarks.current.set(market.coin, market.markPx);
    }
  }, [markets, source]);

  // Demo: a fixed, gentle rhythm so the instrument visibly plays.
  useEffect(() => {
    if (source === "live" || reduced || !visible || strings.length === 0) return undefined;
    let index = 0;
    const order = [0, 3, 1, 5, 2, 6, 4];
    const timer = window.setInterval(() => {
      const target = strings[order[index % order.length]! % strings.length];
      index += 1;
      if (target) lyreRef.current?.pluck(target.id, 0.55 + (index % 3) * 0.15);
    }, 1_300);
    return () => window.clearInterval(timer);
  }, [source, reduced, visible, strings]);

  return (
    <div className={className}>
      <Lyre
        ref={lyreRef}
        strings={strings}
        height={height}
        label={`The Lyre: ${source === "live" ? "the seven most traded HyperCore markets" : "demo markets"}`}
        onSelect={(coin) => navigate(routeHref("trade", { market: coin }))}
      />
      <div className="mt-1 flex flex-wrap items-center justify-between gap-2 font-mono text-xs text-text-2">
        <span>thickness = 24h volume · hum = 24h move · tap a string to trade</span>
        {source === "live" ? (
          <Badge tone="mint" dot>
            live{updatedAt ? ` · ${formatRelativeTime(updatedAt)}` : ""}
          </Badge>
        ) : source === "demo" ? (
          <Badge tone="gold" title="Live market data is not available from the Elyia API right now, so these are sample markets.">
            demo · sample markets
          </Badge>
        ) : (
          <Badge tone="neutral">loading markets</Badge>
        )}
      </div>
    </div>
  );
}
