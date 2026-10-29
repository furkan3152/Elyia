import { Pause, Sparkles } from "lucide-react";

import { useMotionToggle } from "../../motion/useReducedMotion";
import { buttonClasses } from "../../ui/buttonStyles";
import { cx } from "../../ui/cx";
import { Toggle } from "../../ui/Toggle";

/** Top-bar Motion button: stops rays, strings and aurora (never turns motion on against the OS setting). */
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
      className={cx(buttonClasses({ variant: "ghost", size: "md", iconOnly: true }), className)}
    >
      {motion.checked ? <Sparkles className="h-[18px] w-[18px]" aria-hidden="true" /> : <Pause className="h-[18px] w-[18px]" aria-hidden="true" />}
    </button>
  );
}

/** The same setting as a labelled switch (footer, settings). */
export function MotionSwitch({ className }: { readonly className?: string }) {
  const motion = useMotionToggle();
  return <Toggle checked={motion.checked} disabled={motion.disabled} onChange={motion.setOn} label="Motion" description={motion.description} size="sm" className={className} />;
}
