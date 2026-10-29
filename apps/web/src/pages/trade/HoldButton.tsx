import { useEffect, useRef, useState, type ReactNode } from "react";

import { cx, FOCUS_RING } from "../../ui/cx";

export interface HoldButtonProps {
  readonly onConfirm: () => void;
  readonly holdMs?: number;
  readonly disabled?: boolean;
  readonly children: ReactNode;
  readonly className?: string;
}

/**
 * Hold to confirm (Flatten all): press and hold for `holdMs` with the
 * pointer, Space or Enter; letting go early cancels. Nothing fires on a
 * click, a stray key press or a key repeat.
 */
export function HoldButton({ onConfirm, holdMs = 1_500, disabled, children, className }: HoldButtonProps) {
  const [progress, setProgress] = useState(0);
  const startRef = useRef<number | null>(null);
  const frameRef = useRef(0);
  const doneRef = useRef(false);
  const confirmRef = useRef(onConfirm);
  useEffect(() => {
    confirmRef.current = onConfirm;
  });

  const stop = () => {
    startRef.current = null;
    window.cancelAnimationFrame(frameRef.current);
    if (!doneRef.current) setProgress(0);
  };

  const start = () => {
    if (disabled || startRef.current !== null || doneRef.current) return;
    startRef.current = performance.now();
    const tick = () => {
      if (startRef.current === null) return;
      const value = Math.min(1, (performance.now() - startRef.current) / holdMs);
      setProgress(value);
      if (value >= 1) {
        doneRef.current = true;
        startRef.current = null;
        confirmRef.current();
        return;
      }
      frameRef.current = window.requestAnimationFrame(tick);
    };
    frameRef.current = window.requestAnimationFrame(tick);
  };

  useEffect(() => () => window.cancelAnimationFrame(frameRef.current), []);

  return (
    <button
      type="button"
      disabled={disabled}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture?.(event.pointerId);
        start();
      }}
      onPointerUp={stop}
      onPointerCancel={stop}
      onPointerLeave={stop}
      onKeyDown={(event) => {
        if ((event.key === " " || event.key === "Enter") && !event.repeat) {
          event.preventDefault();
          start();
        }
      }}
      onKeyUp={(event) => {
        if (event.key === " " || event.key === "Enter") stop();
      }}
      onClick={(event) => event.preventDefault()}
      aria-describedby="hold-hint"
      className={cx(
        "relative h-14 w-full select-none overflow-hidden border-2 border-down bg-card font-sans text-[15px] font-bold uppercase tracking-[0.08em] text-down shadow-[3px_3px_0_rgb(var(--down))] transition-colors disabled:opacity-40 disabled:shadow-none",
        FOCUS_RING,
        className,
      )}
    >
      <span aria-hidden="true" className="absolute inset-y-0 left-0 border-r-2 border-rule bg-down" style={{ width: `${progress * 100}%` }} />
      <span className={cx("relative", progress > 0.55 && "text-card")}>{children}</span>
      <span id="hold-hint" className="sr-only">
        Press and hold for {Math.round(holdMs / 100) / 10} seconds to confirm.
      </span>
    </button>
  );
}
