import { useState } from "react";

import { useOracleStore } from "../../oracle/oracleStore";
import { cx, FOCUS_RING } from "../../ui/cx";
import { Sheet } from "../../ui/Sheet";
import { PixelGlyph } from "../../pixel/PixelGlyph";
import { Link } from "../routes/Link";
import { useRoute } from "../routes/useRoute";
import { MotionSwitch } from "./MotionToggle";
import { useSessionRole } from "../../features/session/sessionStore";
import { ADMIN_ITEM, PHONE_MORE_NAV, PHONE_NAV, SETTINGS_ITEM } from "./navItems";
import { ThemeToggle } from "./ThemeToggle";

const TAB = "flex h-full flex-1 flex-col items-center justify-center gap-1 font-tag text-[11px] uppercase";

/** 9 x 7 pixel glyphs for the tabs. */
const GLYPH: Readonly<Record<string, readonly string[]>> = {
  deck: ["....k....", "...kwk...", "..kwwwk..", ".kwwkwwk.", "kwwk.kwwk", "kkk...kkk", "........."],
  trade: [".k.....k.", "kkk..k.k.", "kwk.kkkk.", "kwk.kwkk.", "kkk.kkk..", ".k...k...", "........."],
  portfolio: ["kkkkkkkkk", "kw.kkk.wk", "k.kwwwk.k", "kkwwkwwkk", "k.kwwwk.k", "kkkkkkkkk", "........."],
  agent: ["k.......k", ".k.kkk.k.", "..kwwwk..", "..kwkwk..", "..kwwwk..", "...kkk...", "........."],
  more: [".........", ".........", "kk.kk.kk.", "kk.kk.kk.", ".........", ".........", "........."],
};

/**
 * Phone navigation: signpost tabs along the bottom edge. The current page's
 * tab is the yellow blade ("you are here"); MORE opens the rest, the
 * Where-to signpost and the sheet switches.
 */
export function MobileBar() {
  const [open, setOpen] = useState(false);
  const { location } = useRoute();
  const admin = useSessionRole("admin");
  // The owner console is listed only for an admin session (the server re-checks the role).
  const more = [...PHONE_MORE_NAV, SETTINGS_ITEM, ...(admin ? [ADMIN_ITEM] : [])];
  const moreActive = more.some((item) => location.pathname === item.href || location.pathname.startsWith(`${item.href}/`));
  return (
    <>
      <nav aria-label="Deck" className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t-2 border-rule bg-paper md:hidden">
        <ul className="grid h-16 grid-cols-5 items-stretch gap-2 px-3 py-2">
          {PHONE_NAV.map((item) => (
            <li key={item.id} className="flex min-w-0">
              <Link
                to={item.href}
                match={item.match ?? "prefix"}
                className={cx(TAB, "relative text-ink-2 aria-[current=page]:bg-signal aria-[current=page]:text-[#16201B] px-frame-thin [--pf-c:transparent] aria-[current=page]:[--pf-c:rgb(var(--rule))]", FOCUS_RING)}
              >
                {GLYPH[item.id] ? <PixelGlyph rows={GLYPH[item.id]!} scale={2} palette={{ k: "--ink", w: "--card" }} label={null} /> : null}
                {item.label}
              </Link>
            </li>
          ))}
          <li className="flex min-w-0">
            <button type="button" onClick={() => setOpen(true)} aria-haspopup="dialog" className={cx(TAB, "px-frame-thin", moreActive ? "bg-signal text-[#16201B]" : "bg-card text-ink", FOCUS_RING)}>
              <PixelGlyph rows={GLYPH.more!} scale={2} palette={{ k: "--ink" }} label={null} />
              More
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
          className={cx("mb-6 flex h-12 w-full items-stretch bg-card text-left px-frame px-drop", FOCUS_RING)}
        >
          <span className="flex items-center bg-ink px-3 font-tag text-xs uppercase text-paper">Where to?</span>
          <span className="flex items-center truncate px-3 font-mono text-[13px] text-ink-3">a page, a market, a sentence</span>
        </button>
        <ul className="grid grid-cols-2 gap-3">
          {more.map((item) => (
            <li key={item.id}>
              <Link
                to={item.href}
                match={item.match ?? "prefix"}
                onClick={() => setOpen(false)}
                className={cx("flex h-full flex-col gap-0.5 bg-card p-2.5 px-frame-thin aria-[current=page]:bg-signal/50", FOCUS_RING)}
              >
                <span className="font-tag text-[12px] uppercase text-ink">{item.label}</span>
                <span className="text-xs leading-snug text-ink-3">{item.hint}</span>
              </Link>
            </li>
          ))}
        </ul>
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 bg-card p-3 px-frame-thin">
          <MotionSwitch />
          <ThemeToggle />
        </div>
      </Sheet>
    </>
  );
}
