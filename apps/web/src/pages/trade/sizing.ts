import { spotUsdc } from "../../features/trading/accountModel";
import { maxSizeFor } from "../../features/trading/ticketMath";
import type { AccountFeeds } from "../../features/trading/useAccountFeeds";
import type { TradeMarket } from "../../lib/hypercore/marketCatalog";

/**
 * The largest base size the account can open now on `side` (for the % presets
 * and the 1-5 keys): HyperCore's own max trade sizes on perps, the free
 * balance on spot. Null when unknown.
 */
export function maxBaseFor(input: { readonly market: TradeMarket | null; readonly feeds: AccountFeeds; readonly side: "buy" | "sell"; readonly px: number | null; readonly leverage: number }): number | null {
  const { market, feeds, side, px } = input;
  if (!market || px === null || !(px > 0)) return null;
  if (market.isSpot) {
    if (!feeds.spot) return null;
    if (side === "buy") return spotUsdc(feeds.spot).free / px;
    const balance = feeds.spot.find((entry) => entry.coin === market.base);
    return balance ? Math.max(0, Number(balance.total) - Number(balance.hold)) : 0;
  }
  return maxSizeFor({ side, maxTradeSzs: feeds.assetData?.maxTradeSzs ?? null, availableUsd: feeds.summary?.withdrawable ?? null, leverage: input.leverage, px });
}

/** The ticket's leverage and margin mode for a market: the slider's choice, else the account's, else 5x cross. */
export function ticketLeverage(market: TradeMarket | null, feeds: AccountFeeds, chosen: number | undefined, chosenMode: "cross" | "isolated" | undefined) {
  const position = market ? feeds.positions?.find((row) => row.coin === market.coin) : undefined;
  const current = feeds.assetData && market && feeds.assetData.coin === market.coin ? { leverage: feeds.assetData.leverage.value, mode: feeds.assetData.leverage.type } : position ? { leverage: position.leverage, mode: position.leverageType } : null;
  const max = market?.maxLeverage ?? 1;
  const leverage = Math.max(1, Math.min(max, chosen ?? current?.leverage ?? Math.min(5, max)));
  const mode: "cross" | "isolated" = market?.onlyIsolated ? "isolated" : (chosenMode ?? current?.mode ?? "cross");
  return { leverage, mode, current, max };
}
