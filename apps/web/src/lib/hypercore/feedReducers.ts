/**
 * Reducers that fold HyperCore feed messages into values (pure; node tests
 * load this file). See feeds.ts for the stores built on them.
 */

export type FeedKind = "latest" | "trades" | "fills" | "fundings" | "twapHistory";

const TRADES_KEPT = 80;
// HyperCore sends up to 2000 recent fills; keeping them all lets the guard measure 24 h volume correctly.
const FILLS_KEPT = 2_000;

interface Keyed {
  readonly time: number;
  readonly tid?: number;
  readonly hash?: string;
  readonly coin?: string;
}

function identity(item: Keyed): string {
  return `${item.time}|${item.tid ?? ""}|${item.hash ?? ""}|${item.coin ?? ""}`;
}

/** Merges a batch into a newest-first list, without duplicates, capped. */
export function mergeNewestFirst<T extends Keyed>(previous: readonly T[] | null, batch: readonly T[], keep: number, replace = false): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  const incoming = [...batch].sort((a, b) => b.time - a.time);
  for (const item of [...incoming, ...(replace ? [] : (previous ?? []))]) {
    const id = identity(item);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(item);
  }
  out.sort((a, b) => b.time - a.time);
  return out.slice(0, keep);
}

/** Folds one message into a feed value. */
export function reduceFeed(kind: FeedKind, previous: unknown, data: unknown): unknown {
  switch (kind) {
    case "latest":
      return data;
    case "trades":
      return Array.isArray(data) ? mergeNewestFirst(previous as Keyed[] | null, data as Keyed[], TRADES_KEPT) : previous;
    case "fills": {
      const body = data as { isSnapshot?: boolean; fills?: Keyed[] } | null;
      if (!body || !Array.isArray(body.fills)) return previous;
      return mergeNewestFirst(previous as Keyed[] | null, body.fills, FILLS_KEPT, body.isSnapshot === true);
    }
    case "fundings": {
      const body = data as { isSnapshot?: boolean; fundings?: Keyed[] } | null;
      if (!body || !Array.isArray(body.fundings)) return previous;
      return mergeNewestFirst(previous as Keyed[] | null, body.fundings, FILLS_KEPT, body.isSnapshot === true);
    }
    case "twapHistory": {
      const body = data as { isSnapshot?: boolean; history?: Keyed[] } | null;
      if (!body || !Array.isArray(body.history)) return previous;
      return mergeNewestFirst(previous as Keyed[] | null, body.history, 200, body.isSnapshot === true);
    }
  }
}
