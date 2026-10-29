import { useEffect, useId, useState } from "react";

import { navigate } from "../../app/routes/useRoute";
import { useAutoPause } from "../../motion/useAutoPause";
import { intentHref } from "../../oracle/preview";
import { Blaze } from "../../topo/Blaze";
import type { Layer } from "../../topo/geometry/relief";
import { cx } from "../../ui/cx";
import { Kbd } from "../../ui/Kbd";
import { PLACEHOLDER_EXAMPLES, sentenceGrade, sentenceLayers, type SentenceChip } from "./model";
import { useSentenceChips } from "./useSentenceChips";

const TYPE_MS = 42;
const HOLD_MS = 2_400;
const ERASE_MS = 16;

/**
 * The placeholder types real sentences out (English and Turkish), holds,
 * erases and moves on. Paused while the card is off screen, the tab is
 * hidden, the field has focus or text; reduced motion shows the first
 * example whole.
 */
function useTypedExample(active: boolean): { readonly shown: string; readonly example: string } {
  const [state, setState] = useState({ index: 0, length: PLACEHOLDER_EXAMPLES[0]!.length, phase: "hold" as "type" | "hold" | "erase" });
  useEffect(() => {
    if (!active) return undefined;
    const example = PLACEHOLDER_EXAMPLES[state.index]!;
    const delay = state.phase === "type" ? TYPE_MS : state.phase === "hold" ? HOLD_MS : ERASE_MS;
    const timer = window.setTimeout(() => {
      setState((previous) => {
        if (previous.phase === "type") return previous.length >= example.length ? { ...previous, phase: "hold" } : { ...previous, length: previous.length + 1 };
        if (previous.phase === "hold") return { ...previous, phase: "erase" };
        if (previous.length > 0) return { ...previous, length: previous.length - 1 };
        return { index: (previous.index + 1) % PLACEHOLDER_EXAMPLES.length, length: 0, phase: "type" };
      });
    }, delay);
    return () => window.clearTimeout(timer);
  }, [active, state]);
  const example = PLACEHOLDER_EXAMPLES[state.index]!;
  return { shown: active ? example.slice(0, state.length) : example, example };
}

const LAYER_CELLS: ReadonlyArray<{ readonly layer: Layer; readonly name: string; readonly what: string; readonly tone: string }> = [
  { layer: "floor", name: "FLOOR", what: "HyperCore · perps, spot", tone: "text-floor" },
  { layer: "ridge", name: "RIDGE", what: "HyperEVM · stake, swap", tone: "text-ridge" },
  { layer: "summit", name: "SUMMIT", what: "Elysium · bridge, pools", tone: "text-summit-ink" },
];

function Chip({ chip }: { readonly chip: SentenceChip }) {
  const lev = chip.kind === "leverage";
  return (
    <li
      className={cx(
        "inline-flex h-7 items-center gap-1 border-1.5 border-rule px-2 font-mono text-[12px] uppercase tracking-[0.04em]",
        lev ? "bg-signal/45 text-ink" : "bg-card text-ink",
        chip.direction === "up" && "text-up",
        chip.direction === "down" && "text-down",
      )}
    >
      {chip.direction === "up" ? <span aria-hidden="true">▲</span> : chip.direction === "down" ? <span aria-hidden="true">▼</span> : chip.kind === "trigger" ? <span aria-hidden="true">⚓</span> : null}
      {chip.text}
    </li>
  );
}

/**
 * The hero's "WHERE TO?" route card: write a sentence, see what Elyia heard
 * (chips, the altitudes it travels, a first grade) and press Enter to plan
 * it in the deck. An empty card plans the example it is showing.
 */
export function HeroRouteCard({ formId }: { readonly formId?: string }) {
  const inputId = useId();
  const hintId = useId();
  const [text, setText] = useState("");
  const [focused, setFocused] = useState(false);
  const { ref, active } = useAutoPause<HTMLFormElement>();
  const typing = active && !focused && text.length === 0;
  const { shown, example } = useTypedExample(typing);
  const sentence = text.trim().length > 0 ? text : example;
  const reading = useSentenceChips(sentence);
  const layers = sentenceLayers(sentence);
  const grade = sentenceGrade(sentence);

  return (
    <form
      ref={ref}
      id={formId}
      role="search"
      aria-label="Plan a route"
      className="relative border-2 border-rule bg-card shadow-hard-lg"
      onSubmit={(event) => {
        event.preventDefault();
        navigate(intentHref(sentence));
      }}
    >
      <div className="flex items-center justify-between gap-3 border-b-1.5 border-dashed border-rule px-4 py-2.5 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-2">
        <span>
          Route card · {text.trim() ? "yours" : "example"}
          <span className="hidden sm:inline"> · {reading.source === "api" ? "read by Elyia" : "first reading"}</span>
        </span>
        <span className="inline-flex shrink-0 items-center gap-1.5 text-ink">
          {grade ? (
            <>
              <Blaze grade={grade} size={13} label={null} />
              Grade T{grade}
            </>
          ) : (
            "Grade —"
          )}
        </span>
      </div>

      <div className="flex min-h-[58px] items-stretch">
        <label htmlFor={inputId} className="el-blade relative flex shrink-0 items-center bg-ink pl-3.5 pr-6 text-[15px] font-bold uppercase tracking-[0.06em] text-paper sm:text-base">
          Where to?
        </label>
        <input
          id={inputId}
          value={text}
          onChange={(event) => setText(event.target.value.slice(0, 500))}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={shown}
          aria-describedby={hintId}
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="go"
          className="min-w-0 flex-1 bg-transparent px-3 font-mono text-[15px] text-ink outline-none placeholder:text-ink-3 sm:text-base"
        />
        <span aria-hidden="true" className="hidden items-center pr-3 sm:flex">
          <Kbd>↵</Kbd>
        </span>
      </div>
      <p id={hintId} className="sr-only">
        Write what you want in one sentence, in English or Turkish, then press Enter to plan it in the deck.
      </p>

      <ul aria-label={text.trim() ? "What Elyia heard" : "What Elyia hears in the example"} className="flex min-h-[44px] flex-wrap items-center gap-1.5 border-t-1.5 border-rule px-4 py-2.5">
        {reading.chips.map((chip, index) => (
          <Chip key={`${chip.text}-${index}`} chip={chip} />
        ))}
      </ul>

      {/* perforation between the card and its stub */}
      <div aria-hidden="true" className="relative h-0 border-t-2 border-dashed border-rule">
        <span className="absolute -left-[11px] -top-[9px] h-4 w-4 rounded-full border-2 border-rule bg-paper [clip-path:inset(0_0_0_50%)]" />
        <span className="absolute -right-[11px] -top-[9px] h-4 w-4 rounded-full border-2 border-rule bg-paper [clip-path:inset(0_50%_0_0)]" />
      </div>
      <ol aria-label="Altitudes this route travels" className="grid grid-cols-3">
        {LAYER_CELLS.map((cell, index) => {
          const on = layers.has(cell.layer);
          return (
            <li key={cell.layer} className={cx("flex min-w-0 flex-col gap-0.5 px-3 py-2.5 sm:px-4", index > 0 && "border-l-1.5 border-rule", on ? "bg-paper-2" : "")}>
              <span className={cx("font-sans text-[13px] font-bold tracking-[0.06em]", on ? cell.tone : "text-ink-3")}>
                {cell.name} {on ? <span aria-label="on this route">✓</span> : <span className="sr-only">not on this route</span>}
              </span>
              <span className="truncate font-mono text-[11px] text-ink-2">
                {cell.what.split(" · ")[0]}
                <span className="hidden sm:inline"> · {cell.what.split(" · ")[1]}</span>
              </span>
            </li>
          );
        })}
      </ol>
    </form>
  );
}
