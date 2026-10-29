import { usePulseSelector } from "../../hooks/usePulse";
import { formatGwei } from "../../lib/format";
import type { PulseSnapshot } from "../../lib/pulse/pulseHub";
import { NumberTicker } from "../../ui/NumberTicker";
import { Stat } from "../../ui/Stat";

const selectMs = (snapshot: PulseSnapshot) => (snapshot.pulse ? Math.round(snapshot.pulse.blockTimeMs) : null);
const selectGas = (snapshot: PulseSnapshot) => snapshot.pulse?.gasPriceGwei ?? snapshot.head?.baseFeeGwei ?? null;

/** Four facts under the hero: live block time and gas, the settlement layer, the mainnet date. */
export function PulseStats() {
  const ms = usePulseSelector(selectMs);
  const gas = usePulseSelector(selectGas);
  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
      <Stat
        label="Block time"
        value={<NumberTicker value={ms} format={(value) => `${value} ms`} placeholder="— ms" />}
        hint={ms ? `${(1000 / ms).toFixed(1)} blocks every second, live` : "measuring live"}
        className="bg-bg-1/70 backdrop-blur"
      />
      <Stat label="Gas floor" value={gas === null ? "— gwei" : formatGwei(gas)} hint="paid in HYPE" className="bg-bg-1/70 backdrop-blur" />
      <Stat label="Settles to" value="HyperEVM" hint="Arbitrum Orbit · AnyTrust" className="bg-bg-1/70 backdrop-blur" />
      <Stat label="Mainnet" value="Nov 9" tone="gold" hint="chain 99901 · opens at launch" className="bg-bg-1/70 backdrop-blur" />
    </div>
  );
}
