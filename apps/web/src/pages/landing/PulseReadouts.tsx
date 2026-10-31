import type { ReactNode } from "react";

import { usePulseSelector } from "../../hooks/usePulse";
import { formatBlockNumber, formatGwei, formatTps } from "../../lib/format";
import type { PulseSnapshot } from "../../lib/pulse/pulseHub";
import { Cards } from "../../pixel/layout";
import { PixelAltimeter } from "../../pixel/PixelAltimeter";
import { cx } from "../../ui/cx";
import { useSteady } from "../elysium/useSteady";

const selectHead = (s: PulseSnapshot) => s.head?.number ?? s.pulse?.head ?? null;
const selectBlockMs = (s: PulseSnapshot) => (s.pulse ? Math.round(s.pulse.blockTimeMs) : null);
const selectGas = (s: PulseSnapshot) => s.pulse?.gasPriceGwei ?? s.head?.baseFeeGwei ?? null;
const selectTps = (s: PulseSnapshot) => s.pulse?.tps ?? null;
const selectStatus = (s: PulseSnapshot) => s.status;

/** One instrument face: Silkscreen label, Pixelify figure, a line of small print. */
export function Readout({ label, children, note, className }: { readonly label: string; readonly children: ReactNode; readonly note: string; readonly className?: string }) {
  return (
    <div className={cx("flex h-full flex-col items-center gap-2 bg-card px-3 py-5 text-center px-frame px-drop", className)}>
      <span className="font-tag text-[11px] uppercase text-ink-2">{label}</span>
      <span className="flex min-h-[40px] items-center justify-center">{children}</span>
      <span className="mt-auto text-[12px] leading-snug text-ink-3">{note}</span>
    </div>
  );
}

function Figure({ value, unit }: { readonly value: string | null; readonly unit?: string }) {
  return (
    <span className={cx("tnum font-display text-[30px] font-bold leading-none sm:text-[34px]", value === null ? "text-ink-3" : "text-ink")}>
      {value ?? "—"}
      {unit && value !== null ? <span className="ml-1.5 font-tag text-[12px] font-normal uppercase text-ink-2">{unit}</span> : null}
    </span>
  );
}

/**
 * Four live instruments under the hero scene, read from the one shared
 * Elysium pulse (API stream, public RPC fallback): the Summit head (its
 * digits roll once a second), block time, base fee and throughput. Nothing
 * is invented while the pulse is quiet: the faces read "—".
 */
export function PulseReadouts() {
  const head = useSteady(usePulseSelector(selectHead));
  const blockMs = usePulseSelector(selectBlockMs);
  const gas = usePulseSelector(selectGas);
  const tps = usePulseSelector(selectTps);
  const status = usePulseSelector(selectStatus);
  const live = status === "live" || status === "fallback";
  return (
    <Cards n={4} className="mt-12">
      <Readout label="Summit head" note={live ? "Elysium testnet · live" : status === "connecting" ? "reaching Elysium…" : "no block right now"}>
        {head !== null ? <PixelAltimeter value={formatBlockNumber(head)} label="Elysium head block" variant="inline" size="md" /> : <Figure value={null} />}
      </Readout>
      <Readout label="Block time" note="measured · nominal 114 ms">
        <Figure value={blockMs !== null ? String(blockMs) : null} unit="ms" />
      </Readout>
      <Readout label="Base fee" note="paid in HYPE · floor 0.1">
        <Figure value={gas !== null ? formatGwei(gas, { unit: false }) : null} unit="gwei" />
      </Readout>
      <Readout label="Throughput" note="user transactions">
        <Figure value={tps !== null ? formatTps(tps) : null} unit="tx/s" />
      </Readout>
    </Cards>
  );
}
