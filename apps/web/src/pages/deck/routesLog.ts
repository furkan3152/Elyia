/**
 * Recent routes planned from this browser (pure helpers + guarded storage).
 * A per-viewer convenience: the sentences only, never amounts signed, never
 * keys; a blocked storage means "remember nothing".
 */
import { gradeFor, type Grade } from "../../topo/geometry/conditions";
import type { Layer } from "../../topo/geometry/relief";

export const ROUTES_KEY = "elyia.deck.routes";
const MAX = 6;

export interface LoggedRoute {
  readonly sentence: string;
  readonly at: number;
}

export function parseRoutes(raw: string | null): LoggedRoute[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value
      .filter((entry): entry is LoggedRoute => typeof entry === "object" && entry !== null && typeof (entry as LoggedRoute).sentence === "string" && typeof (entry as LoggedRoute).at === "number")
      .map((entry) => ({ sentence: entry.sentence.slice(0, 500), at: entry.at }))
      .slice(0, MAX);
  } catch {
    return [];
  }
}

/** Adds a sentence on top (same sentence moves up), keeping the newest few. */
export function pushRoute(routes: readonly LoggedRoute[], sentence: string, at: number): LoggedRoute[] {
  const text = sentence.trim().slice(0, 500);
  if (!text) return [...routes];
  return [{ sentence: text, at }, ...routes.filter((entry) => entry.sentence.toLowerCase() !== text.toLowerCase())].slice(0, MAX);
}

/** The route's grade and the layers it touches, read from the words (a sketch until the planner answers). */
export function sketchRoute(sentence: string): { readonly grade: Grade; readonly layers: readonly Layer[]; readonly verb: string } {
  const text = sentence.toLowerCase();
  const leverage = Number(/(\d+(?:\.\d+)?)\s*x\b/u.exec(text)?.[1] ?? 1);
  const perp = /\b(long|short)\b/u.test(text);
  const verb = /\b(long|short|buy|sell|swap|bridge|send|stake|unstake|move|twap|close|reduce|flatten|limit|alert|every)\b/u.exec(text)?.[1] ?? "route";
  const kind = perp ? "perp" : /\btwap\b/u.test(text) ? "twap" : /\bswap\b/u.test(text) ? "swap" : /\bstake\b/u.test(text) ? "stake" : /\b(bridge|ascend|descend)\b/u.test(text) ? "bridge" : /\b(buy|sell)\b/u.test(text) ? "spot" : "send";
  const layers: Layer[] = [];
  const add = (layer: Layer) => {
    if (!layers.includes(layer)) layers.push(layer);
  };
  if (perp || /\b(perps?|hypercore|core|twap|spot)\b/u.test(text) || /\b(buy|sell)\b/u.test(text)) add("floor");
  if (/\b(hyperevm|evm|khype|stake|hyperswap)\b/u.test(text)) add("ridge");
  if (/\b(elysium|summit|kalos|ascend)\b/u.test(text)) add("summit");
  if (/\bbridge\b/u.test(text) && !layers.includes("ridge")) layers.unshift("ridge");
  if (layers.length === 0) add("floor");
  return { grade: gradeFor({ kind, leverage }), layers, verb };
}
