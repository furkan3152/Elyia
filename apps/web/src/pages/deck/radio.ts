import type { PortfolioHistory } from "@elyia/core/api/portfolio";

import type { RopeView } from "../../features/trading/useTopoData";
import type { RadioEntry } from "../../topo/RadioLog";
import { pct } from "../portfolio/range/format";
import { registerEntries, sortRopes } from "../portfolio/range/model";

/** The radio's entries, read off the followed range: a call on every rope that frays, then the latest fills, funding and transfers. */
export function radioEntries(ropes: readonly RopeView[], history: PortfolioHistory | null, now: number): RadioEntry[] {
  const out: RadioEntry[] = [];
  const latest = history?.timeline[0]?.time ?? now;
  for (const rope of sortRopes(ropes)) {
    if (rope.distance !== null && rope.distance < 0.25) {
      out.push({ id: `rope-${rope.coin}`, at: now, from: "ALERT", to: "you", message: `${rope.coin} rope ${pct(rope.distance)}${rope.distance < 0.1 ? ", fraying: add margin or set an anchor" : ", watch it"}`, tone: "alert", live: rope.distance < 0.1 });
    }
  }
  for (const entry of registerEntries(history?.timeline ?? [], 6).slice(0, 5)) {
    out.push({ id: entry.id, at: entry.time, from: entry.kind === "ledger" ? "BASE" : "FLOOR", message: `${entry.entry}${entry.amount ? ` · ${entry.amount}` : ""}`, tone: entry.kind === "fill" ? "settled" : "plain" });
  }
  if (out.length === 0) out.push({ id: "quiet", at: latest, from: "GUIDE", to: "you", message: "All quiet on the range. Say where to and I will draft the route." });
  return out.slice(0, 6);
}
