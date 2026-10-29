import type { PortfolioSnapshot } from "@elyia/core/api/portfolio";

import { cx } from "../../../ui/cx";
import { amount, usdShort } from "../range/format";
import { exposureFold } from "../range/model";

/**
 * Real exposure, folded across the layers: one ruled line per underlying,
 * perps hatched and holdings solid on the same bar, long to the right of the
 * zero line and short to the left; cash stands apart. ▲/▼ carry the side.
 */
export function ExposureFold({ snapshot, max = 6, className }: { readonly snapshot: PortfolioSnapshot; readonly max?: number; readonly className?: string }) {
  const fold = exposureFold(snapshot);
  const rows = fold.rows.slice(0, max);
  const scale = Math.max(1, ...rows.map((row) => Math.max(Math.abs(row.perpUsd) + Math.abs(row.spotUsd), Math.abs(row.netUsd ?? 0))));
  return (
    <section className={className} aria-label="Real exposure across all layers">
      <p className="caption">
        <span className="!text-ink">Real exposure</span> · all layers folded
      </p>
      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-ink-2">All cash: nothing here moves with a market.</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {rows.map((row) => {
            const net = row.netUsd ?? 0;
            const long = net >= 0;
            const spotW = (Math.abs(row.spotUsd) / scale) * 50;
            const perpW = (Math.abs(row.perpUsd) / scale) * 50;
            const perpLeft = row.perpUsd < 0;
            const spotLeft = row.spotUsd < 0;
            return (
              <li key={row.underlying} className="grid grid-cols-[4.5rem_minmax(0,1fr)_auto] items-center gap-3 text-[13px] sm:grid-cols-[5.5rem_minmax(0,1fr)_9.5rem]">
                <span className="truncate font-bold text-ink">{row.underlying}</span>
                <span className="relative h-4 border-1.5 border-rule bg-paper-2/60" aria-hidden="true">
                  <span className="absolute inset-y-[-3px] left-1/2 w-0.5 -translate-x-1/2 bg-rule" />
                  {spotW > 0 ? <span className={cx("absolute inset-y-0", long ? "bg-up/70" : "bg-down/70")} style={spotLeft ? { right: "50%", width: `${spotW}%` } : { left: "50%", width: `${spotW}%` }} /> : null}
                  {perpW > 0 ? (
                    <span
                      className="absolute inset-y-0 border-x-1.5 border-rule"
                      style={{
                        ...(perpLeft === spotLeft && spotW > 0 ? (perpLeft ? { right: `${50 + spotW}%` } : { left: `${50 + spotW}%` }) : perpLeft ? { right: "50%" } : { left: "50%" }),
                        width: `${perpW}%`,
                        backgroundImage: `repeating-linear-gradient(135deg, rgb(var(--${row.perpUsd < 0 ? "down" : "up"})) 0 2px, transparent 2px 5px)`,
                      }}
                    />
                  ) : null}
                </span>
                <span className="tnum text-right font-mono text-xs text-ink-2">
                  <span className={long ? "text-up" : "text-down"}>{long ? "▲" : "▼"}</span> {amount(Math.abs(row.net))} · <span className="text-ink">{usdShort(Math.abs(net))}</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <p className="tnum mt-3 font-mono text-[11px] uppercase tracking-[0.08em] text-ink-2">
        Net {fold.netUsd >= 0 ? "long" : "short"} {usdShort(Math.abs(fold.netUsd))} · gross {fold.gross === null ? "—" : `${fold.gross.toFixed(2)}×`} · cash {usdShort(fold.cashUsd)}
      </p>
      <p className="mt-1 flex flex-wrap items-center gap-x-3 font-mono text-[11px] text-ink-3" aria-hidden="true">
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2.5 w-4 border border-rule bg-up/70" /> held
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2.5 w-4 border border-rule" style={{ backgroundImage: "repeating-linear-gradient(135deg, rgb(var(--up)) 0 2px, transparent 2px 5px)" }} /> perps
        </span>
        <span>left of the line = short</span>
      </p>
    </section>
  );
}
