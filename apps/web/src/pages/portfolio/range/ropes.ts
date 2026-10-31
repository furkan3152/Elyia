import type { RopeView } from "../../../features/trading/useTopoData";
import { sortRopes } from "./model";

/** The nearest rope under 10% to the crevasse, if any (Ely worries about it). */
export function frayingRope<T extends Pick<RopeView, "distance" | "positionValue">>(ropes: readonly T[]): T | null {
  const nearest = sortRopes(ropes)[0];
  return nearest && nearest.distance !== null && nearest.distance < 0.1 ? nearest : null;
}
