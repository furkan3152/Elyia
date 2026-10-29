import type { Candle } from "@elyia/core/hypercore/info";
import { roundPrice } from "@elyia/core/hypercore/wire";
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  createChart,
  HistogramSeries,
  LineStyle,
  type CandlestickData,
  type HistogramData,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type MouseEventParams,
  type UTCTimestamp,
} from "lightweight-charts";
import { useEffect, useRef, useState } from "react";

import { useResolvedTheme } from "../../app/state/useTheme";
import { CHART_INTERVALS, useTradeStore, type ChartInterval } from "../../features/trading/tradeStore";
import { formatPx, priceDecimals, type TradeMarket } from "../../lib/hypercore/marketCatalog";
import { hyperCoreSocket, infoClient } from "../../lib/hypercore/runtime";
import { cx, FOCUS_RING } from "../../ui/cx";
import { Skeleton } from "../../ui/Skeleton";
import { useChartLines } from "./chartLines";
import { useTerminal } from "./terminalContext";

/**
 * Reads the theme's colour variables ("R G B" channel triplets) as rgba()
 * strings for the canvas chart. Local on purpose: the terminal must not depend
 * on the retired visuals; a missing variable reads as white.
 */
function readTokens(element: Element | null = typeof document === "undefined" ? null : document.documentElement): (name: string, alpha?: number) => string {
  const style = element ? getComputedStyle(element) : null;
  const cache = new Map<string, string>();
  return (name, alpha = 1) => {
    let channels = cache.get(name);
    if (channels === undefined) {
      channels = style?.getPropertyValue(`--${name}`).trim() || "255 255 255";
      cache.set(name, channels);
    }
    const [r = "255", g = "255", b = "255"] = channels.split(/\s+/u);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  };
}

const INTERVAL_MS: Readonly<Record<ChartInterval, number>> = { "1m": 60_000, "5m": 300_000, "15m": 900_000, "1h": 3_600_000, "4h": 14_400_000, "1d": 86_400_000 };
const BARS = 420;

function toBar(candle: Candle): CandlestickData<UTCTimestamp> {
  return { time: Math.floor(candle.t / 1000) as UTCTimestamp, open: Number(candle.o), high: Number(candle.h), low: Number(candle.l), close: Number(candle.c) };
}

function toVolume(candle: Candle, up: string, down: string): HistogramData<UTCTimestamp> {
  return { time: Math.floor(candle.t / 1000) as UTCTimestamp, value: Number(candle.v), color: Number(candle.c) >= Number(candle.o) ? up : down };
}

interface Legend {
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
}

export function PriceChart({ className }: { readonly className?: string }) {
  const { mode, market } = useTerminal();
  const theme = useResolvedTheme();
  const interval = useTradeStore((state) => state.interval);
  const setPrefs = useTradeStore((state) => state.setPrefs);
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const linesRef = useRef<IPriceLine[]>([]);
  const lastTimeRef = useRef(0);
  const marketRef = useRef<TradeMarket | null>(market);
  const [status, setStatus] = useState<{ readonly key: string; readonly state: "loading" | "ready" | "empty" | "error" }>({ key: "", state: "loading" });
  const [legend, setLegend] = useState<Legend | null>(null);
  const lines = useChartLines(market);
  const coin = market?.coin ?? null;
  const loadKey = `${mode}|${coin}|${interval}`;

  useEffect(() => {
    marketRef.current = market;
  }, [market]);

  // Create the chart once.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    const chart = createChart(container, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, fontFamily: '"JetBrains Mono Variable", "JetBrains Mono", ui-monospace, monospace', fontSize: 11, attributionLogo: false },
      grid: { vertLines: { visible: false }, horzLines: { style: LineStyle.Solid } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.08, bottom: 0.22 } },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false, rightOffset: 6 },
      handleScale: { axisPressedMouseMove: true },
    });
    const candles = chart.addSeries(CandlestickSeries, { borderVisible: false, priceLineStyle: LineStyle.Solid });
    const volume = chart.addSeries(HistogramSeries, { priceScaleId: "", priceFormat: { type: "volume" }, lastValueVisible: false, priceLineVisible: false });
    volume.priceScale().applyOptions({ scaleMargins: { top: 0.84, bottom: 0 } });
    chartRef.current = chart;
    candleRef.current = candles;
    volumeRef.current = volume;

    const onClick = (param: MouseEventParams) => {
      const current = marketRef.current;
      if (!param.point || !current) return;
      const price = candles.coordinateToPrice(param.point.y);
      if (price === null || !(price > 0)) return;
      try {
        useTradeStore.getState().pickPrice(roundPrice(price.toPrecision(10), current.szDecimals, current.isSpot, "nearest"));
      } catch {
        // Outside the tick range: ignore the click.
      }
    };
    const onMove = (param: MouseEventParams) => {
      const bar = param.seriesData.get(candles) as CandlestickData | undefined;
      setLegend(bar && "open" in bar ? { open: bar.open, high: bar.high, low: bar.low, close: bar.close } : null);
    };
    chart.subscribeClick(onClick);
    chart.subscribeCrosshairMove(onMove);
    return () => {
      chart.unsubscribeClick(onClick);
      chart.unsubscribeCrosshairMove(onMove);
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      volumeRef.current = null;
      linesRef.current = [];
    };
  }, []);

  // Theme colours (canvas cannot read CSS variables).
  useEffect(() => {
    const chart = chartRef.current;
    const candles = candleRef.current;
    if (!chart || !candles) return;
    const color = readTokens();
    chart.applyOptions({
      layout: { textColor: color("text-2") },
      grid: { horzLines: { color: color("violet-glow", 0.07) } },
      crosshair: { vertLine: { color: color("violet-glow", 0.4), labelBackgroundColor: color("bg-2") }, horzLine: { color: color("violet-glow", 0.4), labelBackgroundColor: color("bg-2") } },
    });
    candles.applyOptions({ upColor: color("mint"), downColor: color("rose"), wickUpColor: color("mint", 0.8), wickDownColor: color("rose", 0.8) });
  }, [theme]);

  // Price precision per market.
  useEffect(() => {
    const candles = candleRef.current;
    const chart = chartRef.current;
    if (!candles || !chart || !market) return;
    const decimals = priceDecimals(market.ctx?.markPx ?? 1, market.szDecimals, market.isSpot);
    candles.applyOptions({ priceFormat: { type: "price", precision: decimals, minMove: 10 ** -decimals } });
    chart.applyOptions({ localization: { priceFormatter: (price: number) => formatPx(price, market) } });
  }, [market]);

  // Snapshot + live candles for (coin, interval).
  useEffect(() => {
    const candles = candleRef.current;
    const volume = volumeRef.current;
    if (!coin || !candles || !volume) return undefined;
    let cancelled = false;
    const color = readTokens();
    const up = color("mint", 0.28);
    const down = color("rose", 0.28);
    lastTimeRef.current = 0;
    candles.setData([]);
    volume.setData([]);
    const end = Date.now();
    infoClient(mode)
      .post<Candle[]>({ type: "candleSnapshot", req: { coin, interval, startTime: end - BARS * INTERVAL_MS[interval], endTime: end } })
      .then((data) => {
        if (cancelled) return;
        const rows = Array.isArray(data) ? [...data].sort((a, b) => a.t - b.t) : [];
        candles.setData(rows.map(toBar));
        volume.setData(rows.map((row) => toVolume(row, up, down)));
        lastTimeRef.current = rows.length > 0 ? Math.floor(rows[rows.length - 1]!.t / 1000) : 0;
        chartRef.current?.timeScale().scrollToRealTime();
        setStatus({ key: loadKey, state: rows.length > 0 ? "ready" : "empty" });
      })
      .catch(() => {
        if (!cancelled) setStatus({ key: loadKey, state: "error" });
      });
    const leave = hyperCoreSocket(mode).subscribe({ type: "candle", coin, interval }, (data) => {
      const candle = data as Candle;
      if (cancelled || !candle || candle.s !== coin || candle.i !== interval) return;
      const time = Math.floor(candle.t / 1000);
      if (lastTimeRef.current === 0 || time < lastTimeRef.current) return;
      try {
        candles.update(toBar(candle));
        volume.update(toVolume(candle, up, down));
        lastTimeRef.current = time;
      } catch {
        // An out-of-order bar: the next snapshot fixes it.
      }
    });
    return () => {
      cancelled = true;
      leave();
    };
  }, [mode, coin, interval, loadKey]);

  // Price lines.
  useEffect(() => {
    const candles = candleRef.current;
    if (!candles) return;
    for (const line of linesRef.current) candles.removePriceLine(line);
    const color = readTokens();
    linesRef.current = lines.map((line) =>
      candles.createPriceLine({
        price: line.price,
        color: color(line.tone, line.tone === "text-1" ? 0.6 : 0.9),
        lineWidth: 1,
        lineStyle: line.style === "solid" ? LineStyle.Solid : line.style === "dashed" ? LineStyle.Dashed : LineStyle.Dotted,
        axisLabelVisible: true,
        title: line.title,
        axisLabelColor: color(line.tone, 0.9),
        axisLabelTextColor: color("bg-0"),
      }),
    );
  }, [lines, theme]);

  const state = status.key === loadKey ? status.state : "loading";

  return (
    <div className={cx("relative flex min-h-0 flex-col", className)}>
      <div className="flex items-center gap-1 px-3 py-2">
        <div role="radiogroup" aria-label="Candle interval" className="flex items-center gap-0.5">
          {CHART_INTERVALS.map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={option === interval}
              onClick={() => setPrefs({ interval: option })}
              className={cx(
                "h-7 rounded-md px-2 font-mono text-xs transition-colors",
                option === interval ? "bg-bg-2 text-text-0" : "text-text-2 hover:text-text-0",
                FOCUS_RING,
              )}
            >
              {option}
            </button>
          ))}
        </div>
        <div className="tnum ml-3 hidden min-w-0 gap-3 truncate font-mono text-[11px] text-text-2 md:flex">
          {legend ? (
            <>
              <span>O <span className="text-text-1">{formatPx(legend.open, market)}</span></span>
              <span>H <span className="text-text-1">{formatPx(legend.high, market)}</span></span>
              <span>L <span className="text-text-1">{formatPx(legend.low, market)}</span></span>
              <span>C <span className={legend.close >= legend.open ? "text-mint" : "text-rose"}>{formatPx(legend.close, market)}</span></span>
            </>
          ) : null}
        </div>
        <span className="ml-auto hidden font-mono text-[11px] text-text-2 sm:inline">click the chart to set a limit price</span>
      </div>
      <div className="relative min-h-0 flex-1">
        <div ref={containerRef} className="absolute inset-0" aria-label={market ? `${market.displayName} ${interval} candles` : "Price chart"} role="img" />
        {state === "loading" ? (
          <div className="pointer-events-none absolute inset-0 flex items-end gap-1.5 px-6 pb-10 pt-12" aria-hidden="true">
            {Array.from({ length: 28 }, (_, index) => (
              <span key={index} className="flex flex-1 items-end" style={{ height: `${28 + ((index * 37) % 46)}%` }}>
                <Skeleton className="h-full w-full" />
              </span>
            ))}
          </div>
        ) : null}
        {state === "empty" || state === "error" ? (
          <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-text-2">
            {state === "empty" ? "No candles yet for this market on HyperCore." : "Candles did not load; retrying when you switch the interval."}
          </p>
        ) : null}
      </div>
    </div>
  );
}
