import type { PortfolioHistory } from "@elyia/core/api/portfolio";

import type { RangeSource } from "./useRange";

export const SOURCE_LABEL: Readonly<Record<RangeSource, string>> = {
  api: "live · Elyia survey",
  browser: "live · read in your browser",
  sample: "sample range",
};

/** Today's move of the HyperCore account value (the API's and HyperCore's own day curve). */
export function dayChange(history: PortfolioHistory | null): number | null {
  const curve = history?.equity.day?.accountValue;
  if (!curve || curve.length < 2) return null;
  return curve[curve.length - 1]![1] - curve[0]![1];
}
