import { useMemo, useState } from "react";

import { PixelGlyph } from "../../../pixel/PixelGlyph";
import { Button } from "../../../ui/Button";
import { cx, FOCUS_RING } from "../../../ui/cx";
import { sanitizeDecimalInput } from "../../../ui/numberInput";
import { evaluateRule, KIND_LABEL, newRuleId, parseRuleSentence, type AlertKind, type AlertRule, type Direction, type RuleReadings } from "../model/rules";
import { GLYPHS } from "../model/glyphs";
import { TrailGauge } from "./TrailGauge";

const KINDS: readonly { readonly kind: AlertKind; readonly hint: string }[] = [
  { kind: "price", hint: "a mark crosses a level" },
  { kind: "funding", hint: "the wind changes side" },
  { kind: "rope", hint: "a rope nears its crevasse" },
  { kind: "fill", hint: "an order fills" },
  { kind: "bridge", hint: "an ascent or descent lands" },
];

interface Draft {
  readonly kind: AlertKind;
  readonly coin: string;
  readonly direction: Direction;
  readonly value: string;
  readonly app: boolean;
  readonly telegram: boolean;
  readonly once: boolean;
}

const SLOT = "inline-flex h-11 items-center bg-card px-3 font-display text-[20px] font-bold text-ink px-frame px-drop sm:h-14 sm:text-[26px]";

function Slot({ label, value, onChange, options }: { readonly label: string; readonly value: string; readonly onChange: (value: string) => void; readonly options: readonly { readonly value: string; readonly label: string }[] }) {
  return (
    <label className="relative inline-flex">
      <span className="sr-only">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} className={cx(SLOT, "cursor-pointer appearance-none pr-8", FOCUS_RING)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <span aria-hidden="true" className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 font-tag text-[11px] text-ink-3">
        ▼
      </span>
    </label>
  );
}

function NumberSlot({ label, value, onChange, prefix, suffix, placeholder = "0" }: { readonly label: string; readonly value: string; readonly onChange: (value: string) => void; readonly prefix?: string; readonly suffix?: string; readonly placeholder?: string }) {
  return (
    <label className={cx(SLOT, "gap-1 focus-within:outline-dashed focus-within:outline-4 focus-within:outline-offset-[8px] focus-within:outline-signal")}>
      <span className="sr-only">{label}</span>
      {prefix ? <span className="text-ink-3">{prefix}</span> : null}
      <input
        inputMode="decimal"
        value={value}
        onChange={(event) => {
          const raw = event.target.value.replace(/^−/u, "-");
          const negative = raw.startsWith("-");
          const next = sanitizeDecimalInput(negative ? raw.slice(1) : raw, 6);
          if (next !== null) onChange(negative ? `-${next}` : next);
        }}
        placeholder={placeholder}
        className="tnum w-[7.5ch] bg-transparent text-right outline-none placeholder:text-ink-3"
      />
      {suffix ? <span className="font-tag text-[11px] uppercase text-ink-3 sm:text-[13px]">{suffix}</span> : null}
    </label>
  );
}

function thresholdOf(draft: Draft): number | null {
  if (draft.kind === "fill" || draft.kind === "bridge") return null;
  const value = Number(draft.value);
  if (!Number.isFinite(value) || draft.value.trim() === "" || draft.value === "-") return null;
  if (draft.kind === "price") return value > 0 ? value : null;
  if (draft.kind === "funding") return value / 100;
  return value > 0 && value < 100 ? value / 100 : null;
}

export interface RuleBuilderProps {
  readonly coins: readonly string[];
  readonly ropeCoins: readonly string[];
  readonly readings: RuleReadings;
  readonly telegramLinked: boolean;
  readonly priceWord: string;
  readonly onCreate: (rule: AlertRule) => void;
}

/**
 * The rule builder: one sentence with slots you change ("Tell me when ETH
 * price goes above $3,400"), the live reading against your line, where to
 * deliver it, and one button. Or type the sentence and the slots fill in.
 */
export function RuleBuilder({ coins, ropeCoins, readings, telegramLinked, priceWord, onCreate }: RuleBuilderProps) {
  const [draft, setDraft] = useState<Draft>({ kind: "price", coin: coins[0] ?? "BTC", direction: "above", value: "", app: true, telegram: false, once: false });
  const [typed, setTyped] = useState("");
  const [heard, setHeard] = useState<string | null>(null);
  const patch = (values: Partial<Draft>) => setDraft((previous) => ({ ...previous, ...values }));
  const coinOptions = draft.kind === "rope" || draft.kind === "fill" ? [{ value: "ANY", label: draft.kind === "rope" ? "any rope" : "any order" }, ...(draft.kind === "rope" ? ropeCoins : coins).map((entry) => ({ value: entry, label: draft.kind === "rope" ? `my ${entry} rope` : `a ${entry} order` }))] : [...new Set([...coins, ...(draft.coin !== "ANY" && draft.coin ? [draft.coin] : [])])].map((entry) => ({ value: entry, label: entry }));
  const coinValue = coinOptions.some((option) => option.value === draft.coin) ? draft.coin : (coinOptions[0]?.value ?? "BTC");
  const threshold = thresholdOf(draft);
  const preview: AlertRule = useMemo(
    () => ({
      id: "preview",
      kind: draft.kind,
      coin: coinValue === "ANY" || draft.kind === "bridge" ? null : coinValue,
      direction: draft.kind === "rope" ? "below" : draft.direction,
      threshold,
      channels: { app: draft.app, telegram: draft.telegram },
      armed: true,
      once: draft.once,
      createdAt: readings.now,
      lastFiredAt: null,
    }),
    [draft, coinValue, threshold, readings.now],
  );
  const status = evaluateRule(preview, readings);
  const needsValue = draft.kind === "price" || draft.kind === "funding" || draft.kind === "rope";
  const ready = !needsValue || threshold !== null;

  const create = () => {
    if (!ready) return;
    const at = Date.now();
    onCreate({ ...preview, id: newRuleId(at), createdAt: at });
    patch({ value: "" });
    setHeard(null);
  };

  const readSentence = () => {
    const parsed = parseRuleSentence(typed);
    if (!parsed) {
      setHeard("I could not read that as an alert. Try “alert me if BTC drops below 90k”.");
      return;
    }
    const rule = parsed.rule;
    const value = rule.threshold === null ? "" : rule.kind === "price" ? String(rule.threshold) : String(Math.round(rule.threshold * 100 * 1000) / 1000);
    patch({ kind: rule.kind, coin: rule.coin ?? "ANY", direction: rule.direction, value });
    setHeard(`Heard: ${parsed.understood}${rule.action ? ` · standing orders live with the Guide` : ""}`);
  };

  return (
    <section className="bg-card px-frame px-drop-lg" aria-labelledby="rule-builder-title">
      <header className="flex flex-col items-center gap-1 border-b-2 border-rule bg-paper-2 px-4 py-2.5 text-center sm:flex-row sm:justify-between">
        <h2 id="rule-builder-title" className="font-tag text-[12px] uppercase text-ink">
          New alert · one sentence · watched live
        </h2>
        <span className="font-tag text-[11px] uppercase text-ink-2">{priceWord}</span>
      </header>
      <div role="radiogroup" aria-label="What to watch" className="grid grid-cols-5 border-b-2 border-rule">
        {KINDS.map((entry) => {
          const selected = entry.kind === draft.kind;
          return (
            <button
              key={entry.kind}
              type="button"
              role="radio"
              aria-checked={selected}
              title={entry.hint}
              onClick={() => patch({ kind: entry.kind, value: "", coin: entry.kind === "rope" || entry.kind === "fill" ? "ANY" : (coins.includes(draft.coin) ? draft.coin : (coins[0] ?? "BTC")), direction: entry.kind === "rope" ? "below" : draft.direction })}
              className={cx("relative flex flex-col items-center gap-1.5 border-r-2 border-rule px-1 pb-3 pt-3.5 text-center transition-colors duration-fast last:border-r-0 focus-visible:z-10", selected ? "bg-signal text-signal-ink" : "text-ink hover:bg-paper-2", FOCUS_RING)}
            >
              <span className={cx("inline-flex p-1", selected ? "bg-card px-frame-thin" : "")}>
                <PixelGlyph rows={GLYPHS[entry.kind]} scale={3} label={null} />
              </span>
              <span className="font-tag text-[10px] uppercase sm:text-[12px]">{KIND_LABEL[entry.kind]}</span>
              <span className={cx("hidden font-mono text-[11px] leading-tight md:block", selected ? "text-signal-ink" : "text-ink-3")}>{entry.hint}</span>
              {selected ? <span aria-hidden="true" className="absolute -bottom-1 left-1/2 h-1 w-8 -translate-x-1/2 bg-accent" /> : null}
            </button>
          );
        })}
      </div>

      <div className="flex flex-col items-center px-4 pb-8 pt-10 sm:px-8">
        <p className="flex max-w-[960px] flex-wrap items-center justify-center gap-x-5 gap-y-6 text-center font-display text-[26px] font-bold leading-tight text-ink sm:text-[40px]">
          <span>Tell me when</span>
          {draft.kind === "bridge" ? (
            <span className={SLOT}>a bridge journey</span>
          ) : (
            <Slot label="Market" value={coinValue} onChange={(value) => patch({ coin: value })} options={coinOptions} />
          )}
          {draft.kind === "price" || draft.kind === "funding" ? (
            <>
              <span>{draft.kind === "price" ? "goes" : "funding goes"}</span>
              <Slot label="Direction" value={draft.direction} onChange={(value) => patch({ direction: value as Direction })} options={[{ value: "above", label: "above" }, { value: "below", label: "below" }]} />
              <NumberSlot label={draft.kind === "price" ? "Price" : "Funding APR"} value={draft.value} onChange={(value) => patch({ value })} prefix={draft.kind === "price" ? "$" : undefined} suffix={draft.kind === "funding" ? "% APR" : undefined} placeholder={status.value === null ? "0" : draft.kind === "price" ? String(Number(status.value.toPrecision(5))) : (status.value * 100).toFixed(1)} />
            </>
          ) : draft.kind === "rope" ? (
            <>
              <span>is closer than</span>
              <NumberSlot label="Distance to the crevasse" value={draft.value} onChange={(value) => patch({ value })} suffix="%" placeholder="10" />
              <span>to the crevasse</span>
            </>
          ) : draft.kind === "fill" ? (
            <span>fills</span>
          ) : (
            <span>settles</span>
          )}
        </p>

        <div className="mt-10 w-full max-w-[720px]">
          <TrailGauge status={status} rule={preview} />
        </div>

        <div className="mt-8 flex flex-col items-center gap-4">
          <p className="font-tag text-[11px] uppercase text-ink-3">Deliver to</p>
          <div className="flex flex-wrap justify-center gap-x-5 gap-y-4">
            <Check checked={draft.app} onChange={(app) => patch({ app })} label="This feed" />
            <Check checked={draft.telegram && telegramLinked} onChange={(telegram) => patch({ telegram })} label="Telegram" disabled={!telegramLinked} hint={telegramLinked ? undefined : "link first"} />
            <Check checked={draft.once} onChange={(once) => patch({ once })} label="Only once" />
          </div>
        </div>

        <div className="mt-9 flex flex-col items-center gap-3">
          <Button variant="primary" size="lg" onClick={create} disabled={!ready}>
            Arm the alert ▸
          </Button>
          <span className="font-mono text-[11px] text-ink-3">{ready ? "watched while Elyia is open · 15 min quiet after it fires" : needsValue ? "set the level first" : ""}</span>
        </div>

        <form
          className="mt-9 flex w-full max-w-[720px] flex-col items-center gap-3 border-t-2 border-dashed border-rule pt-7"
          onSubmit={(event) => {
            event.preventDefault();
            readSentence();
          }}
        >
          <label htmlFor="alert-sentence" className="font-tag text-[11px] uppercase text-ink-3">
            Or say it, and the slots fill in
          </label>
          <div className="flex w-full flex-col gap-5 sm:flex-row sm:items-center">
            <input
              id="alert-sentence"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              placeholder="alert me if ETH funding goes above 0.01%"
              className={cx("h-11 min-w-0 flex-1 bg-paper px-3 font-mono text-[14px] text-ink outline-none px-frame-thin placeholder:text-ink-3", FOCUS_RING)}
            />
            <Button type="submit" variant="ink" size="md" disabled={typed.trim() === ""}>
              Fill it in
            </Button>
          </div>
          {heard ? (
            <p className="text-center font-mono text-[12px] text-ink-2" aria-live="polite">
              {heard}
            </p>
          ) : (
            <p className="text-center font-mono text-[11px] text-ink-3">Funding without “APR” is read as HyperCore&apos;s hourly rate (0.01% an hour ≈ 87.6% a year).</p>
          )}
        </form>
      </div>
    </section>
  );
}

function Check({ checked, onChange, label, disabled = false, hint }: { readonly checked: boolean; readonly onChange: (checked: boolean) => void; readonly label: string; readonly disabled?: boolean; readonly hint?: string }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx("flex h-9 items-center gap-2 px-3 font-tag text-[11px] uppercase px-frame-thin px-press disabled:cursor-not-allowed disabled:opacity-55", checked ? "px-btn px-btn-thin px-btn-accent text-accent-ink" : "bg-card text-ink-2", FOCUS_RING)}
    >
      <span aria-hidden="true" className={cx("flex h-3.5 w-3.5 items-center justify-center text-[10px] leading-none", checked ? "bg-signal text-signal-ink" : "bg-paper-2")}>
        {checked ? "✓" : ""}
      </span>
      {label}
      {hint ? <span className="normal-case tracking-normal text-ink-3">· {hint}</span> : null}
    </button>
  );
}
