# Trading logic (HyperCore) for the web app

What the trade UI consumes. Everything here is logic. The look lives in the
TOPO kit, so a new terminal can be rebuilt on these modules without touching
signing, the guard or the feeds.

| Layer | Folder | What it holds |
|---|---|---|
| Transport | `src/lib/hypercore/` | info client, WebSocket, exchange client, market catalogue, feed reducers |
| Trading key | `src/features/agentKey/` | "Enable trading", encrypted vault, nonces, signer, lock / revoke / expiry |
| Trading | `src/features/trading/` | order builders, Rule Book guard, executor, account model, TOPO data |

Safety rules hold in every module:

- The wallet key never leaves the wallet.
- The agent key is never stored in plaintext. It is sent nowhere; only its signatures go to `api.hyperliquid(-testnet).xyz/exchange`.
- Every agent signature passes the guard first.
- Nothing signs on a timer.
- Nonces only increase.

---

## 1. Market data

```ts
import { useMarketCatalog, useHip3Catalog, useLiveCtx, useBook, useTrades } from "features/trading/useMarketData";

const { markets, loading, error } = useMarketCatalog(mode);   // first-dex perps + spot, refreshed
const hip3 = useHip3Catalog(mode, wantHip3);                  // HIP-3 builder dexes (heavy, on demand)
const market = findMarket([...markets, ...hip3.markets], "ETH"); // also "xyz:TSLA", "HYPE-USDC", "@1035"
const ctx = useLiveCtx(mode, market);    // MarketCtx: markPx, midPx, oraclePx, prevDayPx, funding (hourly), openInterest, dayNtlVlm
const book = useBook(mode, market.coin, grouping); // BookView: bids, asks, bestBid, bestAsk, mid, spread (server-side grouping)
const prints = useTrades(mode, market.coin);       // newest first, capped at 80
```

- **`TradeMarket`** (`lib/hypercore/marketCatalog.ts`) is core `MarketInfo` plus `kind` (`perp | hip3 | spot`), `dex`, `base`, `quote`, `slug`, `marginMode` and `ctx`.
- **Asset ids**:

  | Kind | Asset id |
  |---|---|
  | Perp | index in the first dex's universe |
  | Spot | `10000 + pair.index` |
  | HIP-3 | `100000 + dexIndex*10000 + i` |

  Tests pin these against testnet: BTC 3, ETH 4, HYPE 135 (isolated-only), HYPE spot 11035 and `test:ABC` 110000.
- **Formatting and figures**: `formatPx` / `formatSz` (the market's own precision), `bookGroupings(px, szDecimals, isSpot)`, `change24h`, `fundingApr`, `msToNextFunding`, `formatCountdown`, `openInterestUsd`.
- **Raw feeds**: `useHyperCoreFeed(mode, subscription, kind?)` reads any channel as a shared external store. `useHyperCoreEvents(mode, subscription, handler)` runs a handler on each message. `useSocketStatus(mode)` gives the connection state.
- **Channels**: `allMids`, `l2Book`, `trades`, `candle`, `activeAssetCtx` (spot answers on `activeSpotAssetCtx`), `activeAssetData`, `allDexsAssetCtxs`, `orderUpdates`, `userEvents` (channel `user`), `userFills`, `userFundings`, `webData3`, `clearinghouseState`, `allDexsClearinghouseState`, `openOrders`, `spotState`, `twapStates`, `userTwapHistory` and `userTwapSliceFills`. `webData2` is dead on the WebSocket.
- **Info client** (`infoClient(mode).post(body, {ttlMs, force, signal})`):
  - Caches per request type and shares identical in-flight requests.
  - Spends a token bucket by HyperCore weight: 800 of the 1200 per minute.
  - Retries a 429, 5xx or network failure once with backoff.
  - Explains failures in plain words (`InfoError.code`).
- **WebSocket** (`hyperCoreSocket(mode)`):
  - Keeps one connection per mode and refcounts subscriptions, unsubscribing after a 1.5 s grace (books leave at once).
  - Reconnects with jittered backoff and resubscribes.
  - Pings every 30 s and forces a reconnect after 65 s of silence.
  - Closes itself 20 s after the last subscriber leaves.

## 2. Account (the connected wallet, or `?as=0x…` in view-only mode)

```ts
const feeds = useAccountFeeds(mode, address, market.coin, market.dex);
// feeds.positions: PositionRow[] (every perp dex)   feeds.summary: AccountSummary
// feeds.openOrders: FrontendOpenOrder[]             feeds.spot, feeds.fills, feeds.fundings
// feeds.twaps, feeds.twapHistory, feeds.assetData (leverage, maxTradeSzs)
// feeds.ready: every feed the guard needs has arrived
```

- `null` means "not loaded yet", never zero.
- `guardAccountFacts({positions, openOrders, fills, fillsComplete, now})` turns the feeds into the Rule Book's facts: open orders, open notional, 24 h volume and realised loss.

## 3. TOPO data (Rope, Windsock, Weather, depth bars, Altimeter, Avalanche bulletin)

The pure functions are in `topo.ts` and the hooks in `useTopoData.ts`.

```ts
const ropes = usePositionRopes(mode, feeds);        // RopeView[]: one per position, marks from live allMids
// rope: side, size, entryPx, markPx, liquidationPx (HyperCore's own), tp / sl {px, oid, wholePosition}
//       distance (|mark-liq|/mark), band critical<5% | danger<10% | watch<25% | safe | unknown,
//       grade T2..T6 by leverage, toStop, toTarget, stopBeyondLiquidation,
//       layout {crevasse, anchor, entry, climber, flag in [0,1], from, to}: crevasse always left
const shocked = useShockedRopes(ropes, -0.2);       // or { HYPE: -0.2 }: markPx, distance, band, snaps, pnlChange
const { account, bulletin } = useAccountTopo(feeds); // equity, leverage, marginRatio, exposure, nearest rope; bulletin 1..5 + advice
const sock = useFundingWindsock(ctx, now);          // hourly, apr, payer "longs"|"shorts"|"none", stripes 0..5, countdown "41:12"
const { weather } = useVolatilityWeather(mode, coin); // clear | few-clouds | overcast | storm, volatility, percentile
const depth = useBookDepth(book, step, 12);         // grouped levels with cumSz, cumNtl, depth (0..1 on one scale), spreadBps, imbalance
```

Rules the drawings rely on:

- **TP/SL**: read from the open reduce-only trigger orders ("Take Profit …" or "Stop …"), taking the one nearest the mark.
- **Liquidation**: always the API's `liquidationPx`. `null` means no liquidation price, and the drawing then has no crevasse.
- **Shocks**: hold the liquidation price fixed. That is exact for isolated positions and an estimate for cross ones.
- **Rope blink**: the drawing may blink under 5% distance, at most 1 Hz.

## 4. Order builders (`orderBuilders.ts`, pure, on core `hypercore/actions` + `wire`)

```ts
marketOrder({ market, side: "buy", size: "0.5", mid, slippageBps: 100, tpsl?: { tp, sl }, reduceOnly?, builder? })
limitOrder({ market, side, size, price, tif: "Gtc" | "Alo" | "Ioc", reduceOnly?, tpsl? }) // TP/SL -> grouping normalTpsl
scaleOrder({ market, side, totalSize, from, to, count: 2..50, skew: "flat" | "front" | "back" })
twapOrder({ market, side, size, minutes: 5..1440, randomize, reduceOnly?, referencePx })
positionTpslOrder({ market, szi, reference, tpsl })            // grouping positionTpsl
modifyTpslPlan({ market, szi, reference, tpsl, openOrders })   // { place, cancel, replaced }: place new first, then cancel old
closePositionOrder({ market, szi, mid, slippageBps, fraction? }) // reduce-only IOC
flattenPlan({ orders, positions, slippageBps })                // { cancel, close (one reduce-only IOC batch), skipped }
leverageAction(market, leverage, isCross)    isolatedMarginAction(market, "25", "add" | "remove")
cancelOrders([{ asset, oid }])    cancelTwap(asset, twapId)
```

- Each builder returns a `BuiltOrder` `{ action, legs, notional, grouping }`. `legs` feed previews, chart lines and optimistic rows.
- Rounding always favours the user:
  - Sizes round down to the lot.
  - Buy limits round down and sell limits round up.
  - Market orders are IOC at mid ± slippage, rounded toward the mid.
  - Prices keep 5 significant figures and at most `6 − szDecimals` decimals (`8 − szDecimals` on spot).
- Failures throw a `TicketError` with a `field` and the fix in plain words.
- `ticketPlan.ts` turns the ticket state into `{ plan, preview, error, buttonLabel }`. The preview gives size, notional, margin, estimated liquidation, fee and the ladder average.
- Other helpers:
  - `ticketMath.ts`: `baseSize`, `presetAmount`, `priceForRoe`, `roeAt`, `marginRequired`, `feeRatesFrom`.
  - `liquidation.ts`: `estimateLiquidation`, the documented formula, for a position not opened yet.

## 5. Guard and executor

```ts
const { book } = effectiveRuleBook(overrides);         // DEFAULT_RULE_BOOK + the user's limits (validated by core)
const verdict = evaluatePlan(book, guardBase, plan, now); // { decision: allow | confirm | deny, reasons, passed }
guardLines(verdict.reasons)                             // strip lines, denies first
const result = await executePlan({ signer, book, guard: guardBase, exchangeUrl, onPending, onSettled }, plan, { confirmed });
// result: { ok: true, outcomes } | { ok: false, kind: "confirm" | "blocked" | "refused" | "error", message }
```

- `TradePlan = { label, actions: L1Action[], legs?, coin?, marketSlippageBps?, plannedLeverage? }`. Put leverage first, then the order.
- `executePlan` checks **every** action before signing **any**. It then signs and posts them in order, stopping at the first refusal.
- The facts come from the action itself plus the account feeds. An unknown fact denies: the guard fails closed.
- **The de-risk lane** (`derisk.ts`):
  - Cancels, `noop`, `scheduleCancel`, and orders, TWAPs or modifies whose every leg is reduce-only are **never blocked** by limits. That covers the kill switch, market list, slippage, size, open orders, unknown facts and the network opt-in.
  - Only the hard floor holds: the key may sign trading actions only, and dry-run mode signs nothing.
  - The lane reads the action, not caller-supplied facts. Reasons it set aside come back as `evaluation.waived`.
- Optimistic rows (`reconcile.ts`):
  - `executePlan` reports rows through `onPending` and `onSettled`.
  - `applyOrderUpdates(pending, parseOrderUpdates(data))` moves them on from the `orderUpdates` feed.
  - `settledPending(pending, {openOrders, fills}, now)` retires them once the real order or fill shows, or after 20 s.
- Exchange errors are explained by `explainExchangeError(raw)`: `NO_DEPOSIT`, `AGENT_UNKNOWN`, `MIN_NOTIONAL`, `TICK`, `MARGIN`, `REDUCE_ONLY`, `ALO_CROSS` and the rest, each with a title and the fix.

## 6. Signer and trading-key lifecycle (`features/agentKey`)

```ts
const agent = useAgentKey(mode, connectedAddress, now);
agent.session.phase   // unsupported | loading | none | locked | ready | expired | error
agent.health          // HyperCore's view (extraAgents): active | expired | missing
agent.agents          // named agents on the account, this device first
await agent.enable(30)  // 7 | 30 | 90 | 180 days
await agent.lock(); await agent.unlock(); await agent.revoke(); await agent.forget();
const signer = signerFor(sessionId(mode, address), isMainnet); // null while locked, absent or expired
```

- **Enable**:
  1. Generate a fresh key with `generatePrivateKey()`.
  2. Name it `elyia-web valid_until <ms>`, a named slot, so the user's Hyperliquid-app agent survives.
  3. The wallet signs `approveAgent` in the domain of **the chain it is connected to** (`signatureChainId` = the wallet's chain id). The flow refuses if the wallet switches chain mid-signature.
  4. POST to `/exchange` and wait for HyperCore to accept.
  5. Store the key encrypted.
  6. Verify with `extraAgents` (status `pending` until listed, then `active`).
- **Vault** (`vault.ts`):
  - Uses one AES-GCM-256 **non-extractable** wrapping key per browser profile, stored in IndexedDB.
  - Each record gets a fresh IV, with `env|master|agent` bound as AAD.
  - The decrypted key exists only in a module map, never in React state or storage.
- **Lock** forgets the key in memory. **Unlock** decrypts it again.
- **Revoke** approves a throwaway address under the same name; HyperCore deregisters the old key. The key is then deleted here.
- **Expiry**: past `valid_until` the session reads `expired`, `signerFor` returns `null` and `signAgentAction` throws `AgentExpiredError`.
- **Nonces** (`NonceManager`): `max(now, last + 1)` per signer, persisted, shared across tabs. A stored value more than 12 h ahead of the clock is ignored.
- **`signAgentAction(deps, action, {book, facts}, {confirmed})`** runs in this order:
  1. The action type must be agent-signable.
  2. The facts must describe this very action.
  3. `evaluatePolicy`, through the de-risk lane.
  4. The key must not be expired.
  5. Take a nonce, set `expiresAfter` (45 s), build the phantom-agent typed data (core) and sign locally.

## 7. Tests

`npm test -w @elyia/web`. Trading logic lives in `src/features/trading/__tests__/{trading,lifecycle,topo}.test.ts`, key logic in `src/features/agentKey/__tests__/agentKey.test.ts` (with an in-memory IndexedDB shim) and transport in `src/lib/hypercore/__tests__/hypercore.test.ts`.
