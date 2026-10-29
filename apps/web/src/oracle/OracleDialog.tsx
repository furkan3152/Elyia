import { ArrowRight, CornerDownLeft, Sparkles } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

import { navigate } from "../app/routes/history";
import { cx } from "../ui/cx";
import { Kbd } from "../ui/Kbd";
import { ModalLayer } from "../ui/overlay/ModalLayer";
import { IntentChips } from "./IntentChips";
import { useOracleStore } from "./oracleStore";
import { EXAMPLE_INTENTS, intentHref, matchCommand, previewChips } from "./preview";

interface Suggestion {
  readonly id: string;
  readonly text: string;
  readonly hint: string;
  readonly run: () => void;
}

/**
 * The Oracle (⌘K): "Speak your intent." One input; as the user types, the
 * words are coloured by role; Enter plans the sentence (navigation commands
 * such as "go trade ETH" open their page directly). Planning itself belongs
 * to the intent API: today a sentence is handed to the deck as ?intent=, where
 * the planner picks it up. Nothing moves until the user signs.
 */
export function OracleDialog() {
  const open = useOracleStore((state) => state.open);
  const draft = useOracleStore((state) => state.draft);
  const setDraft = useOracleStore((state) => state.setDraft);
  const close = useOracleStore((state) => state.closeOracle);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const [active, setActive] = useState(0);

  const text = draft;

  // Reopening keeps the last sentence but selects it, so typing starts a new one.
  useEffect(() => {
    if (!open) return undefined;
    const frame = window.requestAnimationFrame(() => inputRef.current?.select());
    return () => window.cancelAnimationFrame(frame);
  }, [open]);
  const chips = useMemo(() => previewChips(text), [text]);
  const command = useMemo(() => matchCommand(text), [text]);

  const go = useCallback(
    (href: string) => {
      close();
      setDraft("");
      navigate(href);
    },
    [close, setDraft],
  );

  const suggestions: Suggestion[] = useMemo(() => {
    const trimmed = text.trim();
    const items: Suggestion[] = [];
    if (trimmed) {
      if (command) items.push({ id: "command", text: command.label, hint: "open", run: () => go(command.href) });
      else items.push({ id: "plan", text: `Plan “${trimmed}”`, hint: "plan", run: () => go(intentHref(trimmed)) });
    }
    const query = trimmed.toLowerCase();
    for (const example of EXAMPLE_INTENTS) {
      if (query && (!example.toLowerCase().includes(query) || example.toLowerCase() === query)) continue;
      items.push({ id: `example:${example}`, text: example, hint: "example", run: () => setDraft(example) });
    }
    if (!trimmed) {
      items.push({ id: "go-trade", text: "go trade ETH", hint: "command", run: () => setDraft("go trade ETH") });
      items.push({ id: "go-pulse", text: "go pulse", hint: "command", run: () => go("/elysium") });
    }
    return items.slice(0, 7);
  }, [text, command, go, setDraft]);

  const selected = Math.min(active, Math.max(0, suggestions.length - 1));

  return (
    <ModalLayer
      open={open}
      onClose={close}
      ariaLabel="The Oracle: speak your intent"
      initialFocusRef={inputRef}
      placement="top"
      panelClassName="w-full max-w-[760px] animate-dialog-in overflow-hidden rounded-3xl border border-violet-glow/30 bg-bg-1 shadow-glow-violet"
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          suggestions[selected]?.run();
        }}
      >
        <div className="flex items-center gap-3 border-b border-line px-5 py-4 sm:px-6 sm:py-5">
          <span aria-hidden="true" className="relative flex h-5 w-5 shrink-0 items-center justify-center">
            <span className="absolute inset-0 rounded-full border border-gold/50" />
            <span className="h-2.5 w-2.5 rounded-full bg-gold shadow-glow-gold" />
          </span>
          <input
            ref={inputRef}
            value={text}
            onChange={(event) => {
              setDraft(event.target.value);
              setActive(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActive((value) => (suggestions.length === 0 ? 0 : (Math.min(value, suggestions.length - 1) + 1) % suggestions.length));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setActive((value) => (suggestions.length === 0 ? 0 : (Math.min(value, suggestions.length - 1) - 1 + suggestions.length) % suggestions.length));
              }
            }}
            placeholder="Speak your intent… e.g. long ETH 5x with 200 USDC"
            aria-label="Your intent"
            aria-controls={listId}
            aria-activedescendant={suggestions[selected] ? `${listId}-${selected}` : undefined}
            autoComplete="off"
            spellCheck={false}
            maxLength={500}
            className="min-w-0 flex-1 bg-transparent text-lg text-text-0 outline-none placeholder:text-text-2 sm:text-xl"
          />
          <Kbd className="hidden sm:inline-flex">esc</Kbd>
        </div>
        {chips.length > 0 ? (
          <div className="border-b border-line px-5 py-3 sm:px-6">
            <IntentChips tokens={chips} />
          </div>
        ) : null}
        <ul id={listId} role="listbox" aria-label="Suggestions" className="max-h-[50vh] overflow-y-auto p-2">
          {suggestions.map((suggestion, index) => (
            <li
              key={suggestion.id}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === selected}
              onMouseEnter={() => setActive(index)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => suggestion.run()}
              className={cx(
                "flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] transition-colors duration-fast",
                index === selected ? "bg-violet/[0.14] text-text-0" : "text-text-1",
              )}
            >
              {suggestion.hint === "plan" || suggestion.hint === "open" ? (
                <ArrowRight className="h-4 w-4 shrink-0 text-gold" aria-hidden="true" />
              ) : (
                <Sparkles className="h-4 w-4 shrink-0 text-violet-soft" aria-hidden="true" />
              )}
              <span className="min-w-0 flex-1 truncate">{suggestion.text}</span>
              <span className="label-caps shrink-0">{suggestion.hint}</span>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-5 py-3 text-xs text-text-2 sm:px-6">
          <span>Nothing moves until you sign in your own wallet.</span>
          <span className="flex items-center gap-1.5">
            <Kbd>
              <CornerDownLeft className="h-3 w-3" aria-hidden="true" />
            </Kbd>
            to plan
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd>
            to choose
          </span>
        </div>
      </form>
    </ModalLayer>
  );
}
