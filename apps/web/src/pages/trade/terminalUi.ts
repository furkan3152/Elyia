/**
 * Which terminal overlay is open (market picker, review, agent panel, Rule
 * Book, flatten, TP/SL editor, the phone ticket sheet) and the phone's
 * chart/book/trades tab. Session only.
 */
import { create } from "zustand";

import type { TradePlan } from "../../features/trading/executor";

export type MobilePane = "chart" | "book" | "trades";
/** The desktop book column on a short window: book or tape (both stack when there is room). */
export type SidePane = "book" | "tape";
export type AccountTab = "positions" | "orders" | "twap" | "fills" | "funding" | "history";

export interface ReviewRequest {
  readonly plan: TradePlan;
  /** Why the review opened: the default review step, or a Rule Book "confirm". */
  readonly reason: "review" | "confirm";
  readonly message?: string;
}

interface TerminalUiState {
  readonly pickerOpen: boolean;
  readonly agentOpen: boolean;
  readonly enableOpen: boolean;
  readonly rulesOpen: boolean;
  readonly flattenOpen: boolean;
  readonly ticketOpen: boolean;
  readonly review: ReviewRequest | null;
  /** Coin of the position whose TP/SL is being edited. */
  readonly tpslCoin: string | null;
  /** Coin of the position to close (from F or a row). */
  readonly closeCoin: string | null;
  readonly mobilePane: MobilePane;
  readonly sidePane: SidePane;
  readonly accountTab: AccountTab;
  /** The followed account holds HIP-3 positions or orders: load the builder-dex catalogue. */
  readonly needsHip3: boolean;
  set(values: Partial<Omit<TerminalUiState, "set">>): void;
}

export const useTerminalUi = create<TerminalUiState>()((set) => ({
  pickerOpen: false,
  agentOpen: false,
  enableOpen: false,
  rulesOpen: false,
  flattenOpen: false,
  ticketOpen: false,
  review: null,
  tpslCoin: null,
  closeCoin: null,
  mobilePane: "chart",
  sidePane: "book",
  accountTab: "positions",
  needsHip3: false,
  set: (values) => set(values),
}));
