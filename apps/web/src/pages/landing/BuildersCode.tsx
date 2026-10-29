import { usePulseSelector } from "../../hooks/usePulse";
import { API_BASE } from "../../lib/env";
import type { PulseSnapshot } from "../../lib/pulse/pulseHub";

const selectPulse = (snapshot: PulseSnapshot) => snapshot.pulse;
const selectSource = (snapshot: PulseSnapshot) => snapshot.source;

/** A live code sample: the actual GET /v1/elysium/pulse shape, filled with the pulse this page is receiving. */
export function BuildersCode() {
  const pulse = usePulseSelector(selectPulse);
  const source = usePulseSelector(selectSource);
  const body = pulse
    ? JSON.stringify(
        {
          network: pulse.network,
          chainId: pulse.chainId,
          head: pulse.head,
          blockTimeMs: pulse.blockTimeMs,
          tps: pulse.tps,
          gasPriceGwei: pulse.gasPriceGwei,
          l1BlockNumber: pulse.l1BlockNumber,
          healthy: pulse.healthy,
        },
        null,
        2,
      )
    : "// waiting for the first Elysium block…";
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-bg-0/80">
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
        <span className="font-mono text-xs text-text-2">
          <span className="text-mint">GET</span> /v1/elysium/pulse
        </span>
        <span className="font-mono text-xs text-text-2">{source === "rpc" ? "computed in your browser (API offline)" : source === "api" ? "live from the Elyia API" : "connecting"}</span>
      </div>
      <pre className="tnum overflow-x-auto px-4 py-4 font-mono text-[12.5px] leading-relaxed text-text-1">
        <code>
          <span className="text-text-2">$ curl {API_BASE}/v1/elysium/pulse</span>
          {"\n"}
          {body}
        </code>
      </pre>
    </div>
  );
}
