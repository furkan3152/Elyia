import { ChevronDown } from "lucide-react";
import { useMemo, type ReactNode } from "react";

import type { Tif } from "@elyia/core/hypercore/actions";
import { evaluatePlan } from "../../features/trading/executor";
import { distanceTone, liquidationDistance } from "../../features/trading/liquidation";
import type { ScaleSkew } from "../../features/trading/scale";
import { dangerLeverage, formatRate, leverageTicks, presetAmount } from "../../features/trading/ticketMath";
import { planTicket } from "../../features/trading/ticketPlan";
import { SIZE_PRESETS, SLIPPAGE_CHOICES, useTradeStore, type OrderKind } from "../../features/trading/tradeStore";
import { formatPx, formatSz, type TradeMarket } from "../../lib/hypercore/marketCatalog";
import { sanitizeDecimalInput } from "../../ui/numberInput";
import { Button } from "../../ui/Button";
import { cx, FOCUS_RING } from "../../ui/cx";
import { Popover } from "../../ui/Popover";
import { SegmentedControl } from "../../ui/SegmentedControl";
import { Slider } from "../../ui/Slider";
import { Toggle } from "../../ui/Toggle";
import { GuardStrip } from "./GuardStrip";
import { usd } from "./labels";
import { maxBaseFor, ticketLeverage } from "./sizing";
import { useAccess } from "./access";
import { AccessAction, AgentBadge } from "./TicketAccess";
import { useTerminal } from "./terminalContext";

const KINDS: readonly { readonly id: OrderKind; readonly label: string; readonly key: string }[] = [
  { id: "market", label: "Market", key: "M" },
  { id: "limit", label: "Limit", key: "L" },
  { id: "twap", label: "TWAP", key: "T" },
  { id: "scale", label: "Scale", key: "" },
];

function Field({ label, aside, children, invalid, htmlFor }: { readonly label: string; readonly aside?: ReactNode; readonly children: ReactNode; readonly invalid?: boolean; readonly htmlFor?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={htmlFor} className="text-xs text-text-2">
          {label}
        </label>
        {aside ? <span className="tnum font-mono text-[11px] text-text-2">{aside}</span> : null}
      </div>
      <div
        className={cx(
          "flex h-10 items-center gap-2 rounded-[10px] border bg-bg-1 px-3 transition-[border-color,box-shadow] focus-within:shadow-[0_0_0_3px_rgb(var(--violet)/0.16)]",
          invalid ? "border-rose/60" : "border-line-strong focus-within:border-violet-glow/70",
        )}
      >
        {children}
      </div>
    </div>
  );
}

function DecimalInput({ id, value, onChange, decimals, placeholder, label, autoFocus }: { readonly id: string; readonly value: string; readonly onChange: (value: string) => void; readonly decimals: number; readonly placeholder?: string; readonly label?: string; readonly autoFocus?: boolean }) {
  return (
    <input
      id={id}
      inputMode="decimal"
      autoComplete="off"
      spellCheck={false}
      autoFocus={autoFocus}
      aria-label={label}
      value={value}
      placeholder={placeholder ?? "0.00"}
      onChange={(event) => {
        const next = sanitizeDecimalInput(event.target.value, decimals);
        if (next !== null) onChange(next);
      }}
      className="tnum h-full min-w-0 flex-1 bg-transparent font-mono text-[15px] text-text-0 outline-none placeholder:text-text-2"
    />
  );
}

function SlippagePicker() {
  const slippage = useTradeStore((state) => state.slippageBps);
  const setPrefs = useTradeStore((state) => state.setPrefs);
  return (
    <Popover
      label="Market slippage"
      className="min-w-[200px]"
      trigger={(props) => (
        <button type="button" {...props} className={cx("inline-flex items-center gap-0.5 font-mono text-[11px] text-text-2 hover:text-text-0", FOCUS_RING)}>
          slippage {(slippage / 100).toFixed(slippage < 100 ? 1 : 0)}%
          <ChevronDown className="h-3 w-3" aria-hidden="true" />
        </button>
      )}
    >
      {(close) => (
        <div className="flex flex-col gap-2">
          <p className="label-caps">Market-order slippage</p>
          <div className="grid grid-cols-4 gap-1">
            {SLIPPAGE_CHOICES.map((choice) => (
              <button
                key={choice}
                type="button"
                onClick={() => {
                  setPrefs({ slippageBps: choice });
                  close();
                }}
                className={cx("h-8 rounded-md border font-mono text-xs", choice === slippage ? "border-violet-glow/60 bg-violet/20 text-text-0" : "border-line-strong text-text-1 hover:text-text-0", FOCUS_RING)}
              >
                {(choice / 100).toFixed(choice < 100 ? 1 : 0)}%
              </button>
            ))}
          </div>
          <p className="text-xs leading-relaxed text-text-2">A market order is an IOC limit at mid ± this. It never fills worse; your Rule Book caps it.</p>
        </div>
      )}
    </Popover>
  );
}

function useLeverage(market: TradeMarket | null) {
  const { feeds } = useTerminal();
  const chosen = useTradeStore((state) => (market ? state.leverage[market.coin] : undefined));
  const chosenMode = useTradeStore((state) => (market ? state.marginMode[market.coin] : undefined));
  return ticketLeverage(market, feeds, chosen, chosenMode);
}

export function OrderTicket({ className }: { readonly className?: string }) {
  const terminal = useTerminal();
  const { market, mid, feeds, fees, guardBase, rules, now } = terminal;
  const store = useTradeStore();
  const access = useAccess();
  const { leverage, mode, current, max } = useLeverage(market);
  const isSpot = market?.isSpot ?? false;
  const priceDecimals = market ? Math.max(0, (isSpot ? 8 : 6) - market.szDecimals) : 2;

  const result = useMemo(
    () =>
      market
        ? planTicket({
            market,
            side: store.side,
            kind: store.kind,
            tif: store.tif,
            amount: store.amount,
            sizeUnit: store.sizeUnit,
            price: store.price,
            leverage,
            marginMode: mode,
            current,
            reduceOnly: store.reduceOnly,
            tpslOn: store.tpslOn,
            tpslUnit: store.tpslUnit,
            tp: store.tp,
            sl: store.sl,
            twapMinutes: store.twapMinutes,
            twapRandomize: store.twapRandomize,
            scaleFrom: store.scaleFrom,
            scaleTo: store.scaleTo,
            scaleCount: store.scaleCount,
            scaleSkew: store.scaleSkew,
            mid,
            slippageBps: store.slippageBps,
            accountValue: feeds.summary?.crossAccountValue ?? null,
            otherMaintenance: feeds.summary?.maintenance ?? null,
            fees,
          })
        : null,
    [market, store.side, store.kind, store.tif, store.amount, store.sizeUnit, store.price, leverage, mode, current, store.reduceOnly, store.tpslOn, store.tpslUnit, store.tp, store.sl, store.twapMinutes, store.twapRandomize, store.scaleFrom, store.scaleTo, store.scaleCount, store.scaleSkew, mid, store.slippageBps, feeds.summary, fees],
  );
  // The live verdict for exactly what the button would sign (re-checked at signing time).
  const verdict = useMemo(() => (result?.plan && guardBase ? evaluatePlan(rules.book, guardBase, result.plan, now) : null), [result, guardBase, rules.book, now]);

  // Max size for the % presets.
  const px = store.kind === "limit" && Number(store.price) > 0 ? Number(store.price) : mid;
  const maxBase = maxBaseFor({ market, feeds, side: store.side, px, leverage });

  if (!market) {
    return <div className={cx("flex flex-col gap-3 p-4", className)} aria-busy="true" />;
  }

  const long = store.side === "buy";
  const sideTone = long ? "mint" : "rose";
  const preview = result?.preview;
  const error = result?.error ?? null;
  const danger = dangerLeverage(max);
  const liqDistance = preview?.liquidation && preview.entryPx ? liquidationDistance(preview.entryPx, preview.liquidation) : null;
  const unitLabel = store.sizeUnit === "usd" ? (isSpot ? market.quote : "USDC") : market.base;
  const blocked = verdict?.decision === "deny";
  const canSubmit = access === "ready" && result?.plan !== null && result?.plan !== undefined && !error && !blocked;

  const submit = () => {
    if (!canSubmit || !result?.plan) return;
    terminal.request(result.plan);
  };

  return (
    <form
      className={cx("flex flex-col gap-3", className)}
      aria-label="Order ticket"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <SegmentedControl
        label="Side"
        value={store.side}
        onChange={(side) => store.patch({ side })}
        fullWidth
        tone={sideTone}
        className="rounded-xl p-1 [&>button]:h-10 [&>button]:rounded-[9px] [&>button]:text-sm [&>button]:font-bold"
        options={[
          { value: "buy", label: isSpot ? "Buy" : "Long" },
          { value: "sell", label: isSpot ? "Sell" : "Short" },
        ]}
      />

      <div role="tablist" aria-label="Order type" className="flex items-center gap-4 border-b border-line text-[13px]">
        {KINDS.map((kind) => (
          <button
            key={kind.id}
            type="button"
            role="tab"
            aria-selected={store.kind === kind.id}
            onClick={() => store.patch({ kind: kind.id })}
            title={kind.key ? `${kind.label} (${kind.key})` : kind.label}
            className={cx("-mb-px border-b-2 pb-2 transition-colors", store.kind === kind.id ? "border-violet-glow text-text-0" : "border-transparent text-text-2 hover:text-text-1", FOCUS_RING)}
          >
            {kind.label}
          </button>
        ))}
        {store.kind === "market" ? (
          <span className="ml-auto pb-2">
            <SlippagePicker />
          </span>
        ) : null}
      </div>

      {store.kind === "limit" ? (
        <div className="flex flex-col gap-2">
          <Field label="Price" htmlFor="ticket-price" invalid={error?.field === "price"} aside={mid !== null ? `mid ${formatPx(mid, market)}` : undefined}>
            <DecimalInput id="ticket-price" value={store.price} onChange={(price) => store.patch({ price })} decimals={priceDecimals} />
            <button type="button" onClick={() => mid !== null && store.patch({ price: String(Number(mid.toPrecision(6))) })} className={cx("rounded-md px-1.5 py-0.5 font-mono text-xs text-violet-soft hover:bg-violet/15", FOCUS_RING)}>
              mid
            </button>
          </Field>
          <SegmentedControl<Tif>
            label="Time in force"
            size="sm"
            value={store.tif}
            onChange={(tif) => store.patch({ tif })}
            options={[
              { value: "Gtc", label: "GTC", hint: "Good till cancelled" },
              { value: "Alo", label: "Post-only", hint: "ALO: only rests on the book, never takes; earns the maker rate" },
              { value: "Ioc", label: "IOC", hint: "Immediate or cancel" },
            ]}
          />
        </div>
      ) : null}

      {store.kind === "scale" ? (
        <div className="grid grid-cols-2 gap-2">
          <Field label="From price" htmlFor="scale-from" invalid={error?.field === "scale"}>
            <DecimalInput id="scale-from" value={store.scaleFrom} onChange={(scaleFrom) => store.patch({ scaleFrom })} decimals={priceDecimals} />
          </Field>
          <Field label="To price" htmlFor="scale-to" invalid={error?.field === "scale"}>
            <DecimalInput id="scale-to" value={store.scaleTo} onChange={(scaleTo) => store.patch({ scaleTo })} decimals={priceDecimals} />
          </Field>
          <Field label="Orders" htmlFor="scale-count">
            <DecimalInput id="scale-count" value={store.scaleCount} onChange={(scaleCount) => store.patch({ scaleCount })} decimals={0} placeholder="5" />
          </Field>
          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-text-2">Distribution</span>
            <SegmentedControl<ScaleSkew>
              label="Distribution"
              size="sm"
              fullWidth
              value={store.scaleSkew}
              onChange={(scaleSkew) => store.patch({ scaleSkew })}
              className="h-11 items-center"
              options={[
                { value: "flat", label: "Flat" },
                { value: "front", label: "Front", hint: "More size at the first price" },
                { value: "back", label: "Back", hint: "More size at the last price" },
              ]}
            />
          </div>
        </div>
      ) : null}

      {store.kind === "twap" ? (
        <div className="grid grid-cols-[1fr_auto] items-end gap-3">
          <Field label="Duration (minutes)" htmlFor="twap-minutes" invalid={error?.field === "twap"} aside="5 – 1440">
            <DecimalInput id="twap-minutes" value={store.twapMinutes} onChange={(twapMinutes) => store.patch({ twapMinutes })} decimals={0} placeholder="30" />
            <span className="font-mono text-xs text-text-2">min</span>
          </Field>
          <Toggle size="sm" checked={store.twapRandomize} onChange={(twapRandomize) => store.patch({ twapRandomize })} label="Randomize" className="pb-3" />
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        <Field label={store.kind === "scale" ? "Total size" : "Size"} htmlFor="ticket-size" invalid={error?.field === "size"} aside={preview?.size && store.sizeUnit === "usd" ? `≈ ${formatSz(preview.size, market.szDecimals)} ${market.base}` : preview?.notional ? `≈ ${usd(preview.notional)}` : undefined}>
          <DecimalInput id="ticket-size" value={store.amount} onChange={(amount) => store.patch({ amount })} decimals={store.sizeUnit === "usd" ? 2 : market.szDecimals} />
          <button
            type="button"
            onClick={() => store.setPrefs({ sizeUnit: store.sizeUnit === "usd" ? "base" : "usd" })}
            className={cx("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-xs text-text-1 hover:bg-text-0/[0.06]", FOCUS_RING)}
            title="Switch between a USD amount and a coin amount"
          >
            {unitLabel}
            <ChevronDown className="h-3 w-3" aria-hidden="true" />
          </button>
        </Field>
        <div className="grid grid-cols-5 gap-1.5" role="group" aria-label="Size presets (1 to 5)">
          {SIZE_PRESETS.map((percent, index) => {
            const amount = maxBase !== null ? presetAmount({ percent, maxBase, unit: store.sizeUnit, px, szDecimals: market.szDecimals }) : null;
            return (
              <button
                key={percent}
                type="button"
                disabled={amount === null}
                onClick={() => amount !== null && store.patch({ amount })}
                title={`${percent === 100 ? "Max" : `${percent}%`} of what you can open (${index + 1})`}
                className={cx(
                  "h-8 rounded-lg border font-mono text-[11px] transition-colors disabled:opacity-40",
                  amount !== null && amount === store.amount ? "border-violet-glow/50 bg-violet/20 text-text-0" : "border-line bg-bg-2 text-text-1 hover:text-text-0",
                  FOCUS_RING,
                )}
              >
                {percent === 100 ? "Max" : `${percent}%`}
              </button>
            );
          })}
        </div>
      </div>

      {!isSpot ? (
        <div className="flex flex-col gap-2">
          <Slider
            label={<span className="text-xs font-normal text-text-2">Leverage · {mode}</span>}
            value={leverage}
            min={1}
            max={max}
            step={1}
            ticks={leverageTicks(max)}
            format={(value) => `${value}×`}
            dangerFrom={danger}
            aside={<span className={cx("text-sm", leverage >= danger ? "text-rose" : "text-gold")}>{leverage}×</span>}
            onChange={(value) => store.setLeverage(market.coin, value)}
          />
          <div className="flex items-center justify-between gap-2">
            <SegmentedControl<"cross" | "isolated">
              label="Margin mode"
              size="sm"
              value={mode}
              onChange={(value) => store.setMarginMode(market.coin, value)}
              options={[
                { value: "cross", label: "Cross", disabled: market.onlyIsolated, hint: market.onlyIsolated ? `${market.displayName} is isolated only` : "The whole account backs the position" },
                { value: "isolated", label: "Isolated", hint: "Only this position's margin is at risk" },
              ]}
            />
            {leverage >= danger ? <span className="font-mono text-[11px] text-rose">danger zone</span> : current && current.leverage !== leverage ? <span className="font-mono text-[11px] text-text-2">now {current.leverage}× · will update</span> : null}
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <Toggle size="sm" checked={store.reduceOnly} onChange={(reduceOnly) => store.patch({ reduceOnly })} label="Reduce only" />
        {!isSpot && store.kind !== "twap" && store.kind !== "scale" ? <Toggle size="sm" checked={store.tpslOn} onChange={(tpslOn) => store.patch({ tpslOn })} label="TP / SL" /> : null}
      </div>

      {store.tpslOn && !isSpot && (store.kind === "market" || store.kind === "limit") ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-text-2">Triggers as</span>
            <SegmentedControl
              label="TP/SL unit"
              size="sm"
              value={store.tpslUnit}
              onChange={(tpslUnit) => store.patch({ tpslUnit, tp: "", sl: "" })}
              options={[
                { value: "price", label: "Price" },
                { value: "roe", label: "% ROE" },
              ]}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className={cx("flex flex-col gap-0.5 rounded-[10px] border px-2.5 py-2", error?.field === "tp" ? "border-rose/60" : "border-mint/25 bg-mint/[0.06]")}>
              <span className="text-[11px] text-text-2">Take profit</span>
              <span className="flex items-center gap-1">
                <DecimalInput id="ticket-tp" label="Take profit" value={store.tp} onChange={(tp) => store.patch({ tp })} decimals={store.tpslUnit === "roe" ? 2 : priceDecimals} placeholder={store.tpslUnit === "roe" ? "10" : "price"} />
                {store.tpslUnit === "roe" ? <span className="font-mono text-xs text-mint">%</span> : null}
              </span>
              {preview?.tpPx ? <span className="tnum font-mono text-[11px] text-mint">{formatPx(preview.tpPx, market)}</span> : null}
            </label>
            <label className={cx("flex flex-col gap-0.5 rounded-[10px] border px-2.5 py-2", error?.field === "sl" ? "border-rose/60" : "border-rose/25 bg-rose/[0.06]")}>
              <span className="text-[11px] text-text-2">Stop loss</span>
              <span className="flex items-center gap-1">
                <DecimalInput id="ticket-sl" label="Stop loss" value={store.sl} onChange={(sl) => store.patch({ sl })} decimals={store.tpslUnit === "roe" ? 2 : priceDecimals} placeholder={store.tpslUnit === "roe" ? "5" : "price"} />
                {store.tpslUnit === "roe" ? <span className="font-mono text-xs text-rose">%</span> : null}
              </span>
              {preview?.slPx ? <span className="tnum font-mono text-[11px] text-rose">{formatPx(preview.slPx, market)}</span> : null}
            </label>
          </div>
        </div>
      ) : null}

      <dl className="flex flex-col gap-1.5 font-mono text-xs text-text-1">
        {!isSpot ? (
          <div className="flex justify-between gap-3">
            <dt className="text-text-2">est. liquidation</dt>
            <dd className={cx("tnum", liqDistance !== null ? (distanceTone(liqDistance) === "rose" ? "text-rose" : distanceTone(liqDistance) === "gold" ? "text-gold" : "text-text-1") : "")}>
              {preview?.liquidation ? `${formatPx(preview.liquidation, market)} (${preview.entryPx && preview.liquidation < preview.entryPx ? "−" : "+"}${((liqDistance ?? 0) * 100).toFixed(1)}%)` : store.reduceOnly ? "—" : preview?.notional ? "none at this margin" : "—"}
            </dd>
          </div>
        ) : null}
        {store.kind === "scale" && preview?.entryPx ? (
          <div className="flex justify-between gap-3">
            <dt className="text-text-2">avg entry</dt>
            <dd className="tnum">{formatPx(preview.entryPx, market)} · {preview.legs.length} orders</dd>
          </div>
        ) : null}
        <div className="flex justify-between gap-3">
          <dt className="text-text-2">{isSpot ? "cost" : "margin required"}</dt>
          <dd className="tnum">{preview?.margin ? `${preview.margin.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 })} ${isSpot ? market.quote : "USDC"}` : "—"}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-text-2">fees</dt>
          <dd className="tnum">
            {preview?.fee ? `${usd(preview.fee)} · ` : ""}
            {formatRate(preview?.takes === false ? fees.maker : fees.taker)} {preview?.takes === false ? "maker" : "taker"}
          </dd>
        </div>
      </dl>

      {error && store.amount ? <p className="-mt-1 text-xs text-rose">{error.message}</p> : null}

      {access === "ready" ? (
        <>
          <GuardStrip verdict={verdict} idle={result?.plan ? undefined : "Enter a size to see the verdict."} />
          <Button type="submit" variant={long ? "long" : "short"} size="xl" fullWidth disabled={!canSubmit} className="text-base font-extrabold">
            {result?.buttonLabel ?? (long ? "Long" : "Short")}
            {verdict?.decision === "confirm" ? <span className="font-medium opacity-80">· review</span> : null}
          </Button>
        </>
      ) : (
        <>
          <GuardStrip verdict={null} idle={access === "readOnly" ? "Read-only view: nothing is signed here." : "Connect and enable trading: every order is checked before the key signs."} />
          <AccessAction access={access} />
        </>
      )}
      {access !== "connect" && access !== "readOnly" ? <AgentBadge /> : null}
    </form>
  );
}
