import { Link } from "../../app/routes/Link";
import { routeHref } from "../../app/routes/routeTable";
import { usePulseFeed, usePulseSelector } from "../../hooks/usePulse";
import { formatBlockNumber, formatGwei, formatTps } from "../../lib/format";
import type { PulseSnapshot } from "../../lib/pulse/pulseHub";
import { Altimeter } from "../../topo/Altimeter";
import { Barograph } from "../../topo/Barograph";
import { useSteady } from "../elysium/useSteady";
import { cx, FOCUS_RING } from "../../ui/cx";

const selectHead = (s: PulseSnapshot) => s.head?.number ?? s.pulse?.head ?? null;
const selectBlockMs = (s: PulseSnapshot) => (s.pulse ? Math.round(s.pulse.blockTimeMs) : null);
const selectGas = (s: PulseSnapshot) => s.pulse?.gasPriceGwei ?? s.head?.baseFeeGwei ?? null;
const selectTps = (s: PulseSnapshot) => s.pulse?.tps ?? null;
const selectStatus = (s: PulseSnapshot) => s.status;
const selectSource = (s: PulseSnapshot) => s.source;

function Readout({ label, value, unit }: { readonly label: string; readonly value: string; readonly unit?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 bg-card px-4 py-3">
      <dt className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-2">{label}</dt>
      <dd className="tnum font-mono text-[22px] font-medium leading-none text-ink">
        {value}
        {unit ? <span className="ml-1 text-[13px] text-ink-2">{unit}</span> : null}
      </dd>
    </div>
  );
}

/**
 * The dark band under the hero: Elysium's real block cadence as a fine ink
 * trace, one kick per block, with the head, block time, gas and tx/s.
 * One shared connection (API stream, public RPC fallback).
 */
export function BarographBand() {
  const feed = usePulseFeed();
  const head = useSteady(usePulseSelector(selectHead));
  const blockMs = usePulseSelector(selectBlockMs);
  const gas = usePulseSelector(selectGas);
  const tps = usePulseSelector(selectTps);
  const status = usePulseSelector(selectStatus);
  const source = usePulseSelector(selectSource);
  const live = status === "live" || status === "fallback";
  const note = !live ? (status === "connecting" ? "reaching Elysium…" : status === "stale" ? "no new block for a few seconds" : "no endpoint answers right now") : source === "rpc" ? "polled from the public RPC by your browser" : "streamed by the Elyia API";

  return (
    <section aria-labelledby="barograph-title" className="el-night relative border-y-2 border-rule bg-paper text-ink">
      <div className="mx-auto flex max-w-[1440px] flex-col gap-6 px-4 py-10 sm:px-6 lg:px-10 lg:py-12">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex flex-col gap-2.5">
            <h2 id="barograph-title" className="text-[30px] font-bold leading-none tracking-[-0.02em] sm:text-[36px]">
              Elysium barograph
            </h2>
            <p className="font-mono text-[11px] uppercase leading-relaxed tracking-[0.12em] text-ink-2">
              One tick per block · {live ? "live" : status} · testnet 99801 · {note}
            </p>
          </div>
          <dl className="grid grid-cols-2 gap-[1.5px] border-2 border-rule bg-rule sm:grid-cols-4">
            <div className="flex min-w-0 flex-col gap-1 bg-card px-4 py-3">
              <dt className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-2">Summit head</dt>
              <dd>
                {head !== null ? <Altimeter value={formatBlockNumber(head)} label="Elysium head" variant="inline" size="md" markLatest /> : <span className="font-mono text-[22px] text-ink-3">—</span>}
              </dd>
            </div>
            <Readout label="Block" value={blockMs !== null ? String(blockMs) : "—"} unit="ms" />
            <Readout label="Gas" value={gas !== null ? formatGwei(gas, { unit: false }) : "—"} unit="gwei" />
            <Readout label="Tx / s" value={tps !== null ? formatTps(tps) : "—"} />
          </dl>
        </div>
        <Barograph feed={feed} height={92} speed={70} readout={head !== null ? `#${formatBlockNumber(head)}` : undefined} label="Elysium testnet barograph: one ink tick per block, taller with more transactions" />
        <Link to={routeHref("elysium")} className={cx("self-start font-mono text-[12px] uppercase tracking-[0.12em] text-ink underline decoration-accent-line decoration-2 underline-offset-4 hover:decoration-ink", FOCUS_RING)}>
          Open the weather station →
        </Link>
      </div>
    </section>
  );
}
