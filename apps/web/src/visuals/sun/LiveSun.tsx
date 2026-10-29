import type { NetworkKey } from "@elyia/core/networks";

import { usePulseFeed, usePulseSelector } from "../../hooks/usePulse";
import type { PulseSnapshot } from "../../lib/pulse/pulseHub";
import { Sun, type SunProps } from "./Sun";

export interface LiveSunProps extends Omit<SunProps, "feed" | "readout"> {
  readonly network?: NetworkKey;
}

const selectHead = (snapshot: PulseSnapshot) => snapshot.head?.number ?? snapshot.pulse?.head ?? null;
const selectBlockTime = (snapshot: PulseSnapshot) => snapshot.pulse?.blockTimeMs ?? null;
const selectGas = (snapshot: PulseSnapshot) => snapshot.pulse?.gasPriceGwei ?? snapshot.head?.baseFeeGwei ?? null;
const selectTps = (snapshot: PulseSnapshot) => snapshot.pulse?.tps ?? null;
const selectStatus = (snapshot: PulseSnapshot) => snapshot.status;
const selectSource = (snapshot: PulseSnapshot) => snapshot.source;

/** The Sun wired to the shared live pulse (API stream, RPC fallback). Drop-in for any page. */
export function LiveSun({ network = "elysium-testnet", ...props }: LiveSunProps) {
  const feed = usePulseFeed(network);
  const head = usePulseSelector(selectHead, network);
  const blockTimeMs = usePulseSelector(selectBlockTime, network);
  const gasGwei = usePulseSelector(selectGas, network);
  const tps = usePulseSelector(selectTps, network);
  const status = usePulseSelector(selectStatus, network);
  const source = usePulseSelector(selectSource, network);
  return <Sun feed={feed} readout={{ head, blockTimeMs, gasGwei, tps, status, source }} {...props} />;
}
