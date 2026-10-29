import { Keyboard } from "lucide-react";

import { useOracleStore } from "../../oracle/oracleStore";
import { cx, FOCUS_RING } from "../../ui/cx";
import { IconButton } from "../../ui/IconButton";
import { Kbd } from "../../ui/Kbd";
import { Popover } from "../../ui/Popover";
import { isApplePlatform } from "../../ui/platform";
import { useShortcutsStore } from "../keyboard/shortcutsStore";
import { Link } from "../routes/Link";
import { routeHref } from "../routes/routeTable";
import { useRoute } from "../routes/useRoute";
import { AltimeterHeads } from "./AltimeterHeads";
import { ElyiaLogo } from "./ElyiaMark";
import { ModeBadge } from "./ModeBadge";
import { MotionToggle } from "./MotionToggle";
import { MORE_NAV, PRIMARY_NAV } from "./navItems";
import { sheetLabel } from "./sheets";
import { ThemeToggle } from "./ThemeToggle";
import { WalletButton } from "./WalletButton";

const NAV_LINK =
  "relative inline-flex h-[60px] items-center font-sans text-[13px] font-bold uppercase tracking-[0.1em] text-ink-2 hover:text-ink aria-[current=page]:text-ink after:absolute after:inset-x-0 after:bottom-[14px] after:h-[3px] after:bg-accent-line after:opacity-0 aria-[current=page]:after:opacity-100";

/** "Where to? ⌘K": the command signpost trigger. */
export function WhereToTrigger({ className }: { readonly className?: string }) {
  const apple = isApplePlatform();
  return (
    <button
      type="button"
      onClick={() => useOracleStore.getState().openOracle()}
      aria-keyshortcuts={apple ? "Meta+K" : "Control+K"}
      className={cx("group inline-flex h-9 min-w-0 items-stretch border-2 border-rule bg-card text-left shadow-hard-sm transition-transform duration-fast hover:-translate-y-px", FOCUS_RING, className)}
    >
      <span className="el-blade flex items-center bg-ink pl-2.5 pr-5 font-sans text-xs font-bold uppercase tracking-[0.06em] text-paper">Where to?</span>
      <span className="hidden min-w-0 flex-1 items-center truncate px-2.5 font-mono text-xs text-ink-3 xl:flex">trade ETH · bridge 20 HYPE…</span>
      <span className="flex items-center gap-1 px-1.5" aria-hidden="true">
        <Kbd>{apple ? "⌘" : "Ctrl"}</Kbd>
        <Kbd>K</Kbd>
      </span>
    </button>
  );
}

/**
 * The deck's header, drawn like the top margin of a map sheet: the mark,
 * DECK · TRADE · PORTFOLIO · GUIDE and MORE, the "Where to?" signpost, the
 * DAY/NIGHT and motion switches and the wallet; under it a thin margin strip
 * with the sheet label, the layer altimeter and the practice-wall chip.
 */
export function TopBar() {
  const { route } = useRoute();
  const openShortcuts = useShortcutsStore((state) => state.setOpen);
  const moreActive = MORE_NAV.some((item) => route.id === item.id);
  return (
    <header className="sticky top-0 z-40 border-b-2 border-rule bg-paper">
      <div className="flex h-[60px] items-center gap-3 px-4 sm:px-6 lg:gap-6 lg:px-8">
        <Link to={routeHref("deck")} className={cx("flex shrink-0 items-center", FOCUS_RING)} aria-label="Elyia deck">
          <ElyiaLogo size="sm" className="sm:hidden" />
          <ElyiaLogo className="hidden sm:inline-flex" />
        </Link>
        <nav aria-label="Deck" className="hidden items-center gap-6 md:flex">
          {PRIMARY_NAV.map((item) => (
            <Link key={item.id} to={item.href} match={item.match ?? "prefix"} className={cx(NAV_LINK, FOCUS_RING)}>
              {item.label}
            </Link>
          ))}
          <Popover
            label="More destinations"
            align="start"
            trigger={(props) => (
              <button type="button" {...props} className={cx(NAV_LINK, moreActive && "text-ink after:opacity-100", FOCUS_RING)}>
                More <span aria-hidden="true">▾</span>
              </button>
            )}
          >
            {(close) => (
              <ul className="grid w-[420px] grid-cols-2 gap-1">
                {MORE_NAV.map((item) => (
                  <li key={item.id}>
                    <Link to={item.href} onClick={close} className={cx("flex flex-col gap-0.5 border-2 border-transparent p-2 hover:border-rule hover:bg-paper-2 aria-[current=page]:border-rule aria-[current=page]:bg-signal/40", FOCUS_RING)}>
                      <span className="text-sm font-bold uppercase tracking-[0.06em] text-ink">{item.label}</span>
                      <span className="text-xs leading-snug text-ink-3">{item.hint}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Popover>
        </nav>
        <div className="ml-auto flex min-w-0 shrink items-center gap-2 lg:gap-2.5">
          <WhereToTrigger className="hidden md:inline-flex" />
          <ThemeToggle className="hidden lg:inline-flex" />
          <MotionToggle className="hidden xl:inline-flex" />
          <IconButton label="Keyboard shortcuts (?)" icon={<Keyboard className="h-4 w-4" aria-hidden="true" />} onClick={() => openShortcuts(true)} variant="ghost" size="sm" className="hidden xl:inline-flex" />
          <WalletButton compact />
        </div>
      </div>
      <div className="flex h-8 items-center gap-4 overflow-hidden border-t-1.5 border-rule/30 bg-card/60 px-4 font-mono text-[11px] sm:px-6 lg:px-8">
        <span className="shrink-0 uppercase tracking-[0.12em] text-ink">{sheetLabel(route.id)}</span>
        <span aria-hidden="true" className="hidden text-ink-3 sm:inline">
          1 : 25 000
        </span>
        <AltimeterHeads className="ml-auto hidden md:inline-flex" />
        <AltimeterHeads compact className="ml-auto hidden min-[440px]:inline-flex md:hidden" />
        <span className="ml-auto hidden min-[440px]:ml-0 sm:inline-flex">
          <ModeBadge className="h-6" />
        </span>
        <span className="ml-auto inline-flex min-[440px]:ml-0 sm:hidden">
          <ModeBadge compact className="h-6" />
        </span>
      </div>
    </header>
  );
}
