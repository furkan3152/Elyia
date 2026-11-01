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
import { useReadContract, useReadContracts } from "wagmi";

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

/** Summit yield contracts (GET /v1/venues: kalos-stkalos, cheshire, elyra-lending; read back on chain 2026-10-31). */
const SUMMIT = {
  stkalos: "0xa7531d7be19f29b991d97eaa17b034715a835e35",
  cheshire: "0xf6b3bc8b51641037ea8c7621bd8e0ed600752d4b",
  lendingCore: "0x9e4a4632985cbfc13c7143f121ff0f99a0445bd1",
  usdcMarket: "0xfe865cb12a83956acc72046f1cac4a4e0309655e2cb799b0214f1901fe895644",
} as const;
const VAULT_ABI = [{ type: "function", name: "totalAssets", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] }] as const;
const MARKET_ABI = [
  {
    type: "function",
    name: "market",
    stateMutability: "view",
    inputs: [{ type: "bytes32" }],
    outputs: [{ type: "uint128" }, { type: "uint128" }, { type: "uint128" }, { type: "uint128" }, { type: "uint128" }, { type: "uint128" }],
  },
] as const;

function formatCount(value: number): string {
  return value >= 1e6 ? `${(value / 1e6).toFixed(1)}M` : value >= 1e3 ? `${(value / 1e3).toFixed(1)}k` : value.toFixed(2);
}

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

  // The Summit's yields (Elysium testnet), read from chain: ERC-4626 totalAssets and the Morpho-style market.
  const elysium = getEvmNetwork(layersFor(mode).elysium.key);
  const onSummit = mode === "testnet";
  const summitReads = useReadContracts({
    allowFailure: true,
    contracts: [
      { address: SUMMIT.stkalos, abi: VAULT_ABI, functionName: "totalAssets", chainId: elysium.chainId },
      { address: SUMMIT.cheshire, abi: VAULT_ABI, functionName: "totalAssets", chainId: elysium.chainId },
      { address: SUMMIT.lendingCore, abi: MARKET_ABI, functionName: "market", args: [SUMMIT.usdcMarket], chainId: elysium.chainId },
    ],
    query: { enabled: onSummit, staleTime: 60_000 },
  });
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
      venue: { protocol: "kinetiq", family: "hyperevm", verb: "stake", depositAsset: "HYPE" },
      note: `liquid staking on HyperEVM · min 0.1 HYPE${khypeRate ? ` · 1 kHYPE = ${khypeRate.toFixed(4)} HYPE` : ""}`,
      estimated: true,
    });
  }
  if (onSummit) {
    const [stk, ches, market] = summitReads.data ?? [];
    const kalosHeld = stk?.status === "success" ? Number(formatUnits(stk.result as bigint, 18)) : null;
    const cheshireHeld = ches?.status === "success" ? Number(formatUnits(ches.result as bigint, 6)) : null;
    const lent = market?.status === "success" ? (market.result as readonly bigint[]) : null;
    const supplied = lent ? Number(formatUnits(lent[0]!, 6)) : null;
    const utilization = lent && lent[0]! > 0n ? Number(lent[2]!) / Number(lent[0]!) : null;
    rows.push({
      id: "elyra-lending",
      name: "Elyra lending · USDC",
      kind: "lending",
      layer: "summit",
      aprPct: null,
      tvlUsd: supplied,
      asset: "USDC",
      entry: "planner",
      note: `third-party Morpho-style market (useelyra.xyz) · lend USDC against WHYPE · LLTV 77%${utilization !== null ? ` · ${(utilization * 100).toFixed(2)}% borrowed` : ""} · APR n/a (its rate model does not answer a view call) · TVL is test USDC`,
      venue: { protocol: "elyra-lending", family: "elysium", verb: "deposit", depositAsset: "USDC", withdraw: { from: "USDC", unit: "USDC" } },
    });
    rows.push({
      id: "cheshire",
      name: "Cheshire · cUSDC",
      kind: "vault",
      layer: "summit",
      aprPct: null,
      tvlUsd: cheshireHeld,
      asset: "USDC",
      entry: "planner",
      note: "ERC-4626 vault, USDC in, cUSDC out · no website or audit, an experiment · APR n/a (no rate published) · TVL is test USDC",
      venue: { protocol: "cheshire", family: "elysium", verb: "deposit", depositAsset: "USDC", withdraw: { from: "cUSDC", unit: "cUSDC" } },
    });
    rows.push({
      id: "kalos-stkalos",
      name: "stKALOS · Kalos",
      kind: "vault",
      layer: "summit",
      aprPct: null,
      tvlUsd: null,
      tvlNote: kalosHeld !== null ? `${formatCount(kalosHeld)} KALOS · unpriced` : undefined,
      asset: "KALOS",
      entry: "planner",
      note: "ERC-4626 staking of Kalos's own test token · KALOS has no reference price, so the Rule Book refuses rather than guess its value · APR n/a",
      venue: { protocol: "kalos-stkalos", family: "elysium", verb: "deposit", depositAsset: "KALOS", withdraw: { from: "stKALOS", unit: "stKALOS" } },
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
