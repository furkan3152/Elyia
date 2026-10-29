import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { usePageVisible } from "../motion/usePageVisible";
import { cx, FOCUS_RING } from "./cx";
import { getToasts, MAX_VISIBLE_TOASTS, subscribeToasts, toast as toastApi, type ToastRecord, type ToastTone } from "./toast";

const TONES: Readonly<Record<ToastTone, { icon: typeof Info; iconClass: string; edge: string; label: string }>> = {
  success: { icon: CircleCheck, iconClass: "text-mint", edge: "before:bg-mint", label: "Success" },
  error: { icon: CircleAlert, iconClass: "text-rose", edge: "before:bg-rose", label: "Error" },
  info: { icon: Info, iconClass: "text-sky", edge: "before:bg-sky", label: "Info" },
  warning: { icon: TriangleAlert, iconClass: "text-gold", edge: "before:bg-gold", label: "Warning" },
};

function ToastItem({ item, pageVisible }: { readonly item: ToastRecord; readonly pageVisible: boolean }) {
  const [held, setHeld] = useState(false);
  const persistent = item.duration === "persistent";
  const duration = persistent ? 0 : (item.duration as number);
  const halted = held || !pageVisible || item.leaving || persistent;
  const remainingRef = useRef(duration);
  const revisionRef = useRef(item.revision);
  const tone = TONES[item.tone];
  const Icon = tone.icon;

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
        "pointer-events-auto relative flex w-full items-start gap-3 overflow-hidden rounded-2xl border border-line-strong bg-bg-1/95 py-3.5 pl-4 pr-3 shadow-raised backdrop-blur",
        "before:absolute before:inset-y-0 before:left-0 before:w-[3px]",
        tone.edge,
        item.leaving ? "opacity-0 transition-opacity duration-fast" : "animate-rise-in",
      )}
    >
      <Icon className={cx("mt-0.5 h-4 w-4 shrink-0", tone.iconClass)} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-text-0">
          <span className="sr-only">{tone.label}: </span>
          {item.title}
        </p>
        {item.description ? <p className="mt-0.5 text-[13px] text-text-1">{item.description}</p> : null}
        {item.action ? (
          <button
            type="button"
            onClick={() => {
              item.action?.onClick();
              toastApi.dismiss(item.id);
            }}
            className={cx("mt-2 text-[13px] font-semibold text-violet-soft underline-offset-4 hover:underline", FOCUS_RING)}
          >
            {item.action.label}
          </button>
        ) : null}
      </div>
      <button
        type="button"
        aria-label="Dismiss notification"
        onClick={() => toastApi.dismiss(item.id)}
        className={cx("rounded-md p-1 text-text-2 transition-colors hover:text-text-0", FOCUS_RING)}
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </li>
  );
}

const serverEmpty = (): readonly ToastRecord[] => [];

/** Renders the toast queue: bottom-right on desktop, above the bottom bar on phones. Polite for info, assertive for errors. */
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
