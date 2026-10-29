import React, { useId } from "react";

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
 * The Guide's licence: a laminated permit for keeper mode. Licence number =
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
    <article className={cx("relative overflow-hidden border-2 border-rule bg-card shadow-hard-lg", className)} aria-labelledby={`${id}-title`}>
      <header className="flex items-center justify-between gap-3 border-b-2 border-rule bg-signal px-4 py-2.5 text-signal-ink">
        <h3 id={`${id}-title`} className="text-lg font-bold uppercase tracking-[0.04em]">
          Guide&apos;s licence
        </h3>
        <span className="font-mono text-[11px] uppercase tracking-[0.12em]">
          {mode}
          {sample ? " · sample" : ""}
        </span>
      </header>
      <div className={cx("el-laminate relative px-4 pb-3 pt-3.5", revoked && "opacity-60")}>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 font-mono text-[13px]">
          <div>
            <dt className="text-[11px] uppercase tracking-[0.12em] text-ink-3">Licence no. · agent</dt>
            <dd className="tnum font-semibold text-ink" title={agent}>
              {short(agent)}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] uppercase tracking-[0.12em] text-ink-3">Holder</dt>
            <dd className="tnum font-semibold text-ink" title={holder}>
              {short(holder)}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] uppercase tracking-[0.12em] text-ink-3">Markets</dt>
            <dd className="text-ink">{markets.join(" · ")}</dd>
          </div>
          <div>
            <dt className="text-[11px] uppercase tracking-[0.12em] text-ink-3">Actions</dt>
            <dd className="text-ink">{actions.join(" · ")}</dd>
          </div>
          {limits.map(([label, value]) => (
            <div key={label}>
              <dt className="text-[11px] uppercase tracking-[0.12em] text-ink-3">{label}</dt>
              <dd className="tnum text-ink">{value}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-3.5">
          <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3">
            Valid · punched days (max 30) · <span className={cx(revoked || expired ? "text-down" : "text-ink")}>{status}</span>
          </p>
          <ol className="mt-1.5 flex flex-wrap gap-[5px]" aria-label={`${used} of ${days} days used`}>
            {Array.from({ length: days }, (_, index) => {
              const today = index === used && !expired && !revoked;
              return (
                <li
                  key={index}
                  aria-hidden="true"
                  className={cx("h-3.5 w-3.5 rounded-full border-1.5 border-rule", index < used ? "bg-ink" : "bg-paper", today && "outline outline-2 outline-offset-1 outline-signal")}
                />
              );
            })}
          </ol>
          <p className="mt-1 flex justify-between font-mono text-[11px] text-ink-3">
            <span>{dayLabel(validFrom)}</span>
            <span>{dayLabel(validUntil)}</span>
          </p>
        </div>
        <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
          <p className="max-w-[17rem] text-[13px] leading-snug text-ink-2">The key is born for this licence and never sees your wallet. Every order is checked against your Rule Book and radioed to you.</p>
          <svg viewBox="0 0 220 64" className="w-[200px] shrink-0 rotate-[-6deg] text-down" role="img" aria-label="Scope: trade only, cannot withdraw">
            <g filter="url(#el-ink)">
            <rect x="3" y="3" width="214" height="58" fill="none" stroke="currentColor" strokeWidth="3" />
            <rect x="9" y="9" width="202" height="46" fill="none" stroke="currentColor" strokeWidth="1.2" />
            <text x="110" y="33" textAnchor="middle" fontFamily="Space Grotesk Variable, Space Grotesk, sans-serif" fontWeight="700" fontSize="19" letterSpacing="1" fill="currentColor">
              TRADE ONLY
            </text>
            <text x="110" y="49" textAnchor="middle" fontFamily="IBM Plex Mono, monospace" fontWeight="600" fontSize="10.5" letterSpacing="1.6" fill="currentColor">
              CANNOT WITHDRAW
            </text>
          </g>
        </svg>
        </div>
      </div>
      {revoked ? (
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          <svg viewBox="0 0 400 260" preserveAspectRatio="none" className="h-full w-full">
            <path d="M-10 230 410 30" stroke="rgb(var(--ink))" strokeWidth="2.5" strokeDasharray="6 5" />
          </svg>
          <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rotate-[-25deg] border-4 border-down px-4 py-1 font-sans text-5xl font-bold tracking-[0.18em] text-down">VOID</span>
        </div>
      ) : null}
      {footer ? <footer className="el-perf-h flex flex-wrap items-center justify-between gap-3 px-4 py-3">{footer}</footer> : null}
      {revoked ? <p className="sr-only">This licence is void: the keeper can no longer trade for you.</p> : null}
    </article>
  );
}
