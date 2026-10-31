import { PixelGlyph } from "../../pixel/PixelGlyph";
import { cx, FOCUS_RING } from "../../ui/cx";
import { useThemeToggle } from "../state/useTheme";

const SUN = ["....y....", ".y..y..y.", "..yyyyy..", ".yyyyyyy.", "yyyyyyyyy", ".yyyyyyy.", "..yyyyy..", ".y..y..y.", "....y...."];
const MOON = ["...kkk...", "..kss.k..", ".kss....k", ".ks......", ".ks......", ".kss....k", "..kss.k..", "...kkk...", "........."];

/**
 * DAY / NIGHT switch. The new sheet comes down over the old one in eight
 * pixel bands (a sunset wipe), and the choice is remembered (elyia.theme).
 * `compact`: one square button with a pixel sun or moon (the header).
 */
export function ThemeToggle({ className, compact = false }: { readonly className?: string; readonly compact?: boolean }) {
  const { theme, toggle } = useThemeToggle();
  const night = theme === "dark";
  const onClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    toggle({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
  };
  const title = night ? "Switch to the DAY sheet" : "Switch to the NIGHT sheet";
  if (compact) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-pressed={night}
        aria-label="Night sheet"
        title={title}
        className={cx("inline-flex h-9 w-9 shrink-0 items-center justify-center bg-card px-frame-thin px-drop px-press", FOCUS_RING, className)}
      >
        <PixelGlyph rows={night ? MOON : SUN} scale={2} palette={{ y: "#F2C200", k: "--ink", s: "--ink-2" }} label={null} />
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={night}
      aria-label="Night sheet"
      title={title}
      className={cx("inline-flex h-9 shrink-0 items-stretch gap-[2px] bg-rule font-tag text-[11px] uppercase px-frame-thin", FOCUS_RING, className)}
    >
      <span className={cx("flex items-center px-2.5", night ? "bg-card text-ink-3" : "bg-signal text-[#16201B]")}>Day</span>
      <span className={cx("flex items-center px-2.5", night ? "bg-ink text-paper" : "bg-card text-ink-3")}>Night</span>
    </button>
  );
}
