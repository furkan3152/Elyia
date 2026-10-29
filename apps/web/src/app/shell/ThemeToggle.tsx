import { Moon, Sun } from "lucide-react";

import { buttonClasses } from "../../ui/buttonStyles";
import { cx } from "../../ui/cx";
import { useThemeToggle } from "../state/useTheme";

const ICON = "absolute h-[18px] w-[18px] transition-[transform,opacity] duration-base ease-pluck";

/** Dark ("Night of the fields") / light ("Dawn") switch; the new theme grows from the button. */
export function ThemeToggle({ className }: { readonly className?: string }) {
  const { theme, toggle } = useThemeToggle();
  const dark = theme === "dark";
  return (
    <button
      type="button"
      onClick={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        toggle({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
      }}
      aria-pressed={dark}
      aria-label="Dark theme"
      title={dark ? "Switch to Dawn (light)" : "Switch to Night (dark)"}
      className={cx(buttonClasses({ variant: "ghost", size: "md", iconOnly: true }), "relative overflow-hidden", className)}
    >
      <Sun className={cx(ICON, dark ? "rotate-90 scale-50 opacity-0" : "rotate-0 opacity-100")} aria-hidden="true" />
      <Moon className={cx(ICON, dark ? "rotate-0 opacity-100" : "-rotate-90 scale-50 opacity-0")} aria-hidden="true" />
    </button>
  );
}
