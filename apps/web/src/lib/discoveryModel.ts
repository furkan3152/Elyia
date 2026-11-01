/**
 * Discovery responses (pure): merging the live checks of several networks,
 * folding streamed launches into the listing, and the Elysium stats figures
 * as the pages print them (always with their basis: measured, estimate or
 * registry). Shapes are the core contract (`@elyia/core/api/discovery`),
 * checked against the live API on 2026-11-01.
 */
import type { ElysiumStatsResponse, LaunchesResponse, LaunchKind, LaunchView, ProtocolLiveResponse, ProtocolLiveRow, StatFigure } from "@elyia/core/api/discovery";

/** A live check that read its network (an Elysium without RPC answers with head null and every row unread). */
export function liveRead(response: ProtocolLiveResponse | undefined): response is ProtocolLiveResponse {
  return response !== undefined && response.head !== null;
}

function rank(row: ProtocolLiveRow): number {
  if (row.active === true) return 4;
  if (row.missing.length > 0) return 3;
  if (row.present > 0) return 2;
  if (row.active === false) return 1;
  return 0;
}

/**
 * One row per protocol across the checked networks: the most telling one
 * (active, then a missing contract, then deployed and quiet). Rows of a
 * network that was not read never hide a read one.
 */
export function mergeLive(responses: readonly (ProtocolLiveResponse | undefined)[]): Map<string, ProtocolLiveRow> {
  const rows = new Map<string, ProtocolLiveRow>();
  for (const response of responses) {
    if (!liveRead(response)) continue;
    for (const row of response.protocols) {
      const known = rows.get(row.protocolId);
      if (!known || rank(row) > rank(known)) rows.set(row.protocolId, row);
    }
  }
  return rows;
}

/** "elysium-testnet: 457/457 contracts present, 32 active" or why it was not read. */
export function liveSummary(response: ProtocolLiveResponse): string {
  if (response.head === null) return `${response.network}: not read (${response.notes[0] ?? "no RPC"})`;
  return `${response.network}: ${response.totals.present}/${response.totals.contracts} contracts present, ${response.totals.active} active in the last ${response.window?.blocks.toLocaleString("en-US") ?? "?"} blocks`;
}

/** A streamed launch folded into the listing: deduped by id, newest block first, at most `limit`. */
export function withLaunch(response: LaunchesResponse, launch: LaunchView, limit = 40): LaunchesResponse {
  if (launch.network !== response.network) return response;
  const launches = [launch, ...response.launches.filter((item) => item.id !== launch.id)]
    .sort((a, b) => b.blockNumber - a.blockNumber || b.logIndex - a.logIndex)
    .slice(0, limit);
  return { ...response, launches, scannedThrough: Math.max(response.scannedThrough ?? 0, launch.blockNumber) };
}

/** The stream's `status` event (the listing without launches). */
export function withStatus(response: LaunchesResponse, status: Omit<LaunchesResponse, "launches">): LaunchesResponse {
  if (status.network !== response.network) return response;
  return { ...response, ...status, launches: response.launches, scannedThrough: Math.max(response.scannedThrough ?? 0, status.scannedThrough ?? 0) || null };
}

const KIND_WORD: Readonly<Record<LaunchKind, string>> = {
  "v2-pair": "new V2 pair",
  "v3-pool": "new V3 pool",
  "v4-pool": "new V4 pool",
  "launchpad-event": "launchpad token",
};

export function launchKindWord(kind: LaunchKind): string {
  return KIND_WORD[kind] ?? kind;
}

/** Validates a streamed `launch` event (the stream is data, never trusted blindly). */
export function launchOf(data: unknown): LaunchView | null {
  if (typeof data !== "object" || data === null) return null;
  const row = data as Partial<LaunchView>;
  if (typeof row.id !== "string" || typeof row.network !== "string" || typeof row.blockNumber !== "number" || typeof row.logIndex !== "number" || !Array.isArray(row.tokens) || typeof row.protocolName !== "string" || typeof row.kind !== "string") return null;
  return row as LaunchView;
}

export function statusOf(data: unknown): Omit<LaunchesResponse, "launches"> | null {
  if (typeof data !== "object" || data === null) return null;
  const row = data as Partial<LaunchesResponse>;
  if (typeof row.network !== "string" || typeof row.sources !== "number" || typeof row.running !== "boolean") return null;
  return { network: row.network, scannedThrough: typeof row.scannedThrough === "number" ? row.scannedThrough : null, sources: row.sources, windowBlocks: typeof row.windowBlocks === "number" ? row.windowBlocks : 0, running: row.running, notes: Array.isArray(row.notes) ? row.notes.filter((note): note is string => typeof note === "string") : [] };
}

/* ------------------------------------------------------------- stats */

export type StatBasis = StatFigure["basis"];

export const BASIS_WORD: Readonly<Record<StatBasis, string>> = { measured: "measured", estimate: "estimate", registry: "registry" };

export interface StatLine {
  readonly id: string;
  readonly label: string;
  /** Printed value ("—" when nothing measured it). */
  readonly value: string;
  readonly basis: StatBasis;
  readonly source: string;
}

function figureText(figure: StatFigure, format: (value: number) => string): string {
  return figure.value === null || !Number.isFinite(figure.value) ? "—" : format(figure.value);
}

const int = (value: number) => Math.round(value).toLocaleString("en-US");
const approx = (value: number) => `~${Math.round(value).toLocaleString("en-US")}`;

/** The stats as labelled lines: chain first, then the registry, then recent activity. */
export function statLines(stats: ElysiumStatsResponse): { readonly chain: StatLine[]; readonly ecosystem: StatLine[]; readonly activity: StatLine[] } {
  const line = (id: string, label: string, figure: StatFigure, format: (value: number) => string): StatLine => ({ id, label, value: figureText(figure, format), basis: figure.basis, source: figure.source });
  const { chain, ecosystem, activity } = stats;
  return {
    chain: [
      line("head", "Head block", chain.head, int),
      line("blockTime", "Block time", chain.blockTimeMs, (value) => `${value.toFixed(value >= 100 ? 0 : 1)} ms`),
      line("tps", "Transactions / s", chain.tps, (value) => value.toFixed(value >= 10 ? 1 : 2)),
      line("gas", "Gas price", chain.gasPriceGwei, (value) => `${value.toLocaleString("en-US", { maximumSignificantDigits: 3 })} gwei`),
      line("blocksPerDay", "Blocks / day", chain.blocksPerDay, approx),
      line("txPerDay", "Transactions / day", chain.txPerDay, approx),
    ],
    ecosystem: [
      line("protocols", "Protocols deployed here", ecosystem.protocols, int),
      line("live", "Seen working", ecosystem.liveProtocols, int),
      line("contracts", "Verified contracts", ecosystem.verifiedContracts, int),
      line("executable", "Elyia executes", ecosystem.executableProtocols, int),
    ],
    activity: [
      line("active", "Protocols with logs", activity.activeProtocols, int),
      line("present", "Contracts with bytecode", activity.presentContracts, int),
      line("launches", "Launches seen", activity.launchesSeen, int),
    ],
  };
}
