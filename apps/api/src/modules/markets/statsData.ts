/**
 * Hyperliquid's public stats dumps (`https://stats-data.hyperliquid.xyz/{Mainnet,Testnet}/{vaults,leaderboard}`).
 * They are large (the mainnet leaderboard is about 40 MB of JSON), so reads
 * are rare (callers cache for minutes), time-limited and size-capped.
 */
import type { NetworkEnvironment } from "@elyia/core";
import { ElyiaHttpError, upstreamTimeout } from "../../http/errors.js";
import type { FetchLike } from "../../hyperliquid/info.js";

export const STATS_DATA_ORIGIN = "https://stats-data.hyperliquid.xyz";
export type StatsDump = "vaults" | "leaderboard";

export const STATS_DUMP_LIMITS: Readonly<Record<StatsDump, { readonly timeoutMs: number; readonly maxBytes: number }>> = Object.freeze({
  vaults: { timeoutMs: 30_000, maxBytes: 64 * 1024 * 1024 },
  leaderboard: { timeoutMs: 60_000, maxBytes: 160 * 1024 * 1024 },
});

export function statsDataUrl(environment: NetworkEnvironment, dump: StatsDump): string {
  return `${STATS_DATA_ORIGIN}/${environment === "mainnet" ? "Mainnet" : "Testnet"}/${dump}`;
}

function unavailable(dump: StatsDump): ElyiaHttpError {
  return new ElyiaHttpError("STATS_DATA_UNAVAILABLE", 502, `Hyperliquid's public ${dump} data is not available right now. Try again in a few minutes.`, { dump });
}

/** GETs and parses one dump; refuses bodies over the dump's byte cap. */
export async function fetchStatsDump(fetchImpl: FetchLike, environment: NetworkEnvironment, dump: StatsDump): Promise<unknown> {
  const { timeoutMs, maxBytes } = STATS_DUMP_LIMITS[dump];
  let response: Response;
  try {
    response = await fetchImpl(statsDataUrl(environment, dump), { method: "GET", headers: { accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) throw upstreamTimeout("Hyperliquid stats data");
    throw unavailable(dump);
  }
  if (!response.ok || !response.body) {
    await response.body?.cancel().catch(() => undefined);
    throw unavailable(dump);
  }
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body.cancel().catch(() => undefined);
    throw unavailable(dump);
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw unavailable(dump);
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof ElyiaHttpError) throw error;
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) throw upstreamTimeout("Hyperliquid stats data");
    throw unavailable(dump);
  }
  try {
    return JSON.parse(Buffer.concat(chunks, size).toString("utf8")) as unknown;
  } catch {
    throw unavailable(dump);
  }
}
