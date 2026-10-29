/**
 * Candle range planning. Ranges are aligned to interval boundaries so that
 * repeated requests for "the last N candles" share one upstream call per
 * interval, and capped so one request never asks HyperCore for more than
 * MAX_CANDLES candles (candleSnapshot weighs 20 plus 1 per 60 candles).
 */
import type { CandleIntervalParam, CandleView } from "@elyia/core/api/markets";
import type { Candle } from "@elyia/core/hypercore/info";

export const CANDLE_INTERVAL_MS: Readonly<Record<CandleIntervalParam, number>> = Object.freeze({
  "1m": 60_000,
  "3m": 3 * 60_000,
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "30m": 30 * 60_000,
  "1h": 3_600_000,
  "2h": 2 * 3_600_000,
  "4h": 4 * 3_600_000,
  "8h": 8 * 3_600_000,
  "12h": 12 * 3_600_000,
  "1d": 86_400_000,
});

export const CANDLE_INTERVALS = Object.keys(CANDLE_INTERVAL_MS) as CandleIntervalParam[];
export const MAX_CANDLES = 1_500;
export const DEFAULT_CANDLES = 300;

export interface CandlePlan {
  /** Inclusive start sent upstream (aligned down to the interval). */
  readonly startTime: number;
  /** End sent upstream; undefined = "up to now" (an open range shares the cache entry). */
  readonly endTime: number | undefined;
  readonly from: number;
  readonly to: number;
  readonly truncated: boolean;
  /** Whether the whole range is in the past (its candles are final and can be cached longer). */
  readonly closed: boolean;
}

export function planCandles(input: { readonly interval: CandleIntervalParam; readonly from?: number; readonly to?: number; readonly limit?: number }, now: number): CandlePlan {
  const step = CANDLE_INTERVAL_MS[input.interval];
  // Without `from`, the last DEFAULT_CANDLES; with `from`, as many as one request may cover.
  const limit = Math.min(MAX_CANDLES, Math.max(1, input.limit ?? (input.from === undefined ? DEFAULT_CANDLES : MAX_CANDLES)));
  const open = input.to === undefined || input.to >= now;
  // Align the end up to the next boundary; an open range ends at the current candle.
  const to = open ? Math.floor(now / step) * step + step - 1 : Math.ceil((input.to as number) / step) * step - 1;
  const earliest = to + 1 - limit * step;
  const wanted = input.from === undefined ? earliest : Math.floor(input.from / step) * step;
  const startTime = Math.max(wanted, earliest);
  return {
    startTime,
    endTime: open ? undefined : to,
    from: startTime,
    to,
    truncated: input.from !== undefined && wanted < earliest,
    closed: !open,
  };
}

export function candleView(candle: Candle): CandleView {
  return { t: candle.t, T: candle.T, o: candle.o, h: candle.h, l: candle.l, c: candle.c, v: candle.v, n: candle.n };
}
