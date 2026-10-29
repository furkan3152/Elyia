/**
 * "Your pack at each camp": HYPE and USDC on Elysium and HyperEVM (the
 * wallet's public RPCs) and on HyperCore (spot balances and withdrawable
 * perp margin, from the info API). Read only; `null` means "not read yet",
 * never zero.
 */
import type { ClearinghouseState, SpotClearinghouseState } from "@elyia/core/hypercore/info";
import { findToken } from "@elyia/core/assets";
import { getEvmNetwork, layersFor } from "@elyia/core/networks";
import { useQuery } from "@tanstack/react-query";
import { formatUnits, type Address } from "viem";
import { useBalance, useReadContract } from "wagmi";

import { useUiStore } from "../../../app/state/uiStore";
import { infoClient } from "../../../lib/hypercore/runtime";
import { ERC20_ABI } from "./abis";

export interface CampPack {
  readonly HYPE: number | null;
  readonly USDC: number | null;
}

export interface Packs {
  readonly summit: CampPack;
  readonly ridge: CampPack;
  /** HyperCore spot. */
  readonly floor: CampPack;
  /** Withdrawable perp margin (USDC). */
  readonly perps: number | null;
  readonly address: string | null;
}

function toNumber(value: bigint | undefined, decimals: number): number | null {
  return value === undefined ? null : Number(formatUnits(value, decimals));
}

export function usePacks(address: string | null | undefined): Packs {
  const mode = useUiStore((state) => state.mode);
  const layers = layersFor(mode);
  const elysium = getEvmNetwork(layers.elysium.key);
  const hyperevm = getEvmNetwork(layers.hyperevm.key);
  const owner = (address ?? undefined) as Address | undefined;
  const enabled = Boolean(owner);
  const usdcElysium = findToken(elysium.key, "USDC")?.address as Address | undefined;
  const usdcHyperevm = findToken(hyperevm.key, "USDC")?.address as Address | undefined;
  const query = { enabled, refetchInterval: 12_000 } as const;

  const hypeSummit = useBalance({ address: owner, chainId: elysium.chainId, query });
  const hypeRidge = useBalance({ address: owner, chainId: hyperevm.chainId, query });
  const usdcSummit = useReadContract({ address: usdcElysium, abi: ERC20_ABI, functionName: "balanceOf", args: owner ? [owner] : undefined, chainId: elysium.chainId, query: { ...query, enabled: enabled && Boolean(usdcElysium) } });
  const usdcRidge = useReadContract({ address: usdcHyperevm, abi: ERC20_ABI, functionName: "balanceOf", args: owner ? [owner] : undefined, chainId: hyperevm.chainId, query: { ...query, enabled: enabled && Boolean(usdcHyperevm) } });

  const spot = useQuery({
    queryKey: ["hypercore", mode, "spotClearinghouseState", owner],
    queryFn: () => infoClient(mode).post<SpotClearinghouseState>({ type: "spotClearinghouseState", user: owner as string }),
    enabled,
    refetchInterval: 15_000,
  });
  const perps = useQuery({
    queryKey: ["hypercore", mode, "clearinghouseState", owner],
    queryFn: () => infoClient(mode).post<ClearinghouseState>({ type: "clearinghouseState", user: owner as string }),
    enabled,
    refetchInterval: 15_000,
  });

  const spotOf = (coin: string): number | null => {
    if (!spot.data) return null;
    const row = spot.data.balances.find((balance) => balance.coin === coin);
    return row ? Math.max(0, Number(row.total) - Number(row.hold)) : 0;
  };

  return {
    address: owner ?? null,
    summit: { HYPE: hypeSummit.data ? Number(formatUnits(hypeSummit.data.value, 18)) : null, USDC: toNumber(usdcSummit.data, 6) },
    ridge: { HYPE: hypeRidge.data ? Number(formatUnits(hypeRidge.data.value, 18)) : null, USDC: toNumber(usdcRidge.data, 6) },
    floor: { HYPE: spotOf("HYPE"), USDC: spotOf("USDC") },
    perps: perps.data ? Number(perps.data.withdrawable) : null,
  };
}

/** "1.2534", "40.5", "0": a pack figure for labels; null reads as "—". */
export function packFigure(value: number | null, decimals = 4): string {
  if (value === null) return "—";
  if (value === 0) return "0";
  if (value >= 1000) return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return value.toLocaleString("en-US", { maximumFractionDigits: value < 1 ? decimals : 3 });
}
