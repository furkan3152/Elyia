import { useState } from "react";

import { useOracleStore } from "../../oracle/oracleStore";
import { cx, FOCUS_RING } from "../../ui/cx";
import { Sheet } from "../../ui/Sheet";
import { Link } from "../routes/Link";
import { useRoute } from "../routes/useRoute";
import { MotionSwitch } from "./MotionToggle";
import { MORE_NAV, PRIMARY_NAV, SETTINGS_ITEM } from "./navItems";
import { ThemeToggle } from "./ThemeToggle";

const TAB = "flex h-full flex-1 items-center justify-center font-sans text-[11px] font-bold uppercase tracking-[0.06em]";

/**
 * Phone navigation: signpost tabs along the bottom edge. The current page's
 * tab is the yellow blade ("you are here"); MORE opens the rest, the
 * Where-to signpost and the sheet switches.
 */
export function MobileBar() {
  const [open, setOpen] = useState(false);
  const { location } = useRoute();
  const more = [...MORE_NAV, SETTINGS_ITEM];
  const moreActive = more.some((item) => location.pathname === item.href || location.pathname.startsWith(`${item.href}/`));
  return (
    <>
      <nav aria-label="Deck" className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t-2 border-rule bg-paper md:hidden">
        <ul className="flex h-14 items-stretch gap-1 px-1.5 py-1.5">
          {PRIMARY_NAV.map((item) => (
            <li key={item.id} className="flex min-w-0 flex-1">
              <Link
                to={item.href}
                match={item.match ?? "prefix"}
                className={cx(
                  TAB,
                  "relative border-2 border-transparent text-ink-2 aria-[current=page]:border-rule aria-[current=page]:bg-signal aria-[current=page]:text-signal-ink",
                  FOCUS_RING,
                )}
              >
                {item.label}
              </Link>
            </li>
          ))}
          <li className="flex min-w-0 flex-1">
            <button type="button" onClick={() => setOpen(true)} aria-haspopup="dialog" className={cx(TAB, "border-2", moreActive ? "border-rule bg-signal text-signal-ink" : "border-rule bg-card text-ink", FOCUS_RING)}>
              More ▴
            </button>
          </li>
        </ul>
      </nav>
      <Sheet open={open} onClose={() => setOpen(false)} side="bottom" title="Where to?">
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            useOracleStore.getState().openOracle();
          }}
          className={cx("mb-4 flex h-12 w-full items-stretch border-2 border-rule bg-card text-left shadow-hard", FOCUS_RING)}
        >
          <span className="el-blade flex items-center bg-ink pl-3 pr-6 font-sans text-sm font-bold uppercase tracking-[0.06em] text-paper">Where to?</span>
          <span className="flex items-center truncate px-3 font-mono text-[13px] text-ink-3">a page, a market, a sentence</span>
        </button>
        <ul className="grid grid-cols-2 gap-2">
          {more.map((item) => (
            <li key={item.id}>
              <Link
                to={item.href}
                match={item.match ?? "prefix"}
                onClick={() => setOpen(false)}
                className={cx("flex h-full flex-col gap-0.5 border-2 border-rule bg-card p-2.5 aria-[current=page]:bg-signal/50", FOCUS_RING)}
              >
                <span className="text-sm font-bold uppercase tracking-[0.06em] text-ink">{item.label}</span>
                <span className="text-xs leading-snug text-ink-3">{item.hint}</span>
              </Link>
            </li>
          ))}
        </ul>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-2 border-rule p-3">
          <MotionSwitch />
          <ThemeToggle />
        </div>
      </Sheet>
    </>
  );
}
