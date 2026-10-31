import { useMemo, useRef, useState } from "react";

import { useOracleStore } from "../../oracle/oracleStore";
import { Ely } from "../../pixel/Ely";
import { cssVars } from "../../motion/tokens";
import { Blaze } from "../../topo/Blaze";
import { gradeFor, type Grade } from "../../topo/geometry/conditions";
import { cx, FOCUS_RING } from "../../ui/cx";
import { Kbd } from "../../ui/Kbd";
import { ModalLayer } from "../../ui/overlay/ModalLayer";
import { WhereToInput } from "../../ui/WhereToInput";
import { navigate } from "../routes/history";
import { routeHref } from "../routes/routeTable";
import { MORE_NAV, PRIMARY_NAV, SETTINGS_ITEM } from "./navItems";

interface Destination {
  readonly id: string;
  readonly title: string;
  readonly detail: string;
  readonly href: string;
  readonly grade?: Grade;
  /** Words that find it. */
  readonly words: string;
}

const PLACES: readonly Destination[] = [
  ...[...PRIMARY_NAV, ...MORE_NAV, SETTINGS_ITEM].map((item) => ({ id: item.id, title: item.label, detail: item.hint, href: item.href, words: `${item.label} ${item.hint}`.toLowerCase() })),
  { id: "system", title: "Map key", detail: "Every token, primitive and drawn artifact", href: routeHref("system"), words: "map key system kit legend design" },
];

const VERBS = /\b(long|short|buy|sell|swap|bridge|send|stake|unstake|move|ascend|descend|close|flatten|twap|limit|deposit|withdraw|lend|alert)\b/iu;
const MARKET = /\b(?:trade|long|short|buy|sell)\s+([a-z]{2,8})\b/iu;

/** Builds the blades for what was typed: plan it as a route, trade a market, or go to a page. */
function destinationsFor(text: string): Destination[] {
  const query = text.trim();
  const lower = query.toLowerCase();
  const out: Destination[] = [];
  if (query.length > 0 && (VERBS.test(query) || /\d/u.test(query))) {
    const leverage = Number(/(\d+(?:\.\d+)?)\s*x\b/iu.exec(query)?.[1] ?? 1);
    const perp = /\b(long|short)\b/iu.test(query);
    out.push({
      id: "plan",
      title: "Plan this route",
      detail: "The Guide drafts the route card; you sign each step",
      href: `${routeHref("deck")}?intent=${encodeURIComponent(query)}`,
      grade: gradeFor({ kind: perp ? "perp" : /\bswap\b/iu.test(query) ? "swap" : /\bbridge|ascend|descend\b/iu.test(query) ? "bridge" : "send", leverage }),
      words: "",
    });
  }
  const market = MARKET.exec(query)?.[1];
  if (market) {
    const coin = market.toUpperCase();
    out.push({ id: `trade-${coin}`, title: `Trade ${coin}`, detail: "Open the HyperCore terminal on this market", href: routeHref("trade", { market: coin }), words: "" });
  }
  const terms = lower.split(/\s+/u).filter((term) => term.length > 1);
  const places = terms.length === 0 ? PLACES.slice(0, 6) : PLACES.filter((place) => terms.some((term) => place.words.includes(term)));
  for (const place of places) if (out.length < 7) out.push(place);
  return out;
}

/**
 * ⌘K / Ctrl-K: the "WHERE TO?" dialog in a pixel frame, with Ely listening
 * (and talking once you type). Type a page, a market or a
 * whole sentence; arrow keys pick a blade, Enter goes. A sentence goes to the
 * deck as `/app?intent=` (the Guide plans it there; nothing is signed here).
 */
export function WhereTo() {
  const open = useOracleStore((state) => state.open);
  const draft = useOracleStore((state) => state.draft);
  const setDraft = useOracleStore((state) => state.setDraft);
  const close = useOracleStore((state) => state.closeOracle);
  const inputRef = useRef<HTMLInputElement>(null);
  const [active, setActive] = useState(0);
  const blades = useMemo(() => destinationsFor(draft), [draft]);
  const selected = Math.min(active, Math.max(0, blades.length - 1));

  const go = (destination: Destination | undefined) => {
    if (!destination) return;
    close();
    navigate(destination.href);
  };

  return (
    <ModalLayer open={open} onClose={close} placement="top" ariaLabel="Where to?" initialFocusRef={inputRef} panelClassName="w-full max-w-[680px] animate-dialog-in">
      <div className="flex flex-col gap-4 bg-paper p-4 px-frame px-drop-lg sm:p-5">
        <div className="flex items-end gap-3">
          <Ely state={draft.trim() ? "talk" : "idle"} size={66} label={null} className="-mb-1 hidden shrink-0 sm:inline-block" />
          <WhereToInput
            ref={inputRef}
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              setActive(0);
            }}
            placeholder="trade ETH · portfolio · long HYPE 3x with 200 USDC"
            role="combobox"
            aria-expanded="true"
            aria-controls="el-whereto-list"
            aria-activedescendant={blades[selected] ? `el-whereto-${blades[selected]!.id}` : undefined}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActive((selected + 1) % Math.max(1, blades.length));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setActive((selected - 1 + blades.length) % Math.max(1, blades.length));
              } else if (event.key === "Enter") {
                event.preventDefault();
                go(blades[selected]);
              }
            }}
            aside={<Kbd>Esc</Kbd>}
          />
        </div>
        <ul id="el-whereto-list" role="listbox" aria-label="Destinations" className="flex flex-col gap-3 px-1">
          {blades.map((blade, index) => {
            const on = index === selected;
            return (
              <li key={blade.id} id={`el-whereto-${blade.id}`} role="option" aria-selected={on}>
                <button
                  type="button"
                  tabIndex={-1}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => go(blade)}
                  className={cx("el-swing flex min-h-[48px] w-full items-center gap-3 px-3 py-1.5 text-left px-frame-thin", on ? "bg-signal text-[#16201B] px-drop" : "bg-card text-ink", FOCUS_RING)}
                  style={cssVars({ "--el-delay": `${index * 50}ms` })}
                >
                  <span aria-hidden="true" className="w-4 shrink-0 font-tag text-sm">
                    {on ? "▶" : ""}
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate font-display text-[17px] font-bold">{blade.title}</span>
                    <span className="truncate font-mono text-xs opacity-80">{blade.detail}</span>
                  </span>
                  {blade.grade ? <Blaze grade={blade.grade} size={13} className="ml-auto" /> : null}
                </button>
              </li>
            );
          })}
        </ul>
        <p className="text-center font-tag text-[11px] uppercase text-ink-2">↑ ↓ choose · ↵ go · the Guide drafts, you sign</p>
      </div>
    </ModalLayer>
  );
}
