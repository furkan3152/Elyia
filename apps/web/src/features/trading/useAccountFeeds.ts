/**
 * The followed account's live state (the connected wallet, or any address
 * in "view as" mode): positions on every perp dex, open orders, spot
 * balances, fills, funding, TWAPs and the active market's leverage and
 * max sizes. All from the browser's own HyperCore WebSocket (user feeds
 * belong in the user's browser: HyperCore allows 10 users per IP).
 */
import type { FrontendOpenOrder, SpotBalance, UserFill } from "@elyia/core/hypercore/info";
import type { NetworkEnvironment } from "@elyia/core/networks";
import { useEffect, useMemo, useState } from "react";

import { useHyperCoreFeed } from "../../lib/hypercore/feeds";
import { hyperCoreSocket } from "../../lib/hypercore/runtime";
import { accountSummaryFrom, clearinghouseStates, openOrdersFrom, positionsFrom, spotBalancesFrom, twapsFrom, type AccountSummary, type PositionRow, type TwapRow } from "./accountModel";

export interface FundingRow {
  readonly time: number;
  readonly coin: string;
  readonly usdc: string;
  readonly szi: string;
  readonly fundingRate: string;
}

export interface TwapHistoryRow {
  readonly time: number;
  readonly twapId?: number;
  readonly state: { readonly coin: string; readonly side: string; readonly sz: string; readonly executedSz: string; readonly executedNtl: string; readonly minutes: number; readonly reduceOnly: boolean; readonly timestamp: number };
  readonly status: { readonly status: string; readonly description?: string };
}

export interface ActiveAssetData {
  readonly coin: string;
  readonly leverage: { readonly type: "cross" | "isolated"; readonly value: number };
  readonly maxTradeSzs: readonly [string, string];
  readonly availableToTrade: readonly [string, string];
  readonly markPx?: string;
}

export interface AccountFeeds {
  readonly address: string | null;
  readonly positions: readonly PositionRow[] | null;
  readonly summary: AccountSummary | null;
  readonly openOrders: readonly FrontendOpenOrder[] | null;
  readonly spot: readonly SpotBalance[] | null;
  readonly fills: readonly UserFill[] | null;
  readonly fundings: readonly FundingRow[] | null;
  readonly twaps: readonly TwapRow[] | null;
  readonly twapHistory: readonly TwapHistoryRow[] | null;
  readonly assetData: ActiveAssetData | null;
  /** Every feed the guard needs has delivered at least once. */
  readonly ready: boolean;
}

const NONE: AccountFeeds = {
  address: null,
  positions: null,
  summary: null,
  openOrders: null,
  spot: null,
  fills: null,
  fundings: null,
  twaps: null,
  twapHistory: null,
  assetData: null,
  ready: false,
};

const DEX_SCAN_MS = 120_000;

/**
 * Builder (HIP-3) dexes where the account holds positions. The all-dex
 * feed is large (about 90 KB per update on testnet), so it is read once
 * every two minutes and the dexes found are then followed one by one.
 */
function usePositionDexes(mode: NetworkEnvironment, user: string | null): readonly string[] {
  const [found, setFound] = useState<{ readonly user: string | null; readonly dexes: readonly string[] }>({ user: null, dexes: [] });
  useEffect(() => {
    if (!user) return undefined;
    let leave: (() => void) | null = null;
    const scan = () => {
      leave?.();
      leave = hyperCoreSocket(mode).subscribe({ type: "allDexsClearinghouseState", user }, (data) => {
        const dexes = clearinghouseStates(data)
          .filter(([dex, state]) => dex !== "" && (state.assetPositions ?? []).some((entry) => Number(entry?.position?.szi ?? 0) !== 0))
          .map(([dex]) => dex);
        setFound((previous) => (previous.user === user && previous.dexes.join() === dexes.join() ? previous : { user, dexes }));
        leave?.();
        leave = null;
      });
    };
    scan();
    const timer = window.setInterval(scan, DEX_SCAN_MS);
    return () => {
      window.clearInterval(timer);
      leave?.();
    };
  }, [mode, user]);
  return found.user === user ? found.dexes : [];
}

export function useAccountFeeds(mode: NetworkEnvironment, address: string | null, activeCoin: string | null, activeDex: string): AccountFeeds {
  const user = address ? address.toLowerCase() : null;
  const hip3Active = activeDex !== "" && activeDex !== "spot" ? activeDex : null;
  const positionDexes = usePositionDexes(mode, user).filter((dex) => dex !== hip3Active);
  const states = useHyperCoreFeed<unknown>(mode, user ? { type: "clearinghouseState", user } : null);
  const activeState = useHyperCoreFeed<unknown>(mode, user && hip3Active ? { type: "clearinghouseState", user, dex: hip3Active } : null);
  const extraA = useHyperCoreFeed<unknown>(mode, user && positionDexes[0] ? { type: "clearinghouseState", user, dex: positionDexes[0] } : null);
  const extraB = useHyperCoreFeed<unknown>(mode, user && positionDexes[1] ? { type: "clearinghouseState", user, dex: positionDexes[1] } : null);
  const orders = useHyperCoreFeed<unknown>(mode, user ? { type: "openOrders", user } : null);
  const dexOrders = useHyperCoreFeed<unknown>(mode, user && hip3Active ? { type: "openOrders", user, dex: hip3Active } : null);
  const spot = useHyperCoreFeed<unknown>(mode, user ? { type: "spotState", user } : null);
  const fills = useHyperCoreFeed<UserFill[]>(mode, user ? { type: "userFills", user } : null, "fills");
  const fundings = useHyperCoreFeed<FundingRow[]>(mode, user ? { type: "userFundings", user } : null, "fundings");
  const twaps = useHyperCoreFeed<unknown>(mode, user ? { type: "twapStates", user } : null);
  const twapHistory = useHyperCoreFeed<TwapHistoryRow[]>(mode, user ? { type: "userTwapHistory", user } : null, "twapHistory");
  const assetData = useHyperCoreFeed<ActiveAssetData & { user: string }>(mode, user && activeCoin ? { type: "activeAssetData", user, coin: activeCoin } : null);

  return useMemo(() => {
    if (!user) return NONE;
    const baseOrders = orders.value ? openOrdersFrom(orders.value) : null;
    const extraOrders = dexOrders.value ? openOrdersFrom(dexOrders.value) : [];
    const openOrders = baseOrders ? [...baseOrders, ...extraOrders].sort((a, b) => b.timestamp - a.timestamp) : null;
    const merged = states.value
      ? { clearinghouseStates: [states.value, activeState.value, extraA.value, extraB.value].flatMap((value) => (value ? clearinghouseStates(value) : [])) }
      : null;
    const positions = merged ? positionsFrom(merged) : null;
    return {
      address: user,
      positions,
      summary: merged ? accountSummaryFrom(merged) : null,
      openOrders,
      spot: spot.value ? spotBalancesFrom(spot.value) : null,
      fills: fills.value ?? null,
      fundings: fundings.value ?? null,
      twaps: twaps.value ? twapsFrom(twaps.value) : null,
      twapHistory: twapHistory.value ?? null,
      assetData: assetData.value && assetData.value.coin === activeCoin ? assetData.value : null,
      ready: positions !== null && openOrders !== null && fills.value !== null,
    };
  }, [user, states.value, activeState.value, extraA.value, extraB.value, orders.value, dexOrders.value, spot.value, fills.value, fundings.value, twaps.value, twapHistory.value, assetData.value, activeCoin]);
}
