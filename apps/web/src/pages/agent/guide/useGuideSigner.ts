/**
 * Turns a Guide proposal (anchor, halve) into a HyperCore trade plan and
 * signs it with the in-browser trade-only key, through the same Rule Book
 * guard and executor as the terminal. It only runs on the user's click in
 * the review dialog; nothing signs on a timer.
 */
import type { NetworkEnvironment } from "@elyia/core/networks";
import { useCallback, useMemo } from "react";

import { sessionId, signerFor, useAgentStore } from "../../../features/agentKey/agentSession";
import { guardAccountFacts } from "../../../features/trading/accountModel";
import { evaluatePlan, executePlan, type SubmitResult, type TradePlan } from "../../../features/trading/executor";
import { effectiveRuleBook, type GuardContext } from "../../../features/trading/guard";
import { closePositionOrder, positionTpslOrder, TicketError } from "../../../features/trading/orderBuilders";
import { useTradeStore } from "../../../features/trading/tradeStore";
import type { AccountFeeds } from "../../../features/trading/useAccountFeeds";
import { useMarketCatalog } from "../../../features/trading/useMarketData";
import { hyperCoreEndpoints } from "../../../lib/hypercore/endpoints";
import { findMarket } from "../../../lib/hypercore/marketCatalog";
import type { Proposal } from "./planner";

export type SignAccess = "sample" | "watching" | "connect" | "enable" | "unlock" | "ready";

export interface BuiltProposal {
  readonly plan: TradePlan | null;
  /** Why it cannot be built (plain words). */
  readonly problem: string | null;
}

export interface GuideSigner {
  readonly access: SignAccess;
  /** Live hourly funding by perp coin, from the market catalogue. */
  readonly funding: Readonly<Record<string, number>>;
  build(proposal: Proposal): BuiltProposal;
  verdict(plan: TradePlan): ReturnType<typeof evaluatePlan> | null;
  sign(plan: TradePlan, confirmed: boolean): Promise<SubmitResult>;
}

export function useGuideSigner(input: { readonly mode: NetworkEnvironment; readonly connected: string | null; readonly followed: string | null; readonly sample: boolean; readonly feeds: AccountFeeds; readonly now: number }): GuideSigner {
  const { mode, connected, followed, sample, feeds, now } = input;
  const endpoints = hyperCoreEndpoints(mode);
  const catalog = useMarketCatalog(mode);
  const overrides = useTradeStore((state) => state.overrides);
  const slippageBps = useTradeStore((state) => state.slippageBps);
  const rules = useMemo(() => effectiveRuleBook(overrides), [overrides]);
  const phase = useAgentStore((state) => (connected ? state.sessions[sessionId(mode, connected)]?.phase : undefined));
  const own = connected !== null && followed !== null && followed.toLowerCase() === connected.toLowerCase();

  const access: SignAccess = sample ? "sample" : !connected ? "connect" : !own ? "watching" : phase === "ready" ? "ready" : phase === "locked" ? "unlock" : "enable";

  const byAsset = useMemo(() => new Map(catalog.markets.map((market) => [market.asset, market])), [catalog.markets]);
  const funding = useMemo(() => {
    const out: Record<string, number> = {};
    for (const market of catalog.markets) {
      if (market.kind === "perp" && typeof market.ctx?.funding === "number") out[market.coin] = market.ctx.funding;
    }
    return out;
  }, [catalog.markets]);

  const accountFacts = useMemo(
    () => guardAccountFacts({ positions: feeds.positions, openOrders: feeds.openOrders, fills: feeds.fills, fillsComplete: (feeds.fills?.length ?? 0) < 2_000, now }),
    [feeds.positions, feeds.openOrders, feeds.fills, now],
  );

  const guard: GuardContext | null = useMemo(() => {
    if (!connected || !own) return null;
    return {
      mode,
      networkKey: endpoints.networkKey,
      master: connected.toLowerCase(),
      marketByAsset: (asset) => byAsset.get(asset) ?? null,
      priceOf: (coin) => catalog.markets.find((market) => market.coin === coin)?.ctx?.markPx ?? null,
      leverageOf: (coin) => feeds.positions?.find((row) => row.coin === coin)?.leverage ?? null,
      trading: accountFacts.trading,
      dayUsdMicros: accountFacts.dayUsdMicros,
      weekUsdMicros: accountFacts.weekUsdMicros,
      now,
    };
  }, [connected, own, mode, endpoints.networkKey, byAsset, catalog.markets, feeds.positions, accountFacts, now]);

  const build = useCallback(
    (proposal: Proposal): BuiltProposal => {
      if (proposal.kind !== "anchor" && proposal.kind !== "halve") return { plan: null, problem: null };
      if (proposal.dex !== "") return { plan: null, problem: "Builder-dex ropes are signed from the terminal." };
      const market = findMarket(catalog.markets, proposal.coin);
      if (!market) return { plan: null, problem: catalog.loading ? "Loading the market list…" : `${proposal.coin} is not in the HyperCore market list.` };
      const szi = proposal.side === "long" ? proposal.size : -proposal.size;
      try {
        if (proposal.kind === "anchor") {
          const built = positionTpslOrder({ market, szi, reference: proposal.mark, tpsl: { sl: proposal.stop } });
          return { plan: { label: `Anchor ${proposal.coin} at ${proposal.stop} · reduce-only`, actions: [built.action], legs: built.legs, coin: market.coin }, problem: null };
        }
        const mid = market.ctx?.midPx ?? market.ctx?.markPx ?? proposal.mark;
        const fraction = proposal.fraction ?? 0.5;
        const built = closePositionOrder({ market, szi, mid, slippageBps, fraction });
        return { plan: { label: `${fraction === 1 ? "Close" : "Halve"} ${proposal.coin} · reduce-only at market`, actions: [built.action], legs: built.legs, coin: market.coin, marketSlippageBps: slippageBps }, problem: null };
      } catch (error) {
        return { plan: null, problem: error instanceof TicketError ? error.message : "That proposal could not be built." };
      }
    },
    [catalog.markets, catalog.loading, slippageBps],
  );

  const verdict = useCallback((plan: TradePlan) => (guard ? evaluatePlan(rules.book, guard, plan, now) : null), [guard, rules.book, now]);

  const sign = useCallback(
    async (plan: TradePlan, confirmed: boolean): Promise<SubmitResult> => {
      if (!guard || !connected) return { ok: false, kind: "blocked", message: "Connect the wallet that owns this range to sign.", evaluation: null };
      const store = useTradeStore.getState();
      return executePlan(
        {
          signer: signerFor(sessionId(mode, connected), endpoints.isMainnet),
          book: rules.book,
          guard,
          exchangeUrl: endpoints.exchangeUrl,
          onPending: (rows) => store.addPending(rows),
          onSettled: (cloids, status) => (status === "drop" ? store.dropPending(cloids) : store.updatePending(cloids, status)),
        },
        plan,
        { confirmed },
      );
    },
    [guard, connected, mode, endpoints.isMainnet, endpoints.exchangeUrl, rules.book],
  );

  return { access, funding, build, verdict, sign };
}
