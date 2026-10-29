import { useRef, useState } from "react";

import { navigate } from "../../app/routes/history";
import { useOracleStore } from "../../oracle/oracleStore";
import { intentHref, matchCommand } from "../../oracle/preview";
import { cx, FOCUS_RING } from "../../ui/cx";
import { Kbd } from "../../ui/Kbd";
import { modShortcutLabel } from "../../ui/platform";
import { WhereToInput } from "../../ui/WhereToInput";

const EXAMPLES = ["long ETH 5x with 200 USDC, stop at -3%", "bridge 20 HYPE to Elysium and swap half to USDC", "stake 10 HYPE to kHYPE", "twap buy 40 HYPE over 30 minutes"] as const;

export interface WhereBoxProps {
  readonly initial?: string;
  /** Called with every planned sentence (the recent routes log). */
  readonly onPlan?: (sentence: string) => void;
  /** Keep `?as=` when planning while watching an address. */
  readonly viewAs?: string | null;
}

/**
 * The deck's one sentence box: "WHERE TO?". Enter plans the sentence
 * (`/app?intent=`); a page or market command ("go trade ETH", "portfolio
 * 0x…") navigates straight away. What you type also seeds ⌘K, so the global
 * signpost opens where you left off.
 */
export function WhereBox({ initial = "", onPlan, viewAs }: WhereBoxProps) {
  const [text, setText] = useState(initial);
  const input = useRef<HTMLInputElement>(null);
  const setDraft = useOracleStore((state) => state.setDraft);
  const go = (sentence: string) => {
    const value = sentence.trim();
    if (!value) {
      input.current?.focus();
      return;
    }
    const command = matchCommand(value);
    if (command) {
      navigate(command.href);
      return;
    }
    onPlan?.(value);
    const href = intentHref(value);
    navigate(viewAs ? `${href}&as=${viewAs}` : href);
  };

  return (
    <div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          go(text);
        }}
        role="search"
        aria-label="Where to? Say what you want in one sentence"
      >
        <div className="flex items-stretch gap-3">
          <WhereToInput
            ref={input}
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              setDraft(event.target.value);
            }}
            placeholder="long ETH 5x with 200 USDC, stop at -3%"
            maxLength={500}
            containerClassName="h-16 sm:h-[72px]"
            className="text-base sm:text-lg"
            aside={
              <span className="hidden items-center gap-1 pr-1 sm:flex" aria-hidden="true">
                <span className="font-mono text-[11px] text-ink-3">anywhere</span>
                <Kbd>{modShortcutLabel("K")}</Kbd>
              </span>
            }
          />
          <button
            type="submit"
            className={cx(
              "hidden shrink-0 items-center gap-2 border-2 border-rule bg-accent px-6 font-sans text-[15px] font-bold uppercase tracking-[0.06em] text-accent-ink shadow-hard transition-[transform,box-shadow] duration-instant hover:-translate-x-px hover:-translate-y-px hover:shadow-hard-lg active:translate-x-[3px] active:translate-y-[3px] active:shadow-none sm:flex",
              FOCUS_RING,
            )}
          >
            Plan route →
          </button>
        </div>
        <button type="submit" className={cx("mt-3 flex h-12 w-full items-center justify-center border-2 border-rule bg-accent font-sans text-sm font-bold uppercase tracking-[0.06em] text-accent-ink shadow-hard sm:hidden", FOCUS_RING)}>
          Plan route →
        </button>
      </form>
      <ul className="mt-4 flex flex-wrap items-center gap-2" aria-label="Example sentences">
        <li className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3">try</li>
        {EXAMPLES.map((example) => (
          <li key={example}>
            <button
              type="button"
              onClick={() => {
                setText(example);
                setDraft(example);
                input.current?.focus();
              }}
              className={cx("border-1.5 border-rule/50 bg-card px-2.5 py-1 font-mono text-xs text-ink-2 transition-colors duration-fast hover:border-rule hover:text-ink", FOCUS_RING)}
            >
              {example}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
