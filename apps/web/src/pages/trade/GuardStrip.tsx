import { ShieldAlert, ShieldCheck, ShieldX, SlidersHorizontal } from "lucide-react";

import { bookSummary, guardLines, type combineEvaluations } from "../../features/trading/guard";
import { cx, FOCUS_RING } from "../../ui/cx";
import { useTerminal } from "./terminalContext";
import { useTerminalUi } from "./terminalUi";

export type Verdict = ReturnType<typeof combineEvaluations>;

const TONE = {
  allow: { icon: ShieldCheck, text: "text-mint", box: "border-mint/25 bg-mint/[0.05]", head: "This order passes your Rule Book." },
  confirm: { icon: ShieldAlert, text: "text-gold", box: "border-gold/30 bg-gold/[0.06]", head: "Your Rule Book asks you to confirm this." },
  deny: { icon: ShieldX, text: "text-rose", box: "border-rose/35 bg-rose/[0.07]", head: "Your Rule Book blocks this order." },
} as const;

/**
 * The guard strip under the ticket: the Rule Book verdict for exactly the
 * actions the button would sign (the same core evaluator runs again at
 * signing time and fails closed).
 */
export function GuardStrip({ verdict, idle, className }: { readonly verdict: Verdict | null; readonly idle?: string; readonly className?: string }) {
  const { rules } = useTerminal();
  const openRules = () => useTerminalUi.getState().set({ rulesOpen: true });
  const summary = bookSummary(rules.book);
  if (!verdict) {
    return (
      <div className={cx("flex items-start gap-2 rounded-xl border border-line bg-bg-1/70 px-3 py-2.5 text-xs leading-relaxed text-text-2", className)}>
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-text-2" aria-hidden="true" />
        <p className="min-w-0 flex-1">
          <span className="text-text-1">Rule Book:</span> {summary}. {idle ?? "Every order is checked before the key signs."}
        </p>
        <RulesButton onClick={openRules} />
      </div>
    );
  }
  const tone = TONE[verdict.decision];
  const Icon = tone.icon;
  const lines = guardLines(verdict.reasons).slice(0, 3);
  return (
    <div role="status" aria-live="polite" className={cx("flex items-start gap-2 rounded-xl border px-3 py-2.5 text-xs leading-relaxed", tone.box, className)}>
      <Icon className={cx("mt-0.5 h-4 w-4 shrink-0", tone.text)} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className={cx("font-medium", tone.text)}>{tone.head}</p>
        {lines.length > 0 ? (
          <ul className="mt-0.5 flex flex-col gap-0.5 text-text-1">
            {lines.map((line) => (
              <li key={line.text} className="flex gap-1.5">
                <span aria-hidden="true" className={cx("mt-[7px] h-1 w-1 shrink-0 rounded-full", line.tone === "rose" ? "bg-rose" : line.tone === "gold" ? "bg-gold" : "bg-mint")} />
                <span>{line.text}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-text-2">
            {summary} · {verdict.passed} checks passed.
          </p>
        )}
      </div>
      <RulesButton onClick={openRules} />
    </div>
  );
}

function RulesButton({ onClick }: { readonly onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-label="Edit your Rule Book" title="Rule Book" className={cx("-mr-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-text-2 hover:bg-text-0/[0.06] hover:text-text-0", FOCUS_RING)}>
      <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
    </button>
  );
}
