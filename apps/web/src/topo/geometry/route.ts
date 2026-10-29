/**
 * Route card geometry (pure): the elevation profile of an intent's steps
 * across the three altitude bands, and the signpost blade outline.
 */
import type { Layer } from "./relief";

export const LAYER_ORDER: readonly Layer[] = ["floor", "ridge", "summit"];

export const LAYER_NAME: Readonly<Record<Layer, string>> = { floor: "Floor", ridge: "Ridge", summit: "Summit" };
export const LAYER_NETWORK: Readonly<Record<Layer, string>> = { floor: "HyperCore", ridge: "HyperEVM", summit: "Elysium" };

export interface RouteStepInput {
  readonly layer: Layer;
  /** Moving to another layer during this step (bridge up or down). */
  readonly toLayer?: Layer;
}

export interface RouteProfilePoint {
  readonly x: number;
  readonly y: number;
}

export interface RouteProfile {
  /** The trail line: flat along a band, a slope on a bridge. */
  readonly d: string;
  /** Waypoint dots, one per step, at the step's end. */
  readonly waypoints: readonly RouteProfilePoint[];
  /** The start (the pack). */
  readonly start: RouteProfilePoint;
  /** y of each band's centre line. */
  readonly bands: Readonly<Record<Layer, number>>;
}

/** Band centre y for a profile of `height` (summit at the top). */
export function bandY(layer: Layer, height: number): number {
  const index = LAYER_ORDER.indexOf(layer);
  const band = height / 3;
  return height - band * index - band * 0.5;
}

/**
 * Steps are spaced evenly; a step on one layer is a level walk with a small
 * rise, a step that changes layer climbs (or descends) to the next band.
 */
export function routeProfile(steps: readonly RouteStepInput[], width: number, height: number, startLayer?: Layer, padLeft = 14): RouteProfile {
  const bands = { floor: bandY("floor", height), ridge: bandY("ridge", height), summit: bandY("summit", height) };
  const first = startLayer ?? steps[0]?.layer ?? "floor";
  const pad = 14;
  const left = Math.max(pad, padLeft);
  const span = width - left - pad;
  const start = { x: left, y: bands[first] + 8 };
  const points: RouteProfilePoint[] = [start];
  const waypoints: RouteProfilePoint[] = [];
  let current: Layer = first;
  steps.forEach((step, index) => {
    const x0 = left + (span * index) / steps.length;
    const x1 = left + (span * (index + 1)) / steps.length;
    const from = step.layer === current ? current : step.layer;
    if (from !== current) points.push({ x: x0, y: bands[from] + 6 });
    const target = step.toLayer ?? from;
    const rise = target === from ? -6 : 0;
    const end = { x: x1, y: bands[target] + rise + (target === from ? 0 : 6) };
    // shoulder before the climb so slopes read as climbs, not ramps
    if (target !== from) points.push({ x: x0 + (x1 - x0) * 0.35, y: points[points.length - 1]!.y });
    points.push(end);
    waypoints.push(end);
    current = target;
  });
  const fmt = (n: number) => (Math.round(n * 10) / 10).toString();
  const d = `M${points.map((p) => `${fmt(p.x)},${fmt(p.y)}`).join("L")}`;
  return { d, waypoints, start, bands };
}

/** Outline of a signpost blade pointing right (or left): a rectangle with a pointed end. */
export function bladePath(width: number, height: number, direction: "right" | "left" = "right", point = height * 0.5): string {
  const p = Math.min(point, width / 3);
  if (direction === "right") return `M0,0H${width - p}L${width},${height / 2}L${width - p},${height}H0Z`;
  return `M${p},0H${width}V${height}H${p}L0,${height / 2}Z`;
}
