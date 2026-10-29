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

/** Your rules as a ruled log book: the sentence, the live reading on a small trail, where it goes, armed or paused. */
export function RulesLog({ rules, statuses, now, onToggle, onRemove }: { readonly rules: readonly AlertRule[]; readonly statuses: ReadonlyMap<string, RuleStatus>; readonly now: number; readonly onToggle: (rule: AlertRule) => void; readonly onRemove: (rule: AlertRule) => void }) {
  return (
    <section className="border-2 border-rule bg-card shadow-hard" aria-labelledby="rules-title">
      <header className="flex items-center justify-between gap-3 border-b-1.5 border-rule px-4 py-2">
        <h2 id="rules-title" className="caption !text-ink">
          Your rules · {rules.length} · {rules.filter((rule) => rule.armed).length} armed
        </h2>
        <span className="font-mono text-[11px] text-ink-2">kept on this device</span>
      </header>
      {rules.length === 0 ? (
        <p className="px-4 py-6 text-[15px] text-ink-2">No rules yet. Build one above, or ask the Guide: “alert me if BTC drops below 90k”.</p>
      ) : (
        <ol className="divide-y divide-rule/15">
          {rules.map((rule, index) => {
            const status = statuses.get(rule.id);
            return (
              <li key={rule.id} className={cx("grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 px-4 py-3 lg:grid-cols-[2rem_minmax(0,1.3fr)_minmax(160px,1fr)_auto]", !rule.armed && "opacity-70")}>
                <span className="tnum font-mono text-[12px] text-ink-3">{String(index + 1).padStart(2, "0")}</span>
                <div className="min-w-0">
                  <p className="text-[15px] font-semibold leading-snug text-ink">
                    {rule.action ? "When " : "Tell me when "}
                    {ruleCondition(rule)}
                  </p>
                  <p className="font-mono text-[11px] text-ink-3">
                    {KIND_LABEL[rule.kind]}
                    {rule.action ? ` · standing order: ${rule.action}` : ""} · {rule.channels.telegram ? "feed + Telegram" : "feed"}
                    {rule.once ? " · once" : ""}
                    {rule.lastFiredAt ? ` · fired ${ago(rule.lastFiredAt, now)}` : ""}
                  </p>
                </div>
                <div className="col-span-3 col-start-2 min-w-0 lg:col-span-1 lg:col-start-3">
                  {status ? (
                    <div className="flex items-center gap-2">
                      <TrailGauge status={status} rule={rule} compact className="w-[120px] shrink-0" />
                      <span className={cx("min-w-0 truncate font-mono text-[11px]", status.met ? "font-semibold text-up" : "text-ink-2")}>{status.reading}</span>
                    </div>
                  ) : null}
                </div>
                <div className="col-start-3 row-start-1 flex items-center gap-2 lg:col-start-4">
                  <button
                    type="button"
                    onClick={() => onToggle(rule)}
                    aria-pressed={rule.armed}
                    aria-label={`${rule.armed ? "Pause" : "Arm"}: ${ruleCondition(rule)}`}
                    className={cx("flex items-center gap-1.5 border-1.5 px-1.5 py-0.5 font-mono text-[11px] font-semibold uppercase tracking-[0.1em]", rule.armed ? "border-warn text-warn-ink" : "border-rule/40 text-ink-3", FOCUS_RING)}
                  >
                    <span aria-hidden="true">{rule.armed ? "●" : "○"}</span>
                    {rule.armed ? "Armed" : "Paused"}
                  </button>
                  <button type="button" onClick={() => onRemove(rule)} aria-label={`Delete: ${ruleCondition(rule)}`} className={cx("px-1 font-mono text-[13px] text-ink-3 hover:text-down", FOCUS_RING)}>
                    ✕
                  </button>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
