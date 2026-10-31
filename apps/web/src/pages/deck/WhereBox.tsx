import { useRef, useState } from "react";

import { navigate } from "../../app/routes/history";
import { useOracleStore } from "../../oracle/oracleStore";
import { intentHref, matchCommand } from "../../oracle/preview";
import { Chip } from "../../ui/Badge";
import { Button } from "../../ui/Button";
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
    <div className="mx-auto w-full max-w-[880px]">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          go(text);
        }}
        role="search"
        aria-label="Where to? Say what you want in one sentence"
      >
        <div className="flex flex-col items-stretch gap-6 sm:flex-row">
          <WhereToInput
            ref={input}
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              setDraft(event.target.value);
            }}
            placeholder="long ETH 5x with 200 USDC, stop at -3%"
            maxLength={500}
            containerClassName="h-16 sm:h-[72px] sm:flex-1"
            className="text-base sm:text-lg"
            aside={
              <span className="hidden items-center gap-1 pr-1 lg:flex" aria-hidden="true">
                <span className="font-tag text-[11px] uppercase text-ink-3">anywhere</span>
                <Kbd>{modShortcutLabel("K")}</Kbd>
              </span>
            }
          />
          <Button type="submit" variant="primary" size="xl" className="h-14 shrink-0 sm:h-[72px]">
            Plan route ▸
          </Button>
        </div>
      </form>
      <ul className="mt-8 flex flex-wrap items-center justify-center gap-4" aria-label="Example sentences">
        <li className="font-tag text-[11px] uppercase text-ink-3">try</li>
        {EXAMPLES.map((example) => (
          <li key={example}>
            <Chip
              mono
              onClick={() => {
                setText(example);
                setDraft(example);
                input.current?.focus();
              }}
            >
              {example}
            </Chip>
          </li>
        ))}
      </ul>
    </div>
  );
}
