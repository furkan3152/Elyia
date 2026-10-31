import { useMemo, useState } from "react";

import type { PositionRow } from "../../features/trading/accountModel";
import { cancelOrders, closePositionOrder, flattenPlan, modifyTpslPlan, TicketError } from "../../features/trading/orderBuilders";
import { priceForRoe } from "../../features/trading/ticketMath";
import { useTradeStore } from "../../features/trading/tradeStore";
import { formatPx, formatSz, type TradeMarket } from "../../lib/hypercore/marketCatalog";
import { Button } from "../../ui/Button";
import { cx } from "../../ui/cx";
import { Dialog } from "../../ui/Dialog";
import { sanitizeDecimalInput } from "../../ui/numberInput";
import { SegmentedControl } from "../../ui/SegmentedControl";
import { HoldButton } from "./HoldButton";
import { signedUsd } from "./labels";
import { SideMark } from "./parts";
import { RowRope } from "./PositionsTable";
import { RappelScene, type RappelPhase } from "./RappelScene";
import { useTerminal } from "./terminalContext";
import { useTerminalUi } from "./terminalUi";

function markOf(position: PositionRow, market: TradeMarket | null, activeCoin: string | null, activeMark: number | null): number {
  return market && activeCoin === market.coin && activeMark ? activeMark : position.markPx;
}

/** Descend all (flatten): cancel every order, then close every position with reduce-only IOC orders. Hold to confirm. */
export function FlattenDialog() {
  const open = useTerminalUi((state) => state.flattenOpen);
  const close = () => useTerminalUi.getState().set({ flattenOpen: false });
  return (
    <Dialog open={open} onClose={close} title="Descend all" description="Cancel every open order first, then close every position at market, reduce-only. Hold to confirm." size="md">
      {open ? <FlattenBody onClose={close} /> : null}
    </Dialog>
  );
}

function FlattenBody({ onClose }: { readonly onClose: () => void }) {
  const { feeds, marketByCoin, market: active, ctx, run } = useTerminal();
  const slippageBps = useTradeStore((state) => state.slippageBps);
  const [state, setState] = useState<"idle" | "running" | "done">("idle");
  const [notes, setNotes] = useState<string[]>([]);
  const [hold, setHold] = useState(0);
  const positions = useMemo(() => feeds.positions ?? [], [feeds.positions]);
  const orders = useMemo(() => feeds.openOrders ?? [], [feeds.openOrders]);
  const plan = useMemo(
    () =>
      flattenPlan({
        orders: orders.flatMap((order) => {
          const market = marketByCoin.get(order.coin);
          return market ? [{ asset: market.asset, oid: order.oid }] : [];
        }),
        positions: positions.flatMap((position) => {
          const market = marketByCoin.get(position.coin);
          return market ? [{ market, szi: position.sziText, mid: markOf(position, market, active?.coin ?? null, ctx?.markPx ?? null) }] : [];
        }),
        slippageBps,
      }),
    [orders, positions, marketByCoin, active?.coin, ctx?.markPx, slippageBps],
  );
  const unknown = positions.filter((position) => !marketByCoin.has(position.coin)).map((position) => position.coin);

  const flatten = async () => {
    setState("running");
    const messages: string[] = [];
    if (plan.cancel) {
      const cancelled = await run({ label: `Cancel ${plan.cancel.cancels.length} order${plan.cancel.cancels.length === 1 ? "" : "s"}`, actions: [plan.cancel] });
      if (!cancelled.ok) messages.push(`Cancel: ${cancelled.message}`);
    }
    if (plan.close) {
      const closed = await run({ label: `Close ${plan.close.action.orders.length} position${plan.close.action.orders.length === 1 ? "" : "s"} at market`, actions: [plan.close.action], legs: plan.close.legs, marketSlippageBps: slippageBps }, { confirmed: true });
      if (!closed.ok) messages.push(`Close: ${closed.message}`);
    }
    for (const skipped of plan.skipped) messages.push(`${skipped.coin}: ${skipped.reason}`);
    setNotes(messages);
    setState("done");
    // A clean descent: Ely reaches base camp for a beat, then the dialog closes.
    if (messages.length === 0) window.setTimeout(onClose, 1_100);
  };

  const phase: RappelPhase = state === "running" ? "running" : state === "done" ? (notes.length > 0 ? "stuck" : "done") : hold > 0 ? "holding" : "ready";
  return (
    <div className="flex flex-col gap-4">
      <RappelScene phase={phase} progress={hold} />
      {positions.length > 0 ? (
        <ul className="px-frame-thin flex flex-col divide-y divide-dashed divide-rule/30 bg-card">
          {positions.map((position) => {
            const market = marketByCoin.get(position.coin) ?? null;
            return (
              <li key={position.coin} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 px-3 py-2 font-mono text-xs">
                <span>
                  <SideMark long={position.isLong} /> <span className="font-sans font-bold text-ink">{market?.base ?? position.coin}</span>{" "}
                  <span className="text-ink-3">{formatSz(Math.abs(position.szi), market?.szDecimals ?? 4)}</span>
                </span>
                <span className={position.unrealizedPnl >= 0 ? "text-up" : "text-down"}>{signedUsd(position.unrealizedPnl)}</span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-ink-2">No open positions.</p>
      )}
      <p className="text-sm text-ink-2">
        {orders.length > 0 ? `${orders.length} open order${orders.length === 1 ? "" : "s"} will be cancelled first, so nothing re-opens risk. ` : ""}
        Each close is an IOC at mark ± {(slippageBps / 100).toFixed(slippageBps < 100 ? 1 : 0)}%; it never fills worse. Your Rule Book never blocks closing.
      </p>
      {unknown.length > 0 ? <p className="text-xs text-warn-ink">Loading market data for {unknown.join(", ")}: those will be skipped this time.</p> : null}
      {notes.length > 0 ? (
        <ul role="alert" className="flex flex-col gap-1 border-l-4 border-warn bg-paper-2 px-3 py-2 text-xs text-warn-ink">
          {notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      ) : null}
      <HoldButton
        onConfirm={() => void flatten()}
        onProgress={(value) => {
          const step = Math.floor(value * 20) / 20;
          setHold((previous) => (previous === step ? previous : step));
        }}
        disabled={state === "running" || (!plan.cancel && !plan.close)}
      >
        {state === "running" ? "Descending…" : `Hold · descend ${positions.length} rope${positions.length === 1 ? "" : "s"}`}
      </HoldButton>
    </div>
  );
}

/** Close one position (from the row's Close or the F key). */
export function CloseDialog() {
  const coin = useTerminalUi((state) => state.closeCoin);
  const close = () => useTerminalUi.getState().set({ closeCoin: null });
  return (
    <Dialog open={coin !== null} onClose={close} title="Close position" size="sm">
      {coin ? <CloseBody coin={coin} onClose={close} /> : null}
    </Dialog>
  );
}

function CloseBody({ coin, onClose }: { readonly coin: string; readonly onClose: () => void }) {
  const { feeds, marketByCoin, market: active, ctx, run } = useTerminal();
  const slippageBps = useTradeStore((state) => state.slippageBps);
  const [fraction, setFraction] = useState<"1" | "0.5" | "0.25">("1");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const position = feeds.positions?.find((row) => row.coin === coin) ?? null;
  const market = marketByCoin.get(coin) ?? null;
  if (!position || !market) return <p className="text-sm text-ink-2">That position is already closed.</p>;
  const mark = markOf(position, market, active?.coin ?? null, ctx?.markPx ?? null);
  const submit = async () => {
    setError(null);
    let built: ReturnType<typeof closePositionOrder>;
    try {
      built = closePositionOrder({ market, szi: position.sziText, mid: mark, slippageBps, fraction: Number(fraction) });
    } catch (problem) {
      setError(problem instanceof TicketError ? problem.message : "This close cannot be built.");
      return;
    }
    setSending(true);
    const result = await run({ label: `Close ${fraction === "1" ? "" : `${Number(fraction) * 100}% of `}${market.base} ${position.isLong ? "long" : "short"}`, actions: [built.action], legs: built.legs, coin, marketSlippageBps: slippageBps }, { confirmed: true });
    setSending(false);
    if (result.ok) onClose();
    else setError(result.message);
  };
  return (
    <div className="flex flex-col gap-4">
      <div className="px-frame-thin bg-paper-2 p-3 font-mono text-xs">
        <p className="text-sm">
          <SideMark long={position.isLong} /> <span className="font-sans font-bold text-ink">{market.base}</span> {formatSz(Math.abs(position.szi), market.szDecimals)} · entry {formatPx(position.entryPx, market)}
        </p>
        <p className={cx("mt-1", position.unrealizedPnl >= 0 ? "text-up" : "text-down")}>{signedUsd(position.unrealizedPnl)} unrealized</p>
        <div className="mt-2">
          <RowRope rope={undefined} position={position} />
        </div>
      </div>
      <SegmentedControl<"1" | "0.5" | "0.25">
        label="How much to close"
        value={fraction}
        onChange={setFraction}
        fullWidth
        options={[
          { value: "0.25", label: "25%" },
          { value: "0.5", label: "50%" },
          { value: "1", label: "All" },
        ]}
      />
      <p className="text-xs text-ink-3">Reduce-only IOC at mark ± {(slippageBps / 100).toFixed(slippageBps < 100 ? 1 : 0)}%, signed in this browser.</p>
      {error ? <p role="alert" className="text-sm text-down">{error}</p> : null}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button variant={position.isLong ? "short" : "long"} loading={sending} onClick={() => void submit()} autoFocus>
          Close {fraction === "1" ? "all" : `${Number(fraction) * 100}%`} at market
        </Button>
      </div>
    </div>
  );
}

/** Set or change a position's TP/SL (positionTpsl triggers that follow the whole position). */
export function TpslDialog() {
  const coin = useTerminalUi((state) => state.tpslCoin);
  const close = () => useTerminalUi.getState().set({ tpslCoin: null });
  return (
    <Dialog open={coin !== null} onClose={close} title="Flag and anchor" description="TP and SL triggers that close the whole position, reduce-only, at market." size="sm">
      {coin ? <TpslBody coin={coin} onClose={close} /> : null}
    </Dialog>
  );
}

function TpslBody({ coin, onClose }: { readonly coin: string; readonly onClose: () => void }) {
  const { feeds, marketByCoin, run } = useTerminal();
  const position = feeds.positions?.find((row) => row.coin === coin) ?? null;
  const market = marketByCoin.get(coin) ?? null;
  const existing = (feeds.openOrders ?? []).filter((order) => order.coin === coin && order.isTrigger && order.reduceOnly);
  const currentTp = existing.find((order) => /take profit/iu.test(order.orderType));
  const currentSl = existing.find((order) => /stop/iu.test(order.orderType));
  const [unit, setUnit] = useState<"price" | "roe">("price");
  const [tp, setTp] = useState(currentTp ? currentTp.triggerPx : "");
  const [sl, setSl] = useState(currentSl ? currentSl.triggerPx : "");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!position || !market) return <p className="text-sm text-ink-2">That position is closed.</p>;
  const decimals = Math.max(0, (market.isSpot ? 8 : 6) - market.szDecimals);
  const toPrice = (value: string, kind: "tp" | "sl") => {
    if (!value) return null;
    if (unit === "price") return value;
    const px = priceForRoe({ entryPx: position.entryPx, isLong: position.isLong, roePct: Number(value), leverage: position.leverage, kind });
    return px === null ? null : String(Number(px.toPrecision(8)));
  };
  const tpPx = toPrice(tp, "tp");
  const slPx = toPrice(sl, "sl");
  const save = async () => {
    setError(null);
    let built: ReturnType<typeof modifyTpslPlan>["place"];
    try {
      built = modifyTpslPlan({ market, szi: position.sziText, reference: position.markPx, tpsl: { tp: tpPx, sl: slPx }, openOrders: existing }).place;
    } catch (problem) {
      setError(problem instanceof TicketError ? problem.message : "These triggers cannot be built.");
      return;
    }
    // The dialog's two fields are the whole truth: every old trigger goes (a cleared field removes its trigger).
    const cancel = cancelOrders(existing.map((order) => ({ asset: market.asset, oid: order.oid })));
    setSending(true);
    // Replace: place the new triggers first, then cancel the old ones, so the position is never unprotected.
    const result = await run({ label: `Set TP/SL on ${market.base}`, actions: cancel ? [built.action, cancel] : [built.action], legs: built.legs, coin }, { confirmed: true });
    setSending(false);
    if (result.ok) onClose();
    else setError(result.message);
  };
  const input = (value: string, set: (value: string) => void, label: string, tone: "mint" | "rose") => (
    <label className={cx("px-frame-thin flex flex-col gap-1 bg-card px-3 py-2", tone === "mint" && "px-tone-up")}>
      <span className="font-tag text-[10px] uppercase text-ink-2">{label}</span>
      <span className="flex items-center gap-1">
        <input
          value={value}
          inputMode="decimal"
          onChange={(event) => {
            const next = sanitizeDecimalInput(event.target.value, unit === "roe" ? 2 : decimals);
            if (next !== null) set(next);
          }}
          placeholder={unit === "roe" ? "%" : "price"}
          className="tnum min-w-0 flex-1 bg-transparent font-mono text-[15px] text-ink outline-none placeholder:text-ink-3"
        />
        {unit === "roe" ? <span className={cx("font-mono text-xs", tone === "mint" ? "text-up" : "text-down")}>% ROE</span> : null}
      </span>
    </label>
  );
  return (
    <div className="flex flex-col gap-4">
      <p className="font-mono text-xs text-ink-2">
        <SideMark long={position.isLong} /> {market.base} {formatSz(Math.abs(position.szi), market.szDecimals)} · entry {formatPx(position.entryPx, market)} · mark {formatPx(position.markPx, market)}
      </p>
      <SegmentedControl
        label="Unit"
        size="sm"
        value={unit}
        onChange={(next) => {
          setUnit(next);
          setTp("");
          setSl("");
        }}
        options={[
          { value: "price", label: "Price" },
          { value: "roe", label: "% ROE" },
        ]}
      />
      <div className="grid grid-cols-2 gap-2">
        {input(tp, setTp, "⚑ Flag · take profit", "mint")}
        {input(sl, setSl, "⚓ Anchor · stop loss", "rose")}
      </div>
      {unit === "roe" && (tpPx || slPx) ? (
        <p className="font-mono text-xs text-ink-3">
          {tpPx ? <span className="text-up">TP {formatPx(tpPx, market)}</span> : null}
          {tpPx && slPx ? " · " : null}
          {slPx ? <span className="text-down">SL {formatPx(slPx, market)}</span> : null}
        </p>
      ) : null}
      {existing.length > 0 ? <p className="text-xs text-ink-3">Replaces {existing.length} existing trigger{existing.length === 1 ? "" : "s"}.</p> : null}
      {error ? <p role="alert" className="text-sm text-down">{error}</p> : null}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" loading={sending} disabled={!tpPx && !slPx} onClick={() => void save()}>
          Sign & set
        </Button>
      </div>
    </div>
  );
}
