import { useId, useMemo, useState } from "react";

import { navigate } from "../../app/routes/history";
import { IntentChips } from "../../oracle/IntentChips";
import { intentHref, matchCommand, previewChips } from "../../oracle/preview";
import { openOracle } from "../../oracle/oracleStore";
import { Button } from "../../ui/Button";
import { Kbd } from "../../ui/Kbd";
import { isApplePlatform } from "../../ui/platform";

const FIRST_SENTENCE = "long ETH 5x with 200 USDC, stop at -3%";

/**
 * The landing page's Oracle field. Typing colours the words as Elyia hears
 * them; "Plan it" opens the deck with the sentence (/app?intent=…), where the
 * planner picks it up. Navigation commands ("go trade ETH") open their page.
 */
export function HeroOracle() {
  const id = useId();
  const [text, setText] = useState(FIRST_SENTENCE);
  const chips = useMemo(() => previewChips(text), [text]);
  const apple = isApplePlatform();

  return (
    <form
      className="flex max-w-[640px] flex-col gap-3.5"
      onSubmit={(event) => {
        event.preventDefault();
        const sentence = text.trim();
        if (!sentence) {
          openOracle();
          return;
        }
        const command = matchCommand(sentence);
        navigate(command ? command.href : intentHref(sentence));
      }}
    >
      <label htmlFor={id} className="flex items-center gap-2 font-mono text-xs tracking-[0.12em] text-text-2">
        SPEAK YOUR INTENT
        <span className="inline-flex items-center gap-1" aria-hidden="true">
          <Kbd>{apple ? "⌘" : "Ctrl"}</Kbd>
          <Kbd>K</Kbd>
        </span>
      </label>
      <div className="flex items-center gap-3 rounded-[18px] border border-violet-glow/35 bg-bg-2/85 py-2.5 pl-4 pr-2.5 shadow-glow-violet transition-[border-color,box-shadow] duration-base focus-within:border-violet-glow/70 sm:py-3 sm:pl-5">
        <span aria-hidden="true" className="relative flex h-5 w-5 shrink-0 items-center justify-center">
          <span className="absolute inset-0 rounded-full border border-gold/45" />
          <span className="h-2.5 w-2.5 rounded-full bg-gold shadow-glow-gold" />
        </span>
        <input
          id={id}
          value={text}
          onChange={(event) => setText(event.target.value)}
          maxLength={500}
          autoComplete="off"
          spellCheck={false}
          placeholder="bridge 20 HYPE to Elysium and swap half to USDC"
          className="min-w-0 flex-1 bg-transparent text-base text-text-0 outline-none placeholder:text-text-2 sm:text-lg"
        />
        <Button type="submit" variant="gold" size="md" className="shrink-0">
          Plan it
        </Button>
      </div>
      <div className="min-h-8">
        <IntentChips tokens={chips} />
      </div>
    </form>
  );
}
