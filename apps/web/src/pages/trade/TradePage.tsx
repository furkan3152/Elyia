import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { useAccount } from "wagmi";

import { mediaMatches, subscribeMedia } from "../../app/state/media";
import { useUiStore } from "../../app/state/uiStore";
import { routeHref } from "../../app/routes/routeTable";
import { navigate, useRouteParam, useSearchParam } from "../../app/routes/useRoute";
import { sessionId, signerFor, useAgentStore } from "../../features/agentKey/agentSession";
import { useAgentKey } from "../../features/agentKey/useAgentKey";
import { guardAccountFacts } from "../../features/trading/accountModel";
import { executePlan, type SubmitResult, type TradePlan } from "../../features/trading/executor";
import { applyOrderUpdates, parseOrderUpdates, settledPending } from "../../features/trading/reconcile";
import { effectiveRuleBook, type GuardContext } from "../../features/trading/guard";
import { feeRatesFrom } from "../../features/trading/ticketMath";
import { useTradeStore } from "../../features/trading/tradeStore";
import { useAccountFeeds } from "../../features/trading/useAccountFeeds";
import { useHip3Catalog, useLiveCtx, useMarketCatalog } from "../../features/trading/useMarketData";
import { useNow } from "../../hooks/useNow";
import { hyperCoreEndpoints } from "../../lib/hypercore/endpoints";
import { useHyperCoreEvents } from "../../lib/hypercore/feeds";
import { findMarket, formatPx, type TradeMarket } from "../../lib/hypercore/marketCatalog";
import { infoClient } from "../../lib/hypercore/runtime";
import { toast } from "../../ui/toast";
import { DesktopTerminal } from "./DesktopTerminal";
import { ascentClimbing, ascentOf, ropeAlarms } from "./pixelTerminal";
import "./terminal.css";
import { MobileTerminal } from "./MobileTerminal";
import { TerminalOverlays } from "./TerminalOverlays";
import { TerminalContext, type Terminal } from "./terminalContext";
import { useTerminalUi } from "./terminalUi";
import { useTradeHotkeys } from "./useTradeHotkeys";

const DEFAULT_MARKET = "BTC";
const DESKTOP_QUERY = "(min-width: 1180px)";
const ADDRESS = /^0x[0-9a-fA-F]{40}$/u;
let ascentCounter = 0;

const subscribeDesktop = (onChange: () => void) => subscribeMedia(DESKTOP_QUERY, onChange);
const desktopNow = () => mediaMatches(DESKTOP_QUERY) ?? true;

function useIsDesktop(): boolean {
  return useSyncExternalStore(subscribeDesktop, desktopNow, () => true);
}

function toastResult(result: SubmitResult, plan: TradePlan): void {
  if (result.ok) {
    const filled = result.outcomes.filter((outcome) => outcome.kind === "filled");
    const resting = result.outcomes.filter((outcome) => outcome.kind === "resting" || outcome.kind === "waiting");
    const running = result.outcomes.find((outcome) => outcome.kind === "running");
    const refused = result.outcomes.find((outcome) => outcome.kind === "error");
    const description =
      filled.length > 0
        ? filled.map((outcome) => (outcome.kind === "filled" ? `${outcome.totalSz} filled at ${outcome.avgPx}` : "")).join(" · ")
        : running
          ? "TWAP running: HyperCore slices it every 30 s."
          : resting.length > 0
            ? `${resting.length} order${resting.length > 1 ? "s" : ""} resting on the book.`
            : "Done.";
    const tail = refused && refused.kind === "error" ? ` · one leg refused: ${refused.error.message}` : "";
    toast.success(plan.label, { description: `${description}${tail}` });
    return;
  }
  if (result.kind === "confirm") return;
  if (result.kind === "blocked") toast.warning("Your Rule Book blocked this", { description: result.message });
  else toast.error(result.title, { description: result.message });
}

/** The HyperCore terminal at /app/trade/:market?. */
export default function TradePage() {
  const mode = useUiStore((state) => state.mode);
  const endpoints = hyperCoreEndpoints(mode);
  const slug = useRouteParam("market") ?? null;
  const asParam = useSearchParam("as");
  const viewAs = asParam && ADDRESS.test(asParam) ? asParam.toLowerCase() : null;
  const { address } = useAccount();
  const connected = address ? address.toLowerCase() : null;
  const readOnly = viewAs !== null && viewAs !== connected;
  const account = viewAs ?? connected;
  const now = useNow(1_000);
  const desktop = useIsDesktop();

  const catalog = useMarketCatalog(mode);
  const pickerOpen = useTerminalUi((state) => state.pickerOpen);
  const needsHip3 = useTerminalUi((state) => state.needsHip3);
  const wantsHip3 = (slug ?? "").includes(":") || pickerOpen || needsHip3;
  const hip3 = useHip3Catalog(mode, wantsHip3);
  const markets = useMemo(() => [...catalog.markets, ...hip3.markets], [catalog.markets, hip3.markets]);
  const marketByCoin = useMemo(() => new Map(markets.map((market) => [market.coin, market])), [markets]);
  const marketByAsset = useMemo(() => new Map(markets.map((market) => [market.asset, market])), [markets]);
  const market: TradeMarket | null = findMarket(markets, slug ?? DEFAULT_MARKET);

  // An unknown market in the URL falls back to the default once the catalogue is in.
  useEffect(() => {
    if (!slug || catalog.loading || hip3.loading || markets.length === 0) return;
    if (!findMarket(markets, slug)) navigate(`${routeHref("trade", { market: DEFAULT_MARKET })}${viewAs ? `?as=${viewAs}` : ""}`, { replace: true });
  }, [slug, catalog.loading, hip3.loading, markets, viewAs]);

  const ctx = useLiveCtx(mode, market);
  const mid = ctx?.midPx ?? ctx?.markPx ?? null;
  const feeds = useAccountFeeds(mode, account, market?.coin ?? null, market?.dex ?? "");
  const agent = useAgentKey(mode, connected, now);
  const holdsHip3 = (feeds.positions ?? []).some((row) => row.coin.includes(":")) || (feeds.openOrders ?? []).some((order) => order.coin.includes(":"));
  useEffect(() => {
    if (holdsHip3) useTerminalUi.getState().set({ needsHip3: true });
  }, [holdsHip3]);
  const unlocked = useAgentStore((state) => (connected ? state.sessions[sessionId(mode, connected)]?.phase === "ready" : false));
  const canSign = !readOnly && connected !== null && unlocked;

  const overrides = useTradeStore((state) => state.overrides);
  const rules = useMemo(() => effectiveRuleBook(overrides), [overrides]);
  const feesQuery = useQuery({
    queryKey: ["hypercore", mode, "userFees", account],
    queryFn: () => infoClient(mode).post<unknown>({ type: "userFees", user: account as string }),
    enabled: account !== null,
    staleTime: 5 * 60_000,
  });
  const isSpot = market?.isSpot ?? false;
  const fees = useMemo(() => feeRatesFrom(feesQuery.data ?? null, isSpot), [feesQuery.data, isSpot]);

  const accountFacts = useMemo(
    () => guardAccountFacts({ positions: feeds.positions, openOrders: feeds.openOrders, fills: feeds.fills, fillsComplete: (feeds.fills?.length ?? 0) < 2_000, now }),
    [feeds.positions, feeds.openOrders, feeds.fills, now],
  );
  const activeCoin = market?.coin ?? null;
  const guardBase: GuardContext | null = useMemo(() => {
    if (!connected || readOnly) return null;
    return {
      mode,
      networkKey: endpoints.networkKey,
      master: connected,
      marketByAsset: (asset) => marketByAsset.get(asset) ?? null,
      priceOf: (coin) => (coin === activeCoin ? mid : (marketByCoin.get(coin)?.ctx?.markPx ?? null)),
      leverageOf: (coin) => {
        if (feeds.assetData && feeds.assetData.coin === coin) return feeds.assetData.leverage.value;
        const position = feeds.positions?.find((row) => row.coin === coin);
        return position ? position.leverage : null;
      },
      trading: accountFacts.trading,
      dayUsdMicros: accountFacts.dayUsdMicros,
      weekUsdMicros: accountFacts.weekUsdMicros,
      now,
    };
  }, [connected, readOnly, mode, endpoints.networkKey, marketByAsset, marketByCoin, activeCoin, mid, feeds.assetData, feeds.positions, accountFacts, now]);

  const run = useCallback(
    async (plan: TradePlan, options: { readonly confirmed?: boolean } = {}): Promise<SubmitResult> => {
      if (readOnly || !connected || !guardBase) return { ok: false, kind: "blocked", message: "This terminal is read only.", evaluation: null };
      const store = useTradeStore.getState();
      // Ely climbs while the order flies, then says how it went (the review dialog takes over on "confirm").
      const ascentId = (ascentCounter += 1);
      useTerminalUi.getState().set({ ascent: ascentClimbing(ascentId, plan) });
      const result = await executePlan(
        {
          signer: signerFor(sessionId(mode, connected), endpoints.isMainnet),
          book: rules.book,
          guard: guardBase,
          exchangeUrl: endpoints.exchangeUrl,
          onPending: (rows) => store.addPending(rows),
          onSettled: (cloids, status) => (status === "drop" ? store.dropPending(cloids) : store.updatePending(cloids, status)),
        },
        plan,
        options,
      );
      toastResult(result, plan);
      if (useTerminalUi.getState().ascent?.id === ascentId) useTerminalUi.getState().set({ ascent: ascentOf(ascentId, plan, result) });
      return result;
    },
    [readOnly, connected, guardBase, mode, endpoints.isMainnet, endpoints.exchangeUrl, rules.book],
  );

  const request = useCallback(
    (plan: TradePlan) => {
      const ui = useTerminalUi.getState();
      if (readOnly) return;
      if (!canSign) {
        ui.set({ enableOpen: true });
        return;
      }
      if (useAgentStore.getState().oneClick) {
        void run(plan).then((result) => {
          if (!result.ok && result.kind === "confirm") ui.set({ review: { plan, reason: "confirm", message: result.message } });
        });
        return;
      }
      ui.set({ review: { plan, reason: "review" } });
    },
    [readOnly, canSign, run],
  );

  const terminal: Terminal = {
    mode,
    endpoints,
    markets,
    marketByCoin,
    market,
    catalogLoading: catalog.loading,
    catalogError: catalog.error,
    ctx,
    mid,
    feeds,
    connected,
    viewAs,
    readOnly,
    account,
    agent,
    canSign,
    rules,
    guardBase,
    fees,
    now,
    run,
    request,
  };

  // Reconcile optimistic rows from the feeds: orderUpdates move them on; the open-orders and fills feeds (or 20 s) retire them.
  const pending = useTradeStore((state) => state.pending);
  useEffect(() => {
    const done = settledPending(pending, { openOrders: feeds.openOrders, fills: feeds.fills }, now);
    if (done.length > 0) useTradeStore.getState().dropPending(done);
  }, [pending, feeds.openOrders, feeds.fills, now]);
  useHyperCoreEvents(mode, connected && !readOnly ? { type: "orderUpdates", user: connected } : null, (data) => {
    const store = useTradeStore.getState();
    const changes = applyOrderUpdates(store.pending, parseOrderUpdates(data));
    for (const change of changes.update) store.updatePending([change.cloid], change.status);
    if (changes.drop.length > 0) store.dropPending(changes.drop);
  });

  // The tab title reads like a ticker.
  const markPx = ctx?.markPx ?? null;
  useEffect(() => {
    if (!market || markPx === null) return;
    document.title = `${formatPx(markPx, market)} ${market.isSpot ? market.displayName : market.base} · Trade · Elyia`;
  }, [market, markPx]);

  useTradeHotkeys(terminal);

  // The rope alarm: a rope that slips under 10% to its crevasse sends one worried Ely over the radio.
  const underRef = useRef<ReadonlySet<string>>(new Set());
  const alarmAccount = useRef(account);
  useEffect(() => {
    if (alarmAccount.current !== account) {
      alarmAccount.current = account;
      underRef.current = new Set();
    }
    const readings = (feeds.positions ?? []).map((position) => ({ coin: position.coin, distance: position.liquidationDistance }));
    const { fresh, under } = ropeAlarms(readings, underRef.current);
    underRef.current = under;
    for (const reading of fresh) {
      const name = marketByCoin.get(reading.coin)?.base ?? reading.coin;
      toast.warning(`${name} rope under 10%`, {
        id: `rope-${reading.coin}`,
        from: "FLOOR",
        description: `${((reading.distance ?? 0) * 100).toFixed(1)}% to the crevasse (liquidation)${readOnly ? " on the account you are surveying" : ". Add margin, set an anchor or reduce it"}.`,
        action: {
          label: "Show the rope",
          onClick: () => {
            useTerminalUi.getState().set({ accountTab: "positions" });
            useTradeStore.getState().selectPosition(reading.coin);
          },
        },
      });
    }
  }, [feeds.positions, account, marketByCoin, readOnly]);

  return (
    <TerminalContext.Provider value={terminal}>
      <h1 className="sr-only">{market ? `Trade ${market.displayName}` : "Trade"}</h1>
      {desktop ? <DesktopTerminal /> : <MobileTerminal />}
      <TerminalOverlays />
    </TerminalContext.Provider>
  );
}
