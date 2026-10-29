import { X } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { usePageVisible } from "../motion/usePageVisible";
import { cx, FOCUS_RING } from "./cx";
import { getToasts, MAX_VISIBLE_TOASTS, subscribeToasts, toast as toastApi, type ToastRecord, type ToastTone } from "./toast";

const TONES: Readonly<Record<ToastTone, { mark: string; markClass: string; label: string }>> = {
  success: { mark: "◉", markClass: "text-up", label: "Done" },
  error: { mark: "✕", markClass: "text-down", label: "Alert" },
  info: { mark: "●", markClass: "text-summit-ink", label: "Note" },
  warning: { mark: "▲", markClass: "text-warn-ink", label: "Caution" },
};

function clock(at: number | undefined): string {
  if (at === undefined) return "";
  const date = new Date(at);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** One radio message from base camp: a timestamped call sign line, then the message in plain words. */
function ToastItem({ item, pageVisible }: { readonly item: ToastRecord; readonly pageVisible: boolean }) {
  const [held, setHeld] = useState(false);
  const persistent = item.duration === "persistent";
  const duration = persistent ? 0 : (item.duration as number);
  const halted = held || !pageVisible || item.leaving || persistent;
  const remainingRef = useRef(duration);
  const revisionRef = useRef(item.revision);
  const tone = TONES[item.tone];

  useEffect(() => {
    if (revisionRef.current !== item.revision) {
      revisionRef.current = item.revision;
      remainingRef.current = duration;
    }
    if (halted) return undefined;
    const startedAt = performance.now();
    const timer = window.setTimeout(() => toastApi.dismiss(item.id), Math.max(0, remainingRef.current));
    return () => {
      window.clearTimeout(timer);
      remainingRef.current -= performance.now() - startedAt;
    };
  }, [halted, item.id, item.revision, duration]);

  return (
    <li
      onPointerEnter={() => setHeld(true)}
      onPointerLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={() => setHeld(false)}
      className={cx(
        "pointer-events-auto relative w-full border-2 border-rule bg-card shadow-hard-lg",
        item.leaving ? "opacity-0 transition-opacity duration-fast" : "animate-rise-in",
      )}
    >
      <div className="flex items-center gap-2 border-b-1.5 border-dashed border-rule/50 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.1em] text-ink-2">
        <span aria-hidden="true" className={tone.markClass}>
          {tone.mark}
        </span>
        <span className="tnum">{clock(item.at)}</span>
        <span aria-hidden="true">·</span>
        <span className="font-semibold text-ink">{item.from ?? "BASE"}</span>
        <span aria-hidden="true">→ YOU</span>
        <button
          type="button"
          aria-label="Dismiss message"
          onClick={() => toastApi.dismiss(item.id)}
          className={cx("-mr-1 ml-auto inline-flex h-6 w-6 items-center justify-center text-ink-3 transition-colors hover:bg-ink hover:text-paper", FOCUS_RING)}
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>
      <div className="px-3 pb-3 pt-2">
        <p className="text-sm font-bold text-ink">
          <span className="sr-only">{tone.label}: </span>
          {item.title}
        </p>
        {item.description ? <p className="mt-0.5 text-[13px] leading-snug text-ink-2">{item.description}</p> : null}
        {item.action ? (
          <button
            type="button"
            onClick={() => {
              item.action?.onClick();
              toastApi.dismiss(item.id);
            }}
            className={cx("mt-2 font-mono text-xs font-semibold uppercase tracking-[0.08em] text-summit-ink underline decoration-2 underline-offset-4 hover:text-ink", FOCUS_RING)}
          >
            {item.action.label} →
          </button>
        ) : null}
      </div>
    </li>
  );
}

const serverEmpty = (): readonly ToastRecord[] => [];

/** Renders the radio messages: bottom-right on desktop, above the bottom bar on phones. Polite for info, assertive for errors. */
export function Toaster() {
  const items = useSyncExternalStore(subscribeToasts, getToasts, serverEmpty);
  const pageVisible = usePageVisible();
  const visible = items.slice(0, MAX_VISIBLE_TOASTS);
  const urgent = visible.filter((item) => item.tone === "error" || item.tone === "warning");
  const calm = visible.filter((item) => item.tone !== "error" && item.tone !== "warning");
  return (
    <div className="pointer-events-none fixed inset-x-3 bottom-[calc(76px+env(safe-area-inset-bottom))] z-[90] flex flex-col items-end gap-2 md:inset-x-auto md:bottom-6 md:right-6 md:w-[380px]">
      <ol aria-live="assertive" aria-relevant="additions" className="flex w-full flex-col gap-2">
        {urgent.map((item) => (
          <ToastItem key={item.id} item={item} pageVisible={pageVisible} />
        ))}
      </ol>
      <ol aria-live="polite" aria-relevant="additions" className="flex w-full flex-col gap-2">
        {calm.map((item) => (
          <ToastItem key={item.id} item={item} pageVisible={pageVisible} />
        ))}
      </ol>
    </div>
  );
}
