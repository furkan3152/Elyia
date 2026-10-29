import { ArrowUpRight } from "lucide-react";

import { Link } from "../../app/routes/Link";
import { routeHref } from "../../app/routes/routeTable";
import { usePulseSelector } from "../../hooks/usePulse";
import { formatGwei, formatTps } from "../../lib/format";
import type { PulseSnapshot } from "../../lib/pulse/pulseHub";
import { cx, FOCUS_RING } from "../../ui/cx";
import { Panel, PanelHeader } from "../../ui/Panel";
import { LiveSun } from "../../visuals/sun/LiveSun";

const selectGas = (snapshot: PulseSnapshot) => snapshot.pulse?.gasPriceGwei ?? null;
const selectTps = (snapshot: PulseSnapshot) => snapshot.pulse?.tps ?? null;

/** The deck's mini Sun: block time at the centre, gas and tx/s below; opens /elysium. */
export function PulseCard() {
  const gas = usePulseSelector(selectGas);
  const tps = usePulseSelector(selectTps);
  return (
    <Panel padding="lg" className="flex h-full flex-col rounded-3xl">
      <PanelHeader
        title="Elysium pulse"
        aside={
          <Link to={routeHref("elysium")} className={cx("inline-flex items-center gap-1 rounded text-text-2 hover:text-text-0", FOCUS_RING)}>
            open <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        }
      />
      <div className="mx-auto w-full max-w-[220px] flex-1">
        <LiveSun variant="compact" />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <div className="rounded-xl bg-bg-2/70 px-3 py-2">
          <p className="text-xs text-text-2">gas</p>
          <p className="tnum font-mono text-sm text-text-0">{formatGwei(gas)}</p>
        </div>
        <div className="rounded-xl bg-bg-2/70 px-3 py-2">
          <p className="text-xs text-text-2">tx/s</p>
          <p className="tnum font-mono text-sm text-text-0">{formatTps(tps)}</p>
        </div>
      </div>
    </Panel>
  );
}
