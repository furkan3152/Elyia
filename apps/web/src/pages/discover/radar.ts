/**
 * First ascents (pure): the newest HyperCore spot tokens, read from the
 * info API's `spotMetaAndAssetCtxs`, laid out as blips on the radar. A
 * token's index is its deploy order, so the highest indexes are the
 * freshest launches; the radar puts the freshest nearest the centre.
 */
import type { SpotAssetCtx, SpotMetaAndAssetCtxs } from "@elyia/core/hypercore/info";

import type { Condition } from "../../topo/geometry/conditions";

export interface Ascent {
  /** Token name ("PURR"). */
  readonly name: string;
  readonly fullName: string | null;
  readonly index: number;
  /** Book coin of its first USDC pair ("@1035" or "PURR/USDC"), null when it has no book. */
  readonly book: string | null;
  readonly markPx: number | null;
  readonly dayVolumeUsd: number;
  readonly change: number | null;
  /** Linked to a HyperEVM contract (it can climb to the Ridge). */
  readonly evmLinked: boolean;
  readonly condition: Condition;
  readonly reason: string;
}

function num(value: string | null | undefined): number | null {
  if (typeof value !== "string") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** The `count` newest tokens with a book, newest first. */
export function firstAscents(data: SpotMetaAndAssetCtxs, count = 10): Ascent[] {
  const [meta, ctxs] = data;
  const ctxByCoin = new Map<string, SpotAssetCtx>(ctxs.map((ctx) => [ctx.coin, ctx]));
  const usdcIndex = meta.tokens.find((token) => token.name === "USDC")?.index ?? 0;
  const bookOf = new Map<number, string>();
  for (const pair of meta.universe) {
    const [base, quote] = pair.tokens;
    if (quote === usdcIndex && !bookOf.has(base)) bookOf.set(base, pair.name);
  }
  return [...meta.tokens]
    .filter((token) => token.index !== usdcIndex && bookOf.has(token.index))
    .sort((a, b) => b.index - a.index)
    .slice(0, count)
    .map((token) => {
      const book = bookOf.get(token.index) ?? null;
      const ctx = book ? ctxByCoin.get(book) : undefined;
      const mark = num(ctx?.markPx);
      const previous = num(ctx?.prevDayPx);
      const volume = num(ctx?.dayNtlVlm) ?? 0;
      const change = mark !== null && previous !== null && previous > 0 ? mark / previous - 1 : null;
      const condition: Condition = volume <= 0 || mark === null || mark <= 0 ? "closed" : "caution";
      const reason = condition === "closed" ? "no trades in 24 h: no trail yet" : volume < 1_000 ? "thin: under $1k traded today" : "fresh launch: not Shield-checked";
      return { name: token.name, fullName: token.fullName, index: token.index, book, markPx: mark, dayVolumeUsd: volume, change, evmLinked: token.evmContract !== null, condition, reason };
    });
}

export interface Blip {
  readonly ascent: Ascent;
  /** Polar position on a unit radar: r in 0..1, angle in radians. */
  readonly r: number;
  readonly angle: number;
  /** Dot radius in radar units (0..1). */
  readonly size: number;
}

function hash(text: string): number {
  let value = 2166136261;
  for (let index = 0; index < text.length; index += 1) value = Math.imul(value ^ text.charCodeAt(index), 16777619) >>> 0;
  return value;
}

/** Freshest nearest the centre; the bearing is stable per token; dot area grows with the day's volume. */
export function radarBlips(ascents: readonly Ascent[]): Blip[] {
  const n = Math.max(1, ascents.length);
  return ascents.map((ascent, rank) => {
    const r = 0.2 + (0.72 * (rank + 0.5)) / n;
    const angle = ((hash(ascent.name) % 3600) / 3600) * Math.PI * 2;
    const size = 0.014 + Math.min(0.03, Math.log10(1 + ascent.dayVolumeUsd) * 0.005);
    return { ascent, r, angle, size };
  });
}
