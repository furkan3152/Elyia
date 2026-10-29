import { Menu } from "lucide-react";
import { useState } from "react";

import { ButtonLink } from "../../ui/Button";
import { cx, FOCUS_RING } from "../../ui/cx";
import { IconButton } from "../../ui/IconButton";
import { Sheet } from "../../ui/Sheet";
import { Link } from "../routes/Link";
import { routeHref } from "../routes/routeTable";
import { useRoute } from "../routes/useRoute";
import { ElyiaLogo } from "./ElyiaMark";
import { MotionSwitch } from "./MotionToggle";
import { PRIMARY_NAV } from "./navItems";
import { sheetLabel } from "./sheets";
import { ThemeToggle } from "./ThemeToggle";

const LINKS = [
  ...PRIMARY_NAV.map((item) => ({ label: item.label, to: item.href })),
  { label: "Elysium", to: routeHref("elysium") },
  { label: "Developers", to: routeHref("developers") },
] as const;

/** Site header (Survey): mark, DECK · TRADE · PORTFOLIO · GUIDE, the sheet label and the one action: Open the deck. Wallet-free. */
export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const { route } = useRoute();
  return (
    <header className="relative z-30 border-b-2 border-rule bg-paper">
      <div className="mx-auto flex h-[60px] max-w-[1440px] items-center gap-6 px-4 sm:px-6 lg:gap-8 lg:px-10">
        <Link to="/" aria-label="Elyia home" className={cx("shrink-0", FOCUS_RING)}>
          <ElyiaLogo />
        </Link>
        <nav aria-label="Primary" className="hidden items-center gap-6 lg:flex">
          {LINKS.map((link) => (
            <Link
              key={link.label}
              to={link.to}
              match="prefix"
              className={cx(
                "relative inline-flex h-[60px] items-center font-sans text-[13px] font-bold uppercase tracking-[0.1em] text-ink-2 hover:text-ink aria-[current=page]:text-ink after:absolute after:inset-x-0 after:bottom-[14px] after:h-[3px] after:bg-accent-line after:opacity-0 aria-[current=page]:after:opacity-100",
                FOCUS_RING,
              )}
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <span className="ml-auto hidden font-mono text-xs uppercase tracking-[0.06em] text-ink xl:inline">{sheetLabel(route.id)} · 1 : 25 000</span>
        <div className="ml-auto flex items-center gap-2.5 xl:ml-0">
          <ThemeToggle className="hidden sm:inline-flex" />
          <ButtonLink to={routeHref("deck")} variant="primary" size="md" rightIcon={<span aria-hidden="true">→</span>}>
            Open the deck
          </ButtonLink>
          <IconButton label="Menu" icon={<Menu className="h-5 w-5" aria-hidden="true" />} variant="ink" className="lg:hidden" onClick={() => setOpen(true)} />
        </div>
      </div>
      <Sheet open={open} onClose={() => setOpen(false)} side="bottom" title="Elyia">
        <ul className="flex flex-col border-t-2 border-rule">
          {LINKS.map((link) => (
            <li key={link.label} className="border-b-1.5 border-rule/30">
              <Link to={link.to} onClick={() => setOpen(false)} className={cx("block px-1 py-3 text-2xl font-bold tracking-[-0.01em] text-ink hover:bg-paper-2", FOCUS_RING)}>
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
        <div className="mt-4 flex items-center justify-between gap-3 border-2 border-rule p-3">
          <MotionSwitch />
          <ThemeToggle />
        </div>
      </Sheet>
    </header>
  );
}
