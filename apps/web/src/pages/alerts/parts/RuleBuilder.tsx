import { useMemo, useState } from "react";

import { Button } from "../../../ui/Button";
import { cx, FOCUS_RING } from "../../../ui/cx";
import { sanitizeDecimalInput } from "../../../ui/numberInput";
import { evaluateRule, KIND_LABEL, newRuleId, parseRuleSentence, type AlertKind, type AlertRule, type Direction, type RuleReadings } from "../model/rules";
import { TrailGauge } from "./TrailGauge";

const KINDS: readonly { readonly kind: AlertKind; readonly glyph: string; readonly hint: string }[] = [
  { kind: "price", glyph: "▲▼", hint: "a mark crosses a level" },
  { kind: "funding", glyph: "≋", hint: "the wind changes side" },
  { kind: "rope", glyph: "✕—●", hint: "a rope nears its crevasse" },
  { kind: "fill", glyph: "◎", hint: "an order fills" },
  { kind: "bridge", glyph: "⇅", hint: "an ascent or descent lands" },
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

const SLOT = "inline-flex h-11 items-center border-2 border-rule bg-card px-2.5 font-mono text-[17px] font-semibold text-ink shadow-hard sm:h-12 sm:text-[20px]";

function Slot({ label, value, onChange, options }: { readonly label: string; readonly value: string; readonly onChange: (value: string) => void; readonly options: readonly { readonly value: string; readonly label: string }[] }) {
  return (
    <label className="relative inline-flex">
      <span className="sr-only">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} className={cx(SLOT, "cursor-pointer appearance-none pr-7", FOCUS_RING)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <span aria-hidden="true" className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-ink-3">
        ▾
      </span>
    </label>
  );
}

function NumberSlot({ label, value, onChange, prefix, suffix, placeholder = "0" }: { readonly label: string; readonly value: string; readonly onChange: (value: string) => void; readonly prefix?: string; readonly suffix?: string; readonly placeholder?: string }) {
  return (
    <label className={cx(SLOT, "gap-1 focus-within:shadow-hard-lg")}>
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
      {suffix ? <span className="text-[13px] text-ink-3 sm:text-[15px]">{suffix}</span> : null}
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
    <section className="border-2 border-rule bg-card shadow-hard-lg" aria-labelledby="rule-builder-title">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b-2 border-rule px-4 py-2">
        <h2 id="rule-builder-title" className="caption !text-ink">
          New alert · one sentence · watched live
        </h2>
        <span className="font-mono text-[11px] text-ink-2">{priceWord}</span>
      </header>
      <div role="radiogroup" aria-label="What to watch" className="grid grid-cols-2 border-b-1.5 border-rule/40 sm:grid-cols-5">
        {KINDS.map((entry) => {
          const selected = entry.kind === draft.kind;
          return (
            <button
              key={entry.kind}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => patch({ kind: entry.kind, value: "", coin: entry.kind === "rope" || entry.kind === "fill" ? "ANY" : (coins.includes(draft.coin) ? draft.coin : (coins[0] ?? "BTC")), direction: entry.kind === "rope" ? "below" : draft.direction })}
              className={cx("flex flex-col items-start gap-0.5 border-r-1.5 border-rule/25 px-3 py-2.5 text-left transition-colors duration-fast last:border-r-0", selected ? "bg-ink text-paper" : "text-ink hover:bg-paper-2", FOCUS_RING)}
            >
              <span className="flex items-center gap-2 font-sans text-[13px] font-bold uppercase tracking-[0.06em]">
                <span aria-hidden="true" className={cx("font-mono text-[12px]", selected ? "text-signal" : "text-ink-3")}>
                  {entry.glyph}
                </span>
                {KIND_LABEL[entry.kind]}
              </span>
              <span className={cx("font-mono text-[11px]", selected ? "text-paper/75" : "text-ink-3")}>{entry.hint}</span>
            </button>
          );
        })}
      </div>

      <div className="px-4 pb-5 pt-6 sm:px-6">
        <p className="flex flex-wrap items-center gap-x-3 gap-y-3 text-[24px] font-bold leading-tight tracking-[-0.02em] text-ink sm:text-[32px]">
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

        <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <TrailGauge status={status} rule={preview} />
          <div className="flex flex-col gap-2">
            <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3">Deliver to</p>
            <div className="flex flex-wrap gap-2">
              <Check checked={draft.app} onChange={(app) => patch({ app })} label="This feed" />
              <Check checked={draft.telegram && telegramLinked} onChange={(telegram) => patch({ telegram })} label="Telegram" disabled={!telegramLinked} hint={telegramLinked ? undefined : "link first"} />
              <Check checked={draft.once} onChange={(once) => patch({ once })} label="Only once" />
            </div>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Button variant="primary" size="lg" onClick={create} disabled={!ready}>
            Arm the alert ▸
          </Button>
          <span className="font-mono text-[11px] text-ink-3">{ready ? "watched while Elyia is open · 15 min quiet after it fires" : needsValue ? "set the level first" : ""}</span>
        </div>

        <form
          className="mt-6 flex flex-col gap-1.5 border-t-1.5 border-dashed border-rule/40 pt-4"
          onSubmit={(event) => {
            event.preventDefault();
            readSentence();
          }}
        >
          <label htmlFor="alert-sentence" className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3">
            Or say it
          </label>
          <div className="flex gap-2">
            <input
              id="alert-sentence"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              placeholder="alert me if ETH funding goes above 0.01%"
              className="h-10 min-w-0 flex-1 border-2 border-rule bg-paper px-3 font-mono text-[14px] text-ink outline-none placeholder:text-ink-3 focus:shadow-hard"
            />
            <Button type="submit" variant="ink" size="md" disabled={typed.trim() === ""}>
              Fill it in
            </Button>
          </div>
          {heard ? (
            <p className="font-mono text-[12px] text-ink-2" aria-live="polite">
              {heard}
            </p>
          ) : (
            <p className="font-mono text-[11px] text-ink-3">Funding without “APR” is read as HyperCore&apos;s hourly rate (0.01% an hour ≈ 87.6% a year).</p>
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
      className={cx("flex h-9 items-center gap-2 border-2 px-2.5 font-mono text-[12px] font-semibold uppercase tracking-[0.08em] transition-colors duration-fast disabled:cursor-not-allowed disabled:opacity-55", checked ? "border-rule bg-ink text-paper" : "border-rule/50 bg-card text-ink-2 hover:border-rule", FOCUS_RING)}
    >
      <span aria-hidden="true" className={cx("flex h-3.5 w-3.5 items-center justify-center border-1.5 text-[10px] leading-none", checked ? "border-paper" : "border-rule/60")}>
        {checked ? "✓" : ""}
      </span>
      {label}
      {hint ? <span className="normal-case tracking-normal text-ink-3">· {hint}</span> : null}
    </button>
  );
}
