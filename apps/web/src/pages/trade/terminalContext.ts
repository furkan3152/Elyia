import type { NetworkEnvironment } from "@elyia/core/networks";
import type { RuleBook } from "@elyia/core/policy";
import { createContext, useContext } from "react";

import type { AgentKeyApi } from "../../features/agentKey/useAgentKey";
import type { SubmitResult, TradePlan } from "../../features/trading/executor";
import type { GuardContext } from "../../features/trading/guard";
import type { FeeRates } from "../../features/trading/ticketMath";
import type { AccountFeeds } from "../../features/trading/useAccountFeeds";
import type { HyperCoreEndpoints } from "../../lib/hypercore/endpoints";
import type { MarketCtx, TradeMarket } from "../../lib/hypercore/marketCatalog";

export interface Terminal {
  readonly mode: NetworkEnvironment;
  readonly endpoints: HyperCoreEndpoints;
  readonly markets: readonly TradeMarket[];
  readonly marketByCoin: ReadonlyMap<string, TradeMarket>;
  readonly market: TradeMarket | null;
  readonly catalogLoading: boolean;
  readonly catalogError: string | null;
  /** Live context of the active market. */
  readonly ctx: MarketCtx | null;
  /** Live mid (falls back to mark). */
  readonly mid: number | null;
  readonly feeds: AccountFeeds;
  /** The connected wallet. */
  readonly connected: string | null;
  /** ?as= address being viewed (read only unless it is the connected wallet). */
  readonly viewAs: string | null;
  readonly readOnly: boolean;
  /** The account the terminal follows. */
  readonly account: string | null;
  readonly agent: AgentKeyApi;
  /** The agent key is unlocked for the connected account and the terminal is not read only. */
  readonly canSign: boolean;
  readonly rules: { readonly book: RuleBook; readonly issues: readonly string[] };
  readonly guardBase: GuardContext | null;
  readonly fees: FeeRates;
  readonly now: number;
  /** Signs and sends a plan the user triggered (confirmed: they reviewed it). */
  run(plan: TradePlan, options?: { readonly confirmed?: boolean }): Promise<SubmitResult>;
  /** The user pressed a trade button: review first, or send at once in one-click mode. */
  request(plan: TradePlan): void;
}

export const TerminalContext = createContext<Terminal | null>(null);

export function useTerminal(): Terminal {
  const terminal = useContext(TerminalContext);
  if (!terminal) throw new Error("useTerminal must be used inside the trade terminal");
  return terminal;
}
