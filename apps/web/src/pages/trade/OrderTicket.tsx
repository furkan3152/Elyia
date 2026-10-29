import { ChevronDown } from "lucide-react";
import { useMemo, type ReactNode } from "react";

import type { Tif } from "@elyia/core/hypercore/actions";
import { evaluatePlan } from "../../features/trading/executor";
import { liquidationDistance } from "../../features/trading/liquidation";
import type { ScaleSkew } from "../../features/trading/scale";
import { dangerLeverage, formatRate, leverageTicks, presetAmount } from "../../features/trading/ticketMath";
import { planTicket } from "../../features/trading/ticketPlan";
import { SIZE_PRESETS, SLIPPAGE_CHOICES, useTradeStore, type OrderKind } from "../../features/trading/tradeStore";
import { formatPx, formatSz, type TradeMarket } from "../../lib/hypercore/marketCatalog";
import { Blaze } from "../../topo/Blaze";
import { Rope } from "../../topo/Rope";
import { GradeChip } from "../../ui/Badge";
import { Button } from "../../ui/Button";
import { cx, FOCUS_RING } from "../../ui/cx";
import { fieldBoxClasses } from "../../ui/fieldStyles";
import { sanitizeDecimalInput } from "../../ui/numberInput";
import { Popover } from "../../ui/Popover";
import { SegmentedControl } from "../../ui/SegmentedControl";
import { Slider } from "../../ui/Slider";
import { Toggle } from "../../ui/Toggle";
import { useAccess } from "./access";
import { GuardStrip } from "./GuardStrip";
import { marketTitle, usd } from "./labels";
import { Caption, KeyHint } from "./parts";
import { gradeOfLeverage, ticketGrade } from "./survey";
import { maxBaseFor, ticketLeverage } from "./sizing";
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
        <label htmlFor={htmlFor} className="caption !text-ink-2">
          {label}
        </label>
        {aside ? <span className="tnum font-mono text-[11px] text-ink-3">{aside}</span> : null}
      </div>
      <div className={fieldBoxClasses({ invalid })}>{children}</div>
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
      className="tnum h-full min-w-0 flex-1 bg-transparent font-mono text-[15px] text-ink outline-none placeholder:text-ink-3"
    />
  );
}

function SlippagePicker() {
  const slippage = useTradeStore((state) => state.slippageBps);
  const setPrefs = useTradeStore((state) => state.setPrefs);
  return (
    <Popover
      label="Market slippage"
      className="min-w-[220px]"
      trigger={(props) => (
        <button type="button" {...props} className={cx("inline-flex items-center gap-0.5 font-mono text-[11px] uppercase tracking-[0.08em] text-ink-2 hover:text-ink", FOCUS_RING)}>
          slip {(slippage / 100).toFixed(slippage < 100 ? 1 : 0)}%
          <ChevronDown className="h-3 w-3" aria-hidden="true" />
        </button>
      )}
    >
      {(close) => (
        <div className="flex flex-col gap-2">
          <p className="caption !text-ink">Market-order slippage</p>
          <div className="grid grid-cols-4 gap-1">
            {SLIPPAGE_CHOICES.map((choice) => (
              <button
                key={choice}
                type="button"
                onClick={() => {
                  setPrefs({ slippageBps: choice });
                  close();
                }}
                className={cx("h-8 border-1.5 font-mono text-xs", choice === slippage ? "border-rule bg-ink text-paper" : "border-rule/40 text-ink-2 hover:border-rule hover:text-ink", FOCUS_RING)}
              >
                {(choice / 100).toFixed(choice < 100 ? 1 : 0)}%
              </button>
            ))}
          </div>
          <p className="text-xs leading-relaxed text-ink-2">A market order is an IOC limit at mid ± this. It never fills worse; your Rule Book caps it.</p>
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

/** LONG ▲ / SHORT ▼: the two halves of the card's head. B and S switch them. */
function SideSwitch({ long, spot, onChange }: { readonly long: boolean; readonly spot: boolean; readonly onChange: (side: "buy" | "sell") => void }) {
  const sides = [
    { id: "buy" as const, label: spot ? "Buy" : "Long", glyph: "▲", key: "B", on: long },
    { id: "sell" as const, label: spot ? "Sell" : "Short", glyph: "▼", key: "S", on: !long },
  ];
  return (
    <div role="group" aria-label="Side (B / S)" className="grid grid-cols-2 border-2 border-rule">
      {sides.map((side) => (
        <button
          key={side.id}
          type="button"
          aria-pressed={side.on}
          onClick={() => onChange(side.id)}
          className={cx(
            "relative flex h-12 items-center justify-center gap-2 font-sans text-[15px] font-bold uppercase tracking-[0.08em] transition-colors duration-fast first:border-r-2 first:border-rule",
            side.on ? (side.id === "buy" ? "bg-up text-card" : "bg-down text-card") : side.id === "buy" ? "bg-card text-up hover:bg-up/10" : "bg-card text-down hover:bg-down/10",
            FOCUS_RING,
          )}
        >
          <span aria-hidden="true" className="text-[12px]">
            {side.glyph}
          </span>
          {side.label}
          <KeyHint k={side.key} className="absolute right-2 top-1/2 -translate-y-1/2" />
        </button>
      ))}
    </div>
  );
}

/** One ruled line of the card's log: what this order costs and where it breaks. */
function LogLine({ term, children, tone }: { readonly term: ReactNode; readonly children: ReactNode; readonly tone?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-dashed border-rule/25 py-1.5 last:border-b-0">
      <dt className="caption !text-[11px] !text-ink-3">{term}</dt>
      <dd className={cx("tnum text-right font-mono text-[12px] text-ink", tone)}>{children}</dd>
    </div>
  );
}

export function OrderTicket({ className, bare = false }: { readonly className?: string; readonly bare?: boolean }) {
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
    return <div className={cx("flex min-h-[420px] flex-col gap-3 border-2 border-rule bg-card p-4 shadow-hard-lg", className)} aria-busy="true" />;
  }

  const long = store.side === "buy";
  const preview = result?.preview;
  const error = result?.error ?? null;
  const danger = dangerLeverage(max);
  const entry = preview?.entryPx ?? px ?? null;
  const liqDistance = preview?.liquidation && entry ? liquidationDistance(entry, preview.liquidation) : null;
  const unitLabel = store.sizeUnit === "usd" ? (isSpot ? market.quote : "USDC") : market.base;
  const blocked = verdict?.decision === "deny";
  const canSubmit = access === "ready" && result?.plan !== null && result?.plan !== undefined && !error && !blocked;
  const grade = ticketGrade(isSpot, leverage);
  const showRope = !isSpot && !store.reduceOnly && store.kind !== "twap";

  const submit = () => {
    if (!canSubmit || !result?.plan) return;
    terminal.request(result.plan);
  };

  return (
    <form
      className={cx("flex flex-col bg-card", !bare && "border-2 border-rule shadow-hard-lg", className)}
      aria-label="Order ticket"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <header className={cx("flex items-center justify-between gap-2 border-b-2 border-rule py-2.5", bare ? "px-0" : "px-4")}>
        <Caption tone="ink" parts={["TICKET", marketTitle(market)]} />
        <GradeChip grade={grade} />
      </header>

      <div className={cx("flex flex-col gap-3.5 py-4", bare ? "px-0" : "px-4")}>
        <SideSwitch long={long} spot={isSpot} onChange={(side) => store.patch({ side })} />

        <div role="tablist" aria-label="Order type" className="flex items-center gap-4 border-b-1.5 border-rule/30">
          {KINDS.map((kind) => (
            <button
              key={kind.id}
              type="button"
              role="tab"
              aria-selected={store.kind === kind.id}
              onClick={() => store.patch({ kind: kind.id })}
              title={kind.key ? `${kind.label} (${kind.key})` : kind.label}
              className={cx(
                "-mb-[1.5px] border-b-[3px] pb-1.5 font-sans text-[12px] font-bold uppercase tracking-[0.08em] transition-colors duration-fast",
                store.kind === kind.id ? "border-accent-line text-ink" : "border-transparent text-ink-3 hover:text-ink",
                FOCUS_RING,
              )}
            >
              {kind.label}
            </button>
          ))}
          {store.kind === "market" ? (
            <span className="ml-auto pb-1.5">
              <SlippagePicker />
            </span>
          ) : null}
        </div>

        {store.kind === "limit" ? (
          <div className="flex flex-col gap-2">
            <Field label="Price" htmlFor="ticket-price" invalid={error?.field === "price"} aside={mid !== null ? `mid ${formatPx(mid, market)}` : undefined}>
              <DecimalInput id="ticket-price" value={store.price} onChange={(price) => store.patch({ price })} decimals={priceDecimals} />
              <button type="button" onClick={() => mid !== null && store.patch({ price: String(Number(mid.toPrecision(6))) })} className={cx("border-1.5 border-rule/40 px-1.5 py-0.5 font-mono text-[11px] uppercase text-summit-ink hover:border-rule", FOCUS_RING)}>
                mid
              </button>
            </Field>
            <SegmentedControl<Tif>
              label="Time in force"
              size="sm"
              fullWidth
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
            <Field label="From" htmlFor="scale-from" invalid={error?.field === "scale"}>
              <DecimalInput id="scale-from" value={store.scaleFrom} onChange={(scaleFrom) => store.patch({ scaleFrom })} decimals={priceDecimals} />
            </Field>
            <Field label="To" htmlFor="scale-to" invalid={error?.field === "scale"}>
              <DecimalInput id="scale-to" value={store.scaleTo} onChange={(scaleTo) => store.patch({ scaleTo })} decimals={priceDecimals} />
            </Field>
            <Field label="Orders" htmlFor="scale-count">
              <DecimalInput id="scale-count" value={store.scaleCount} onChange={(scaleCount) => store.patch({ scaleCount })} decimals={0} placeholder="5" />
            </Field>
            <div className="flex flex-col gap-1.5">
              <span className="caption !text-ink-2">Weight</span>
              <SegmentedControl<ScaleSkew>
                label="Distribution"
                size="sm"
                fullWidth
                value={store.scaleSkew}
                onChange={(scaleSkew) => store.patch({ scaleSkew })}
                className="h-10 items-stretch [&>button]:h-auto"
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
            <Field label="Duration" htmlFor="twap-minutes" invalid={error?.field === "twap"} aside="5 – 1440 min">
              <DecimalInput id="twap-minutes" value={store.twapMinutes} onChange={(twapMinutes) => store.patch({ twapMinutes })} decimals={0} placeholder="30" />
              <span className="font-mono text-xs text-ink-3">min</span>
            </Field>
            <Toggle size="sm" checked={store.twapRandomize} onChange={(twapRandomize) => store.patch({ twapRandomize })} label="Randomize" className="pb-2.5" />
          </div>
        ) : null}

        <div className="flex flex-col gap-2">
          <Field label={store.kind === "scale" ? "Total size" : "Size"} htmlFor="ticket-size" invalid={error?.field === "size"} aside={preview?.size && store.sizeUnit === "usd" ? `≈ ${formatSz(preview.size, market.szDecimals)} ${market.base}` : preview?.notional ? `≈ ${usd(preview.notional)}` : undefined}>
            <DecimalInput id="ticket-size" value={store.amount} onChange={(amount) => store.patch({ amount })} decimals={store.sizeUnit === "usd" ? 2 : market.szDecimals} />
            <button
              type="button"
              onClick={() => store.setPrefs({ sizeUnit: store.sizeUnit === "usd" ? "base" : "usd" })}
              className={cx("inline-flex items-center gap-1 border-1.5 border-rule/40 px-1.5 py-0.5 font-mono text-[11px] text-ink hover:border-rule", FOCUS_RING)}
              title="Switch between a USDC amount and a coin amount"
            >
              {unitLabel}
              <ChevronDown className="h-3 w-3" aria-hidden="true" />
            </button>
          </Field>
          <div className="grid grid-cols-5 gap-1.5" role="group" aria-label="Size presets (keys 1 to 5)">
            {SIZE_PRESETS.map((percent, index) => {
              const amount = maxBase !== null ? presetAmount({ percent, maxBase, unit: store.sizeUnit, px, szDecimals: market.szDecimals }) : null;
              const chosen = amount !== null && amount === store.amount;
              return (
                <button
                  key={percent}
                  type="button"
                  disabled={amount === null}
                  onClick={() => amount !== null && store.patch({ amount })}
                  title={`${percent === 100 ? "Max" : `${percent}%`} of what you can open (key ${index + 1})`}
                  className={cx(
                    "h-8 border-1.5 font-mono text-[11px] font-semibold transition-colors duration-fast disabled:opacity-40",
                    chosen ? "border-rule bg-ink text-paper" : "border-rule/35 bg-card text-ink-2 hover:border-rule hover:text-ink",
                    FOCUS_RING,
                  )}
                >
                  {percent === 100 ? "MAX" : `${percent}%`}
                </button>
              );
            })}
          </div>
        </div>

        {!isSpot ? (
          <div className="flex flex-col gap-2">
            <Slider
              label={`Leverage · ${mode}`}
              value={leverage}
              min={1}
              max={max}
              step={1}
              ticks={leverageTicks(max)}
              format={(value) => `${value}×`}
              dangerFrom={danger}
              gradeOf={gradeOfLeverage}
              aside={`${leverage}× · T${gradeOfLeverage(leverage)}`}
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
              {leverage >= danger ? <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-down">high for this market</span> : current && current.leverage !== leverage ? <span className="font-mono text-[11px] text-ink-3">now {current.leverage}× · will update</span> : null}
            </div>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <Toggle size="sm" checked={store.reduceOnly} onChange={(reduceOnly) => store.patch({ reduceOnly })} label="Reduce only" />
          {!isSpot && store.kind !== "twap" && store.kind !== "scale" ? <Toggle size="sm" checked={store.tpslOn} onChange={(tpslOn) => store.patch({ tpslOn })} label="Flag + anchor" /> : null}
        </div>

        {store.tpslOn && !isSpot && (store.kind === "market" || store.kind === "limit") ? (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="caption !text-ink-2">Set as</span>
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
              <label className={cx("flex flex-col gap-1 border-2 px-2.5 py-2", error?.field === "tp" ? "border-down" : "border-up")}>
                <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-up">⚑ Flag · TP</span>
                <span className="flex items-center gap-1">
                  <DecimalInput id="ticket-tp" label="Take profit" value={store.tp} onChange={(tp) => store.patch({ tp })} decimals={store.tpslUnit === "roe" ? 2 : priceDecimals} placeholder={store.tpslUnit === "roe" ? "10" : "price"} />
                  {store.tpslUnit === "roe" ? <span className="font-mono text-xs text-up">%</span> : null}
                </span>
                {preview?.tpPx ? <span className="tnum font-mono text-[11px] text-ink-2">at {formatPx(preview.tpPx, market)}</span> : null}
              </label>
              <label className={cx("flex flex-col gap-1 border-2 px-2.5 py-2", error?.field === "sl" ? "border-down" : "border-rule")}>
                <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-ink">⚓ Anchor · SL</span>
                <span className="flex items-center gap-1">
                  <DecimalInput id="ticket-sl" label="Stop loss" value={store.sl} onChange={(sl) => store.patch({ sl })} decimals={store.tpslUnit === "roe" ? 2 : priceDecimals} placeholder={store.tpslUnit === "roe" ? "5" : "price"} />
                  {store.tpslUnit === "roe" ? <span className="font-mono text-xs text-ink-2">%</span> : null}
                </span>
                {preview?.slPx ? <span className="tnum font-mono text-[11px] text-ink-2">at {formatPx(preview.slPx, market)}</span> : null}
              </label>
            </div>
          </div>
        ) : null}

        {showRope ? <RopePreview market={market} long={long} entry={entry} mark={mid} liquidation={preview?.liquidation ?? null} stop={store.tpslOn ? (preview?.slPx ?? null) : null} target={store.tpslOn ? (preview?.tpPx ?? null) : null} distance={liqDistance} sized={Boolean(preview?.notional)} waiting={store.amount && error ? error.message : null} /> : null}

        <dl className="flex flex-col">
          {!isSpot ? (
            <LogLine term="✕ Crevasse · liq" tone={liqDistance !== null && liqDistance < 0.1 ? "text-down" : undefined}>
              {preview?.liquidation ? `${formatPx(preview.liquidation, market)} · ${((liqDistance ?? 0) * 100).toFixed(1)}%` : store.reduceOnly ? "—" : preview?.notional ? "none at this margin" : "—"}
            </LogLine>
          ) : null}
          {store.kind === "scale" && preview?.entryPx ? (
            <LogLine term="Avg entry">
              {formatPx(preview.entryPx, market)} · {preview.legs.length} orders
            </LogLine>
          ) : null}
          <LogLine term={isSpot ? "Cost" : "Margin"}>{preview?.margin ? `${preview.margin.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 })} ${isSpot ? market.quote : "USDC"}` : "—"}</LogLine>
          <LogLine term="Hut fee">
            {preview?.fee ? `${usd(preview.fee)} · ` : ""}
            {formatRate(preview?.takes === false ? fees.maker : fees.taker)} {preview?.takes === false ? "maker" : "taker"}
          </LogLine>
        </dl>

        {error && store.amount ? (
          <p role="alert" className="-mt-1 border-l-[3px] border-down pl-2 text-[13px] leading-snug text-down">
            {error.message}
          </p>
        ) : null}

      </div>
      {/* The action stays in reach while the ticket scrolls: guard, the one button, the key. */}
      <div className={cx("sticky bottom-0 z-[2] flex flex-col gap-2.5 border-t-2 border-rule bg-card pb-4 pt-3", bare ? "px-0" : "px-4")}>
        {access === "ready" ? (
          <>
            <GuardStrip verdict={verdict} idle={result?.plan ? undefined : "Enter a size to see the verdict."} />
            <Button type="submit" variant={long ? "long" : "short"} size="xl" fullWidth disabled={!canSubmit} className="!text-[15px]">
              <span aria-hidden="true" className="text-[12px]">
                {long ? "▲" : "▼"}
              </span>
              <span className="truncate">{result?.buttonLabel ?? (long ? (isSpot ? "Buy" : "Long") : isSpot ? "Sell" : "Short")}</span>
              {verdict?.decision === "confirm" ? <span className="font-medium opacity-80">· review</span> : null}
              <span className="ml-1 inline-flex border-1.5 border-card/70 bg-card px-0.5 py-px">
                <Blaze grade={grade} size={12} label={null} />
              </span>
            </Button>
          </>
        ) : (
          <>
            <GuardStrip verdict={null} idle={access === "readOnly" ? "Read-only view: nothing is signed here." : "Connect and enable trading: every order is checked before the key signs."} />
            <AccessAction access={access} />
          </>
        )}
        {access !== "connect" && access !== "readOnly" ? <AgentBadge /> : null}
      </div>
    </form>
  );
}

/**
 * The rope before you sign: where the crevasse (liquidation) would open for
 * this exact order, drawn on the same pitch as an open position's rope.
 */
function RopePreview({ market, long, entry, mark, liquidation, stop, target, distance, sized, waiting }: { readonly market: TradeMarket; readonly long: boolean; readonly entry: number | null; readonly mark: number | null; readonly liquidation: number | null; readonly stop: number | null; readonly target: number | null; readonly distance: number | null; readonly sized: boolean; readonly waiting: string | null }) {
  const ready = sized && entry !== null && mark !== null;
  return (
    <figure className="border-2 border-dashed border-rule/45 bg-paper/60 px-3 pb-1 pt-2">
      <figcaption className="flex items-center justify-between gap-2">
        <span className="caption !text-[11px] !text-ink">Rope · preview</span>
        <span className={cx("tnum font-mono text-[11px] font-semibold", distance !== null && distance < 0.1 ? "text-down" : "text-ink-2")}>
          {ready ? (distance !== null ? `${(distance * 100).toFixed(distance < 0.1 ? 1 : 0)}% to the crevasse` : "no crevasse at this margin") : waiting ? "waiting" : "set a size"}
        </span>
      </figcaption>
      {ready ? (
        <>
          <Rope variant="compact" className="mt-1" side={long ? "long" : "short"} entry={entry} mark={mark} liquidation={liquidation} stop={stop} takeProfit={target} symbol={market.base} formatPrice={(price) => formatPx(price, market)} />
          <dl className="mt-1 grid grid-cols-3 border-t-1.5 border-rule/30">
            {[
              { glyph: "✕", name: "Crevasse", px: liquidation, tone: "text-down" },
              { glyph: "⚓", name: "Anchor", px: stop, tone: "text-ink" },
              { glyph: "⚑", name: "Flag", px: target, tone: "text-up" },
            ].map((cell) => {
              const move = cell.px !== null && mark ? (cell.px - mark) / mark : null;
              return (
                <div key={cell.name} className="flex flex-col gap-0.5 border-r border-dashed border-rule/30 px-1.5 py-1.5 first:pl-0 last:border-r-0">
                  <dt className={cx("font-mono text-[10px] font-semibold uppercase tracking-[0.1em]", cell.tone)}>
                    {cell.glyph} {cell.name}
                  </dt>
                  <dd className="tnum font-mono text-[12px] text-ink">{cell.px !== null ? formatPx(cell.px, market) : "—"}</dd>
                  <dd className="tnum font-mono text-[10px] text-ink-3">{move !== null ? `${move >= 0 ? "+" : "−"}${Math.abs(move * 100).toFixed(1)}%` : cell.name === "Crevasse" ? "none" : "not set"}</dd>
                </div>
              );
            })}
          </dl>
        </>
      ) : (
        <p className="py-3 text-[13px] leading-snug text-ink-2">{waiting ?? "Enter a size and the rope shows how far the mark can move against you before this position breaks, before anything is signed."}</p>
      )}
    </figure>
  );
}
