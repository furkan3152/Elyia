/** Pure helpers behind the terminal's Survey pieces (grades, sign tones, hatching). */
import type { FrontendOpenOrder } from "@elyia/core/hypercore/info";
import type { CSSProperties } from "react";

import { leverageGrade } from "../../features/trading/topo";
import type { Grade } from "../../topo/geometry/conditions";

/** Route grade (1-6) of a leverage, for Blaze / GradeChip / the grade slider. */
export function gradeOfLeverage(leverage: number | null): Grade {
  return Number(leverageGrade(leverage).slice(1)) as Grade;
}

/** Spot and 1x moves are trail grades (T1-T2); leverage climbs from T3. */
export function ticketGrade(isSpot: boolean, leverage: number): Grade {
  if (isSpot) return 1;
  return gradeOfLeverage(leverage);
}

/** Text tone for a signed figure. */
export function signTone(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value) || value === 0) return "text-ink";
  return value > 0 ? "text-up" : "text-down";
}

/** Diagonal hatching in a sign colour: the depth bars, the imbalance meter, cliffs. */
export function hatch(tone: "up" | "down" | "ink" | "warn", alpha = 0.55, gap = 5): CSSProperties {
  const color = `rgb(var(--${tone}) / ${alpha})`;
  return {
    backgroundImage: `repeating-linear-gradient(135deg, ${color} 0 1.25px, transparent 1.25px ${gap}px)`,
  };
}

export interface RestingLevel {
  readonly px: number;
  readonly buy: boolean;
  readonly count: number;
  readonly sz: number;
  /** The first order's id (a stable key for the line). */
  readonly oid: number;
}

/**
 * Resting (non-trigger) orders of one market folded into chart lines: orders
 * at the same price and side share one line with their total size, and only
 * the `max` levels nearest the reference price are kept.
 */
export function restingLevels(orders: readonly Pick<FrontendOpenOrder, "oid" | "side" | "limitPx" | "sz" | "isTrigger">[], reference: number | null, max: number): RestingLevel[] {
  const resting = orders.filter((order) => !order.isTrigger);
  const near = reference === null ? resting : [...resting].sort((a, b) => Math.abs(Number(a.limitPx) - reference) - Math.abs(Number(b.limitPx) - reference));
  const levels = new Map<string, { px: number; buy: boolean; count: number; sz: number; oid: number }>();
  for (const order of near) {
    const key = `${order.side}${Number(order.limitPx)}`;
    const entry = levels.get(key);
    if (entry) {
      entry.count += 1;
      entry.sz += Number(order.sz);
    } else if (levels.size < max) levels.set(key, { px: Number(order.limitPx), buy: order.side === "B", count: 1, sz: Number(order.sz), oid: order.oid });
  }
  return [...levels.values()].map((level) => ({ ...level, sz: Number(level.sz.toPrecision(10)) }));
}
