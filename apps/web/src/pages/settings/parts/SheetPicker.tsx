import type { ThemePreference } from "../../../app/state/uiPrefs";
import { cx, FOCUS_RING } from "../../../ui/cx";

const PATHS = [
  "M18 92 C 34 60, 70 52, 96 64 S 150 98, 182 70",
  "M30 96 C 46 74, 74 68, 96 76 S 140 100, 170 84",
  "M44 100 C 58 86, 78 82, 96 88 S 128 104, 156 96",
  "M66 40 C 84 26, 112 24, 128 36 S 150 58, 136 66 S 96 62, 78 56 S 54 50, 66 40 Z",
  "M86 42 C 96 34, 112 34, 120 42 S 124 54, 112 56 S 92 54, 86 48 Z",
];

/** A tiny map sheet drawn in its own tokens (`.el-day` / `.el-night` force the palette on the subtree). */
function MiniSheet({ sheet }: { readonly sheet: "day" | "night" }) {
  return (
    <span className={cx(sheet === "day" ? "el-day" : "el-night", "relative block overflow-hidden border-2 border-rule bg-paper")}>
      <svg viewBox="0 0 200 120" className="block h-auto w-full" aria-hidden="true">
        <rect width="200" height="120" fill="rgb(var(--paper))" />
        {PATHS.map((d, index) => (
          <path key={d} d={d} fill="none" stroke="rgb(var(--contour))" strokeOpacity={0.45 + index * 0.1} strokeWidth={index === 3 ? 1.6 : 1.1} />
        ))}
        <path d="M100 38 l5 8 h-10 z" fill="rgb(var(--ink))" />
        <text x="12" y="20" fontFamily="Instrument Serif, serif" fontStyle="italic" fontSize="14" fill="rgb(var(--floor))">
          The Floor
        </text>
        <rect x="12" y="98" width="62" height="12" fill="rgb(var(--card))" stroke="rgb(var(--ink))" strokeWidth="1.2" />
        <text x="17" y="107" fontFamily="IBM Plex Mono, monospace" fontSize="7" fill="rgb(var(--ink))">
          $48,213 ▲
        </text>
        <rect x="128" y="96" width="58" height="16" fill="rgb(var(--accent))" stroke="rgb(var(--ink))" strokeWidth="1.5" />
        <text x="157" y="107" textAnchor="middle" fontFamily="Space Grotesk Variable, sans-serif" fontWeight="700" fontSize="7.5" fill="rgb(var(--on-accent))">
          SIGN ▸
        </text>
      </svg>
    </span>
  );
}

function SplitSheet() {
  return (
    <span className="relative grid grid-cols-2 overflow-hidden border-2 border-rule">
      <span className="el-day block overflow-hidden">
        <MiniSheetHalf />
      </span>
      <span className="el-night block overflow-hidden">
        <MiniSheetHalf />
      </span>
    </span>
  );
}

function MiniSheetHalf() {
  return (
    <svg viewBox="0 0 100 120" className="block h-auto w-full" aria-hidden="true">
      <rect width="100" height="120" fill="rgb(var(--paper))" />
      {PATHS.slice(0, 3).map((d, index) => (
        <path key={d} d={d} transform="translate(-40 0)" fill="none" stroke="rgb(var(--contour))" strokeOpacity={0.5 + index * 0.12} strokeWidth="1.1" />
      ))}
      <circle cx="50" cy="60" r="16" fill="none" stroke="rgb(var(--ink))" strokeWidth="1.5" />
      <path d="M50 44 v32" stroke="rgb(var(--ink))" strokeWidth="1.5" />
    </svg>
  );
}

const CHOICES: readonly { readonly value: ThemePreference; readonly name: string; readonly line: string }[] = [
  { value: "light", name: "Day", line: "paper map · default on the site" },
  { value: "dark", name: "Night", line: "headlamp · easy on the eyes" },
  { value: "system", name: "Follow device", line: "day or night with your system" },
];

/** Theme as three sheets of map paper to choose from. */
export function SheetPicker({ value, onChange }: { readonly value: ThemePreference; readonly onChange: (value: ThemePreference) => void }) {
  return (
    <div role="radiogroup" aria-label="Map sheet (theme)" className="grid grid-cols-3 gap-2.5 sm:gap-4">
      {CHOICES.map((choice) => {
        const selected = choice.value === value;
        return (
          <button
            key={choice.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(choice.value)}
            className={cx("group relative flex flex-col gap-2 text-left transition-transform duration-fast", selected ? "-translate-y-0.5" : "hover:-translate-y-0.5", FOCUS_RING)}
          >
            <span className={cx("block transition-shadow duration-fast", selected ? "shadow-hard-lg" : "shadow-hard")}>{choice.value === "system" ? <SplitSheet /> : <MiniSheet sheet={choice.value === "light" ? "day" : "night"} />}</span>
            <span className="flex items-center justify-between gap-2">
              <span className="text-[14px] font-bold leading-tight text-ink sm:text-[16px]">{choice.name}</span>
              <span aria-hidden="true" className={cx("flex h-5 w-5 shrink-0 items-center justify-center border-2 border-rule text-[11px] font-bold", selected ? "bg-ink text-paper" : "bg-card text-transparent")}>
                ✓
              </span>
            </span>
            <span className="-mt-1.5 hidden font-mono text-[11px] text-ink-3 sm:block">{choice.line}</span>
          </button>
        );
      })}
    </div>
  );
}
