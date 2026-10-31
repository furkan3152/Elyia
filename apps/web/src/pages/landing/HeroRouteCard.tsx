import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

import { navigate } from "../../app/routes/useRoute";
import { useResolvedTheme } from "../../app/state/useTheme";
import { useAutoPause } from "../../motion/useAutoPause";
import { intentHref } from "../../oracle/preview";
import { PixelCanvas } from "../../pixel/PixelCanvas";
import { Blaze } from "../../topo/Blaze";
import type { Layer } from "../../topo/geometry/relief";
import { cx } from "../../ui/cx";
import { Kbd } from "../../ui/Kbd";
import { elyLayer, paintStub, STUB_H, STUB_LAYERS, type HopState } from "./altitudeStub";
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

const CELLS: Readonly<Record<Layer, { readonly name: string; readonly net: string; readonly what: string; readonly tone: string }>> = {
  floor: { name: "Floor", net: "HyperCore", what: "perps, spot", tone: "text-floor" },
  ridge: { name: "Ridge", net: "HyperEVM", what: "stake, swap", tone: "text-ridge" },
  summit: { name: "Summit", net: "Elysium", what: "bridge, pools", tone: "text-summit-ink" },
};

function Chip({ chip }: { readonly chip: SentenceChip }) {
  const lev = chip.kind === "leverage";
  return (
    <li
      className={cx(
        "inline-flex h-7 items-center gap-1.5 px-2 font-tag text-[11px] uppercase px-frame-thin",
        lev ? "bg-signal text-[#16201B]" : "bg-card text-ink",
        chip.direction === "up" && "text-up",
        chip.direction === "down" && "text-down",
      )}
    >
      {chip.direction === "up" ? <span aria-hidden="true">▲</span> : chip.direction === "down" ? <span aria-hidden="true">▼</span> : chip.kind === "trigger" ? <span aria-hidden="true">⚓</span> : null}
      {chip.text}
    </li>
  );
}

/** The card's stub: three altitude steps; Ely stands on the highest layer the sentence travels and hops when it changes. */
function AltitudeStub({ layersKey }: { readonly layersKey: string }) {
  const theme = useResolvedTheme();
  const hop = useRef<HopState>({ from: 1 / 6, to: 1 / 6, start: 0 });
  const layers = useMemo(() => new Set(layersKey.split("+").filter(Boolean) as Layer[]), [layersKey]);
  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, info: { readonly w: number; readonly seconds: number; readonly still: boolean }) => {
      const styles = getComputedStyle(ctx.canvas);
      const token = (name: string, fallback: string) => {
        const value = styles.getPropertyValue(name).trim().split(/\s+/u).join(",");
        return value ? `rgb(${value})` : fallback;
      };
      paintStub(ctx, info.w, { touched: layers, seconds: info.seconds, still: info.still, fog: token("--card", "#FFF9EC"), line: token("--ink", "#16201B"), hop: hop.current });
    },
    [layers],
  );
  return <PixelCanvas width={200} height={STUB_H} pixelSize={3} draw={draw} animate fps={12} endTime={0} decorative redrawKey={`${layersKey}|${theme}`} />;
}

/**
 * The "WHERE TO?" route card: write a sentence, see what Elyia heard (chips,
 * the altitudes it travels, a first grade) and press Enter to plan it in the
 * deck. An empty card plans the example it is showing.
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
  const stand = elyLayer(layers);

  return (
    <form
      ref={ref}
      id={formId}
      role="search"
      aria-label="Plan a route"
      className="relative w-full bg-card text-left px-frame px-drop-lg"
      onSubmit={(event) => {
        event.preventDefault();
        navigate(intentHref(sentence));
      }}
    >
      <div className="flex items-center justify-between gap-3 px-4 py-2.5 font-tag text-[11px] uppercase text-ink-2">
        <span>
          Route card · {text.trim() ? "yours" : "example"}
          <span className="hidden sm:inline"> · {reading.source === "api" ? "read by Elyia" : "first reading"}</span>
        </span>
        <span className="inline-flex shrink-0 items-center gap-2 text-ink">
          {grade ? (
            <>
              <Blaze grade={grade} size={14} label={null} />
              Grade T{grade}
            </>
          ) : (
            "Grade —"
          )}
        </span>
      </div>

      <div className="flex min-h-[60px] items-stretch border-y-4 border-rule">
        <label htmlFor={inputId} className="flex shrink-0 items-center bg-ink px-3 font-display text-[16px] font-bold uppercase text-paper sm:px-4 sm:text-[19px]">
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
          className="min-w-0 flex-1 bg-transparent px-3 font-mono text-[15px] text-ink outline-none placeholder:text-ink-3 focus-visible:bg-paper-2 sm:text-base"
        />
        <span aria-hidden="true" className="hidden items-center pr-4 sm:flex">
          <Kbd>↵</Kbd>
        </span>
      </div>
      <p id={hintId} className="sr-only">
        Write what you want in one sentence, in English or Turkish, then press Enter to plan it in the deck.
      </p>

      <ul aria-label={text.trim() ? "What Elyia heard" : "What Elyia hears in the example"} className="m-0 flex min-h-[60px] list-none flex-wrap items-center justify-center gap-3 px-4 py-3">
        {reading.chips.map((chip, index) => (
          <Chip key={`${chip.text}-${index}`} chip={chip} />
        ))}
      </ul>

      {/* perforation between the card and its stub */}
      <div aria-hidden="true" className="h-1 px-rule" />

      <div className="px-4 pt-4">
        <AltitudeStub layersKey={STUB_LAYERS.filter((layer) => layers.has(layer)).join("+")} />
      </div>
      <ol aria-label="Altitudes this route travels" className="m-0 grid list-none grid-cols-3 px-4 pb-4 pt-2 text-center">
        {STUB_LAYERS.map((layer) => {
          const cell = CELLS[layer];
          const on = layers.has(layer);
          return (
            <li key={layer} className="flex min-w-0 flex-col items-center gap-0.5">
              <span className={cx("font-tag text-[12px] uppercase", on ? cell.tone : "text-ink-3")}>
                {cell.name} {on ? <span aria-label="on this route">✓</span> : <span className="sr-only">not on this route</span>}
                {stand === layer ? <span className="sr-only">, Ely stands here</span> : null}
              </span>
              <span className="truncate font-mono text-[11px] text-ink-2">
                {cell.net}
                <span className="hidden sm:inline"> · {cell.what}</span>
              </span>
            </li>
          );
        })}
      </ol>
    </form>
  );
}
