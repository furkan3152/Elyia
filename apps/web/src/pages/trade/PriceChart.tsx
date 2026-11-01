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
import { useCallback, useEffect, useRef, useState } from "react";

import { useResolvedTheme } from "../../app/state/useTheme";
import { CHART_INTERVALS, useTradeStore, type ChartInterval } from "../../features/trading/tradeStore";
import { formatPx, priceDecimals, type TradeMarket } from "../../lib/hypercore/marketCatalog";
import { hyperCoreSocket, infoClient } from "../../lib/hypercore/runtime";
import { useReducedMotion } from "../../motion/useReducedMotion";
import { Ely } from "../../pixel/Ely";
import { ElyLoader } from "../../pixel/ElyLoader";
import { cx, FOCUS_RING } from "../../ui/cx";
import { useChartLines, type ChartLine } from "./chartLines";
import { paintChartRopes } from "./chartRopes";
import { marketTitle } from "./labels";
import { Caption, Frame } from "./parts";
import { useTerminal } from "./terminalContext";

/**
 * Reads the theme's colour variables ("R G B" channel triplets) as rgba()
 * strings for the canvas chart. Local on purpose: the terminal must not depend
 * on the retired visuals; a missing variable reads as grey.
 */
function readTokens(element: Element | null = typeof document === "undefined" ? null : document.documentElement): (name: string, alpha?: number) => string {
  const style = element ? getComputedStyle(element) : null;
  const cache = new Map<string, string>();
  return (name, alpha = 1) => {
    let channels = cache.get(name);
    if (channels === undefined) {
      channels = style?.getPropertyValue(`--${name}`).trim() || "128 128 128";
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

/** Axis and crosshair labels: Silkscreen at its pixel size, so the glyphs land on whole pixels. */
const AXIS_FONT = '"Silkscreen", "IBM Plex Mono", ui-monospace, monospace';

export function PriceChart({ className }: { readonly className?: string }) {
  const { mode, market, now } = useTerminal();
  const reduced = useReducedMotion();
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const ropeLinesRef = useRef<readonly ChartLine[]>([]);
  const frameRef = useRef(0);
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

  // The rope overlay: pixel markers at the position's levels, repainted once per frame at most when the
  // chart scrolls, scales, resizes, gets a candle or its lines change (and once a second for a fraying rope).
  const pulseRef = useRef(0);
  /** The crevasse is off the visible price range: a chip at that edge says where it is. */
  const [offPane, setOffPane] = useState<"above" | "below" | null>(null);
  const paintOverlay = useCallback(() => {
    const canvas = overlayRef.current;
    const chart = chartRef.current;
    const candles = candleRef.current;
    const box = containerRef.current;
    if (!canvas || !chart || !candles || !box) return;
    const dpr = window.devicePixelRatio || 1;
    const paneW = chart.timeScale().width();
    const paneH = Math.max(0, box.clientHeight - chart.timeScale().height());
    const w = Math.max(1, Math.round(paneW * dpr));
    const h = Math.max(1, Math.round(paneH * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      canvas.style.width = `${w / dpr}px`;
      canvas.style.height = `${h / dpr}px`;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);
    const color = readTokens();
    const crevasse = ropeLinesRef.current.find((line) => line.rope === "crevasse");
    const crevasseY = crevasse ? candles.priceToCoordinate(crevasse.price) : null;
    const edge = crevasseY === null || crevasse === undefined ? null : crevasseY > paneH ? "below" : crevasseY < 0 ? "above" : null;
    setOffPane((previous) => (previous === edge ? previous : edge));
    const ropes = ropeLinesRef.current.flatMap((line) => {
      const y = candles.priceToCoordinate(line.price);
      return y === null || line.rope === undefined ? [] : [{ kind: line.rope, y: y * dpr, long: line.long, frays: line.frays }];
    });
    if (ropes.length === 0) return;
    paintChartRopes(ctx, {
      w,
      h,
      unit: Math.max(1, Math.round(2 * dpr)),
      ropes,
      palette: { ink: color("ink"), up: color("up"), accent: color("accent-line"), danger: color("down", 0.22) },
      seconds: pulseRef.current,
    });
  }, []);
  const schedulePaintRef = useRef<() => void>(() => undefined);
  useEffect(() => {
    schedulePaintRef.current = () => {
      if (frameRef.current) return;
      frameRef.current = window.requestAnimationFrame(() => {
        frameRef.current = 0;
        paintOverlay();
      });
    };
    return () => {
      window.cancelAnimationFrame(frameRef.current);
      frameRef.current = 0;
      schedulePaintRef.current = () => undefined;
    };
  }, [paintOverlay]);
  // The terminal's one-second clock: a fraying rope's loose strands shift (held still under reduced motion);
  // it also catches price-scale drags that fire no chart event.
  useEffect(() => {
    pulseRef.current = reduced ? 0 : Math.floor(now / 1000);
    schedulePaintRef.current();
  }, [now, reduced, theme]);

  useEffect(() => {
    marketRef.current = market;
  }, [market]);

  // Create the chart once.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    const chart = createChart(container, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, fontFamily: AXIS_FONT, fontSize: 10, attributionLogo: false },
      grid: { vertLines: { visible: false }, horzLines: { style: LineStyle.SparseDotted } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderVisible: true, scaleMargins: { top: 0.1, bottom: 0.2 }, minimumWidth: 72 },
      timeScale: { borderVisible: true, timeVisible: true, secondsVisible: false, rightOffset: 8, minBarSpacing: 2 },
      handleScale: { axisPressedMouseMove: true },
    });
    // Crisp 1 px candles: thin borders and wicks, whole-pixel bodies.
    const candles = chart.addSeries(CandlestickSeries, { borderVisible: true, wickVisible: true, priceLineStyle: LineStyle.Dotted, priceLineWidth: 1 });
    const volume = chart.addSeries(HistogramSeries, { priceScaleId: "", priceFormat: { type: "volume" }, lastValueVisible: false, priceLineVisible: false });
    volume.priceScale().applyOptions({ scaleMargins: { top: 0.86, bottom: 0 } });
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
    const repaint = () => schedulePaintRef.current();
    chart.subscribeClick(onClick);
    chart.subscribeCrosshairMove(onMove);
    chart.subscribeCrosshairMove(repaint);
    chart.timeScale().subscribeVisibleLogicalRangeChange(repaint);
    chart.timeScale().subscribeSizeChange(repaint);
    return () => {
      chart.unsubscribeClick(onClick);
      chart.unsubscribeCrosshairMove(onMove);
      chart.unsubscribeCrosshairMove(repaint);
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(repaint);
      chart.timeScale().unsubscribeSizeChange(repaint);
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      volumeRef.current = null;
      linesRef.current = [];
    };
  }, []);

  // Sheet colours (a canvas cannot read CSS variables): ink on paper by DAY, the headlamp palette by NIGHT.
  // Rising candles are hollow and falling ones filled, so direction never rests on colour alone.
  useEffect(() => {
    const chart = chartRef.current;
    const candles = candleRef.current;
    if (!chart || !candles) return;
    const color = readTokens();
    chart.applyOptions({
      layout: { textColor: color("ink-2") },
      grid: { horzLines: { color: color("contour", theme === "dark" ? 0.3 : 0.32) } },
      rightPriceScale: { borderColor: color("rule") },
      timeScale: { borderColor: color("rule") },
      crosshair: {
        vertLine: { color: color("ink", 0.55), width: 1, style: LineStyle.SparseDotted, labelBackgroundColor: color("ink") },
        horzLine: { color: color("ink", 0.55), width: 1, style: LineStyle.SparseDotted, labelBackgroundColor: color("ink") },
      },
    });
    candles.applyOptions({
      upColor: color("card"),
      downColor: color("down"),
      borderUpColor: color("up"),
      borderDownColor: color("down"),
      wickUpColor: color("up"),
      wickDownColor: color("down"),
      priceLineColor: color("ink", 0.6),
    });
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
    const up = color("up", 0.3);
    const down = color("down", 0.3);
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
        schedulePaintRef.current();
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
        schedulePaintRef.current();
      } catch {
        // An out-of-order bar: the next snapshot fixes it.
      }
    });
    return () => {
      cancelled = true;
      leave();
    };
    // The theme re-colours the volume bars on the next load.
  }, [mode, coin, interval, loadKey, theme]);

  // Price lines.
  useEffect(() => {
    const candles = candleRef.current;
    if (!candles) return;
    for (const line of linesRef.current) candles.removePriceLine(line);
    const color = readTokens();
    ropeLinesRef.current = lines.filter((line) => line.rope !== undefined);
    schedulePaintRef.current();
    linesRef.current = lines.map((line) =>
      candles.createPriceLine({
        price: line.price,
        // Rope levels are drawn in pixels on the overlay; the chart keeps their axis label and title.
        lineVisible: line.rope === undefined,
        color: color(line.tone, line.axis === false ? 0.4 : line.style === "dotted" ? 0.7 : 0.95),
        lineWidth: line.width ?? 1,
        lineStyle: line.style === "solid" ? LineStyle.Solid : line.style === "dashed" ? LineStyle.Dashed : LineStyle.Dotted,
        axisLabelVisible: line.axis !== false,
        title: line.title,
        axisLabelColor: color(line.tone),
        axisLabelTextColor: color(line.tone === "ink" || line.tone === "ink-2" ? "paper" : "card"),
      }),
    );
  }, [lines, theme]);

  const state = status.key === loadKey ? status.state : "loading";
  const intervals = (
    <div role="radiogroup" aria-label="Candle interval" className="flex items-center gap-1">
      {CHART_INTERVALS.map((option) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={option === interval}
          onClick={() => setPrefs({ interval: option })}
          className={cx(
            "h-6 min-w-[30px] px-1.5 font-tag text-[11px] uppercase transition-colors duration-fast",
            option === interval ? "px-btn px-btn-thin px-btn-accent text-accent-ink" : "text-ink-2 hover:bg-paper-2 hover:text-ink",
            FOCUS_RING,
          )}
        >
          {option}
        </button>
      ))}
    </div>
  );

  return (
    <Frame
      label={market ? `${marketTitle(market)} price chart` : "Price chart"}
      className={className}
      title={
        <span className="flex items-center gap-3">
          <Caption tone="ink" parts={["ELEVATION", marketTitle(market)]} className="hidden sm:inline" />
          {intervals}
        </span>
      }
      aside={
        <span className="tnum hidden min-w-0 items-center gap-3 font-mono text-[11px] text-ink-3 min-[1400px]:flex">
          {legend ? (
            <>
              <span>O <span className="text-ink">{formatPx(legend.open, market)}</span></span>
              <span>H <span className="text-ink">{formatPx(legend.high, market)}</span></span>
              <span>L <span className="text-ink">{formatPx(legend.low, market)}</span></span>
              <span>
                C <span className={legend.close >= legend.open ? "text-up" : "text-down"}>{formatPx(legend.close, market)} {legend.close >= legend.open ? "▲" : "▼"}</span>
              </span>
            </>
          ) : (
            <span className="font-tag uppercase">click · limit price</span>
          )}
        </span>
      }
    >
      <div className="relative min-h-0 flex-1">
        {/* The map label of the sheet: which ground this elevation is read on. */}
        <div aria-hidden="true" className="pointer-events-none absolute left-3 top-2 z-[2] flex flex-col bg-card/90 px-1.5 py-1 leading-tight">
          <span className="font-display text-[20px] font-bold leading-none text-floor">The Floor</span>
          <span className="mt-1 font-tag text-[10px] uppercase text-ink-3">HyperCore {mode} · {interval}</span>
        </div>
        <div ref={containerRef} className="absolute inset-0" aria-label={market ? `${market.displayName} ${interval} candles${ropeSummary(lines)}` : "Price chart"} role="img" />
        <canvas ref={overlayRef} aria-hidden="true" className="pixelated pointer-events-none absolute left-0 top-0 z-[1]" />
        {offPane && state === "ready" ? <CrevasseChip lines={lines} edge={offPane} market={market} /> : null}
        {state === "loading" ? (
          <div className="pointer-events-none absolute inset-0 z-[3] flex items-center justify-center">
            <ElyLoader label="Surveying the candles" size="md" />
          </div>
        ) : null}
        {state === "empty" || state === "error" ? (
          <div className="pointer-events-none absolute inset-0 z-[3] flex flex-col items-center justify-center gap-3 px-6 text-center">
            <Ely state={state === "empty" ? "sleep" : "worry"} size={66} label={null} />
            <p className="max-w-[300px] text-sm text-ink-2">{state === "empty" ? "No candles yet for this market on HyperCore." : "Candles did not load. Switch the interval to try again."}</p>
          </div>
        ) : null}
      </div>
    </Frame>
  );
}

/** "✕ crevasse 96.03 ▼ off the chart": the liquidation level is outside the visible range. */
function CrevasseChip({ lines, edge, market }: { readonly lines: readonly ChartLine[]; readonly edge: "above" | "below"; readonly market: TradeMarket | null }) {
  const crevasse = lines.find((line) => line.rope === "crevasse");
  if (!crevasse) return null;
  return (
    <span className={cx("px-frame-thin pointer-events-none absolute left-3 z-[2] inline-flex items-center gap-1.5 bg-card px-2 py-0.5 font-tag text-[10px] uppercase text-down", edge === "below" ? "bottom-10" : "top-16")}>
      <span aria-hidden="true">✕</span>
      crevasse {formatPx(crevasse.price, market)} {edge === "below" ? "▼ below" : "▲ above"} the view
    </span>
  );
}

/** The rope levels in words, for the chart's accessible name. */
function ropeSummary(lines: readonly ChartLine[]): string {
  const named = lines.filter((line) => line.rope === "crevasse" || line.rope === "anchor" || line.rope === "flag");
  if (named.length === 0) return "";
  return `; ${named.map((line) => `${line.rope === "crevasse" ? "liquidation" : line.rope === "anchor" ? "stop" : "take profit"} at ${line.price}`).join(", ")}`;
}
