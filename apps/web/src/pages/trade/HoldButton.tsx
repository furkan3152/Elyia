import { useEffect, useRef, useState, type ReactNode } from "react";

import { cx, FOCUS_RING } from "../../ui/cx";

export interface HoldButtonProps {
  readonly onConfirm: () => void;
  readonly holdMs?: number;
  readonly disabled?: boolean;
  /** Hold progress 0..1 (0 again when let go early), for a drawing that follows the hold. */
  readonly onProgress?: (progress: number) => void;
  readonly children: ReactNode;
  readonly className?: string;
}

/**
 * Hold to confirm (Flatten all): press and hold for `holdMs` with the
 * pointer, Space or Enter; letting go early cancels. Nothing fires on a
 * click, a stray key press or a key repeat.
 */
export function HoldButton({ onConfirm, holdMs = 1_500, disabled, onProgress, children, className }: HoldButtonProps) {
  const [progress, setProgress] = useState(0);
  const startRef = useRef<number | null>(null);
  const frameRef = useRef(0);
  const doneRef = useRef(false);
  const confirmRef = useRef(onConfirm);
  const progressRef = useRef(onProgress);
  useEffect(() => {
    confirmRef.current = onConfirm;
    progressRef.current = onProgress;
  });

  const stop = () => {
    startRef.current = null;
    window.cancelAnimationFrame(frameRef.current);
    if (!doneRef.current) {
      setProgress(0);
      progressRef.current?.(0);
    }
  };

  const start = () => {
    if (disabled || startRef.current !== null || doneRef.current) return;
    startRef.current = performance.now();
    const tick = () => {
      if (startRef.current === null) return;
      const value = Math.min(1, (performance.now() - startRef.current) / holdMs);
      setProgress(value);
      progressRef.current?.(value);
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
        "px-frame px-tone-down relative h-14 w-full select-none overflow-hidden bg-card font-display text-[18px] font-bold uppercase tracking-[0.04em] text-down disabled:opacity-40",
        FOCUS_RING,
        className,
      )}
    >
      {/* The fill grows in twenty whole steps, like a pixel meter. */}
      <span aria-hidden="true" className="absolute inset-y-0 left-0 bg-down" style={{ width: `${Math.floor(progress * 20) * 5}%` }} />
      <span className="relative">{children}</span>
      {/* The same words in card ink over the filled part, so they read on both halves. */}
      <span aria-hidden="true" className="absolute inset-0 flex items-center justify-center bg-transparent text-card" style={{ clipPath: `inset(0 ${100 - Math.floor(progress * 20) * 5}% 0 0)` }}>
        {children}
      </span>
      <span id="hold-hint" className="sr-only">
        Press and hold for {Math.round(holdMs / 100) / 10} seconds to confirm.
      </span>
    </button>
  );
}
