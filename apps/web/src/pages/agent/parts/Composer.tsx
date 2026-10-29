import { forwardRef, useState } from "react";

import { Kbd } from "../../../ui/Kbd";
import { cx, FOCUS_RING } from "../../../ui/cx";

export interface ComposerProps {
  readonly onAsk: (question: string) => void;
  readonly starters: readonly string[];
  readonly history: readonly string[];
  readonly busy: boolean;
}

/**
 * "Ask the Guide": one line, Enter asks, ↑ recalls your last question,
 * starter questions under it. `A` focuses it from anywhere on the page.
 */
export const Composer = forwardRef<HTMLInputElement, ComposerProps>(function Composer({ onAsk, starters, history, busy }, ref) {
  const [value, setValue] = useState("");
  const [recall, setRecall] = useState(-1);
  const submit = () => {
    const text = value.trim();
    if (!text || busy) return;
    onAsk(text.slice(0, 400));
    setValue("");
    setRecall(-1);
  };
  return (
    <div className="flex flex-col gap-2.5">
      <ul className="flex flex-wrap gap-1.5" aria-label="Questions to start with">
        {starters.map((starter) => (
          <li key={starter}>
            <button type="button" onClick={() => onAsk(starter)} disabled={busy} className={cx("border-1.5 border-rule/50 bg-paper px-2.5 py-1 font-mono text-[12px] text-ink-2 transition-colors duration-fast hover:border-rule hover:bg-card hover:text-ink disabled:opacity-50", FOCUS_RING)}>
              “{starter}”
            </button>
          </li>
        ))}
      </ul>
      <form
        className="flex min-h-[56px] items-stretch border-2 border-rule bg-card shadow-hard focus-within:shadow-hard-lg"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <label htmlFor="guide-ask" className="flex shrink-0 items-center border-r-2 border-rule bg-ink px-3 font-sans text-[13px] font-bold uppercase tracking-[0.06em] text-paper sm:px-4">
          Ask<span className="hidden sm:inline">&nbsp;the Guide</span>
        </label>
        <input
          ref={ref}
          id="guide-ask"
          value={value}
          autoComplete="off"
          spellCheck={false}
          maxLength={400}
          onChange={(event) => {
            setValue(event.target.value);
            setRecall(-1);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowUp" && history.length > 0 && (value === "" || recall >= 0)) {
              event.preventDefault();
              const next = Math.min(recall + 1, history.length - 1);
              setRecall(next);
              setValue(history[history.length - 1 - next] ?? "");
            } else if (event.key === "Escape") {
              setValue("");
              setRecall(-1);
            }
          }}
          placeholder="“alert me if BTC drops below 90k”"
          className="min-w-0 flex-1 bg-transparent px-3 font-mono text-[14px] text-ink outline-none placeholder:text-ink-3 sm:px-4 sm:text-[15px]"
        />
        <span className="hidden items-center gap-1 px-2 font-mono text-[11px] text-ink-3 md:flex">
          <Kbd>A</Kbd> focus · <Kbd>↵</Kbd>
        </span>
        <button type="submit" disabled={busy || value.trim() === ""} className={cx("shrink-0 border-l-2 border-rule bg-accent px-4 font-sans text-[13px] font-bold uppercase tracking-[0.06em] text-accent-ink transition-opacity disabled:opacity-45", FOCUS_RING)}>
          Ask ▸
        </button>
      </form>
    </div>
  );
});
