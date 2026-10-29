/**
 * useRange(address): one followed account's range across the three layers,
 * from the best source that answers.
 *
 * 1. The Elyia API (`GET /v1/portfolio/:address` + `/history`, kept live by
 *    the `/stream` SSE): the full balance sheet, valued at reference prices.
 * 2. Browser-direct, when the API cannot be reached: HyperCore's own feeds
 *    and info API plus the two EVM layers through public RPCs (wagmi).
 * 3. The labelled sample, when no address is followed.
 *
 * Ropes always come from the browser's own HyperCore WebSocket (live mids,
 * TP/SL from open orders) once the account is followed; until then from the
 * snapshot's positions.
 */
import type { PortfolioHistory, PortfolioSnapshot, PortfolioStreamSnapshot } from "@elyia/core/api/portfolio";
import { findToken } from "@elyia/core/assets";
import type { DelegatorSummary, LedgerUpdate, Portfolio } from "@elyia/core/hypercore/info";
import type { NetworkEnvironment } from "@elyia/core/networks";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import { useNow } from "../../../hooks/useNow";
import { erc20Abi, formatUnits } from "viem";
import { useBalance, useReadContract } from "wagmi";

import { useUiStore } from "../../../app/state/uiStore";
import { DEFINED_CHAINS } from "../../../app/wallet/chains";
import { ropeLayout, ropesFrom } from "../../../features/trading/topo";
import { useAccountFeeds, type AccountFeeds } from "../../../features/trading/useAccountFeeds";
import { usePositionRopes, type RopeView } from "../../../features/trading/useTopoData";
import { apiGet, apiUrl, describeError } from "../../../lib/api";
import { infoClient } from "../../../lib/hypercore/runtime";
import { openEventStream } from "../../../lib/sse";
import { historyFromBrowser, snapshotFromBrowser, type EvmLayerRead } from "./browser";
import { positionRowsFrom } from "./model";
import { sampleHistory, sampleRopes, sampleSnapshot } from "./sample";

export type RangeSource = "api" | "browser" | "sample";

export interface RangeData {
  /** The followed address (lower case), null when showing the sample. */
  readonly address: string | null;
  readonly mode: NetworkEnvironment;
  readonly source: RangeSource;
  /** The balance sheet; null while the first read is in flight. */
  readonly snapshot: PortfolioSnapshot | null;
  readonly history: PortfolioHistory | null;
  readonly ropes: readonly RopeView[];
  readonly feeds: AccountFeeds;
  /** First read still loading (no snapshot yet). */
  readonly loading: boolean;
  /** The SSE stream is delivering (API source only). */
  readonly live: boolean;
  /** Why the API was not used, in plain words (browser source). */
  readonly apiProblem: string | null;
  readonly updatedAt: number | null;
}

const HISTORY_DAYS = 35;

const EVM_KEYS = { testnet: { ridge: "hyperevm-testnet", summit: "elysium-testnet" }, mainnet: { ridge: "hyperevm-mainnet", summit: "elysium-mainnet" } } as const;

/** Native HYPE and USDC of one EVM layer, read through wagmi (public RPCs). */
function useEvmLayer(address: string | null, key: "hyperevm-testnet" | "elysium-testnet" | "hyperevm-mainnet" | "elysium-mainnet", enabled: boolean): EvmLayerRead | null {
  const chain = DEFINED_CHAINS[key];
  const usdc = findToken(key, "USDC");
  const on = enabled && address !== null && chain.rpcUrls.default.http.length > 0;
  const native = useBalance({ address: (address ?? undefined) as `0x${string}` | undefined, chainId: chain.id, query: { enabled: on, refetchInterval: 30_000, retry: 1 } });
  const token = useReadContract({
    address: (usdc?.address ?? undefined) as `0x${string}` | undefined,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address as `0x${string}`] : undefined,
    chainId: chain.id,
    query: { enabled: on && usdc !== null, refetchInterval: 30_000, retry: 1 },
  });
  if (!on) return null;
  if (native.isPending && token.isPending) return null;
  const hype = native.data ? Number(formatUnits(native.data.value, native.data.decimals)) : null;
  const usdcAmount = typeof token.data === "bigint" && usdc ? Number(formatUnits(token.data, usdc.decimals)) : null;
  return { network: key, hype, usdc: usdcAmount, blockNumber: null };
}

export function useRange(rawAddress: string | null): RangeData {
  const mode = useUiStore((state) => state.mode);
  const address = rawAddress ? rawAddress.toLowerCase() : null;
  const queryClient = useQueryClient();
  const [now] = useState(() => Date.now());
  const clockNow = useNow(30_000);

  /* 1. the API */
  const apiSnapshot = useQuery({
    queryKey: ["portfolio", mode, address],
    queryFn: ({ signal }) => apiGet<PortfolioSnapshot>(`/v1/portfolio/${address}`, { query: { mode }, signal, timeoutMs: 20_000 }),
    enabled: address !== null,
    retry: 0,
    staleTime: 15_000,
    refetchInterval: 60_000,
  });
  const apiHistory = useQuery({
    queryKey: ["portfolio-history", mode, address, HISTORY_DAYS],
    queryFn: ({ signal }) => apiGet<PortfolioHistory>(`/v1/portfolio/${address}/history`, { query: { mode, days: HISTORY_DAYS }, signal, timeoutMs: 30_000 }),
    enabled: address !== null && apiSnapshot.isSuccess,
    retry: 0,
    staleTime: 60_000,
    refetchInterval: 120_000,
  });
  const apiUp = apiSnapshot.isSuccess;
  const apiDown = address !== null && apiSnapshot.isError;

  // Live: the stream republishes the snapshot whenever its content changes.
  const [live, setLive] = useState(false);
  useEffect(() => {
    if (!address || !apiUp) return undefined;
    const stream = openEventStream<{ snapshot: PortfolioStreamSnapshot }>({
      url: apiUrl(`/v1/portfolio/${address}/stream`, { mode }),
      parsers: { snapshot: (data) => (data && typeof data === "object" && "snapshot" in data ? (data as PortfolioStreamSnapshot) : null) },
      onEvent: (_name, value) => queryClient.setQueryData(["portfolio", mode, address], value.snapshot),
      onStateChange: (state) => setLive(state === "open"),
      maxAttempts: 4,
    });
    return () => {
      stream.close();
      setLive(false);
    };
  }, [address, apiUp, mode, queryClient]);

  /* ropes: always from the browser's own feed once followed */
  const feeds = useAccountFeeds(mode, address, null, "");
  const feedRopes = usePositionRopes(mode, feeds);

  /* 2. browser-direct, only when the API is down */
  const fallback = apiDown;
  const mids = useQuery({
    queryKey: ["hypercore", "mainnet", "allMids-reference"],
    queryFn: () => infoClient("mainnet").post<Record<string, string>>({ type: "allMids" }),
    enabled: fallback,
    staleTime: 30_000,
    refetchInterval: 30_000,
  });
  const staking = useQuery({
    queryKey: ["hypercore", mode, "delegatorSummary", address],
    queryFn: () => infoClient(mode).post<DelegatorSummary>({ type: "delegatorSummary", user: address as string }),
    enabled: fallback,
    staleTime: 60_000,
  });
  const equity = useQuery({
    queryKey: ["hypercore", mode, "portfolio", address],
    queryFn: () => infoClient(mode).post<Portfolio>({ type: "portfolio", user: address as string }),
    enabled: fallback,
    staleTime: 60_000,
    refetchInterval: 120_000,
  });
  const ledger = useQuery({
    queryKey: ["hypercore", mode, "ledger", address],
    queryFn: () => infoClient(mode).post<LedgerUpdate[]>({ type: "userNonFundingLedgerUpdates", user: address as string, startTime: now - HISTORY_DAYS * 86_400_000 }),
    enabled: fallback,
    staleTime: 120_000,
  });
  const ridge = useEvmLayer(address, EVM_KEYS[mode].ridge, fallback);
  const summit = useEvmLayer(address, EVM_KEYS[mode].summit, fallback);

  const browserSnapshot = useMemo(
    () =>
      fallback && address
        ? snapshotFromBrowser({ address, mode, now: clockNow, summary: feeds.summary, positions: feeds.positions, spot: feeds.spot, staking: staking.data ?? null, mids: mids.data ?? null, ridge, summit })
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ridge/summit are rebuilt each render; their values are the dependency
    [fallback, address, mode, clockNow, feeds.summary, feeds.positions, feeds.spot, staking.data, mids.data, ridge?.hype, ridge?.usdc, summit?.hype, summit?.usdc],
  );
  const browserHistory = useMemo(
    () => (fallback && address ? historyFromBrowser({ address, mode, now: clockNow, from: now - HISTORY_DAYS * 86_400_000, portfolio: equity.data ?? null, fills: feeds.fills, fundings: feeds.fundings, ledger: ledger.data ?? null }) : null),
    [fallback, address, mode, now, clockNow, equity.data, feeds.fills, feeds.fundings, ledger.data],
  );

  /* 3. the sample */
  const sample = useMemo(() => (address ? null : { snapshot: sampleSnapshot(now), history: sampleHistory(now), ropes: sampleRopes() }), [address, now]);

  const snapshot = sample?.snapshot ?? (apiUp ? apiSnapshot.data : browserSnapshot) ?? null;
  const history = sample?.history ?? (apiUp ? (apiHistory.data ?? null) : browserHistory);
  const snapshotRopes = useMemo<RopeView[]>(() => {
    if (!snapshot || sample) return [];
    return ropesFrom(positionRowsFrom(snapshot.positions), null).map((rope) => ({ ...rope, layout: ropeLayout(rope) }));
  }, [snapshot, sample]);
  const ropes = sample ? sample.ropes : feeds.positions !== null ? feedRopes : snapshotRopes;

  return {
    address,
    mode,
    source: sample ? "sample" : apiUp ? "api" : "browser",
    snapshot,
    history,
    ropes,
    feeds,
    loading: snapshot === null,
    live: apiUp && live,
    apiProblem: apiDown ? describeError(apiSnapshot.error) : null,
    updatedAt: snapshot?.generatedAt ?? null,
  };
}
