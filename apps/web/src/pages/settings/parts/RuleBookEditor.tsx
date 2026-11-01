import { DEFAULT_RULE_BOOK } from "@elyia/core/policy";
import { useMemo, useState } from "react";

import { bookSummary, effectiveRuleBook } from "../../../features/trading/guard";
import { useTradeStore } from "../../../features/trading/tradeStore";
import { Ely } from "../../../pixel/Ely";
import { PixelGlyph } from "../../../pixel/PixelGlyph";
import { Button } from "../../../ui/Button";
import { cx } from "../../../ui/cx";
import { sanitizeDecimalInput } from "../../../ui/numberInput";
import { toast } from "../../../ui/toast";
import { Toggle } from "../../../ui/Toggle";
import { ITEM } from "./kitItems";
import { draftChanged, loosenedBy, toDraft, toOverrides, type RuleDraft } from "../ruleDraft";

function Limit({ label, hint, value, onChange, unit, decimals = 2, placeholder }: { readonly label: string; readonly hint: string; readonly value: string; readonly onChange: (value: string) => void; readonly unit: string; readonly decimals?: number; readonly placeholder?: string }) {
  return (
    <label className="flex flex-col gap-2 bg-paper-2/60 p-3 px-frame-thin">
      <span className="font-tag text-[11px] uppercase text-ink-2">{label}</span>
      <span className="flex h-11 items-center gap-1.5 bg-card px-3 px-frame-thin focus-within:outline-dashed focus-within:outline-4 focus-within:outline-offset-[6px] focus-within:outline-signal">
        <input
          inputMode="decimal"
          value={value}
          placeholder={placeholder ?? "off"}
          onChange={(event) => {
            const next = sanitizeDecimalInput(event.target.value, decimals);
            if (next !== null) onChange(next);
          }}
          className="tnum min-w-0 flex-1 bg-transparent font-display text-[20px] font-bold text-ink outline-none placeholder:font-sans placeholder:text-[14px] placeholder:font-normal placeholder:text-ink-3"
        />
        <span className="font-tag text-[11px] uppercase text-ink-3">{unit}</span>
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

  const worried = loosened.length > 0 || draft.paused;
  return (
    <div className="bg-card px-frame px-drop-lg">
      <header className="flex flex-col items-center gap-3 border-b-2 border-rule bg-paper-2 px-4 py-4 text-center">
        <span className="flex items-center gap-3">
          <PixelGlyph rows={ITEM.book} scale={3} label={null} />
          <span className="font-tag text-[12px] uppercase text-ink">Rule Book · printed on this device</span>
        </span>
        <p className="font-mono text-[13px] text-ink-2">{bookSummary(next.book)}</p>
      </header>
      <div className="flex flex-col gap-7 px-4 py-6 sm:px-6">
        <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
          <Toggle checked={draft.paused} onChange={(paused) => patch({ paused })} label="Kill switch" description="Nothing new is signed. Closing and cancelling still work." />
          <Toggle checked={draft.reduceOnly} onChange={(reduceOnly) => patch({ reduceOnly })} label="De-risk only" description="Only reduce-only orders: positions shrink, never grow." />
        </div>
        <div className="grid gap-x-6 gap-y-6 sm:grid-cols-2 lg:grid-cols-3">
          <Limit label="Max leverage" hint="Per order, perps" value={draft.maxLeverage} onChange={(maxLeverage) => patch({ maxLeverage })} unit="×" decimals={0} />
          <Limit label="Max per order" hint="Size × worst price" value={draft.maxNotionalUsd} onChange={(maxNotionalUsd) => patch({ maxNotionalUsd })} unit="USD" />
          <Limit label="Max market slippage" hint="Mid ± this for market orders" value={draft.maxSlippagePct} onChange={(maxSlippagePct) => patch({ maxSlippagePct })} unit="%" />
          <Limit label="Daily volume" hint="Rolling 24 h, new risk only" value={draft.dailyVolumeUsd} onChange={(dailyVolumeUsd) => patch({ dailyVolumeUsd })} unit="USD" />
          <Limit label="Daily loss stop" hint="Then only closing runs; the keeper licence suspends itself" value={draft.dailyLossUsd} onChange={(dailyLossUsd) => patch({ dailyLossUsd })} unit="USD" />
          <Limit label="Confirm above" hint="Bigger orders ask you first" value={draft.confirmAboveUsd} onChange={(confirmAboveUsd) => patch({ confirmAboveUsd })} unit="USD" />
        </div>
        <label className="flex flex-col gap-2">
          <span className="font-tag text-[11px] uppercase text-ink-2">Only these markets</span>
          <input value={draft.markets} onChange={(event) => patch({ markets: event.target.value })} placeholder="every market (e.g. BTC, ETH, HYPE)" className="h-11 bg-card px-3 font-mono text-[15px] text-ink outline-none px-frame-thin placeholder:text-ink-3 focus-visible:outline-dashed focus-visible:outline-4 focus-visible:outline-offset-[6px] focus-visible:outline-signal" />
        </label>
        <Toggle checked={draft.allowMainnet} onChange={(allowMainnet) => patch({ allowMainnet })} label="Allow HyperCore mainnet" description="Off by default: the default book is testnet only. Mainnet opens with Elysium mainnet." />
        {next.issues.length > 0 ? <p className="text-[13px] text-down">{next.issues.join(" · ")}</p> : null}
        {worried ? (
          <div className="flex flex-col items-center gap-4 bg-paper-2 p-4 text-center px-frame-thin px-tone-signal sm:flex-row sm:text-left">
            <Ely state="worry" size={64} label={null} className="shrink-0" />
            <div className="flex min-w-0 flex-col gap-3">
              <p className="font-semibold text-warn-ink">{loosened.length > 0 ? `! This loosens your rules: ${loosened.join(", ")}.` : "! The kill switch is in this draft: nothing new will sign."}</p>
              {loosened.length > 0 ? <Toggle size="sm" checked={ack} onChange={setAck} label="I understand; apply it on this device" /> : null}
            </div>
          </div>
        ) : null}
      </div>
      <footer className="flex flex-col items-center gap-5 border-t-2 border-dashed border-rule px-4 py-5 sm:flex-row sm:justify-between sm:px-6">
        <Button
          variant="ghost"
          onClick={() => {
            setDraft(toDraft({}));
            setAck(false);
          }}
        >
          Reset to defaults
        </Button>
        <div className="flex items-center gap-5">
          <span className={cx("font-tag text-[11px] uppercase", changed ? "text-warn-ink" : "text-ink-3")}>{changed ? "unsaved changes" : "saved"}</span>
          <Button variant="primary" onClick={save} disabled={!changed || next.issues.length > 0 || (loosened.length > 0 && !ack)}>
            Save the Rule Book
          </Button>
        </div>
      </footer>
      <p className="border-t-2 border-rule bg-paper-2 px-4 py-3 text-center text-[12px] leading-relaxed text-ink-3 sm:px-6">Shared with the terminal and Ely. The same evaluator ({DEFAULT_RULE_BOOK.schema}) runs in the API and the keeper; Ely can never loosen it.</p>
    </div>
  );
}
