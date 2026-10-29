import type { PortfolioHistory } from "@elyia/core/api/portfolio";
import { useMemo } from "react";

import { campsFor, equitySeries, summitFacts, type EquityRange } from "./model";

/** The equity series of a range, its camps and its summit facts. */
export function useEquity(history: PortfolioHistory | null, range: EquityRange) {
  return useMemo(() => {
    const series = equitySeries(history, range);
    const from = series[0]?.t ?? 0;
    const to = series[series.length - 1]?.t ?? 0;
    return { series, camps: history ? campsFor(history.timeline, from, to) : [], facts: summitFacts(series) };
  }, [history, range]);
}
