import { DEFAULT_RULE_BOOK, loosenedRules } from "@elyia/core/policy";
import { ShieldAlert } from "lucide-react";
import { useMemo, useState } from "react";

import { bookSummary, effectiveRuleBook, type GuardOverrides } from "../../features/trading/guard";
import { useTradeStore } from "../../features/trading/tradeStore";
import { Button } from "../../ui/Button";
import { cx } from "../../ui/cx";
import { sanitizeDecimalInput } from "../../ui/numberInput";
import { Sheet } from "../../ui/Sheet";
import { Toggle } from "../../ui/Toggle";
import { useTerminalUi } from "./terminalUi";

interface Draft {
  readonly maxLeverage: string;
  readonly maxNotionalUsd: string;
  readonly maxSlippagePct: string;
  readonly dailyVolumeUsd: string;
  readonly dailyLossUsd: string;
  readonly confirmAboveUsd: string;
  readonly markets: string;
  readonly reduceOnly: boolean;
  readonly paused: boolean;
  readonly allowMainnet: boolean;
}

function toDraft(overrides: GuardOverrides): Draft {
  const book = effectiveRuleBook(overrides).book;
  return {
    maxLeverage: String(book.trading?.maxLeverage ?? ""),
    maxNotionalUsd: book.trading?.maxNotionalUsd ?? "",
    maxSlippagePct: book.trading?.maxSlippageBps !== undefined ? String(book.trading.maxSlippageBps / 100) : "",
    dailyVolumeUsd: book.trading?.dailyVolumeUsd ?? "",
    dailyLossUsd: book.trading?.dailyLossUsd ?? "",
    confirmAboveUsd: book.confirm?.aboveUsd ?? "",
    markets: (book.trading?.markets?.allow ?? []).join(", "),
    reduceOnly: book.trading?.reduceOnly === true,
    paused: book.mode === "paused",
    allowMainnet: (book.networks?.environments ?? []).includes("mainnet"),
  };
}

function toOverrides(draft: Draft): GuardOverrides {
  const usd = (value: string) => (value.trim() === "" ? undefined : String(Math.round(Number(value) * 100) / 100));
  const markets = draft.markets
    .split(/[\s,]+/u)
    .map((entry) => entry.trim().toUpperCase())
    .filter(Boolean);
  return {
    ...(draft.maxLeverage ? { maxLeverage: Math.max(1, Math.round(Number(draft.maxLeverage))) } : {}),
    ...(usd(draft.maxNotionalUsd) ? { maxNotionalUsd: usd(draft.maxNotionalUsd) } : {}),
    ...(draft.maxSlippagePct ? { maxSlippageBps: Math.max(1, Math.round(Number(draft.maxSlippagePct) * 100)) } : {}),
    ...(usd(draft.dailyVolumeUsd) ? { dailyVolumeUsd: usd(draft.dailyVolumeUsd) } : {}),
    ...(usd(draft.dailyLossUsd) ? { dailyLossUsd: usd(draft.dailyLossUsd) } : {}),
    ...(usd(draft.confirmAboveUsd) ? { confirmAboveUsd: usd(draft.confirmAboveUsd) } : {}),
    ...(markets.length > 0 ? { markets } : {}),
    ...(draft.reduceOnly ? { reduceOnly: true } : {}),
    ...(draft.paused ? { paused: true } : {}),
    ...(draft.allowMainnet ? { allowMainnet: true } : {}),
  };
}

const RULE_NAMES: Readonly<Record<string, string>> = {
  mode: "kill switch off",
  "networks.environments": "mainnet allowed",
  "trading.maxLeverage": "higher leverage",
  "trading.maxNotionalUsd": "bigger orders",
  "trading.maxSlippageBps": "more slippage",
  "limits.maxSlippageBps": "more slippage",
  "trading.dailyVolumeUsd": "more daily volume",
  "trading.dailyLossUsd": "a later loss stop",
  "confirm.aboveUsd": "fewer confirmations",
  "trading.markets.allow": "more markets",
  "trading.reduceOnly": "new risk allowed",
};

function NumberRow({ label, hint, value, onChange, unit, decimals = 2 }: { readonly label: string; readonly hint: string; readonly value: string; readonly onChange: (value: string) => void; readonly unit: string; readonly decimals?: number }) {
  return (
    <label className="grid grid-cols-[1fr_140px] items-center gap-3">
      <span className="flex flex-col">
        <span className="text-sm text-ink">{label}</span>
        <span className="text-xs text-ink-3">{hint}</span>
      </span>
      <span className="px-frame-thin flex h-9 items-center gap-1.5 bg-card px-2.5 focus-within:bg-paper-2">
        <input
          inputMode="decimal"
          value={value}
          onChange={(event) => {
            const next = sanitizeDecimalInput(event.target.value, decimals);
            if (next !== null) onChange(next);
          }}
          className="tnum min-w-0 flex-1 bg-transparent text-right font-mono text-sm text-ink outline-none"
        />
        <span className="font-mono text-xs text-ink-3">{unit}</span>
      </span>
    </label>
  );
}

/** The terminal's Rule Book: the default testnet book with a few limits the user can tune. */
export function RuleBookSheet() {
  const open = useTerminalUi((state) => state.rulesOpen);
  const close = () => useTerminalUi.getState().set({ rulesOpen: false });
  return (
    <Sheet open={open} onClose={close} title="Rule Book" description="Hard limits checked in code before the trading key signs anything. Closing and cancelling always work.">
      {open ? <RuleBookBody onClose={close} /> : null}
    </Sheet>
  );
}

function RuleBookBody({ onClose }: { readonly onClose: () => void }) {
  const overrides = useTradeStore((state) => state.overrides);
  const setOverrides = useTradeStore((state) => state.setOverrides);
  const [draft, setDraft] = useState<Draft>(() => toDraft(overrides));
  const [ack, setAck] = useState(false);
  const next = useMemo(() => effectiveRuleBook(toOverrides(draft)), [draft]);
  const current = useMemo(() => effectiveRuleBook(overrides).book, [overrides]);
  const loosened = useMemo(() => [...new Set(loosenedRules(current, next.book).map((path) => RULE_NAMES[path] ?? path))], [current, next.book]);
  const patch = (values: Partial<Draft>) => {
    setDraft((previous) => ({ ...previous, ...values }));
    setAck(false);
  };
  const save = () => {
    setOverrides(toOverrides(draft));
    onClose();
  };
  return (
    <div className="flex flex-col gap-5">
      <div className="px-frame-thin bg-paper-2 p-3 font-mono text-xs text-ink-2">{bookSummary(next.book)}</div>
      <section className="flex flex-col gap-3">
        <Toggle checked={draft.paused} onChange={(paused) => patch({ paused })} label="Kill switch" description="Nothing new is signed. Closing positions and cancelling orders still work." />
        <Toggle checked={draft.reduceOnly} onChange={(reduceOnly) => patch({ reduceOnly })} label="De-risk only" description="Only reduce-only orders: positions can shrink, never grow." />
      </section>
      <section className="flex flex-col gap-3">
        <NumberRow label="Max leverage" hint="Per order, perps" value={draft.maxLeverage} onChange={(maxLeverage) => patch({ maxLeverage })} unit="×" decimals={0} />
        <NumberRow label="Max per order" hint="Size × worst price" value={draft.maxNotionalUsd} onChange={(maxNotionalUsd) => patch({ maxNotionalUsd })} unit="USD" />
        <NumberRow label="Max market slippage" hint="Mid ± this for market orders" value={draft.maxSlippagePct} onChange={(maxSlippagePct) => patch({ maxSlippagePct })} unit="%" />
        <NumberRow label="Daily volume" hint="Rolling 24 h, new risk only" value={draft.dailyVolumeUsd} onChange={(dailyVolumeUsd) => patch({ dailyVolumeUsd })} unit="USD" />
        <NumberRow label="Daily loss stop" hint="Then only closing runs (empty = off)" value={draft.dailyLossUsd} onChange={(dailyLossUsd) => patch({ dailyLossUsd })} unit="USD" />
        <NumberRow label="Confirm above" hint="Bigger orders ask you first" value={draft.confirmAboveUsd} onChange={(confirmAboveUsd) => patch({ confirmAboveUsd })} unit="USD" />
        <label className="flex flex-col gap-1.5">
          <span className="text-sm text-ink">Only these markets</span>
          <input value={draft.markets} onChange={(event) => patch({ markets: event.target.value })} placeholder="every market (e.g. BTC, ETH, HYPE)" className="px-frame-thin mx-0.5 h-9 bg-card px-2.5 font-mono text-sm text-ink outline-none placeholder:text-ink-3 focus:bg-paper-2" />
        </label>
        <Toggle checked={draft.allowMainnet} onChange={(allowMainnet) => patch({ allowMainnet })} label="Allow HyperCore mainnet" description="Off by default: the default book is testnet only. Mainnet opens with Elysium mainnet." />
      </section>
      {next.issues.length > 0 ? <p className="text-xs text-down">{next.issues.join(" · ")}</p> : null}
      {loosened.length > 0 ? (
        <div className={cx("flex flex-col gap-2 border-l-4 border-warn bg-paper-2 p-3 text-sm text-ink-2")}>
          <p className="flex items-center gap-2 text-warn-ink">
            <ShieldAlert className="h-4 w-4" aria-hidden="true" />
            This loosens your rules: {loosened.join(", ")}.
          </p>
          <Toggle size="sm" checked={ack} onChange={setAck} label="I understand; apply it on this device" />
        </div>
      ) : null}
      <div className="flex flex-wrap justify-between gap-2">
        <Button
          variant="ghost"
          onClick={() => {
            setDraft(toDraft({}));
            setAck(false);
          }}
        >
          Reset to defaults
        </Button>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} disabled={next.issues.length > 0 || (loosened.length > 0 && !ack)}>
            Save rules
          </Button>
        </div>
      </div>
      <p className="text-xs leading-relaxed text-ink-3">Stored on this device. The same evaluator ({DEFAULT_RULE_BOOK.schema}) runs in the API and the Keeper; the Elysium Agent can never loosen it.</p>
    </div>
  );
}
