import React, { useId } from "react";

import { Ely } from "../pixel/Ely";
import { PixelStamp } from "../pixel/PixelStamp";
import { cx } from "../ui/cx";

export interface GuideLicenceProps {
  /** Agent (keeper) address, the licence number. */
  readonly agent: string;
  /** The wallet that issued it. */
  readonly holder: string;
  readonly markets: readonly string[];
  /** HyperCore L1 actions the licence allows ("order", "cancel", "modify"). */
  readonly actions: readonly string[];
  /** Printed limits: label -> value ("Per order" -> "≤ $5,000 · ≤ 5×"). */
  readonly limits: ReadonlyArray<readonly [string, string]>;
  /** ms since epoch. */
  readonly validFrom: number;
  readonly validUntil: number;
  /** Today (ms); punched days are the days already used. */
  readonly now: number;
  /** Revoked: the VOID perforation and stamp. */
  readonly revoked?: boolean;
  /** "KEEPER MODE · OPTIONAL". */
  readonly mode?: string;
  /** Footer actions (Issue / Void). */
  readonly footer?: React.ReactNode;
  readonly sample?: boolean;
  readonly className?: string;
}

const DAY = 86_400_000;
const short = (address: string) => (address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address);
const dayLabel = (ms: number) => new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short" }).toUpperCase();

/**
 * The Guide's licence: a pixel permit for keeper mode, with Ely on watch. Licence number =
 * the agent address; printed scope and limits; one punch hole per day of
 * validity (punched = used, ringed = today); the scope stamp TRADE ONLY ·
 * CANNOT WITHDRAW. Revoking tears a VOID perforation across it.
 */
export function GuideLicence({ agent, holder, markets, actions, limits, validFrom, validUntil, now, revoked = false, mode = "Keeper mode · optional", footer, sample = false, className }: GuideLicenceProps) {
  const id = useId();
  const days = Math.max(1, Math.min(30, Math.round((validUntil - validFrom) / DAY)));
  const used = Math.max(0, Math.min(days, Math.floor((now - validFrom) / DAY)));
  const expired = now >= validUntil;
  const status = revoked ? "Void" : expired ? "Expired" : `Valid · ${days - used} of ${days} days left`;
  return (
    <article className={cx("relative bg-card px-frame px-drop", className)} aria-labelledby={`${id}-title`}>
      <header className="flex items-center justify-between gap-3 border-b-4 border-rule bg-signal px-4 py-2.5 text-signal-ink">
        <h3 id={`${id}-title`} className="font-display text-xl font-bold">
          Guide&apos;s licence
        </h3>
        <span className="font-tag text-[11px] uppercase">
          {mode}
          {sample ? " · sample" : ""}
        </span>
      </header>
      <div className={cx("relative overflow-hidden px-4 pb-4 pt-4", revoked && "opacity-60")}>
        <div className="flex items-start gap-4">
        <Ely state="watch" size={88} label={null} className="shrink-0 bg-paper-2 px-frame-thin" />
        <dl className="grid flex-1 grid-cols-2 gap-x-4 gap-y-2.5 font-mono text-[13px]">
          <div>
            <dt className="font-tag text-[11px] uppercase text-ink-3">Licence no. · agent</dt>
            <dd className="tnum font-semibold text-ink" title={agent}>
              {short(agent)}
            </dd>
          </div>
          <div>
            <dt className="font-tag text-[11px] uppercase text-ink-3">Holder</dt>
            <dd className="tnum font-semibold text-ink" title={holder}>
              {short(holder)}
            </dd>
          </div>
          <div>
            <dt className="font-tag text-[11px] uppercase text-ink-3">Markets</dt>
            <dd className="text-ink">{markets.join(" · ")}</dd>
          </div>
          <div>
            <dt className="font-tag text-[11px] uppercase text-ink-3">Actions</dt>
            <dd className="text-ink">{actions.join(" · ")}</dd>
          </div>
          {limits.map(([label, value]) => (
            <div key={label}>
              <dt className="font-tag text-[11px] uppercase text-ink-3">{label}</dt>
              <dd className="tnum text-ink">{value}</dd>
            </div>
          ))}
        </dl>
        </div>
        <div className="mt-4">
          <p className="font-tag text-[11px] uppercase text-ink-3">
            Valid · punched days (max 30) · <span className={cx(revoked || expired ? "text-down" : "text-ink")}>{status}</span>
          </p>
          <ol className="mt-2 flex flex-wrap gap-[6px]" aria-label={`${used} of ${days} days used`}>
            {Array.from({ length: days }, (_, index) => {
              const today = index === used && !expired && !revoked;
              return (
                <li
                  key={index}
                  aria-hidden="true"
                  className={cx("h-3 w-3 px-frame-thin", index < used ? "bg-ink" : "bg-paper", today && "bg-signal")}
                />
              );
            })}
          </ol>
          <p className="mt-2 flex justify-between font-tag text-[11px] text-ink-3">
            <span>{dayLabel(validFrom)}</span>
            <span>{dayLabel(validUntil)}</span>
          </p>
        </div>
        <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
          <p className="max-w-[17rem] text-[13px] leading-snug text-ink-2">The key is born for this licence and never sees your wallet. Every order is checked against your Rule Book and radioed to you.</p>
          <PixelStamp state="settled" text="TRADE ONLY" detail="CANNOT WITHDRAW" size="lg" label="Scope: trade only, cannot withdraw" className="mr-2" />
        </div>
      </div>
      {revoked ? (
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          <span className="absolute left-0 right-0 top-1/2 h-1 -rotate-[14deg] bg-[repeating-linear-gradient(to_right,rgb(var(--ink))_0_12px,transparent_12px_20px)]" />
          <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 -rotate-[14deg] bg-card px-5 py-1 font-display text-5xl font-bold tracking-[0.18em] text-down px-frame px-tone-down">VOID</span>
        </div>
      ) : null}
      {footer ? <footer className="flex flex-wrap items-center justify-between gap-3 border-t-4 border-dashed border-rule/40 px-4 py-3">{footer}</footer> : null}
      {revoked ? <p className="sr-only">This licence is void: the keeper can no longer trade for you.</p> : null}
    </article>
  );
}
