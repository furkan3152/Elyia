import { useShortcutsStore } from "../keyboard/shortcutsStore";
import { cx, FOCUS_RING } from "../../ui/cx";
import { Popover } from "../../ui/Popover";
import { Link } from "../routes/Link";
import { routeHref } from "../routes/routeTable";
import { useRoute } from "../routes/useRoute";
import { AdminLink } from "./AdminLink";
import { AltimeterHeads } from "./AltimeterHeads";
import { HeaderGrid, NAV_LINK, WhereToTrigger } from "./HeaderGrid";
import { ModeBadge } from "./ModeBadge";
import { MotionToggle } from "./MotionToggle";
import { MORE_NAV, PRIMARY_NAV } from "./navItems";
import { sheetLabel } from "./sheets";
import { headerSplitFor } from "./layoutSplit";
import { ThemeToggle } from "./ThemeToggle";
import { WalletButton } from "./WalletButton";

export { WhereToTrigger } from "./HeaderGrid";

/**
 * The deck's header on the centre axis (the content axis on pages with a rail): pixel Ely and ELYIA left, ASK ELY ·
 * TRADE · PORTFOLIO · GUIDE · MORE centred, WHERE TO? ⌘K, DAY/NIGHT, Motion
 * and the wallet right. Under it the thin layer strip: the sheet label, the
 * FLOOR / RIDGE / SUMMIT heads centred, and the network mode.
 */
export function TopBar() {
  const { route } = useRoute();
  const openShortcuts = useShortcutsStore((state) => state.setOpen);
  const moreActive = MORE_NAV.some((item) => route.id === item.id);
  const split = headerSplitFor(route.id);
  return (
    <HeaderGrid
      sticky
      split={split}
      home={routeHref("deck")}
      homeLabel="Elyia deck"
      navLabel="Deck"
      nav={
        <>
          {PRIMARY_NAV.map((item) => (
            <Link key={item.id} to={item.href} match={item.match ?? "prefix"} className={cx(NAV_LINK, FOCUS_RING)}>
              {item.label}
            </Link>
          ))}
          <Popover
            label="More destinations"
            align="end"
            trigger={(props) => (
              <button type="button" {...props} className={cx(NAV_LINK, moreActive && "text-ink after:opacity-100", FOCUS_RING)}>
                More <span aria-hidden="true">▾</span>
              </button>
            )}
          >
            {(close) => (
              <div className="flex w-[440px] flex-col gap-3">
                <ul className="grid grid-cols-2 gap-2">
                  {MORE_NAV.map((item) => (
                    <li key={item.id}>
                      <Link to={item.href} onClick={close} className={cx("flex h-full flex-col gap-0.5 p-2 hover:bg-paper-2 aria-[current=page]:bg-signal/40", FOCUS_RING)}>
                        <span className="font-tag text-[12px] uppercase text-ink">{item.label}</span>
                        <span className="text-xs leading-snug text-ink-2">{item.hint}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
                <button type="button" onClick={() => openShortcuts(true)} className={cx("self-center font-tag text-[11px] uppercase text-ink-2 underline decoration-2 underline-offset-4 hover:text-ink", FOCUS_RING)}>
                  Keyboard shortcuts · ?
                </button>
              </div>
            )}
          </Popover>
        </>
      }
      actions={
        <>
          {/* With the nav on the row, the ⌘K box does not fit beside it (⌘K itself works everywhere). */}
          <WhereToTrigger className="hidden md:inline-flex lg:hidden" />
          <AdminLink className="hidden lg:inline-flex" />
          <ThemeToggle compact />
          <MotionToggle compact className={split ? "hidden 2xl:inline-flex" : "hidden xl:inline-flex"} />
          <WalletButton compact />
        </>
      }
      strip={
        <>
          <span className="hidden max-w-full truncate justify-self-start text-ink-2 sm:block">{sheetLabel(route.id)}</span>
          <AltimeterHeads className="hidden justify-self-center sm:inline-flex" />
          <AltimeterHeads compact className="justify-self-start sm:hidden" />
          <span className="justify-self-end">
            <ModeBadge compact className="h-6 sm:hidden" />
            <ModeBadge className="hidden h-6 sm:inline-flex" />
          </span>
        </>
      }
    />
  );
}
