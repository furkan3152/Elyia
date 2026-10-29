import { Keyboard } from "lucide-react";

import { IconButton } from "../../ui/IconButton";
import { useShortcutsStore } from "../keyboard/shortcutsStore";
import { Link } from "../routes/Link";
import { routeHref } from "../routes/routeTable";
import { useRoute } from "../routes/useRoute";
import { ElyiaLogo, ElyiaMark } from "./ElyiaMark";
import { ModeBadge } from "./ModeBadge";
import { MotionToggle } from "./MotionToggle";
import { OracleIconTrigger, OracleTrigger } from "./OracleTrigger";
import { PulsePill } from "./PulsePill";
import { ThemeToggle } from "./ThemeToggle";
import { WalletButton } from "./WalletButton";

/**
 * The deck's top bar: Elyia mark + wordmark, the page title, the Elysium
 * heartbeat, the Oracle ("Speak your intent… ⌘K"), the Testnet badge, theme
 * and motion toggles, and the wallet.
 */
export function TopBar() {
  const { route } = useRoute();
  const openShortcuts = useShortcutsStore((state) => state.setOpen);
  return (
    <header className="glass sticky top-0 z-40 h-[var(--topbar-h)] border-b border-line">
      <div className="flex h-full items-center gap-3 px-3 sm:px-4 lg:gap-4 lg:px-5">
        <Link to={routeHref("deck")} className="flex shrink-0 items-center rounded-lg" aria-label="Elyia deck">
          <ElyiaLogo size="sm" className="hidden sm:inline-flex" />
          <ElyiaMark size={28} className="sm:hidden" />
        </Link>
        <span aria-hidden="true" className="hidden h-6 w-px bg-[var(--line-strong)] lg:block" />
        <p className="hidden shrink-0 font-display text-[26px] leading-none text-text-0 lg:block">{route.title}</p>
        <PulsePill className="hidden shrink-0 sm:inline-flex" />
        <PulsePill compact className="shrink-0 sm:hidden" />
        <div className="mx-auto hidden min-w-0 max-w-[560px] flex-1 md:block">
          <OracleTrigger />
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-1.5 md:ml-0">
          <OracleIconTrigger className="md:hidden" />
          <ModeBadge className="hidden sm:inline-flex" />
          <ThemeToggle className="hidden sm:inline-flex" />
          <MotionToggle className="hidden lg:inline-flex" />
          <IconButton
            label="Keyboard shortcuts (?)"
            icon={<Keyboard className="h-[18px] w-[18px]" aria-hidden="true" />}
            onClick={() => openShortcuts(true)}
            className="hidden xl:inline-flex"
          />
          <WalletButton compact />
        </div>
      </div>
    </header>
  );
}
