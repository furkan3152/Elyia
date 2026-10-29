import { SlidersHorizontal } from "lucide-react";

import { bookSummary, guardLines, type combineEvaluations } from "../../features/trading/guard";
import { cx, FOCUS_RING } from "../../ui/cx";
import { useTerminal } from "./terminalContext";
import { useTerminalUi } from "./terminalUi";

export type Verdict = ReturnType<typeof combineEvaluations>;

const TONE = {
  allow: { stamp: "CHECKED", mark: "✓", text: "text-up", edge: "border-up", head: "Passes your Rule Book." },
  confirm: { stamp: "CONFIRM", mark: "!", text: "text-warn-ink", edge: "border-warn", head: "Your Rule Book asks you to confirm this." },
  deny: { stamp: "BLOCKED", mark: "✕", text: "text-down", edge: "border-down", head: "Your Rule Book blocks this order." },
} as const;

/**
 * The guard strip under the ticket: the Rule Book verdict for exactly the
 * actions the button would sign (the same core evaluator runs again at
 * signing time and fails closed). A ruled strip with a small stamp.
 */
export function GuardStrip({ verdict, idle, className }: { readonly verdict: Verdict | null; readonly idle?: string; readonly className?: string }) {
  const { rules } = useTerminal();
  const openRules = () => useTerminalUi.getState().set({ rulesOpen: true });
  const summary = bookSummary(rules.book);
  if (!verdict) {
    return (
      <div className={cx("flex items-center gap-2.5 border-y-1.5 border-rule/30 py-1.5 text-[12px] leading-snug text-ink-2", className)} title={idle ?? "Every order is checked before the key signs."}>
        <span className="shrink-0 border-1.5 border-rule/50 px-1 font-mono text-[10px] font-semibold tracking-[0.1em] text-ink-2">RULE BOOK</span>
        <p className="min-w-0 flex-1 truncate font-mono text-[11px]">{summary}</p>
        <RulesButton onClick={openRules} />
      </div>
    );
  }
  const tone = TONE[verdict.decision];
  const lines = guardLines(verdict.reasons).slice(0, 3);
  return (
    <div role="status" aria-live="polite" className={cx("flex items-start gap-2.5 border-l-[3px] bg-paper/60 py-2 pl-2.5 pr-1 text-[12px] leading-snug", tone.edge, className)}>
      <span className={cx("mt-px inline-flex shrink-0 -rotate-2 items-center gap-1 border-2 border-current px-1.5 py-px font-mono text-[10px] font-bold tracking-[0.12em]", tone.text)}>
        <span aria-hidden="true">{tone.mark}</span>
        {tone.stamp}
      </span>
      <div className="min-w-0 flex-1">
        <p className={cx("font-medium", tone.text)}>{tone.head}</p>
        {lines.length > 0 ? (
          <ul className="mt-0.5 flex flex-col gap-0.5 text-ink-2">
            {lines.map((line) => (
              <li key={line.text} className="flex gap-1.5">
                <span aria-hidden="true" className={cx("shrink-0 font-mono", line.tone === "rose" ? "text-down" : line.tone === "gold" ? "text-warn-ink" : "text-up")}>
                  {line.tone === "rose" ? "✕" : line.tone === "gold" ? "!" : "✓"}
                </span>
                <span>{line.text}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="font-mono text-[11px] text-ink-3">
            {summary} · {verdict.passed} checks passed
          </p>
        )}
      </div>
      <RulesButton onClick={openRules} />
    </div>
  );
}

function RulesButton({ onClick }: { readonly onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-label="Edit your Rule Book" title="Rule Book" className={cx("inline-flex h-6 w-6 shrink-0 items-center justify-center text-ink-3 hover:bg-paper-2 hover:text-ink", FOCUS_RING)}>
      <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
    </button>
  );
}
