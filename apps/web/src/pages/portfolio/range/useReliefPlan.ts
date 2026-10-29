import type { PortfolioSnapshot } from "@elyia/core/api/portfolio";
import { useMemo } from "react";

import type { RopeView } from "../../../features/trading/useTopoData";
import { reliefPlan, type ReliefPlan } from "./model";

export function useReliefPlan(snapshot: PortfolioSnapshot, ropes: readonly RopeView[], cap?: number): ReliefPlan {
  return useMemo(() => reliefPlan(snapshot, { ropes, cap }), [snapshot, ropes, cap]);
}
