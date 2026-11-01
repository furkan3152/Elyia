/**
 * GET /v1/elysium/stats: the Elysium ecosystem in figures, each labelled
 * with how it was obtained. Chain figures come from the live block pulse
 * (measured over its sample window; per-day figures are extrapolations, so
 * `estimate`), ecosystem figures are counted from the registry, activity
 * comes from the last cached live check and the launch radar. Nothing here
 * is invented: a figure without a source is null.
 */
import { NETWORKS, type NetworkKey, type ProtocolDescriptor, type ProtocolKind } from "@elyia/core";
import type { ElysiumStatsResponse, LaunchesResponse, ProtocolLiveResponse, StatFigure } from "@elyia/core/api/discovery";
import type { Pulse } from "@elyia/core";

const figure = <T>(value: T | null, basis: StatFigure["basis"], source: string): StatFigure<T> => ({ value, basis, source });

export interface StatsInput {
  readonly network: NetworkKey;
  readonly now: number;
  readonly pulse: Pulse | null;
  readonly rows: readonly ProtocolDescriptor[];
  readonly live: ProtocolLiveResponse | null;
  readonly radar: (Omit<LaunchesResponse, "launches"> & { readonly seen: number }) | null;
}

export function elysiumStats(input: StatsInput): ElysiumStatsResponse {
  const { network, pulse, live, radar } = input;
  const onNetwork = input.rows.filter((row) => row.deployments.some((deployment) => deployment.network === network));
  const deployment = (row: ProtocolDescriptor) => row.deployments.find((entry) => entry.network === network);
  const working = onNetwork.filter((row) => ["live", "testnet-live"].includes(deployment(row)?.status ?? ""));
  const announced = onNetwork.filter((row) => ["announced", "coming"].includes(deployment(row)?.status ?? ""));
  const contracts = onNetwork.reduce((sum, row) => sum + (deployment(row)?.contractInfo?.length ?? 0), 0);
  const byKind: Partial<Record<ProtocolKind, number>> = {};
  for (const row of onNetwork) byKind[row.kind] = (byKind[row.kind] ?? 0) + 1;
  const pulseSource = pulse ? `block pulse, ${pulse.sampleBlocks} blocks sampled` : "block pulse unavailable";
  const blocksPerDay = pulse && pulse.blockTimeMs > 0 ? Math.round(86_400_000 / pulse.blockTimeMs) : null;
  const txPerDay = pulse ? Math.round(pulse.tps * 86_400) : null;
  const notes = [
    "Per-day figures extrapolate the pulse's short sample window: estimates, not counts.",
    "Ecosystem figures count Elyia's registry (verified contracts only), not every contract deployed on the chain.",
    ...(NETWORKS[network].environment === "testnet" ? ["Testnet activity includes bots and test traffic."] : []),
    ...(live ? [] : ["No live registry check has run yet: activity figures are null (GET /v1/protocols/live runs one)."]),
  ];
  return {
    network,
    at: new Date(input.now).toISOString(),
    chain: {
      head: figure(pulse?.head ?? null, "measured", pulseSource),
      blockTimeMs: figure(pulse ? Math.round(pulse.blockTimeMs * 10) / 10 : null, "measured", pulseSource),
      tps: figure(pulse ? Math.round(pulse.tps * 100) / 100 : null, "measured", pulseSource),
      gasPriceGwei: figure(pulse ? pulse.gasPriceGwei : null, "measured", pulseSource),
      blocksPerDay: figure(blocksPerDay, "estimate", "86,400 s / measured block time"),
      txPerDay: figure(txPerDay, "estimate", "measured tx/s x 86,400"),
    },
    ecosystem: {
      protocols: figure(onNetwork.length, "registry", `protocols with a deployment on ${NETWORKS[network].name}`),
      liveProtocols: figure(working.length, "registry", "deployments seen working (live / testnet-live)"),
      announcedProtocols: figure(announced.length, "registry", "announced or coming deployments"),
      verifiedContracts: figure(contracts, "registry", "contracts re-checked by eth_getCode when added"),
      executableProtocols: figure(onNetwork.filter((row) => row.executable).length, "registry", "protocols Elyia's engine executes here"),
      byKind,
    },
    activity: {
      activeProtocols: figure(live ? live.totals.active : null, "measured", live ? `logs in blocks ${live.window?.fromBlock ?? "?"}-${live.window?.toBlock ?? "?"}, checked ${live.checkedAt}` : "no live check yet"),
      presentContracts: figure(live ? live.totals.present : null, "measured", live ? `bytecode present at ${live.checkedAt}` : "no live check yet"),
      launchesSeen: figure(radar ? radar.seen : null, "measured", radar ? `launch radar, ${radar.sources} registry sources, through block ${radar.scannedThrough ?? "?"}` : "launch radar not running"),
      launchWindowBlocks: figure(radar ? radar.windowBlocks : null, "measured", "blocks per eth_getLogs request"),
    },
    notes,
  };
}
