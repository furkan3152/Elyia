import { useCallback, useMemo, useRef, useState } from "react";

import { navigate } from "../../../app/routes/history";
import { routeHref } from "../../../app/routes/routeTable";
import { streamChat } from "../../../features/ely/client";
import { paletteOf } from "../../../features/ely/draw";
import { applyEvent, interrupted, newElyTurn, type ElyTurn } from "../../../features/ely/turn";
import { Glyph } from "../../../features/ely/ui";
import { describeError } from "../../../lib/api";
import { PixelCanvas } from "../../../pixel/PixelCanvas";
import { cx, FOCUS_RING } from "../../../ui/cx";
import { ElyMessage } from "../../ask/parts/Messages";
import { usdShort, usdSigned } from "../range/format";
import { drawWaterfall } from "./draw";
import { pnlSteps, rankedCauses, waterfall } from "./model";

export interface PnlExplainProps {
  readonly figures: Readonly<Record<string, string | number | null>> | null;
  /** The wallet Ely reads (null: the sample). */
  readonly address: string | null;
  readonly session: string | null;
  readonly sample: boolean;
  readonly phone: boolean;
}

const FOLLOW_UPS = ["Protect my positions", "What if HYPE drops 20%?", "What's my HYPE exposure?"] as const;

/**
 * Explain my PnL: chat | waterfall. The left half is Ely's answer from the
 * 30-day ledger (realized, funding, fees, unrealized, ranked by size), and
 * "Ask Ely live" streams the real agent turn in place. The right half is the
 * waterfall: bars rise in steps, reconcile to the net, and the caption says
 * where the axis starts.
 */
export function PnlExplain({ figures, address, session, sample, phone }: PnlExplainProps) {
  const steps = useMemo(() => (figures ? pnlSteps(figures) : []), [figures]);
  const fall = useMemo(() => waterfall(null, steps, "Net"), [steps]);
  const causes = rankedCauses(steps);
  const days = typeof figures?.days === "number" ? figures.days : 30;
  const [turn, setTurn] = useState<ElyTurn | null>(null);
  const controller = useRef<AbortController | null>(null);

  const askLive = async () => {
    if (!address) return;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    let current = newElyTurn(`pnl_${Date.now()}`, Date.now());
    setTurn(current);
    try {
      await streamChat({
        request: { message: "explain my pnl", address },
        session,
        signal: abort.signal,
        onEvent: (event) => {
          current = applyEvent(current, event, Date.now());
          setTurn(current);
        },
      });
      current = interrupted(current, Date.now());
    } catch (error) {
      current = interrupted(current, Date.now(), describeError(error));
    }
    setTurn(current);
  };

  const draw = useCallback((ctx: CanvasRenderingContext2D, info: { readonly w: number; readonly h: number; readonly seconds: number; readonly still: boolean }) => drawWaterfall(ctx, fall, info.w, info.h, info.still ? 99 : info.seconds, paletteOf(ctx.canvas)), [fall]);
  const label = `Waterfall over ${days} days: ${fall.bars.map((bar) => `${bar.label} ${usdSigned(bar.value)}`).join(", ")}.`;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <div className="fr flex flex-col gap-4 p-5">
        <div className="msg-u">Where did my money go over the last {days} days?</div>
        {turn ? (
          <ElyMessage turn={turn} phone={phone} opened={false} onOpenCard={() => navigate(routeHref("deck"))} onAnswer={() => undefined} />
        ) : (
          <div className="msg-e">
            <span className="pt-1">
              <Glyph name="chat" scale={4} />
            </span>
            <div className="bd">
              <ul className="readings" aria-label="Readings">
                <li className="rd">
                  <Glyph name="check" scale={2} /> Fills · {days} d
                </li>
                <li className="rd">
                  <Glyph name="check" scale={2} /> Funding · {days} d
                </li>
                <li className="rd">
                  <Glyph name="check" scale={2} /> Fees
                </li>
              </ul>
              {causes.length === 0 ? (
                <p>No fills, funding or fees in the window: nothing moved your PnL.</p>
              ) : (
                <>
                  <p>{causes.length === 1 ? "One thing:" : `${causes.length === 2 ? "Two" : causes.length === 3 ? "Three" : "Four"} things, in order of size:`}</p>
                  <p>
                    {causes.map((cause) => (
                      <span key={cause.label} className="block">
                        <b>
                          {cause.label}, {usdSigned(cause.value)}.
                        </b>{" "}
                        {cause.label === "Realized" ? "closed trades" : cause.label === "Funding" ? (cause.value < 0 ? "you paid funding" : "funding paid you") : cause.label === "Fees" ? "venue and network fees" : "open positions, marked now"}
                      </span>
                    ))}
                  </p>
                  <p>
                    Net over {days} days: <b className={fall.total >= 0 ? "t-up" : "t-down"}>{usdSigned(fall.total)}</b>
                    {sample ? " (labelled sample)" : " at reference prices"}.
                  </p>
                </>
              )}
            </div>
          </div>
        )}
        <div className="choices mt-auto">
          {address && !sample ? (
            <button type="button" className={cx("choice rec", FOCUS_RING)} onClick={() => void askLive()}>
              Ask Ely live ▸
            </button>
          ) : null}
          {FOLLOW_UPS.map((sentence) => (
            <button key={sentence} type="button" className={cx("choice", FOCUS_RING)} onClick={() => navigate(`${routeHref("deck")}?intent=${encodeURIComponent(sentence)}`)}>
              {sentence}
            </button>
          ))}
        </div>
      </div>
      <div className="fr flex flex-col p-5">
        <div className="mb-3.5 flex items-center justify-between gap-3">
          <h3 className="disp flex items-center gap-2.5 text-[20px]">
            <Glyph name="rebalance" scale={3} /> Last {days} days
          </h3>
          <span className={cx("pill", fall.total >= 0 ? "up" : "dn")}>{`${fall.total >= 0 ? "▲" : "▼"} ${usdShort(Math.abs(fall.total))}`}</span>
        </div>
        <PixelCanvas width={132} height={66} pixelSize={4} aspect={0.5} draw={draw} animate fps={12} endTime={99} redrawKey={JSON.stringify(steps)} label={label} />
        <div className="pnl-leg" style={{ gridTemplateColumns: `repeat(${fall.bars.length}, minmax(0, 1fr))` }}>
          {fall.bars.map((bar) => (
            <span key={bar.label}>
              {bar.label}
              <b className={cx("num", bar.kind === "up" && "t-up", bar.kind === "down" && "t-down")}>{usdSigned(bar.value, true)}</b>
            </span>
          ))}
        </div>
        <p className="mt-3 text-center font-tag text-[10px] uppercase text-ink-3">
          Axis starts at {usdShort(fall.min)} · {sample ? "labelled sample" : "reference USD"} · bars reconcile to the net
        </p>
      </div>
    </div>
  );
}
