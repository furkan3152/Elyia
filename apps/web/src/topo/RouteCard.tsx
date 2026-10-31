import React, { useCallback, useId } from "react";

import { useNow } from "../hooks/useNow";
import { PixelCanvas } from "../pixel/PixelCanvas";
import { paintRouteProfile } from "../pixel/route";
import { GradeChip } from "../ui/Badge";
import { cx } from "../ui/cx";
import type { Grade } from "./geometry/conditions";
import type { Layer } from "./geometry/relief";
import { LAYER_NAME, LAYER_NETWORK, routeProfile } from "./geometry/route";
import { HutStamp } from "./HutStamp";

export type RouteStepState = "settled" | "climbing" | "next" | "waiting" | "failed";

export interface RouteStep {
  readonly id: string;
  readonly layer: Layer;
  /** Set when the step moves between layers (bridge up or down). */
  readonly toLayer?: Layer;
  /** "send", "swap", "ascend". */
  readonly action: string;
  readonly venue: string;
  /** "1,000 USDC → 11.94 HYPE". */
  readonly inOut: string;
  /** "$0.25". */
  readonly fee: string;
  /** "2 s", "~3 min". */
  readonly eta: string;
  readonly state: RouteStepState;
  /** Evidence block / nonce, for the hut stamp. */
  readonly block?: string | number;
  readonly time?: string;
}

export interface RouteEvidence {
  readonly step: string;
  readonly text: React.ReactNode;
  readonly proven: boolean;
}

export interface RouteCardProps {
  /** Short route id ("7F3A"). */
  readonly id: string;
  /** The intent sentence, as typed. */
  readonly sentence: string;
  readonly grade: Grade;
  readonly steps: readonly RouteStep[];
  /** Total hut fees ("$5.29"). */
  readonly fees: string;
  readonly signatures: { readonly done: number; readonly needed: number; readonly note?: string };
  /** Quote binding: expiry (ms since epoch) and what it is bound to ("SUMMIT #18,514,920"). */
  readonly quote?: { readonly expiresAt: number; readonly boundTo?: string };
  /** The Rule Book checks this route passed. */
  readonly rules?: readonly string[];
  /** Hash of the quote binding ("sha256:350c68af…"). */
  readonly binding?: string;
  readonly evidence?: readonly RouteEvidence[];
  /** The one action (sign the next step). */
  readonly action?: React.ReactNode;
  /** Small print under the action. */
  readonly note?: React.ReactNode;
  /** Sample data label. */
  readonly sample?: boolean;
  readonly className?: string;
}

const STATE_LABEL: Readonly<Record<RouteStepState, string>> = {
  settled: "◎ SETTLED",
  climbing: "● CLIMBING",
  next: "○ SIGN NEXT",
  waiting: "○ WAITING",
  failed: "✕ STOPPED",
};
const STATE_CLASS: Readonly<Record<RouteStepState, string>> = {
  settled: "text-down",
  climbing: "font-semibold text-ink",
  next: "font-semibold text-ink",
  waiting: "text-ink-3",
  failed: "font-semibold text-down",
};
const LAYER_TEXT: Readonly<Record<Layer, string>> = { floor: "text-floor", ridge: "text-ridge", summit: "text-summit-ink" };
/* Band names sit on fixed light band colours, so they use fixed dark inks (AA on both sheets). */
const LAYER_TEXT_ON_BAND: Readonly<Record<Layer, string>> = { floor: "text-[#0F4C5C]", ridge: "text-[#6B4423]", summit: "text-[#1F5866]" };

const PW = 720;
const PH = 198;
/** Left gutter for the band names, so the trail never runs through them. */
const GUTTER = 128;

function Countdown({ expiresAt, boundTo }: { readonly expiresAt: number; readonly boundTo?: string }) {
  const now = useNow(1000);
  const left = Math.max(0, Math.round((expiresAt - now) / 1000));
  return (
    <p className="tnum font-mono text-[13px] leading-snug text-ink">
      {boundTo ? (
        <>
          until {boundTo}
          <br />
        </>
      ) : null}
      {left > 0 ? (
        <>
          ≈ <span className="font-semibold">{left} s</span> · re-quote on expiry
        </>
      ) : (
        <span className="font-semibold text-down">expired · re-quote to sign</span>
      )}
    </p>
  );
}

/**
 * The route card: an intent as a laminated card. The steps climb across the
 * three altitude bands (FLOOR → RIDGE → SUMMIT); settled steps carry a hut
 * stamp; the waypoints are a log book; the perforated stub holds the hut
 * fees, the signatures, the quote-bound countdown and the Rule Book; the
 * evidence strip says what was read back on chain.
 */
export function RouteCard({ id, sentence, grade, steps, fees, signatures, quote, rules = [], binding, evidence = [], action, note, sample = false, className }: RouteCardProps) {
  const labelId = useId();
  const profile = routeProfile(steps, PW, PH, undefined, GUTTER);
  const drawProfile = useCallback(
    (ctx: CanvasRenderingContext2D, info: { readonly w: number; readonly h: number; readonly seconds: number; readonly still: boolean }) =>
      paintRouteProfile(ctx, steps, info.w, info.h, (GUTTER / PW) * info.w, info.seconds, info.still),
    [steps],
  );
  const layers = new Set(steps.flatMap((step) => [step.layer, step.toLayer].filter(Boolean) as Layer[]));
  const proven = evidence.filter((item) => item.proven).length;
  return (
    <article className={cx("grid bg-card px-frame px-drop lg:grid-cols-[minmax(0,1fr)_240px]", className)} aria-labelledby={labelId}>
      <div className="min-w-0">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b-4 border-rule px-4 py-3 sm:px-5">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-4 gap-y-1">
            <h3 id={labelId} className="font-display text-[28px] font-bold leading-none text-ink">
              Route {id}
            </h3>
            <p className="caption">
              {steps.length} waypoints · {layers.size} layer{layers.size === 1 ? "" : "s"}
              {sample ? " · sample" : ""}
            </p>
          </div>
          <GradeChip grade={grade} />
        </header>
        <p className="border-b-2 border-dashed border-rule/40 px-4 py-3 font-mono text-[15px] leading-snug text-ink sm:px-5">“{sentence}”</p>
        {/* the elevation profile of the route */}
        <div className="relative border-b-4 border-rule">
          <PixelCanvas
            width={240}
            height={66}
            pixelSize={3}
            draw={drawProfile}
            animate={steps.some((step) => step.state === "climbing")}
            fps={4}
            label={`Route profile: ${steps.map((s, i) => `${i + 1} ${s.action} on the ${s.toLayer ? `${s.layer} to the ${s.toLayer}` : s.layer}, ${s.state}`).join("; ")}`}
            redrawKey={steps}
          />
          {(["summit", "ridge", "floor"] as const).map((layer, index) => (
            <span key={layer} aria-hidden="true" className={cx("pointer-events-none absolute left-3 font-tag text-[11px] uppercase leading-tight", LAYER_TEXT_ON_BAND[layer])} style={{ top: `calc(${(index * 100) / 3}% + 8px)` }}>
              {LAYER_NAME[layer]}
              <span className="block text-[10px] opacity-80">{LAYER_NETWORK[layer]}</span>
            </span>
          ))}
          {profile.waypoints.map((point, index) => {
            const step = steps[index]!;
            const done = step.state === "settled";
            const live = step.state === "climbing";
            const right = point.x > PW - 90;
            return (
              <React.Fragment key={step.id}>
                <span
                  aria-hidden="true"
                  className={cx("pointer-events-none absolute flex h-5 w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center font-tag text-[11px] px-frame-thin", live ? "bg-signal text-[#16201B]" : done ? "bg-[#16201B] text-[#FFF9EC]" : "bg-[#FFF9EC] text-[#16201B]")}
                  style={{ left: `${(point.x / PW) * 100}%`, top: `${(point.y / PH) * 100}%` }}
                >
                  {index + 1}
                </span>
                <span
                  aria-hidden="true"
                  className={cx("pointer-events-none absolute whitespace-nowrap bg-[#16201B] px-1 font-tag text-[10px] uppercase leading-4 text-[#FFF9EC]", right ? "-translate-x-[calc(100%-10px)]" : "-translate-x-1/2")}
                  style={{ left: `${(point.x / PW) * 100}%`, top: `calc(${(point.y / PH) * 100}% + 14px)` }}
                >
                  {step.action} · {step.eta}
                </span>
              </React.Fragment>
            );
          })}
        </div>
        {/* waypoints: the log book */}
        <div className="el-logbook relative overflow-x-auto">
          <table className="w-full border-separate border-spacing-0 text-[13px]">
            <caption className="sr-only">Waypoints of route {id}</caption>
            <thead>
              <tr className="font-tag text-[11px] uppercase tracking-[0.04em] text-ink-2">
                {["WP", "Layer", "Action · venue", "In → out", "Hut fee", "Time", "State"].map((heading, index) => (
                  <th key={heading} scope="col" className={cx("whitespace-nowrap border-b-4 border-rule py-2 font-normal", index === 0 ? "pl-5 pr-2 text-left" : "px-3 text-left", (index === 4 || index === 5) && "text-right")}>
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {steps.map((step, index) => (
                <tr key={step.id} className={cx(step.state === "climbing" && "bg-signal [&_*]:!text-signal-ink")}>
                  <td className="tnum border-b-2 border-dashed border-rule/15 py-2 pl-5 pr-2 font-mono text-ink-2">{index + 1}</td>
                  <td className="whitespace-nowrap border-b-2 border-dashed border-rule/15 px-3 py-2 font-mono text-xs font-semibold">
                    <span className={LAYER_TEXT[step.layer]}>{step.layer.toUpperCase()}</span>
                    {step.toLayer ? (
                      <>
                        <span className="text-ink-3"> → </span>
                        <span className={LAYER_TEXT[step.toLayer]}>{step.toLayer.toUpperCase()}</span>
                      </>
                    ) : null}
                  </td>
                  <td className="whitespace-nowrap border-b-2 border-dashed border-rule/15 px-3 py-2 text-ink">
                    {step.action} <span className="text-ink-3">·</span> {step.venue}
                  </td>
                  <td className="tnum whitespace-nowrap border-b-2 border-dashed border-rule/15 px-3 py-2 font-mono text-xs text-ink">{step.inOut}</td>
                  <td className="tnum whitespace-nowrap border-b-2 border-dashed border-rule/15 px-3 py-2 text-right font-mono text-xs text-ink">{step.fee}</td>
                  <td className="tnum whitespace-nowrap border-b-2 border-dashed border-rule/15 px-3 py-2 text-right font-mono text-xs text-ink-2">{step.eta}</td>
                  <td className={cx("whitespace-nowrap border-b-2 border-dashed border-rule/15 px-3 py-2 font-tag text-[11px] uppercase", STATE_CLASS[step.state])}>
                    {step.state === "settled" ? (
                      <HutStamp layer={step.toLayer ?? step.layer} time={step.time} size={48} animate delayMs={300 + index * 160} label={`Settled on the ${step.toLayer ?? step.layer}${step.block !== undefined ? `, block ${step.block}` : ""}`} />
                    ) : (
                      STATE_LABEL[step.state]
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {evidence.length > 0 ? (
          <div className="m-5 px-frame-thin sm:m-6">
            <p className="flex justify-between gap-3 border-b-2 border-rule px-3 py-1.5 font-tag text-[11px] uppercase text-ink-2">
              <span>Evidence · checked, not trusted</span>
              <span className="tnum">
                {proven} of {steps.length} proven
              </span>
            </p>
            <ul className="px-3 py-2 font-mono text-xs leading-relaxed text-ink">
              {evidence.map((item) => (
                <li key={item.step}>
                  <span className={item.proven ? "text-up" : "text-ink-3"}>{item.proven ? "✓" : "…"}</span> <span className="font-semibold">{item.step}</span> {item.text}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
      {/* the stub: keep it */}
      <aside className="flex flex-col gap-4 border-t-4 border-dashed border-rule/50 px-4 py-4 lg:border-l-4 lg:border-t-0 lg:px-5" aria-label="Route stub">
        <p className="caption">Stub · keep</p>
        <div>
          <p className="caption !text-ink-3">Hut fees</p>
          <p className="tnum mt-1 font-display text-[32px] font-bold leading-none text-ink">{fees}</p>
        </div>
        <div>
          <p className="caption !text-ink-3">Signatures</p>
          <div className="mt-2 flex gap-2.5 pl-0.5" role="img" aria-label={`${signatures.done} of ${signatures.needed} signatures`}>
            {Array.from({ length: signatures.needed }, (_, index) => (
              <span key={index} className={cx("h-6 w-6 px-frame-thin", index < signatures.done ? "bg-ink" : index === signatures.done ? "bg-signal" : "bg-card")} />
            ))}
          </div>
          <p className="tnum mt-1 font-mono text-xs text-ink-2">
            {signatures.done} of {signatures.needed}
            {signatures.note ? ` · ${signatures.note}` : ""}
          </p>
        </div>
        {quote ? (
          <div>
            <p className="caption !text-ink-3">Quote bound</p>
            <div className="mt-1">
              <Countdown expiresAt={quote.expiresAt} boundTo={quote.boundTo} />
            </div>
          </div>
        ) : null}
        {rules.length > 0 ? (
          <div>
            <p className="caption !text-ink-3">Rule Book</p>
            <ul className="mt-1 font-mono text-[13px] leading-relaxed text-ink">
              {rules.map((rule) => (
                <li key={rule}>
                  <span className="text-up">✓</span> {rule}
                </li>
              ))}
            </ul>
            {binding ? <p className="tnum mt-1 truncate font-mono text-[11px] text-ink-3">{binding}</p> : null}
          </div>
        ) : null}
        {action ? <div className="mt-auto flex flex-col gap-6 pt-2 pr-3">{action}</div> : null}
        {note ? <p className="text-center font-mono text-[11px] leading-snug text-ink-3">{note}</p> : null}
      </aside>
    </article>
  );
}
