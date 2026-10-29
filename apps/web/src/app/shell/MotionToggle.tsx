import { useMotionToggle } from "../../motion/useReducedMotion";
import { cx, FOCUS_RING } from "../../ui/cx";
import { Toggle } from "../../ui/Toggle";

/** Header Motion switch: stops every loop (contours, needles, flutter) and shows end states. Never turns motion on against the OS. */
export function MotionToggle({ className }: { readonly className?: string }) {
  const motion = useMotionToggle();
  return (
    <button
      type="button"
      aria-pressed={motion.checked}
      aria-label="Motion"
      title={motion.description}
      disabled={motion.disabled}
      onClick={() => motion.setOn(!motion.checked)}
      className={cx(
        "inline-flex h-9 shrink-0 items-center gap-1.5 border-2 border-rule px-2 font-mono text-[11px] font-semibold tracking-[0.1em] text-ink disabled:opacity-50",
        FOCUS_RING,
        className,
      )}
    >
      <svg width="16" height="10" viewBox="0 0 16 10" aria-hidden="true">
        <path d="M1 7c2-4 4-4 6 0s4 4 6 0" fill="none" stroke="currentColor" strokeWidth="1.6" strokeDasharray={motion.checked ? undefined : "2 2"} />
      </svg>
      {motion.checked ? "MOTION" : "STILL"}
    </button>
  );
}

/** The same setting as a labelled switch (footer, settings). */
export function MotionSwitch({ className }: { readonly className?: string }) {
  const motion = useMotionToggle();
  return <Toggle checked={motion.checked} disabled={motion.disabled} onChange={motion.setOn} label="Motion" description={motion.description} size="sm" className={className} />;
}
