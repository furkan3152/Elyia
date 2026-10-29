/**
 * Terminal state: the order ticket (session only), the user's terminal
 * preferences (favorites, chart interval, slippage, size unit, Rule Book
 * overrides; persisted on this device through the guarded storage adapter)
 * and optimistic rows for orders in flight (reconciled from the feeds).
 */
import type { Tif } from "@elyia/core/hypercore/actions";
import type { CandleInterval } from "@elyia/core/hypercore/info";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { safeLocalStorage } from "../../app/state/storage";
import type { GuardOverrides } from "./guard";
import type { Side } from "./orderBuilders";
import type { ScaleSkew } from "./scale";
import type { SizeUnit } from "./ticketMath";

export type OrderKind = "market" | "limit" | "twap" | "scale";
export type TpslUnit = "price" | "roe";
export type ChartInterval = Extract<CandleInterval, "1m" | "5m" | "15m" | "1h" | "4h" | "1d">;

export const CHART_INTERVALS: readonly ChartInterval[] = ["1m", "5m", "15m", "1h", "4h", "1d"];
export const SLIPPAGE_CHOICES: readonly number[] = [10, 50, 100, 300];
export const SIZE_PRESETS: readonly number[] = [10, 25, 50, 75, 100];

export interface TicketState {
  readonly side: Side;
  readonly kind: OrderKind;
  readonly tif: Tif;
  readonly amount: string;
  readonly price: string;
  /** Leverage chosen on the slider for a coin; absent = the account's current leverage. */
  readonly leverage: Readonly<Record<string, number>>;
  readonly marginMode: Readonly<Record<string, "cross" | "isolated">>;
  readonly reduceOnly: boolean;
  readonly tpslOn: boolean;
  readonly tpslUnit: TpslUnit;
  readonly tp: string;
  readonly sl: string;
  readonly twapMinutes: string;
  readonly twapRandomize: boolean;
  readonly scaleFrom: string;
  readonly scaleTo: string;
  readonly scaleCount: string;
  readonly scaleSkew: ScaleSkew;
  /** Bumps when something outside the ticket fills a field (chart or book click) so it can flash. */
  readonly priceNonce: number;
}

export interface PendingOrder {
  readonly cloid: string;
  readonly coin: string;
  readonly isBuy: boolean;
  readonly px: string;
  readonly sz: string;
  readonly label: string;
  readonly status: "signing" | "sent" | "resting" | "filled" | "failed";
  readonly at: number;
}

export interface TradePrefs {
  readonly favorites: readonly string[];
  readonly interval: ChartInterval;
  readonly slippageBps: number;
  readonly sizeUnit: SizeUnit;
  readonly overrides: GuardOverrides;
  /** Index into the book grouping options. */
  readonly bookGrouping: number;
}

const INITIAL_TICKET: TicketState = {
  side: "buy",
  kind: "limit",
  tif: "Gtc",
  amount: "",
  price: "",
  leverage: {},
  marginMode: {},
  reduceOnly: false,
  tpslOn: false,
  tpslUnit: "price",
  tp: "",
  sl: "",
  twapMinutes: "30",
  twapRandomize: true,
  scaleFrom: "",
  scaleTo: "",
  scaleCount: "5",
  scaleSkew: "flat",
  priceNonce: 0,
};

const DEFAULT_PREFS: TradePrefs = {
  favorites: ["BTC", "ETH", "HYPE"],
  interval: "15m",
  slippageBps: 100,
  sizeUnit: "usd",
  overrides: {},
  bookGrouping: 0,
};

export interface TradeStore extends TicketState, TradePrefs {
  readonly pending: readonly PendingOrder[];
  /** Coin of the position row the user selected (F closes it). */
  readonly selectedPosition: string | null;
  patch(values: Partial<TicketState>): void;
  /** A price picked on the chart or the book: switches a market ticket to limit. */
  pickPrice(price: string): void;
  setLeverage(coin: string, leverage: number): void;
  setMarginMode(coin: string, mode: "cross" | "isolated"): void;
  resetTicket(keep?: Partial<TicketState>): void;
  toggleFavorite(coin: string): void;
  setPrefs(values: Partial<TradePrefs>): void;
  setOverrides(overrides: GuardOverrides): void;
  addPending(rows: readonly PendingOrder[]): void;
  updatePending(cloids: readonly string[], status: PendingOrder["status"]): void;
  dropPending(cloids: readonly string[]): void;
  selectPosition(coin: string | null): void;
}

export const TRADE_STORAGE_KEY = "elyia.trade";

function sanitizePrefs(value: unknown): Partial<TradePrefs> {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const out: { -readonly [K in keyof TradePrefs]?: TradePrefs[K] } = {};
  if (Array.isArray(record.favorites)) out.favorites = record.favorites.filter((entry): entry is string => typeof entry === "string" && entry.length <= 40).slice(0, 60);
  if (typeof record.interval === "string" && (CHART_INTERVALS as readonly string[]).includes(record.interval)) out.interval = record.interval as ChartInterval;
  if (typeof record.slippageBps === "number" && Number.isInteger(record.slippageBps) && record.slippageBps >= 1 && record.slippageBps <= 1_000) out.slippageBps = record.slippageBps;
  if (record.sizeUnit === "base" || record.sizeUnit === "usd") out.sizeUnit = record.sizeUnit;
  if (record.overrides && typeof record.overrides === "object") out.overrides = record.overrides as GuardOverrides;
  if (typeof record.bookGrouping === "number" && Number.isInteger(record.bookGrouping) && record.bookGrouping >= 0 && record.bookGrouping < 8) out.bookGrouping = record.bookGrouping;
  return out;
}

export const useTradeStore = create<TradeStore>()(
  persist(
    (set, get) => ({
      ...INITIAL_TICKET,
      ...DEFAULT_PREFS,
      pending: [],
      selectedPosition: null,
      patch: (values) => set(values),
      pickPrice: (price) => {
        const state = get();
        set({ price, kind: state.kind === "market" || state.kind === "twap" ? "limit" : state.kind, priceNonce: state.priceNonce + 1 });
      },
      setLeverage: (coin, leverage) => set((state) => ({ leverage: { ...state.leverage, [coin]: leverage } })),
      setMarginMode: (coin, mode) => set((state) => ({ marginMode: { ...state.marginMode, [coin]: mode } })),
      resetTicket: (keep = {}) => {
        const state = get();
        set({ amount: "", price: "", tp: "", sl: "", scaleFrom: "", scaleTo: "", reduceOnly: false, ...keep, leverage: state.leverage, marginMode: state.marginMode });
      },
      toggleFavorite: (coin) =>
        set((state) => ({ favorites: state.favorites.includes(coin) ? state.favorites.filter((entry) => entry !== coin) : [...state.favorites, coin] })),
      setPrefs: (values) => set(values),
      setOverrides: (overrides) => set({ overrides }),
      addPending: (rows) => set((state) => ({ pending: [...rows, ...state.pending].slice(0, 40) })),
      updatePending: (cloids, status) => set((state) => ({ pending: state.pending.map((row) => (cloids.includes(row.cloid) ? { ...row, status } : row)) })),
      dropPending: (cloids) => set((state) => ({ pending: state.pending.filter((row) => !cloids.includes(row.cloid)) })),
      selectPosition: (selectedPosition) => set({ selectedPosition }),
    }),
    {
      name: TRADE_STORAGE_KEY,
      version: 1,
      storage: createJSONStorage(() => safeLocalStorage),
      partialize: (state): TradePrefs => ({
        favorites: state.favorites,
        interval: state.interval,
        slippageBps: state.slippageBps,
        sizeUnit: state.sizeUnit,
        overrides: state.overrides,
        bookGrouping: state.bookGrouping,
      }),
      merge: (persisted, current) => ({ ...current, ...sanitizePrefs(persisted) }),
    },
  ),
);
