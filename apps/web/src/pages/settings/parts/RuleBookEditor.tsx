import { DEFAULT_RULE_BOOK } from "@elyia/core/policy";
import { useMemo, useState } from "react";

import { bookSummary, effectiveRuleBook } from "../../../features/trading/guard";
import { useTradeStore } from "../../../features/trading/tradeStore";
import { Button } from "../../../ui/Button";
import { cx } from "../../../ui/cx";
import { sanitizeDecimalInput } from "../../../ui/numberInput";
import { toast } from "../../../ui/toast";
import { Toggle } from "../../../ui/Toggle";
import { draftChanged, loosenedBy, toDraft, toOverrides, type RuleDraft } from "../ruleDraft";

function Limit({ label, hint, value, onChange, unit, decimals = 2, placeholder }: { readonly label: string; readonly hint: string; readonly value: string; readonly onChange: (value: string) => void; readonly unit: string; readonly decimals?: number; readonly placeholder?: string }) {
  return (
    <label className="flex flex-col gap-1.5 border-b-1.5 border-dashed border-rule/30 pb-3">
      <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3">{label}</span>
      <span className="flex h-11 items-center gap-1.5 border-2 border-rule bg-card px-3 focus-within:shadow-hard">
        <input
          inputMode="decimal"
          value={value}
          placeholder={placeholder ?? "off"}
          onChange={(event) => {
            const next = sanitizeDecimalInput(event.target.value, decimals);
            if (next !== null) onChange(next);
          }}
          className="tnum min-w-0 flex-1 bg-transparent font-mono text-[17px] font-semibold text-ink outline-none placeholder:font-normal placeholder:text-ink-3"
        />
        <span className="font-mono text-[12px] text-ink-3">{unit}</span>
      </span>
      <span className="text-[12px] leading-snug text-ink-3">{hint}</span>
    </label>
  );
}

/**
 * The Rule Book, printed like a permit: hard limits checked in code before
 * the trading key signs anything (terminal, Guide, keeper). Loosening asks
 * for an explicit acknowledgement; closing and cancelling always work.
 */
export function RuleBookEditor() {
  const overrides = useTradeStore((state) => state.overrides);
  const setOverrides = useTradeStore((state) => state.setOverrides);
  const [draft, setDraft] = useState<RuleDraft>(() => toDraft(overrides));
  const [ack, setAck] = useState(false);
  const next = useMemo(() => effectiveRuleBook(toOverrides(draft)), [draft]);
  const loosened = useMemo(() => loosenedBy(overrides, draft), [overrides, draft]);
  const changed = draftChanged(overrides, draft);
  const patch = (values: Partial<RuleDraft>) => {
    setDraft((previous) => ({ ...previous, ...values }));
    setAck(false);
  };
  const save = () => {
    setOverrides(toOverrides(draft));
    setAck(false);
    toast.success("Rule Book saved", { description: bookSummary(next.book), from: "BASE" });
  };

  return (
    <div className="flex flex-col gap-5">
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 border-2 border-rule bg-paper-2 px-3 py-2 font-mono text-[12px] text-ink-2">
        <span className="border-1.5 border-rule px-1 text-[10px] font-semibold tracking-[0.1em] text-ink">RULE BOOK</span>
        {bookSummary(next.book)}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Toggle checked={draft.paused} onChange={(paused) => patch({ paused })} label="Kill switch" description="Nothing new is signed. Closing and cancelling still work." />
        <Toggle checked={draft.reduceOnly} onChange={(reduceOnly) => patch({ reduceOnly })} label="De-risk only" description="Only reduce-only orders: positions shrink, never grow." />
      </div>
      <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
        <Limit label="Max leverage" hint="Per order, perps" value={draft.maxLeverage} onChange={(maxLeverage) => patch({ maxLeverage })} unit="×" decimals={0} />
        <Limit label="Max per order" hint="Size × worst price" value={draft.maxNotionalUsd} onChange={(maxNotionalUsd) => patch({ maxNotionalUsd })} unit="USD" />
        <Limit label="Max market slippage" hint="Mid ± this for market orders" value={draft.maxSlippagePct} onChange={(maxSlippagePct) => patch({ maxSlippagePct })} unit="%" />
        <Limit label="Daily volume" hint="Rolling 24 h, new risk only" value={draft.dailyVolumeUsd} onChange={(dailyVolumeUsd) => patch({ dailyVolumeUsd })} unit="USD" />
        <Limit label="Daily loss stop" hint="Then only closing runs (the keeper licence suspends itself)" value={draft.dailyLossUsd} onChange={(dailyLossUsd) => patch({ dailyLossUsd })} unit="USD" />
        <Limit label="Confirm above" hint="Bigger orders ask you first" value={draft.confirmAboveUsd} onChange={(confirmAboveUsd) => patch({ confirmAboveUsd })} unit="USD" />
      </div>
      <label className="flex flex-col gap-1.5">
        <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3">Only these markets</span>
        <input value={draft.markets} onChange={(event) => patch({ markets: event.target.value })} placeholder="every market (e.g. BTC, ETH, HYPE)" className="h-11 border-2 border-rule bg-card px-3 font-mono text-[15px] text-ink outline-none placeholder:text-ink-3 focus:shadow-hard" />
      </label>
      <Toggle checked={draft.allowMainnet} onChange={(allowMainnet) => patch({ allowMainnet })} label="Allow HyperCore mainnet" description="Off by default: the default book is testnet only. Mainnet opens with Elysium mainnet." />
      {next.issues.length > 0 ? <p className="text-[13px] text-down">{next.issues.join(" · ")}</p> : null}
      {loosened.length > 0 ? (
        <div className="flex flex-col gap-2 border-l-[3px] border-warn bg-paper-2 p-3 text-[14px] text-ink-2">
          <p className="font-semibold text-warn-ink">! This loosens your rules: {loosened.join(", ")}.</p>
          <Toggle size="sm" checked={ack} onChange={setAck} label="I understand; apply it on this device" />
        </div>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button
          variant="ghost"
          onClick={() => {
            setDraft(toDraft({}));
            setAck(false);
          }}
        >
          Reset to defaults
        </Button>
        <div className="flex items-center gap-3">
          <span className={cx("font-mono text-[11px]", changed ? "text-warn-ink" : "text-ink-3")}>{changed ? "unsaved changes" : "saved"}</span>
          <Button variant="primary" onClick={save} disabled={!changed || next.issues.length > 0 || (loosened.length > 0 && !ack)}>
            Save the Rule Book
          </Button>
        </div>
      </div>
      <p className="text-[12px] leading-relaxed text-ink-3">Stored on this device and shared with the terminal and the Guide. The same evaluator ({DEFAULT_RULE_BOOK.schema}) runs in the API and the keeper; the Guide can never loosen it.</p>
    </div>
  );
}
