import { NETWORKS } from "@elyia/core/networks";

import { cx, FOCUS_RING } from "../../ui/cx";
import { Link } from "../routes/Link";
import { routeHref } from "../routes/routeTable";
import { ElyiaLogo } from "./ElyiaMark";
import { MotionSwitch } from "./MotionToggle";
import { ThemeToggle } from "./ThemeToggle";

const elysium = NETWORKS["elysium-testnet"];
const explorerUrl = elysium.vm === "evm" ? (elysium.explorer?.url ?? null) : null;

interface FooterLink {
  readonly label: string;
  readonly to: string;
  readonly external?: boolean;
}

const COLUMNS: ReadonlyArray<{ readonly title: string; readonly links: readonly FooterLink[] }> = [
  {
    title: "Deck",
    links: [
      { label: "Deck", to: routeHref("deck") },
      { label: "Trade", to: routeHref("trade") },
      { label: "Portfolio", to: routeHref("portfolio") },
      { label: "Agent", to: routeHref("agent") },
    ],
  },
  {
    title: "Elysium",
    links: [
      { label: "Pulse", to: routeHref("elysium") },
      ...(explorerUrl ? [{ label: "Testnet explorer", to: explorerUrl, external: true }] : []),
      { label: "Discover", to: routeHref("discover") },
      { label: "Bridge", to: routeHref("bridge") },
    ],
  },
  {
    title: "Builders",
    links: [
      { label: "Developers", to: routeHref("developers") },
      { label: "Telegram", to: routeHref("alerts") },
    ],
  },
];

/** Marketing footer: the Aeneid line, link columns, "Built for Elysium · Testnet" and the independence notice. */
export function SiteFooter() {
  return (
    <footer className="relative z-10 border-t border-line">
      <div className="mx-auto grid max-w-[1280px] gap-10 px-4 py-12 sm:px-8 lg:grid-cols-[1.4fr_repeat(3,minmax(0,1fr))] lg:px-10">
        <div className="flex flex-col gap-4">
          <ElyiaLogo />
          <p className="max-w-xs font-display text-xl italic leading-snug text-text-1">
            “They know their own sun, and their own stars.” <span className="not-italic text-text-2">— Aeneid VI</span>
          </p>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            <MotionSwitch />
          </div>
        </div>
        {COLUMNS.map((column) => (
          <div key={column.title}>
            <p className="label-caps mb-3">{column.title}</p>
            <ul className="flex flex-col gap-2 text-sm">
              {column.links.map((link) =>
                link.external ? (
                  <li key={link.label}>
                    <a href={link.to} target="_blank" rel="noopener noreferrer" className={cx("rounded text-text-1 hover:text-text-0", FOCUS_RING)}>
                      {link.label}
                      <span className="sr-only"> (opens in a new tab)</span>
                    </a>
                  </li>
                ) : (
                  <li key={link.label}>
                    <Link to={link.to} className={cx("rounded text-text-1 hover:text-text-0", FOCUS_RING)}>
                      {link.label}
                    </Link>
                  </li>
                ),
              )}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-line">
        <div className="mx-auto flex max-w-[1280px] flex-col gap-2 px-4 py-6 text-xs text-text-2 sm:flex-row sm:items-center sm:justify-between sm:px-8 lg:px-10">
          <p className="font-mono tracking-[0.04em]">Built for Elysium · Testnet · chain 99801 · non-custodial</p>
          <p>Elyia is an independent, non-custodial interface. Not affiliated with Kinetiq, Elysium or Hyperliquid.</p>
        </div>
      </div>
    </footer>
  );
}
