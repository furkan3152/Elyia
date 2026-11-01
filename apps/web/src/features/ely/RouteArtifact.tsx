/**
 * The route card artifact: the compact card inline in the conversation, and
 * the full panel (Route / Txs / Rules) beside it on desktop or in a bottom
 * sheet on phones. The panel runs the real sign flow (`useCardSign`): a
 * fresh planner dry run, then each leg prepared, signed in the wallet and
 * submitted only when the person presses Sign. Ely never signs.
 */
import type { Proposal, RouteCard } from "@elyia/core/api/agent";
import { explorerTxUrl, NETWORKS, type NetworkKey } from "@elyia/core/networks";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useMemo, useState, type ReactNode } from "react";

import { Link } from "../../app/routes/Link";
import { routeHref } from "../../app/routes/routeTable";
import type { RouteStepState } from "../../topo/RouteCard";
import { cx, FOCUS_RING } from "../../ui/cx";
import { cardView, compactAmount, venueLabel, type CardView } from "./cardModel";
import { drawAvatar, paletteOf } from "./draw";
import { RouteStrip } from "./RouteStrip";
import { Glyph, Stamp, type StampTone } from "./ui";
import { useCardSign, type CardSign, type SignSource } from "./useCardSign";
import { PixelCanvas } from "../../pixel/PixelCanvas";
import { saveRecipe } from "./recipes";

const STAMP: Readonly<Record<RouteStepState, { readonly tone: StampTone; readonly text: string }>> = {
  settled: { tone: "up", text: "Settled" },
  climbing: { tone: "warn", text: "Climbing" },
  next: { tone: "acc", text: "Sign next" },
  waiting: { tone: "ink", text: "Waiting" },
  failed: { tone: "dn", text: "Stopped" },
};

function shortHash(value: string): string {
  const hash = value.replace(/^evm:/u, "").split(":").at(-1) ?? value;
  return hash.length > 12 ? `${hash.slice(0, 6)}…${hash.slice(-4)}` : hash;
}

function hhmmss(ms: number): string {
  const date = new Date(ms);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}:${String(date.getSeconds()).padStart(2, "0")}`;
}

/* --------------------------------------------------------------- inline */

export interface RouteCardInlineProps {
  readonly card: RouteCard;
  readonly states?: readonly RouteStepState[];
  readonly onOpen: () => void;
  /** Phones: "Sign step N | Open ▴". */
  readonly compact?: boolean;
  readonly opened?: boolean;
}

/** The card inside Ely's message: strip at ×2, a tile per leg with its stamp, and "Open in panel ▸". */
export function RouteCardInline({ card, states, onOpen, compact = false, opened = false }: RouteCardInlineProps) {
  const view = useMemo(() => cardView(card, states ? { states } : {}), [card, states]);
  const next = view.legs.find((leg) => leg.state === "next" || leg.state === "failed");
  if (compact) {
    return (
      <div className="rcard fr stepin">
        <div className="rc-h" style={{ padding: "8px 10px" }}>
          <b style={{ fontSize: 13 }}>Route · {view.id}</b>
          {next ? <Stamp tone="acc">Sign next</Stamp> : <Stamp tone="up">Settled</Stamp>}
        </div>
        <div className="rc-strip">
          <RouteStrip layers={view.legs.map((leg) => leg.layer)} states={view.legs.map((leg) => leg.state)} scale={2} />
        </div>
        <div className="flex gap-2 p-[10px]">
          <button type="button" className={cx("b acc sm", FOCUS_RING)} style={{ flex: 1 }} onClick={onOpen}>
            {next ? `Sign step ${next.n}` : "Review"}
          </button>
          <button type="button" className={cx("b sm", FOCUS_RING)} onClick={onOpen} aria-label="Open the route card">
            Open ▴
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="rcard fr stepin">
      <div className="rc-h">
        <b>Route card · {view.id}</b>
        <button type="button" className={cx("b xs acc", FOCUS_RING)} onClick={onOpen} aria-expanded={opened}>
          {opened ? "In the panel ▸" : "Open in panel ▸"}
        </button>
      </div>
      <div className="rc-strip">
          <RouteStrip layers={view.legs.map((leg) => leg.layer)} states={view.legs.map((leg) => leg.state)} scale={2} />
        </div>
      <div className="rc-steps" style={{ gridTemplateColumns: `repeat(${Math.min(3, Math.max(1, view.legs.length))}, minmax(0, 1fr))` }}>
        {view.legs.slice(0, 3).map((leg) => (
          <div key={leg.n} className="rc-step">
            <b>
              {leg.n} · {leg.layer}
            </b>
            <span className="block truncate" title={leg.title}>
              {leg.title}
            </span>
            <Stamp tone={STAMP[leg.state].tone}>{STAMP[leg.state].text}</Stamp>
          </div>
        ))}
      </div>
      {view.legs.length > 3 ? <p className="px-[14px] pb-3 text-center font-tag text-[10px] uppercase text-ink-3">+ {view.legs.length - 3} more legs in the panel</p> : null}
    </div>
  );
}

/* ---------------------------------------------------------------- panel */

export interface RouteArtifactProps {
  readonly card: RouteCard;
  readonly proposal: Proposal | null;
  readonly source: SignSource;
  /** The connected wallet's session token: a proposal's card is then signed through the proposal (one linked intent). */
  readonly session?: string | null;
  /** When Ely drafted it (journey log). */
  readonly draftedAt: number;
  readonly onClose?: () => void;
  /** "panel": desktop half; "sheet": phone bottom sheet (no header). */
  readonly variant?: "panel" | "sheet";
}

type Tab = "route" | "txs" | "rules";

export function RouteArtifact({ card, proposal, source, session = null, draftedAt, onClose, variant = "panel" }: RouteArtifactProps) {
  const sign = useCardSign(source, session);
  const view = useMemo(() => cardView(card, { route: sign.route, ...(sign.states ? { states: sign.states } : {}) }), [card, sign.route, sign.states]);
  const [tab, setTab] = useState<Tab>("route");
  return (
    <section className="artifact h-full" aria-label={`Route card ${view.id}`}>
      {variant === "panel" ? (
        <div className="art-h">
          <Glyph name="peak" scale={3} />
          <b>Route card · {view.id}</b>
          <span className="flex-1" />
          <Tabs tab={tab} onTab={setTab} />
          {onClose ? (
            <button type="button" className={cx("b sm", FOCUS_RING)} onClick={onClose} aria-label="Close the route card panel">
              ✕
            </button>
          ) : null}
        </div>
      ) : (
        <div className="flex justify-center px-4 pb-1 pt-1">
          <Tabs tab={tab} onTab={setTab} />
        </div>
      )}
      <div className="art-b">
        {tab === "route" ? <RouteTab view={view} sign={sign} draftedAt={draftedAt} proposal={proposal} /> : tab === "txs" ? <TxsTab sign={sign} /> : <RulesTab card={card} sign={sign} />}
      </div>
      <SignFooter sign={sign} view={view} source={source} card={card} size={variant === "sheet" ? "" : "lg"} />
    </section>
  );
}

function Tabs({ tab, onTab }: { readonly tab: Tab; readonly onTab: (tab: Tab) => void }) {
  return (
    <div className="seg" role="tablist" aria-label="Route card views">
      {(["route", "txs", "rules"] as const).map((key) => (
        <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => onTab(key)} className={FOCUS_RING}>
          {key === "txs" ? "Txs" : key === "route" ? "Route" : "Rules"}
        </button>
      ))}
    </div>
  );
}

/** Before the plan exists: Ely climbing with "Surveying the route…". */
export function ArtifactWaiting({ onClose }: { readonly onClose?: () => void }) {
  return (
    <section className="artifact h-full" aria-label="Route card" aria-busy="true">
      <div className="art-h">
        <Glyph name="peak" scale={3} />
        <b>Route card</b>
        <span className="flex-1" />
        {onClose ? (
          <button type="button" className={cx("b sm", FOCUS_RING)} onClick={onClose} aria-label="Close the route card panel">
            ✕
          </button>
        ) : null}
      </div>
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
        <PixelCanvas width={20} height={22} scale={4} draw={(ctx, info) => drawAvatar(ctx, "climb", info.still ? 0.6 : info.seconds, paletteOf(ctx.canvas))} animate fps={12} label="Ely surveying the route" />
        <b className="disp text-[22px]">Surveying the route…</b>
        <span className="t-tag t-mute">quotes · shield · simulation</span>
      </div>
    </section>
  );
}

function RouteTab({ view, sign, draftedAt, proposal }: { readonly view: CardView; readonly sign: CardSign; readonly draftedAt: number; readonly proposal: Proposal | null }) {
  const settled = view.legs.filter((leg) => leg.state === "settled").length;
  const live = view.legs.find((leg) => leg.state === "climbing" || leg.state === "next" || leg.state === "failed");
  return (
    <>
      <div className="art-strip fr flat">
        <RouteStrip layers={view.legs.map((leg) => leg.layer)} states={view.legs.map((leg) => leg.state)} scale={4} />
        <div className="cap3">
          <span>
            {view.legs[0] ? `${view.legs[0].layer} · start` : ""}
          </span>
          <span className={settled === view.legs.length ? "t-up" : "t-acc"}>
            {settled === view.legs.length ? "▲ all settled" : live ? `● camp ${live.n} of ${view.legs.length}` : ""}
          </span>
          <span>{view.legs.at(-1)?.layer} · end</span>
        </div>
      </div>
      <ol className="legs" aria-label="Legs">
        {view.legs.map((leg) => (
          <li key={leg.n} className={cx("leg fr", leg.state === "next" && "acc", leg.state === "failed" && "dn")}>
            <span className={cx("n", leg.layer)} aria-label={`Leg ${leg.n}, ${leg.layer}`}>
              {leg.n}
            </span>
            <div className="what">
              <b title={leg.title}>{leg.title}</b>
              <span>{leg.detail}</span>
            </div>
            <div className="amt num">
              {leg.amount ?? "—"}
              <i>{leg.eta ?? ""}</i>
            </div>
            <div className="st">
              <Stamp tone={STAMP[leg.state].tone}>{STAMP[leg.state].text}</Stamp>
            </div>
          </li>
        ))}
      </ol>
      <div className="readouts4">
        {view.readouts.map((readout) => (
          <div key={readout.label} className="ro fr flat">
            <b>{readout.label}</b>
            <span className="num" title={readout.value}>
              {readout.value}
            </span>
            <i title={readout.sub}>{readout.sub}</i>
          </div>
        ))}
      </div>
      <JourneyLog sign={sign} draftedAt={draftedAt} proposal={proposal} view={view} />
      <div className="guards" aria-label="Guards">
        {view.guards.map((guard) => (
          <span key={guard} className="chip tiny">
            {guard}
          </span>
        ))}
      </div>
      {view.fakePrice || view.testnet ? (
        <p className="text-center font-mono text-[11px] leading-snug text-ink-2">
          <span className={cx("mr-2 px-1.5 py-px font-tag text-[9px] uppercase", view.fakePrice ? "bg-warn text-warn-on" : "bg-paper-2 text-ink-2")}>{view.fakePrice ? "fake testnet price" : "testnet"}</span>
          Testnet pools pay test prices; USD values use HyperCore mainnet reference mids. Read the Rules tab before signing.
        </p>
      ) : null}
    </>
  );
}

function JourneyLog({ sign, draftedAt, proposal, view }: { readonly sign: CardSign; readonly draftedAt: number; readonly proposal: Proposal | null; readonly view: CardView }) {
  const rows: { key: string; at: number | null; text: string; right: ReactNode }[] = [{ key: "drafted", at: draftedAt, text: proposal ? `Ely proposed it · ${proposal.status}` : "Ely drafted it · dry run", right: <span className="t-mute">nothing signed</span> }];
  if (sign.updatedAt > 0 && sign.route) rows.push({ key: "quoted", at: sign.updatedAt, text: `Planner re-quoted · ${sign.route.source === "planner" ? "bound at signing" : "offline plan"}`, right: <span className="t-mute">every 30 s</span> });
  if (sign.route) {
    sign.route.steps.forEach((step, index) => {
      const run = sign.run.runs[step.stepId];
      if (!run || run.state === "idle") return;
      const url = run.reference && (run.reference.startsWith("0x") || run.reference.startsWith("evm:")) ? explorerTxUrl(step.network as NetworkKey, run.reference.replace(/^evm:/u, "")) : null;
      rows.push({
        key: step.stepId,
        at: null,
        text: `Leg ${index + 1} ${run.state === "settled" ? "settled" : run.state === "failed" ? "stopped" : run.state === "signing" ? "waiting for your wallet" : run.state === "preparing" ? "preparing" : "sent"}${run.message ? ` · ${run.message}` : ""}`,
        right: run.reference ? (
          url ? (
            <a href={url} target="_blank" rel="noreferrer" className={cx("t-up underline decoration-dotted", FOCUS_RING)}>
              ✓ {shortHash(run.reference)}
            </a>
          ) : (
            <span className="t-up">✓ {shortHash(run.reference)}</span>
          )
        ) : (
          <span className="t-mute">{run.time ?? ""}</span>
        ),
      });
    });
  }
  const next = view.legs.find((leg) => leg.state === "next" || leg.state === "failed");
  if (next) rows.push({ key: "next", at: null, text: `Leg ${next.n} waiting for your signature`, right: <span className="t-acc">sign ▸</span> });
  return (
    <div className="jlog fr flat">
      <span className="t-tag t-mute">Journey log</span>
      {rows.map((row) => (
        <div key={row.key} className="stepin">
          <span className="num t-mute">{row.at ? hhmmss(row.at) : "·"}</span>
          <span className="truncate">{row.text}</span>
          {row.right}
        </div>
      ))}
    </div>
  );
}

function TxsTab({ sign }: { readonly sign: CardSign }) {
  const steps = sign.route?.steps ?? [];
  const signed = steps.filter((step) => sign.run.runs[step.stepId]?.reference);
  if (signed.length === 0) {
    return (
      <div className="fr flat flex flex-col items-center gap-2 p-6 text-center">
        <Glyph name="wallet" scale={3} />
        <b className="disp text-[18px]">Nothing signed yet</b>
        <p className="max-w-[420px] text-[12.5px] text-ink-2">Each leg asks your wallet when you press Sign. The planner prepares the transaction then, with a fresh quote bound to it; it never holds a key.</p>
      </div>
    );
  }
  return (
    <ul className="flex flex-col gap-2">
      {signed.map((step) => {
        const run = sign.run.runs[step.stepId]!;
        const url = run.reference && (run.reference.startsWith("0x") || run.reference.startsWith("evm:")) ? explorerTxUrl(step.network as NetworkKey, run.reference.replace(/^evm:/u, "")) : null;
        return (
          <li key={step.stepId} className="fr flat flex items-center justify-between gap-3 px-3 py-2 text-[12px]">
            <span className="min-w-0 truncate">
              {step.title} · {NETWORKS[step.network as NetworkKey]?.shortName ?? step.network}
            </span>
            {url ? (
              <a href={url} target="_blank" rel="noreferrer" className={cx("num t-acc underline", FOCUS_RING)}>
                {shortHash(run.reference!)} ↗
              </a>
            ) : (
              <span className="num">{shortHash(run.reference!)}</span>
            )}
          </li>
        );
      })}
      {sign.run.journeyId ? (
        <li className="text-center">
          <Link to={routeHref("track", { id: sign.run.journeyId })} className={cx("t-tag t-acc underline", FOCUS_RING)}>
            Follow it on the track page →
          </Link>
        </li>
      ) : null}
    </ul>
  );
}

function RulesTab({ card, sign }: { readonly card: RouteCard; readonly sign: CardSign }) {
  const decision = sign.route?.decision ?? card.policy.decision;
  return (
    <>
      <div className="fr flat p-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="t-tag t-mute">Rule Book</span>
          <span className={cx("pill", decision === "allow" ? "up" : decision === "deny" ? "dn" : "sig")}>{decision}</span>
        </div>
        <ul className="flex flex-col gap-1 text-[12px]">
          {(sign.route?.rules.length ? sign.route.rules : card.policy.reasons.length ? card.policy.reasons : ["Every check the Rule Book ran passed."]).map((rule, index) => {
            const text = typeof rule === "string" ? rule : rule.text;
            const mark = typeof rule === "string" ? "ok" : rule.mark;
            return (
              <li key={`${index}-${text}`} className="flex gap-2">
                <span aria-hidden="true" className={mark === "fail" ? "t-down" : mark === "warn" ? "t-warn" : "t-up"}>
                  {mark === "fail" ? "✕" : mark === "warn" ? "!" : "✓"}
                </span>
                <span>{text}</span>
              </li>
            );
          })}
        </ul>
      </div>
      {card.venues.length > 0 ? (
        <div className="rd-detail">
          <span className="h">Venue</span>
          <span className="h">Auction</span>
          <span className="h text-right">Pays</span>
          {card.venues.map((venue) => (
            <Fragment3 key={venue.protocol} name={venueLabel(venue.protocol)} note={venue.winner ? "winner" : (venue.note ?? "quoted")} value={compactAmount(venue.expected)} winner={venue.winner} />
          ))}
        </div>
      ) : null}
      {card.warnings.length > 0 ? (
        <ul className="flex flex-col gap-2" aria-label="Trail notes">
          {card.warnings.map((warning) => (
            <li key={warning} className="flex gap-3 text-[12px] leading-snug text-ink-2">
              <span className={cx("mt-px h-fit shrink-0 px-1.5 py-px font-tag text-[9px] uppercase", /fake price/iu.test(warning) ? "bg-warn text-warn-on" : "bg-paper-2 text-ink-2")}>{/fake price/iu.test(warning) ? "fake price" : /testnet/iu.test(warning) ? "testnet" : "note"}</span>
              <span>{warning}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

function Fragment3({ name, note, value, winner }: { readonly name: string; readonly note: string; readonly value: string; readonly winner: boolean }) {
  return (
    <>
      <span>{name}</span>
      <span>{note}</span>
      <span className={cx("num text-right", winner && "ok")}>
        {value}
        {winner ? " ✓" : ""}
      </span>
    </>
  );
}

function SignFooter({ sign, view, source, card, size }: { readonly sign: CardSign; readonly view: CardView; readonly source: SignSource; readonly card: RouteCard; readonly size: "" | "lg" }) {
  const [confirmed, setConfirmed] = useState(false);
  const [saved, setSaved] = useState(false);
  const plan = sign.plan;
  const route = sign.route;
  const next = view.legs.find((leg) => leg.state === "next" || leg.state === "failed");
  const finished = view.legs.length > 0 && view.legs.every((leg) => leg.state === "settled");
  const mustConfirm = route?.decision === "confirm" && (route.confirmations?.length ?? 0) > 0 && view.legs.every((leg) => leg.state !== "settled");
  let action: ReactNode;
  if (!sign.connected) {
    action = (
      <ConnectButton.Custom>
        {({ openConnectModal, mounted }) => (
          <button type="button" className={cx(`b acc ${size}`, FOCUS_RING)} onClick={openConnectModal} disabled={!mounted}>
            Connect to sign
          </button>
        )}
      </ConnectButton.Custom>
    );
  } else if (finished) {
    action = (
      <Link to={sign.run.journeyId ? routeHref("track", { id: sign.run.journeyId }) : routeHref("track")} className={cx(`b ink ${size}`, FOCUS_RING)}>
        On the summit · track →
      </Link>
    );
  } else if (!plan) {
    action = (
      <button type="button" className={`b acc ${size}`} disabled>
        Surveying the route…
      </button>
    );
  } else if (plan.kind === "refused" || plan.kind === "clarify") {
    action = (
      <p className="max-w-[520px] text-center text-[12.5px] leading-snug text-ink">
        <Stamp tone="dn" thump={false} className="mr-2">
          {plan.kind === "refused" ? "No route" : "Question"}
        </Stamp>
        {plan.message}
      </p>
    );
  } else {
    action = (
      <button
        type="button"
        className={cx(`b acc ${size}`, !sign.run.busy && next && "pulse", FOCUS_RING)}
        disabled={sign.run.busy || !next || route?.decision === "deny" || (mustConfirm && !confirmed)}
        onClick={() => void sign.run.start({ confirmed: mustConfirm && confirmed })}
      >
        {sign.run.busy ? "Check your wallet…" : next ? `Sign ${view.legs.length > 1 ? `leg ${next.n}` : "it"} · ${next.layer}` : "Waiting on the chain"}
      </button>
    );
  }
  return (
    <div className="art-f">
      {mustConfirm ? (
        <label className="flex max-w-[520px] items-start gap-3 bg-warn/20 px-3 py-2 text-left text-[12.5px] leading-snug">
          <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className={cx("mt-0.5 h-4 w-4 shrink-0", FOCUS_RING)} />
          <span>
            <span className="block font-tag text-[10px] uppercase text-ink-2">The Rule Book asks you to confirm</span>
            {route!.confirmations!.join(" · ")}
          </span>
        </label>
      ) : null}
      <div className="flex flex-wrap items-center justify-center gap-3">
        {action}
        <button
          type="button"
          className={cx(`b ${size}`, FOCUS_RING)}
          onClick={() => {
            saveRecipe({ title: view.title, source, card });
            setSaved(true);
          }}
          disabled={saved}
        >
          {saved ? "Saved ✓" : "Save as recipe"}
        </button>
      </div>
      <p className="text-center font-tag text-[10px] uppercase text-ink-3" aria-live="polite">
        {sign.run.error ? <span className="block normal-case text-down">{sign.run.error}</span> : null}
        {sign.planning ? "re-quoting · " : ""}dry run until you sign · your wallet signs every leg
      </p>
    </div>
  );
}
