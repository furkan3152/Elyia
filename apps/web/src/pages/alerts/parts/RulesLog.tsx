import { Cards } from "../../../pixel/layout";
import { ElyEmpty } from "../../../pixel/ElyEmpty";
import { cx, FOCUS_RING } from "../../../ui/cx";
import { KIND_LABEL, ruleCondition, type AlertRule, type RuleStatus } from "../model/rules";
import { TrailGauge } from "./TrailGauge";

function ago(ms: number, now: number): string {
  const minutes = Math.max(0, Math.round((now - ms) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} d ago`;
}

/** Your rules as equal trail-gauge cards: the sentence, the live reading as a pixel climb to your flag, where it goes, armed or paused. */
export function RulesLog({ rules, statuses, now, onToggle, onRemove, onBuild }: { readonly rules: readonly AlertRule[]; readonly statuses: ReadonlyMap<string, RuleStatus>; readonly now: number; readonly onToggle: (rule: AlertRule) => void; readonly onRemove: (rule: AlertRule) => void; readonly onBuild?: () => void }) {
  if (rules.length === 0) {
    return (
      <div className="mx-auto max-w-[560px] bg-card px-frame px-drop">
        <ElyEmpty
          title="No rules yet"
          description="Build one above, or ask Ely: “alert me if BTC drops below 90k”. Every rule you arm shows up here as its own trail."
          action={
            onBuild ? (
              <button type="button" onClick={onBuild} className={cx("bg-signal px-3 py-1.5 font-tag text-[11px] uppercase text-signal-ink px-frame-thin px-drop px-press", FOCUS_RING)}>
                Build the first one ▲
              </button>
            ) : undefined
          }
        />
      </div>
    );
  }
  return (
    <Cards n={rules.length === 1 ? 1 : rules.length === 2 || rules.length === 4 ? 2 : 3} as="ol" className={cx(rules.length === 1 && "mx-auto max-w-[560px]")}>
      {rules.map((rule, index) => {
        const status = statuses.get(rule.id);
        return (
          <li key={rule.id} className={cx("flex flex-col bg-card px-frame px-drop", !rule.armed && "opacity-75")}>
            <header className="flex items-center justify-between gap-3 border-b-4 border-rule bg-paper-2 px-4 py-2">
              <span className="font-tag text-[11px] uppercase text-ink-2">
                <span className="tnum text-ink">{String(index + 1).padStart(2, "0")}</span> · {KIND_LABEL[rule.kind]}
                {rule.action ? " · standing order" : ""}
              </span>
              <button
                type="button"
                onClick={() => onToggle(rule)}
                aria-pressed={rule.armed}
                aria-label={`${rule.armed ? "Pause" : "Arm"}: ${ruleCondition(rule)}`}
                className={cx("flex items-center gap-1.5 px-2 py-0.5 font-tag text-[11px] uppercase px-frame-thin px-press", rule.armed ? "bg-signal text-signal-ink" : "bg-card text-ink-3", FOCUS_RING)}
              >
                <span aria-hidden="true">{rule.armed ? "●" : "○"}</span>
                {rule.armed ? "Armed" : "Paused"}
              </button>
            </header>
            <div className="flex flex-1 flex-col gap-4 px-4 pb-4 pt-5">
              <p className="text-center font-display text-[19px] font-bold leading-snug text-ink">
                {rule.action ? "When " : "Tell me when "}
                {ruleCondition(rule)}
              </p>
              <div className="mt-auto">{status ? <TrailGauge status={status} rule={rule} /> : <p className="text-center font-mono text-[12px] text-ink-3">waiting for the first reading…</p>}</div>
            </div>
            <footer className="flex items-center justify-between gap-3 border-t-4 border-dashed border-rule/30 px-4 py-2 font-mono text-[11px] text-ink-3">
              <span className="min-w-0 truncate">
                {rule.action ? `drafts “${rule.action}” · ` : ""}
                {rule.channels.telegram ? "feed + Telegram" : "feed"}
                {rule.once ? " · once" : ""}
                {rule.lastFiredAt ? ` · fired ${ago(rule.lastFiredAt, now)}` : ""}
              </span>
              <button type="button" onClick={() => onRemove(rule)} aria-label={`Delete: ${ruleCondition(rule)}`} className={cx("shrink-0 font-tag text-[11px] uppercase hover:text-down", FOCUS_RING)}>
                delete ✕
              </button>
            </footer>
          </li>
        );
      })}
    </Cards>
  );
}
