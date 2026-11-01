import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { cx, FOCUS_RING } from "../../../ui/cx";
import type { PortalGlyphName } from "./glyphs";
import { PORTAL_GO_EVENT, revealSection, scrollToSection } from "./scroll";
import { neighbours, viewForHash } from "./views";
import { Glyph, Pill } from "./ui";

export interface PortalNavItem {
  /** Section id on the page. */
  readonly id: string;
  readonly label: string;
  readonly glyph: PortalGlyphName;
  readonly badge?: React.ReactNode;
  /** Extra words the search matches ("endpoint", "hmac"). */
  readonly keywords?: string;
  /** With `views`: the view that holds this section. */
  readonly view?: string;
}

/** One sub-view of a portal (a page of sections); the hash picks it. */
export interface PortalView {
  readonly id: string;
  readonly label: string;
  readonly node: React.ReactNode;
}

export interface PortalNavGroup {
  readonly title: string;
  readonly items: readonly PortalNavItem[];
}

export interface PortalShellProps {
  /** The chip beside the bar ("Developers", "Owner console"). */
  readonly chip: string;
  readonly navLabel: string;
  readonly groups: readonly PortalNavGroup[];
  /** A small card under the side nav. */
  readonly note?: React.ReactNode;
  /** Right side of the portal bar: status, session. */
  readonly barRight?: React.ReactNode;
  readonly searchPlaceholder?: string;
  /** Sub-views chosen by the URL hash (deep links to any section keep working). Without them, `children` is one long page. */
  readonly views?: readonly PortalView[];
  readonly children?: React.ReactNode;
}

/** The view and section the URL hash names, following hash changes, Back and `scrollToSection`. */
function useHashView(items: readonly PortalNavItem[], views: readonly PortalView[] | undefined) {
  const ids = useMemo(() => (views ?? []).map((view) => view.id), [views]);
  const viewItems = useMemo(() => items.filter((item): item is PortalNavItem & { view: string } => typeof item.view === "string").map((item) => ({ id: item.id, view: item.view })), [items]);
  const read = useCallback(() => viewForHash(typeof window === "undefined" ? "" : window.location.hash, viewItems, ids), [viewItems, ids]);
  const [state, setState] = useState(() => ({ ...read(), nonce: 0, initial: true }));
  useEffect(() => {
    const sync = () => setState((previous) => ({ ...read(), nonce: previous.nonce + 1, initial: false }));
    const onGo = (event: Event) => {
      if (views) sync();
      else revealSection(String((event as CustomEvent<string>).detail));
    };
    window.addEventListener("hashchange", sync);
    window.addEventListener("popstate", sync);
    window.addEventListener(PORTAL_GO_EVENT, onGo);
    return () => {
      window.removeEventListener("hashchange", sync);
      window.removeEventListener("popstate", sync);
      window.removeEventListener(PORTAL_GO_EVENT, onGo);
    };
  }, [read, views]);
  // After the view renders: scroll to the named section, or to the top of a newly opened view.
  useEffect(() => {
    if (!views) return undefined;
    if (state.initial && !state.section) return undefined;
    const timer = window.setTimeout(() => (state.section ? revealSection(state.section) : revealSection(state.view, { top: true })), state.initial ? 250 : 30);
    return () => window.clearTimeout(timer);
  }, [views, state]);
  return state;
}

/** Which section is under the top of the viewport (scroll spy). */
function useCurrentSection(ids: readonly string[]): string | null {
  const [current, setCurrent] = useState<string | null>(ids[0] ?? null);
  const key = ids.join("|");
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return undefined;
    const visible = new Map<string, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.set(entry.target.id, entry.boundingClientRect.top);
          else visible.delete(entry.target.id);
        }
        // Page order, not nav order: a section that holds others (Ship it holds the widget) comes first.
        const order = key
          .split("|")
          .map((id) => document.getElementById(id))
          .filter((element): element is HTMLElement => element !== null)
          .sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))
          .map((element) => element.id);
        const first = order.find((id) => visible.has(id));
        if (first) setCurrent(first);
      },
      { rootMargin: "-20% 0px -60% 0px" },
    );
    for (const id of key.split("|")) {
      const element = document.getElementById(id);
      if (element) observer.observe(element);
    }
    return () => observer.disconnect();
  }, [key]);
  return current;
}

function NavLink({ item, current, onGo }: { readonly item: PortalNavItem; readonly current: boolean; readonly onGo: (id: string) => void }) {
  return (
    <a
      href={`#${item.id}`}
      aria-current={current ? "true" : undefined}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
        event.preventDefault();
        onGo(item.id);
      }}
      className={cx("flex items-center gap-2.5 px-2.5 py-[7px] text-[12.5px] text-ink-2 hover:bg-paper-2 hover:text-ink", FOCUS_RING)}
    >
      <Glyph name={item.glyph} />
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {item.badge !== undefined ? <Pill tone="mute">{item.badge}</Pill> : null}
    </a>
  );
}

/**
 * The portal frame (v2 screens 03 and 04): a 264 px side nav with grouped
 * section links (scroll spy marks the current one) and a note card, a portal
 * bar with search, status and session, then the content column on its own
 * centre axis. Phones get the links as a scrolling chip row.
 */
export function PortalShell({ chip, navLabel, groups, note, barRight, searchPlaceholder = "Search sections", views, children }: PortalShellProps) {
  const items = useMemo(() => groups.flatMap((group) => group.items), [groups]);
  const hashView = useHashView(items, views);
  const activeView = views ? (views.find((view) => view.id === hashView.view) ?? views[0] ?? null) : null;
  const spied = useCurrentSection(items.filter((item) => !activeView || item.view === activeView.id).map((item) => item.id));
  // In a sub-view the hash's section wins until the spy sees another one of the same view.
  const current = activeView && spied && items.find((item) => item.id === spied)?.view !== activeView.id ? null : spied;
  const order = views?.map((view) => view.id) ?? [];
  const around = activeView ? neighbours(activeView.id, order) : { previous: null, next: null };
  const labelOf = (id: string | null) => views?.find((view) => view.id === id)?.label ?? "";
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const matches = useMemo(() => {
    const words = query.trim().toLowerCase();
    if (!words) return [];
    return items.filter((item) => `${item.label} ${item.keywords ?? ""}`.toLowerCase().includes(words)).slice(0, 6);
  }, [items, query]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/u.test(target.tagName))) return;
      event.preventDefault();
      inputRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const go = (id: string) => {
    setQuery("");
    scrollToSection(id);
  };

  return (
    <div className="relative mx-auto grid w-full max-w-[1440px] grid-cols-1 lg:grid-cols-[264px_minmax(0,1fr)]">
      <aside className="hidden border-r-2 border-rule bg-card/70 lg:block">
        <nav aria-label={navLabel} className="portal-nav sticky top-[calc(var(--header-h)+8px)] flex max-h-[calc(100dvh-var(--header-h)-16px)] flex-col gap-5 overflow-y-auto px-4 py-6">
          {groups.map((group) => (
            <div key={group.title} className="flex flex-col gap-0.5">
              <h2 className="mb-1.5 px-2.5 font-tag text-[10px] uppercase tracking-[0.1em] text-ink-3">{group.title}</h2>
              {group.items.map((item) => (
                <NavLink key={item.id} item={item} current={current === item.id || (activeView !== null && current === null && item.id === activeView.id)} onGo={go} />
              ))}
            </div>
          ))}
          {note ? <div className="bg-card p-3 text-[11.5px] leading-[1.45] text-ink-2 px-frame-thin">{note}</div> : null}
        </nav>
      </aside>
      <div className="min-w-0">
        <div className="border-b-2 border-rule bg-card/80">
          <div className="mx-auto grid max-w-[1088px] grid-cols-1 items-center gap-3 px-6 py-3 md:grid-cols-[1fr_minmax(0,420px)_1fr]">
            <div className="hidden md:block">
              <Pill tone="sig">{chip}</Pill>
            </div>
            <div className="relative">
              <label className="flex h-10 items-center gap-2.5 bg-paper px-3 text-[12.5px] text-ink-3 px-frame-thin focus-within:outline-dashed focus-within:outline-4 focus-within:outline-offset-[4px] focus-within:outline-signal">
                <Glyph name="search" />
                <span className="sr-only">Search</span>
                <input
                  ref={inputRef}
                  type="search"
                  value={query}
                  placeholder={searchPlaceholder}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && matches[0]) go(matches[0].id);
                    if (event.key === "Escape") setQuery("");
                  }}
                  className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-ink-3"
                  aria-controls="portal-search-results"
                  aria-expanded={matches.length > 0}
                />
                <kbd className="bg-paper-2 px-1.5 font-tag text-[10px] text-ink-2">/</kbd>
              </label>
              {matches.length > 0 ? (
                <ul id="portal-search-results" className="absolute inset-x-0 top-[calc(100%+6px)] z-30 bg-card p-1 px-frame px-drop">
                  {matches.map((item) => (
                    <li key={item.id}>
                      <button type="button" onClick={() => go(item.id)} className={cx("flex w-full items-center gap-2.5 px-2.5 py-2 text-left text-[12.5px] text-ink hover:bg-paper-2", FOCUS_RING)}>
                        <Glyph name={item.glyph} />
                        {item.label}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center justify-start gap-2 md:justify-end">{barRight}</div>
          </div>
        </div>
        <nav aria-label={`${navLabel} (sections)`} className="flex gap-2 overflow-x-auto border-b-2 border-rule bg-card/60 px-4 py-2.5 lg:hidden">
          {items.map((item) => (
            <a
              key={item.id}
              href={`#${item.id}`}
              aria-current={current === item.id ? "true" : undefined}
              onClick={(event) => {
                event.preventDefault();
                go(item.id);
              }}
              className={cx("flex shrink-0 items-center gap-1.5 px-2.5 py-1.5 font-tag text-[10px] uppercase px-frame-thin", current === item.id ? "bg-accent text-accent-ink" : "bg-card text-ink-2", FOCUS_RING)}
            >
              {item.label}
            </a>
          ))}
        </nav>
        <div className="mx-auto w-full max-w-[1088px] px-4 pb-20 sm:px-6">
          {activeView ? (
            <>
              <div key={activeView.id} id={`view-${activeView.id}`} className="portal-view">
                {activeView.node}
              </div>
              <nav aria-label={`${navLabel}: previous and next`} className="mt-14 grid grid-cols-2 gap-6 border-t-2 border-dashed border-rule pt-6">
                <div>
                  {around.previous ? (
                    <a href={`#${around.previous}`} onClick={(event) => { event.preventDefault(); go(around.previous as string); }} className={cx("inline-flex flex-col gap-0.5 text-left", FOCUS_RING)}>
                      <span className="font-tag text-[10px] uppercase text-ink-3">← Previous</span>
                      <span className="font-display text-[18px] font-bold text-ink">{labelOf(around.previous)}</span>
                    </a>
                  ) : null}
                </div>
                <div className="text-right">
                  {around.next ? (
                    <a href={`#${around.next}`} onClick={(event) => { event.preventDefault(); go(around.next as string); }} className={cx("inline-flex flex-col items-end gap-0.5", FOCUS_RING)}>
                      <span className="font-tag text-[10px] uppercase text-ink-3">Next →</span>
                      <span className="font-display text-[18px] font-bold text-ink">{labelOf(around.next)}</span>
                    </a>
                  ) : null}
                </div>
              </nav>
            </>
          ) : (
            children
          )}
        </div>
      </div>
    </div>
  );
}
