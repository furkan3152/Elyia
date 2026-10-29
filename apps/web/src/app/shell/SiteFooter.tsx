import { NETWORKS } from "@elyia/core/networks";

import { TitleBlockBox } from "../../topo/MapSheet";
import { cx, FOCUS_RING } from "../../ui/cx";
import { Link } from "../routes/Link";
import { routeHref } from "../routes/routeTable";
import { useRoute } from "../routes/useRoute";
import { useUiStore } from "../state/uiStore";
import { ElyiaLogo } from "./ElyiaMark";
import { MotionSwitch } from "./MotionToggle";
import { sheetFor } from "./sheets";
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
      { label: "Guide", to: routeHref("agent") },
    ],
  },
  {
    title: "Elysium",
    links: [
      { label: "Barograph", to: routeHref("elysium") },
      ...(explorerUrl ? [{ label: "Testnet explorer", to: explorerUrl, external: true }] : []),
      { label: "Discover", to: routeHref("discover") },
      { label: "Bridge", to: routeHref("bridge") },
    ],
  },
  {
    title: "Builders",
    links: [
      { label: "Developers", to: routeHref("developers") },
      { label: "Map key", to: routeHref("system") },
      { label: "Telegram", to: routeHref("alerts") },
    ],
  },
];

function today(): string {
  return new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }).toUpperCase();
}

/** The cartographic margin under every page: survey line, scale and the network mode. */
function MarginLine() {
  const mode = useUiStore((state) => state.mode);
  return (
    <div className="flex flex-col gap-1 border-t-2 border-rule pt-3 font-mono text-[11px] uppercase tracking-[0.08em] text-ink-2 sm:flex-row sm:items-center sm:justify-between">
      <span>Survey: Elyia · Elysium 99801 · 114 ms per block</span>
      <span>Not to scale · {mode === "testnet" ? "Practice wall (testnet)" : "Mainnet"}</span>
    </div>
  );
}

/** Site footer: the mark, link columns, a cartographic title block, the switches, and the independence notice. */
export function SiteFooter() {
  const { route } = useRoute();
  const mode = useUiStore((state) => state.mode);
  const sheet = sheetFor(route.id);
  return (
    <footer className="relative z-10 mt-16">
      <div className="mx-auto max-w-[1440px] px-4 pb-8 sm:px-6 lg:px-10">
        <div className="grid gap-10 border-t-2 border-rule pt-10 lg:grid-cols-[1.3fr_repeat(3,minmax(0,1fr))_auto]">
          <div className="flex flex-col gap-4">
            <ElyiaLogo />
            <p className="max-w-xs text-[15px] leading-relaxed text-ink-2">The intent, trading and portfolio deck for Elysium, HyperEVM and HyperCore. Your keys stay in your wallet.</p>
            <div className="flex flex-wrap items-center gap-3">
              <ThemeToggle />
              <MotionSwitch />
            </div>
          </div>
          {COLUMNS.map((column) => (
            <div key={column.title}>
              <p className="caption mb-3">{column.title}</p>
              <ul className="flex flex-col gap-2 text-[15px]">
                {column.links.map((link) => (
                  <li key={link.label}>
                    {link.external ? (
                      <a href={link.to} target="_blank" rel="noopener noreferrer" className={cx("text-ink-2 underline-offset-4 hover:text-ink hover:underline", FOCUS_RING)}>
                        {link.label} ↗<span className="sr-only"> (opens in a new tab)</span>
                      </a>
                    ) : (
                      <Link to={link.to} className={cx("text-ink-2 underline-offset-4 hover:text-ink hover:underline", FOCUS_RING)}>
                        {link.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <TitleBlockBox className="self-start" block={{ name: `Sheet ${sheet.number} · ${sheet.name}`, date: today(), mode: mode === "testnet" ? "testnet" : "mainnet" }} />
        </div>
        <div className="mt-10">
          <MarginLine />
          <p className="mt-2 text-xs text-ink-3">Elyia is an independent, non-custodial interface. Not affiliated with Kinetiq, Elysium or Hyperliquid.</p>
        </div>
      </div>
    </footer>
  );
}

/** The deck's footer: just the margin line, so the sheet ends like a map. */
export function AppFooter() {
  return (
    <footer className="mx-auto mt-10 hidden max-w-[1440px] px-4 pb-6 sm:px-6 md:block lg:px-8">
      <MarginLine />
    </footer>
  );
}
