import React, { useId } from "react";

import { useNow } from "../hooks/useNow";
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
const LAYER_COLOR: Readonly<Record<Layer, string>> = { floor: "rgb(var(--floor))", ridge: "rgb(var(--ridge))", summit: "rgb(var(--summit-ink))" };

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
  const layers = new Set(steps.flatMap((step) => [step.layer, step.toLayer].filter(Boolean) as Layer[]));
  const proven = evidence.filter((item) => item.proven).length;
  return (
    <article className={cx("el-laminate grid border-2 border-rule bg-card shadow-hard-lg lg:grid-cols-[minmax(0,1fr)_240px]", className)} aria-labelledby={labelId}>
      <div className="min-w-0">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-rule px-4 py-3 sm:px-5">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-4 gap-y-1">
            <h3 id={labelId} className="text-[26px] font-bold leading-none tracking-[-0.02em] text-ink">
              Route {id}
            </h3>
            <p className="caption">
              {steps.length} waypoints · {layers.size} layer{layers.size === 1 ? "" : "s"}
              {sample ? " · sample" : ""}
            </p>
          </div>
          <GradeChip grade={grade} />
        </header>
        <p className="border-b-1.5 border-dashed border-rule/60 px-4 py-2.5 font-mono text-[15px] leading-snug text-ink sm:px-5">“{sentence}”</p>
        {/* the elevation profile of the route */}
        <div className="relative overflow-x-auto border-b-2 border-rule bg-paper/40">
          <div className="relative min-w-[560px]">
          <svg viewBox={`0 0 ${PW} ${PH}`} width="100%" role="img" aria-label={`Route profile: ${steps.map((s, i) => `${i + 1} ${s.action} on the ${s.toLayer ? `${s.layer} to the ${s.toLayer}` : s.layer}, ${s.state}`).join("; ")}`} className="block">
            {(["summit", "ridge", "floor"] as const).map((layer, index) => (
              <g key={layer}>
                <rect x="0" y={index * (PH / 3)} width={PW} height={PH / 3} fill={LAYER_COLOR[layer]} fillOpacity={0.045 + index * 0.02} />
                {index > 0 ? <path d={`M0,${index * (PH / 3)}H${PW}`} stroke="rgb(var(--ink))" strokeOpacity="0.4" strokeDasharray="1 4" /> : null}
                {index === 0 ? <path d={`M${GUTTER - 14},0V${PH}`} stroke="rgb(var(--ink))" strokeOpacity="0.25" strokeDasharray="1 3" /> : null}
                <text x="12" y={index * (PH / 3) + 30} fontFamily="Instrument Serif, Georgia, serif" fontStyle="italic" fontSize="20" fill={LAYER_COLOR[layer]}>
                  The {LAYER_NAME[layer]}
                </text>
                <text x="12" y={index * (PH / 3) + 47} fontFamily="IBM Plex Mono, monospace" fontSize="11" letterSpacing="0.8" fill={LAYER_COLOR[layer]}>
                  {LAYER_NETWORK[layer].toUpperCase()}
                </text>
              </g>
            ))}
            <path d={profile.d} pathLength={1} fill="none" stroke="rgb(var(--ink))" strokeWidth="2.2" strokeLinejoin="round" className="el-draw" />
            <circle cx={profile.start.x} cy={profile.start.y} r="5" fill="rgb(var(--card))" stroke="rgb(var(--ink))" strokeWidth="2" />
            {profile.waypoints.map((point, index) => {
              const step = steps[index]!;
              const done = step.state === "settled";
              const live = step.state === "climbing";
              return (
                <g key={step.id} className="el-draw-fade" style={{ animationDelay: `${300 + index * 120}ms` }}>
                  <circle cx={point.x} cy={point.y} r="8" fill={live ? "rgb(var(--signal))" : done ? "rgb(var(--ink))" : "rgb(var(--card))"} stroke="rgb(var(--ink))" strokeWidth="1.8" />
                  <text x={point.x} y={point.y + 3.5} textAnchor="middle" fontFamily="IBM Plex Mono, monospace" fontSize="10" fontWeight="600" fill={done ? "rgb(var(--card))" : "rgb(var(--ink))"}>
                    {index + 1}
                  </text>
                  <text x={point.x > PW - 70 ? point.x + 8 : point.x} y={point.y - 14} textAnchor={point.x > PW - 70 ? "end" : "middle"} fontFamily="Space Grotesk Variable, Space Grotesk, sans-serif" fontSize="11.5" fontWeight="700" fill="rgb(var(--ink))" paintOrder="stroke" stroke="rgb(var(--card))" strokeWidth="3">
                    {step.action.toUpperCase()} · {step.eta}
                  </text>
                </g>
              );
            })}
          </svg>
          {/* hut stamps on settled steps */}
          {profile.waypoints.map((point, index) => {
            const step = steps[index]!;
            if (step.state !== "settled") return null;
            return (
              <span key={step.id} className="pointer-events-none absolute" style={{ left: `${((point.x + 10) / PW) * 100}%`, top: `${((point.y + 12) / PH) * 100}%` }}>
                <HutStamp layer={step.toLayer ?? step.layer} block={step.block} time={step.time} size={56} animate delayMs={500 + index * 160} label={null} />
              </span>
            );
          })}
          <span className="pointer-events-none absolute bottom-1 font-sans text-[11px] font-bold uppercase tracking-[0.06em] text-ink" style={{ left: `${(GUTTER / PW) * 100}%` }}>
            Pack
          </span>
          </div>
        </div>
        {/* waypoints: the log book */}
        <div className="el-logbook relative overflow-x-auto">
          <table className="w-full border-separate border-spacing-0 text-[13px]">
            <caption className="sr-only">Waypoints of route {id}</caption>
            <thead>
              <tr className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-2">
                {["WP", "Layer", "Action · venue", "In → out", "Hut fee", "Time", "State"].map((heading, index) => (
                  <th key={heading} scope="col" className={cx("whitespace-nowrap border-b-1.5 border-rule py-2 font-medium", index === 0 ? "pl-5 pr-2 text-left" : "px-3 text-left", (index === 4 || index === 5) && "text-right")}>
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {steps.map((step, index) => (
                <tr key={step.id} className={cx(step.state === "climbing" && "bg-signal [&_*]:!text-signal-ink")}>
                  <td className="tnum border-b border-rule/15 py-2 pl-5 pr-2 font-mono text-ink-2">{index + 1}</td>
                  <td className="whitespace-nowrap border-b border-rule/15 px-3 py-2 font-mono text-xs font-semibold">
                    <span className={LAYER_TEXT[step.layer]}>{step.layer.toUpperCase()}</span>
                    {step.toLayer ? (
                      <>
                        <span className="text-ink-3"> → </span>
                        <span className={LAYER_TEXT[step.toLayer]}>{step.toLayer.toUpperCase()}</span>
                      </>
                    ) : null}
                  </td>
                  <td className="whitespace-nowrap border-b border-rule/15 px-3 py-2 text-ink">
                    {step.action} <span className="text-ink-3">·</span> {step.venue}
                  </td>
                  <td className="tnum whitespace-nowrap border-b border-rule/15 px-3 py-2 font-mono text-xs text-ink">{step.inOut}</td>
                  <td className="tnum whitespace-nowrap border-b border-rule/15 px-3 py-2 text-right font-mono text-xs text-ink">{step.fee}</td>
                  <td className="tnum whitespace-nowrap border-b border-rule/15 px-3 py-2 text-right font-mono text-xs text-ink-2">{step.eta}</td>
                  <td className={cx("whitespace-nowrap border-b border-rule/15 px-3 py-2 font-mono text-xs", STATE_CLASS[step.state])}>{STATE_LABEL[step.state]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {evidence.length > 0 ? (
          <div className="m-4 border-1.5 border-rule sm:m-5">
            <p className="flex justify-between gap-3 border-b-1.5 border-rule px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-2">
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
      <aside className="el-stub flex flex-col gap-4 px-4 py-4 lg:px-5" aria-label="Route stub">
        <p className="caption">Stub · keep</p>
        <div>
          <p className="caption !text-ink-3">Hut fees</p>
          <p className="tnum mt-0.5 font-mono text-[30px] font-semibold leading-none text-ink">{fees}</p>
        </div>
        <div>
          <p className="caption !text-ink-3">Signatures</p>
          <div className="mt-1.5 flex gap-1.5" role="img" aria-label={`${signatures.done} of ${signatures.needed} signatures`}>
            {Array.from({ length: signatures.needed }, (_, index) => (
              <span key={index} className={cx("h-6 w-6 border-2 border-rule", index < signatures.done ? "bg-ink" : index === signatures.done ? "bg-signal" : "bg-card")} />
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
        {action ? <div className="mt-auto flex flex-col gap-2 pt-2">{action}</div> : null}
        {note ? <p className="text-center font-mono text-[11px] leading-snug text-ink-3">{note}</p> : null}
      </aside>
    </article>
  );
}
