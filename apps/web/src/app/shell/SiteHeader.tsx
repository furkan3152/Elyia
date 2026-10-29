import { Menu } from "lucide-react";
import { useState } from "react";

import { ButtonLink } from "../../ui/Button";
import { cx, FOCUS_RING } from "../../ui/cx";
import { IconButton } from "../../ui/IconButton";
import { Sheet } from "../../ui/Sheet";
import { Link } from "../routes/Link";
import { routeHref } from "../routes/routeTable";
import { ElyiaLogo } from "./ElyiaMark";
import { MotionSwitch } from "./MotionToggle";
import { ThemeToggle } from "./ThemeToggle";

const LINKS = [
  { label: "Speak", to: "/#speak" },
  { label: "Trade", to: "/#trade" },
  { label: "Portfolio", to: "/#see" },
  { label: "Agent", to: "/#agent" },
  { label: "Elysium Pulse", to: routeHref("elysium") },
  { label: "Developers", to: routeHref("developers") },
] as const;

/** Marketing header: wordmark, section links, the Testnet badge and "Open the deck". Wallet-free. */
export function SiteHeader() {
  const [open, setOpen] = useState(false);
  return (
    <header className="relative z-30">
      <div className="mx-auto flex max-w-[1280px] items-center justify-between gap-6 px-4 py-5 sm:px-8 lg:px-10 lg:py-7">
        <Link to="/" aria-label="Elyia home" className="rounded-lg">
          <ElyiaLogo />
        </Link>
        <nav aria-label="Primary" className="hidden items-center gap-7 text-sm lg:flex">
          {LINKS.map((link) => (
            <Link key={link.label} to={link.to} className={cx("rounded text-text-1 transition-colors hover:text-text-0 aria-[current=page]:text-text-0", FOCUS_RING)}>
              {link.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-2 sm:gap-3">
          <span className="hidden items-center gap-2 rounded-full border border-mint/35 px-3 py-1.5 font-mono text-xs text-mint sm:inline-flex">
            <span aria-hidden="true" className="el-loop h-1.5 w-1.5 animate-breathe rounded-full bg-mint" />
            Testnet 99801
          </span>
          <ThemeToggle className="hidden sm:inline-flex" />
          <ButtonLink to={routeHref("deck")} variant="primary" size="md">
            Open the deck
          </ButtonLink>
          <IconButton label="Menu" icon={<Menu className="h-5 w-5" aria-hidden="true" />} className="lg:hidden" onClick={() => setOpen(true)} />
        </div>
      </div>
      <Sheet open={open} onClose={() => setOpen(false)} side="bottom" title="Elyia">
        <ul className="flex flex-col">
          {LINKS.map((link) => (
            <li key={link.label}>
              <Link to={link.to} onClick={() => setOpen(false)} className={cx("block rounded-xl px-2 py-3 font-display text-2xl text-text-0 hover:bg-text-0/[0.04]", FOCUS_RING)}>
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
        <div className="mt-4 flex items-center justify-between gap-3 rounded-2xl border border-line p-3">
          <MotionSwitch />
          <ThemeToggle />
        </div>
      </Sheet>
    </header>
  );
}
