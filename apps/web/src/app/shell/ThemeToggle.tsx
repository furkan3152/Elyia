import { cx, FOCUS_RING } from "../../ui/cx";
import { useThemeToggle } from "../state/useTheme";

/**
 * DAY / NIGHT switch: the paper map or the headlamp sheet. The new sheet is
 * laid over the old one from the switch (a view transition), and the choice
 * is remembered (elyia.theme).
 */
export function ThemeToggle({ className, compact = false }: { readonly className?: string; readonly compact?: boolean }) {
  const { theme, toggle } = useThemeToggle();
  const night = theme === "dark";
  return (
    <button
      type="button"
      onClick={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        toggle({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
      }}
      aria-pressed={night}
      aria-label="Night sheet"
      title={night ? "Switch to the DAY sheet (paper map)" : "Switch to the NIGHT sheet (headlamp)"}
      className={cx("inline-flex h-9 shrink-0 items-stretch border-2 border-rule font-mono text-[11px] font-semibold tracking-[0.1em]", FOCUS_RING, className)}
    >
      <span className={cx("flex items-center px-2", night ? "text-ink-3" : "bg-ink text-paper")}>{compact ? "D" : "DAY"}</span>
      <span className={cx("flex items-center border-l-2 border-rule px-2", night ? "bg-ink text-paper" : "text-ink-3")}>{compact ? "N" : "NIGHT"}</span>
    </button>
  );
}
