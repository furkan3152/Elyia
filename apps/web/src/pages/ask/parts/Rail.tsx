import type { Automation } from "@elyia/core/api/agent";
import { useEffect, useMemo, useRef, useState } from "react";

import { Link } from "../../../app/routes/Link";
import { routeHref } from "../../../app/routes/routeTable";
import { useAutomations, useSkills } from "../../../features/ely/agentApi";
import { drawAvatar, paletteOf } from "../../../features/ely/draw";
import { useRecipes, type Recipe } from "../../../features/ely/recipes";
import { groupThreads, type ChatThread } from "../../../features/ely/threads";
import { Glyph } from "../../../features/ely/ui";
import type { RopeView } from "../../../features/trading/useTopoData";
import { useNow } from "../../../hooks/useNow";
import { HerdPortrait } from "../../../pixel/Herd";
import { PixelCanvas } from "../../../pixel/PixelCanvas";
import { cx, FOCUS_RING } from "../../../ui/cx";
import { herdIdOf } from "../../../features/ely/herdId";
import { useHerdAvatar } from "../../../features/herd/useHerdAvatar";
import { useJourneys } from "../../track/flow/journeyStore";

export interface RailProps {
  readonly threads: readonly ChatThread[];
  readonly activeId: string | null;
  readonly liveIds: Readonly<Record<string, true>>;
  readonly onNew: () => void;
  readonly onPick: (id: string) => void;
  readonly onRecipe: (recipe: Recipe) => void;
  readonly ropes: readonly RopeView[];
  readonly ropesSample: boolean;
  readonly address: string | null;
  readonly sample: boolean;
  readonly token: string | null;
  readonly signingIn: boolean;
  readonly onSignIn: () => void;
  readonly onSignOut: () => void;
  readonly connected: boolean;
}

const short = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;

function ClimbingEly() {
  return <PixelCanvas width={20} height={22} scale={1} draw={(ctx, info) => drawAvatar(ctx, "climb", info.still ? 0.6 : info.seconds, paletteOf(ctx.canvas))} animate fps={8} decorative className="shrink-0" />;
}

/**
 * The rail: New climb (N), search, In flight (journeys signed from this
 * browser), Threads by date, Recipes, Watching (rope distance with a square
 * AND a word, never colour alone) and Automations, then the account footer.
 */
export function Rail({ threads, activeId, liveIds, onNew, onPick, onRecipe, ropes, ropesSample, address, sample, token, signingIn, onSignIn, onSignOut, connected }: RailProps) {
  const herdAvatar = useHerdAvatar(sample ? null : address);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const now = useNow(60_000);
  const groups = useMemo(() => groupThreads(threads, now, query), [threads, now, query]);
  const journeys = useJourneys();
  const recipes = useRecipes();
  const automations = useAutomations(token);
  const skills = useSkills();
  const inFlight = journeys.filter((journey) => journey.legs.length > 0 && now - journey.createdAt < 3 * 24 * 3600_000).slice(0, 3);
  const watching = [...ropes].filter((rope) => rope.distance !== null).sort((a, b) => (a.distance ?? 1) - (b.distance ?? 1)).slice(0, 3);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "n" || event.key === "N") {
        event.preventDefault();
        onNew();
      } else if (event.key === "/") {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onNew]);

  return (
    <nav className="rail h-full" aria-label="Ely threads">
      <button type="button" onClick={onNew} className={cx("b acc full", FOCUS_RING)} aria-keyshortcuts="N">
        + New climb <span className="kbd ml-1 !bg-transparent !text-current">N</span>
      </button>
      <label className="search fr flat">
        <Glyph name="search" scale={2} />
        <span className="sr-only">Search threads</span>
        <input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search threads" type="search" />
        <span className="kbd" aria-hidden="true">
          /
        </span>
      </label>
      <div className="rail-scroll">
        {inFlight.length > 0 ? (
          <section className="rg" aria-label="In flight">
            <h2>
              In flight <span>{inFlight.length}</span>
            </h2>
            <ul>
              {inFlight.map((journey) => {
                const legs = journey.legs.length;
                const total = Math.max(legs, journey.layers.length);
                return (
                  <li key={journey.id}>
                    <Link to={routeHref("track", { id: journey.id })} className={cx("ri flight", FOCUS_RING)}>
                      <ClimbingEly />
                      <span className="tx">
                        <b>{journey.sentence || journey.routeId}</b>
                        <i>
                          {legs} signed leg{legs === 1 ? "" : "s"} · {journey.layers.join(" → ")}
                        </i>
                      </span>
                      <span className="prog" aria-hidden="true">
                        <i style={{ width: `${Math.min(100, Math.round((legs / Math.max(1, total)) * 100))}%` }} />
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}
        <section className="rg" aria-label="Threads">
          <h2>
            Threads <span>{threads.length}</span>
          </h2>
          {groups.length === 0 ? (
            <p className="px-2.5 py-1 text-[12px] text-ink-3">{query ? "No thread matches." : "No climbs yet. Ask Ely anything."}</p>
          ) : (
            groups.map((group) => (
              <div key={group.label}>
                <p className="rdate">{group.label}</p>
                <ul>
                  {group.threads.map((thread) => (
                    <li key={thread.id}>
                      <button type="button" onClick={() => onPick(thread.id)} aria-current={thread.id === activeId ? "true" : undefined} className={cx("ri", FOCUS_RING)}>
                        <span className="tx">{thread.title}</span>
                        {liveIds[thread.id] ? <small>live</small> : null}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </section>
        {recipes.length > 0 ? (
          <section className="rg" aria-label="Recipes">
            <h2>
              Recipes <span>{recipes.length}</span>
            </h2>
            <ul>
              {recipes.slice(0, 4).map((recipe) => (
                <li key={recipe.id}>
                  <button type="button" onClick={() => onRecipe(recipe)} className={cx("ri", FOCUS_RING)} title="Open it as a fresh route card (re-planned, re-quoted)">
                    <span className="tx">{recipe.title}</span>
                    <small>run</small>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        <section className="rg" aria-label="Watching">
          <h2>
            Watching <span>{ropesSample ? "sample" : watching.length}</span>
          </h2>
          {watching.length === 0 ? (
            <p className="px-2.5 py-1 text-[12px] text-ink-3">No open ropes{sample ? " · connect to watch yours" : ""}.</p>
          ) : (
            <ul>
              {watching.map((rope) => {
                const pct = Math.round((rope.distance ?? 0) * 100);
                const word = pct < 10 ? "risk" : pct < 20 ? "watch" : "ok";
                return (
                  <li key={`${rope.dex}:${rope.coin}`}>
                    <Link to={routeHref("trade", { market: rope.coin.replace(/^.*:/u, "") })} className={cx("ri", FOCUS_RING)}>
                      <span className={cx("dotc", word === "risk" ? "dn" : word === "watch" ? "warn" : "")} aria-hidden="true" />
                      <span className="tx">
                        {rope.coin.replace(/^.*:/u, "")} {rope.side === "short" ? "short" : `${Math.round(rope.leverage)}×`} · rope {pct}%
                      </span>
                      <small>{word}</small>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
        <AutomationsGroup token={token} automations={automations.data?.automations ?? null} catalog={skills.data?.automations ?? []} />
      </div>
      <div className="rail-foot">
        <HerdPortrait id={herdAvatar ? herdAvatar.art : herdIdOf(address)} scale={1} label={herdAvatar ? `Your Herd goat${herdAvatar.tokenId ? ` #${herdAvatar.tokenId}` : ""}` : null} />
        <div className="who">
          <b className="num">{sample ? "Sample wallet" : address ? short(address) : "—"}</b>
          <i>{herdAvatar && !sample ? "Herd holder · " : ""}{sample ? "labelled sample · connect yours" : token ? "signed in · propose mode" : "propose mode"}</i>
        </div>
        {connected ? (
          token ? (
            <button type="button" onClick={onSignOut} className={cx("b xs", FOCUS_RING)} title="Forget this tab's Ely session">
              Sign out
            </button>
          ) : (
            <button type="button" onClick={onSignIn} disabled={signingIn} className={cx("b xs acc", FOCUS_RING)} title="Sign a message (not a transaction) so Ely can file proposals and keep threads">
              {signingIn ? "…" : "Sign in"}
            </button>
          )
        ) : null}
      </div>
    </nav>
  );
}

function AutomationsGroup({ token, automations, catalog }: { readonly token: string | null; readonly automations: readonly Automation[] | null; readonly catalog: readonly { readonly kind: string; readonly title: { readonly en: string } }[] }) {
  const on = automations?.filter((automation) => automation.enabled) ?? [];
  return (
    <section className="rg" aria-label="Automations">
      <h2>
        Automations <span>{automations ? `${on.length} on` : "sign in"}</span>
      </h2>
      <ul>
        {(automations && automations.length > 0 ? automations.map((automation) => ({ kind: automation.kind, enabled: automation.enabled, title: catalog.find((entry) => entry.kind === automation.kind)?.title.en ?? automation.kind })) : catalog.slice(0, 3).map((entry) => ({ kind: entry.kind, enabled: false, title: entry.title.en }))).slice(0, 4).map((row) => (
          <li key={row.kind}>
            <Link to={`${routeHref("portfolio")}#automations`} className={cx("ri", FOCUS_RING)}>
              <span className={cx("dotc", !row.enabled && "off")} aria-hidden="true" />
              <span className="tx">{row.title}</span>
              <small>{token ? (row.enabled ? "on" : "off") : "off"}</small>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
