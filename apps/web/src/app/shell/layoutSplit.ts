import type { RouteId } from "../routes/routeTable";
import type { HeaderSplit } from "./HeaderGrid";

/**
 * Pages with a rail or side nav, and its width: the header centres its nav
 * on their content axis (DESIGN.md §1, `.top.split`). Ask Ely's rail is full
 * bleed (272); the developer portal and the owner console sit in a 1440
 * frame with a 264 side nav (PortalShell).
 */
const SPLITS: Partial<Record<RouteId, HeaderSplit>> = {
  deck: { rail: 272 },
  developers: { rail: 264, max: 1440 },
  admin: { rail: 264, max: 1440 },
};

export function headerSplitFor(id: RouteId): HeaderSplit | null {
  return SPLITS[id] ?? null;
}
