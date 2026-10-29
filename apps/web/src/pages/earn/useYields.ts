/**
 * Live yields for the network mode: HyperCore staking from the validators,
 * kHYPE from Kinetiq's StakingManager on HyperEVM, HLP and vaults from the
 * Elyia API (or the public stats dump when the API is down). Each source
 * reports where it came from, so the page can label it.
 */
import type { VaultRow, VaultsResponse } from "@elyia/core/api/markets";
import { getEvmNetwork, layersFor } from "@elyia/core/networks";
import { useQuery } from "@tanstack/react-query";
import { formatUnits, parseUnits } from "viem";
import { useReadContract } from "wagmi";

import { useUiStore } from "../../app/state/uiStore";
import { apiGet } from "../../lib/api";
import { hyperCoreEndpoints } from "../../lib/hypercore/endpoints";
import { infoClient } from "../../lib/hypercore/runtime";
import { KINETIQ_ACCOUNTANT_ABI, KINETIQ_STAKING_ABI } from "../track/flow/abis";
import { KINETIQ_MANAGER } from "../track/flow/localPlanner";
import { depositableVaults, rankYields, stakingRate, vaultFromDump, type DumpVault, type ValidatorSummary, type YieldRow } from "./yields";

/** Kinetiq StakingAccountant on HyperEVM testnet (StakingManager.stakingAccountant()). */
const KINETIQ_ACCOUNTANT = "0x78b1F56988e1fc1bb6c214e8e71dC0F43Fe3DF87" as const;
const VAULTS_SHOWN = 8;

export interface Yields {
  readonly rows: readonly YieldRow[];
  readonly loading: boolean;
  readonly vaultSource: "api" | "stats-dump" | "none";
  /** Open vaults at 0% APR, left off the range. */
  readonly idleVaults: number;
  readonly staking: { readonly aprPct: number | null; readonly stakedHype: number; readonly validators: number } | null;
  /** HYPE per kHYPE, from the accountant. */
  readonly khypeRate: number | null;
  readonly khypeStaked: number | null;
  readonly referencePx: number | null;
}

async function loadVaults(mode: "testnet" | "mainnet"): Promise<{ rows: VaultRow[]; source: "api" | "stats-dump" | "none" }> {
  const network = layersFor(mode).hypercore.key;
  try {
    const body = await apiGet<VaultsResponse>("/v1/vaults", { query: { network, limit: 60 }, timeoutMs: 12_000 });
    return { rows: [...body.vaults], source: "api" };
  } catch {
    // The full mainnet dump is ~14 MB: only the testnet one (~3 MB) is read from the browser.
    if (mode !== "testnet") return { rows: [], source: "none" };
    const response = await fetch("https://stats-data.hyperliquid.xyz/Testnet/vaults");
    if (!response.ok) return { rows: [], source: "none" };
    const dump = (await response.json()) as DumpVault[];
    return { rows: dump.map(vaultFromDump), source: "stats-dump" };
  }
}

export function useYields(): Yields {
  const mode = useUiStore((state) => state.mode);
  const app = hyperCoreEndpoints(mode).appUrl;
  const hyperevm = getEvmNetwork(layersFor(mode).hyperevm.key);
  const manager = KINETIQ_MANAGER[hyperevm.key];

  const validators = useQuery({
    queryKey: ["hypercore", mode, "validatorSummaries"],
    queryFn: () => infoClient(mode).post<ValidatorSummary[]>({ type: "validatorSummaries" }),
    staleTime: 5 * 60_000,
  });
  const vaults = useQuery({ queryKey: ["earn", mode, "vaults"], queryFn: () => loadVaults(mode), staleTime: 5 * 60_000, retry: 0 });
  const reference = useQuery({
    queryKey: ["hypercore", "mainnet", "allMids-reference"],
    queryFn: () => infoClient("mainnet").post<Record<string, string>>({ type: "allMids" }),
    refetchInterval: 30_000,
  });
  const totalStaked = useReadContract({ address: manager, abi: KINETIQ_STAKING_ABI, functionName: "totalStaked", chainId: hyperevm.chainId, query: { enabled: Boolean(manager), staleTime: 60_000 } });
  const rate = useReadContract({ address: manager ? KINETIQ_ACCOUNTANT : undefined, abi: KINETIQ_ACCOUNTANT_ABI, functionName: "kHYPEToHYPE", args: [parseUnits("1", 18)], chainId: hyperevm.chainId, query: { enabled: Boolean(manager), staleTime: 60_000 } });

  const staking = validators.data ? stakingRate(validators.data) : null;
  const referencePx = Number(reference.data?.HYPE) || null;
  const khypeStaked = totalStaked.data !== undefined ? Number(formatUnits(totalStaked.data, 18)) : null;
  const khypeRate = rate.data !== undefined ? Number(formatUnits(rate.data, 18)) : null;

  const rows: YieldRow[] = [];
  rows.push({
    id: "hypercore-staking",
    name: "HyperCore staking",
    kind: "staking",
    layer: "floor",
    aprPct: staking?.aprPct ?? null,
    tvlUsd: staking && referencePx ? staking.stakedHype * referencePx : null,
    asset: "HYPE",
    entry: "external",
    note: staking ? `${staking.validators} active validators · stake-weighted week APR · 1-day delegation lock · 7-day unstaking queue` : "reading validators…",
    href: `${app}/staking`,
  });
  if (manager) {
    rows.push({
      id: "kinetiq-khype",
      name: "kHYPE · Kinetiq",
      kind: "liquid-staking",
      layer: "ridge",
      aprPct: staking?.aprPct ?? null,
      tvlUsd: khypeStaked !== null && referencePx ? khypeStaked * referencePx : null,
      asset: "HYPE",
      entry: "planner",
      note: `liquid staking on HyperEVM · min 0.1 HYPE${khypeRate ? ` · 1 kHYPE = ${khypeRate.toFixed(4)} HYPE` : ""}`,
      estimated: true,
    });
  }
  const open = depositableVaults(vaults.data?.rows ?? []);
  // Vaults at exactly 0% have not traded this month: they stay off the range.
  const active = open.filter((vault) => vault.aprPct !== 0);
  for (const vault of active.slice(0, VAULTS_SHOWN)) {
    const hlp = /hyperliquidity provider/iu.test(vault.name);
    rows.push({
      id: vault.address,
      name: hlp ? "HLP" : vault.name,
      kind: "vault",
      layer: "floor",
      aprPct: vault.aprPct,
      tvlUsd: vault.tvlUsd,
      asset: "USDC",
      entry: "external",
      note: hlp ? "Hyperliquidity Provider · protocol vault · 4-day lockup" : `user vault · leader ${vault.leader.slice(0, 6)}…${vault.leader.slice(-4)} · 1-day lockup`,
      href: `${app}/vaults/${vault.address}`,
    });
  }
  return {
    rows: rankYields(rows),
    loading: validators.isPending || vaults.isPending,
    vaultSource: vaults.data?.source ?? "none",
    idleVaults: open.length - active.length,
    staking,
    khypeRate,
    khypeStaked,
    referencePx,
  };
}
