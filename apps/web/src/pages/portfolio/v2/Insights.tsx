import type { Insight } from "@elyia/core/api/agent";
import { useCallback, useMemo, useState } from "react";

import { navigate } from "../../../app/routes/history";
import { routeHref } from "../../../app/routes/routeTable";
import { useCardSign, type SignSource } from "../../../features/ely/useCardSign";
import { Glyph } from "../../../features/ely/ui";
import { PixelCanvas } from "../../../pixel/PixelCanvas";
import { cx, FOCUS_RING } from "../../../ui/cx";
import { Dialog } from "../../../ui/Dialog";
import { FlowCard } from "../../track/flow/FlowCard";
import { drawTalkingEly } from "./draw";
import { insightViews, type InsightView } from "./model";

function TalkingEly() {
  const draw = useCallback((ctx: CanvasRenderingContext2D, info: { readonly seconds: number; readonly still: boolean }) => drawTalkingEly(ctx, info.still ? 0 : info.seconds), []);
  return <PixelCanvas width={20} height={22} scale={2} draw={draw} animate fps={10} label="Ely, talking" />;
}

/** The real sign flow for one insight's draft: planner dry run, then each step signed in the wallet when pressed. */
function InsightSign({ source }: { readonly source: SignSource }) {
  const sign = useCardSign(source);
  return (
    <FlowCard
      ask={sign.ask}
      plan={sign.plan}
      planning={sign.planning}
      updatedAt={sign.updatedAt}
      run={sign.run}
      empty={null}
      fineprint="A draft until you sign: the planner re-quotes each step at prepare and binds the quote. Ely never signs."
    />
  );
}

export interface InsightsProps {
  readonly insights: readonly Insight[];
  readonly sample: boolean;
  readonly loading: boolean;
  readonly error: string | null;
}

/**
 * Ely's insights as proposal cards (glyph, title, numbers, pills, a one-tap
 * button and "Why?"). The button opens the real sign flow; nothing moves
 * until the wallet signs. Paper and information-only insights have no
 * button: they say why.
 */
export function Insights({ insights, sample, loading, error }: InsightsProps) {
  const views = useMemo(() => insightViews(insights).slice(0, 4), [insights]);
  const [open, setOpen] = useState<{ readonly view: InsightView; readonly source: SignSource } | null>(null);
  const [why, setWhy] = useState<string | null>(null);
  const count = views.length;
  return (
    <div className="flex h-full flex-col gap-3.5">
      <div className="flex items-center gap-3">
        <TalkingEly />
        <div>
          <h3 className="disp text-[22px]">{loading ? "Ely is reading your range…" : count === 0 ? "Nothing to flag right now" : `Ely noticed ${count} thing${count === 1 ? "" : "s"}`}</h3>
          <p className="text-[12px] text-ink-2">{sample ? "Labelled sample · connect a wallet for yours. " : ""}Each one is a draft: one tap opens it in your wallet; nothing moves until you sign.</p>
        </div>
      </div>
      {error ? (
        <p role="status" className="note">
          The insights did not load ({error}). The range above is still live.
        </p>
      ) : null}
      {count === 0 && !loading ? (
        <div className="fr flat flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
          <Glyph name="check" scale={3} />
          <p className="max-w-[360px] text-[13px] text-ink-2">No rope near the edge, no idle cash past your floor, no drift beyond your band. Ely keeps watching.</p>
        </div>
      ) : null}
      {views.map((view) => {
        const insight = insights.find((entry) => entry.id === view.id)!;
        return (
          <article key={view.id} className={cx("icard fr stepin", view.severity === "act" && "dn")} aria-label={view.title}>
            <div className="ic">
              <Glyph name={view.glyph} scale={3} />
            </div>
            <div className="min-w-0">
              <b>{view.title}</b>
              <p>{view.body}</p>
              <div className="meta">
                <span className={cx("pill", view.severity === "act" ? "dn" : view.severity === "watch" ? "sig" : "mute")}>{view.severityWord}</span>
                {view.layer ? <span className="pill mute">{view.layer}</span> : null}
                {view.paper ? <span className="pill sig">Paper only · testnet</span> : null}
                {sample ? <span className="pill sig">Sample</span> : null}
              </div>
              {why === view.id ? (
                <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[11.5px]">
                  {view.figures.map((figure) => (
                    <div key={figure.key} className="contents">
                      <dt className="t-tag t-faint !text-[9px]">{figure.key}</dt>
                      <dd className="num m-0">{figure.value}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}
            </div>
            <div className="act">
              {view.action ? (
                <button type="button" className={cx("b acc sm", FOCUS_RING)} onClick={() => setOpen({ view, source: { kind: "actions", actions: insight.actions, sentence: view.title } })}>
                  {view.action}
                </button>
              ) : (
                <button type="button" className={cx("b sm", FOCUS_RING)} onClick={() => navigate(`${routeHref("deck")}?intent=${encodeURIComponent(view.title)}`)}>
                  Ask Ely
                </button>
              )}
              <button type="button" className={cx("why", FOCUS_RING)} aria-expanded={why === view.id} onClick={() => setWhy((current) => (current === view.id ? null : view.id))}>
                {why === view.id ? "Hide" : "Why?"}
              </button>
            </div>
          </article>
        );
      })}
      <Dialog open={open !== null} onClose={() => setOpen(null)} title={open ? open.view.title : "Draft"} description="Ely drafted this. Your wallet signs each step; nothing moves until you do." size="lg">
        {open ? <InsightSign source={open.source} /> : null}
      </Dialog>
    </div>
  );
}
