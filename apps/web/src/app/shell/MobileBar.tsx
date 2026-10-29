import { Ellipsis } from "lucide-react";
import { useState } from "react";

import { cx, FOCUS_RING } from "../../ui/cx";
import { Sheet } from "../../ui/Sheet";
import { Link } from "../routes/Link";
import { useRoute } from "../routes/useRoute";
import { Badge } from "../../ui/Badge";
import { useUiStore } from "../state/uiStore";
import { MotionSwitch } from "./MotionToggle";
import { NAV_ITEMS, SETTINGS_ITEM } from "./navItems";
import { ThemeToggle } from "./ThemeToggle";

const PRIMARY = NAV_ITEMS.filter((item) => item.primaryOnMobile);
const MORE = [...NAV_ITEMS.filter((item) => !item.primaryOnMobile), SETTINGS_ITEM];

/** Phone navigation: four destinations and "More" (a bottom sheet with the rest). */
export function MobileBar() {
  const [open, setOpen] = useState(false);
  const { location } = useRoute();
  const mode = useUiStore((state) => state.mode);
  const moreActive = MORE.some((item) => location.pathname === item.href || (item.match !== "exact" && location.pathname.startsWith(`${item.href}/`)));
  return (
    <>
      <nav aria-label="Deck" className="glass safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-line md:hidden">
        <ul className="mx-auto flex h-16 max-w-lg items-stretch justify-around px-2">
          {PRIMARY.map((item) => {
            const Icon = item.icon;
            return (
              <li key={item.id} className="flex flex-1">
                <Link
                  to={item.href}
                  match={item.match ?? "prefix"}
                  className={cx(
                    "group flex flex-1 flex-col items-center justify-center gap-1 rounded-xl text-[11.5px] text-text-2 transition-colors aria-[current=page]:text-text-0",
                    FOCUS_RING,
                  )}
                >
                  <Icon className="h-5 w-5 group-aria-[current=page]:text-violet-soft" aria-hidden="true" strokeWidth={1.75} />
                  {item.label}
                </Link>
              </li>
            );
          })}
          <li className="flex flex-1">
            <button
              type="button"
              onClick={() => setOpen(true)}
              aria-haspopup="dialog"
              className={cx("flex flex-1 flex-col items-center justify-center gap-1 rounded-xl text-[11.5px] transition-colors", moreActive ? "text-text-0" : "text-text-2", FOCUS_RING)}
            >
              <Ellipsis className={cx("h-5 w-5", moreActive && "text-violet-soft")} aria-hidden="true" />
              More
            </button>
          </li>
        </ul>
      </nav>
      <Sheet open={open} onClose={() => setOpen(false)} side="bottom" title="Everything in Elyia">
        <ul className="grid grid-cols-2 gap-2">
          {MORE.map((item) => {
            const Icon = item.icon;
            return (
              <li key={item.id}>
                <Link
                  to={item.href}
                  match={item.match ?? "prefix"}
                  onClick={() => setOpen(false)}
                  className={cx(
                    "flex h-full items-start gap-3 rounded-2xl border border-line bg-bg-2/50 p-3 transition-colors hover:border-violet-glow/30 aria-[current=page]:border-violet-glow/40",
                    FOCUS_RING,
                  )}
                >
                  <Icon className="mt-0.5 h-5 w-5 shrink-0 text-violet-soft" aria-hidden="true" strokeWidth={1.75} />
                  <span className="min-w-0">
                    <span className="block text-sm text-text-0">{item.label}</span>
                    <span className="block text-xs text-text-2">{item.hint}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line p-3">
          <MotionSwitch />
          <div className="flex items-center gap-1.5">
            <Badge tone={mode === "testnet" ? "mint" : "gold"} dot>
              {mode === "testnet" ? "Testnet" : "Mainnet"}
            </Badge>
            <ThemeToggle />
          </div>
        </div>
      </Sheet>
    </>
  );
}
