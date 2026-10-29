import { usePulseFeed, usePulseSelector } from "../../hooks/usePulse";
import { formatBlockNumber } from "../../lib/format";
import type { PulseSnapshot } from "../../lib/pulse/pulseHub";
import { cx, FOCUS_RING } from "../../ui/cx";
import { useUiStore } from "../state/uiStore";
import { MiniSun } from "../../visuals/sun/MiniSun";
import { Link } from "../routes/Link";
import { routeHref } from "../routes/routeTable";

const selectHead = (snapshot: PulseSnapshot) => snapshot.head?.number ?? snapshot.pulse?.head ?? null;
const selectMs = (snapshot: PulseSnapshot) => (snapshot.pulse ? Math.round(snapshot.pulse.blockTimeMs) : null);
const selectStatus = (snapshot: PulseSnapshot) => snapshot.status;

const STATUS_LABEL: Readonly<Record<PulseSnapshot["status"], string>> = {
  live: "live",
  fallback: "live via public RPC",
  connecting: "connecting",
  stale: "stale",
  offline: "offline",
};

/**
 * Top-bar heartbeat: the mini sun (about one beat per second), block height
 * and block time. Opens /elysium. `compact` (phones) shows the heartbeat with
 * the network mode instead, so "Testnet" is always on screen.
 */
export function PulsePill({ className, compact = false }: { readonly className?: string; readonly compact?: boolean }) {
  const feed = usePulseFeed();
  const head = usePulseSelector(selectHead);
  const ms = usePulseSelector(selectMs);
  const status = usePulseSelector(selectStatus);
  const mode = useUiStore((state) => state.mode);
  if (compact) {
    return (
      <Link
        to={routeHref("elysium")}
        aria-label={`Elysium pulse, ${STATUS_LABEL[status]}, ${mode}`}
        className={cx("inline-flex h-8 items-center gap-2 rounded-full border border-mint/30 px-3 font-mono text-xs text-mint", FOCUS_RING, className)}
      >
        <MiniSun feed={feed} status={status} size={8} />
        {mode === "testnet" ? "Testnet" : "Mainnet"}
      </Link>
    );
  }
  return (
    <Link
      to={routeHref("elysium")}
      aria-label={`Elysium pulse, ${STATUS_LABEL[status]}${head !== null ? `, block ${formatBlockNumber(head)}` : ""}${ms !== null ? `, ${ms} ms blocks` : ""}`}
      className={cx(
        "inline-flex h-8 items-center gap-2.5 rounded-full border border-line bg-bg-1/60 pl-3 pr-3.5 font-mono text-xs text-text-1 transition-colors hover:border-gold/40 hover:text-text-0",
        FOCUS_RING,
        className,
      )}
    >
      <MiniSun feed={feed} status={status} />
      <span className="tnum">{head !== null ? `#${formatBlockNumber(head)}` : status === "offline" ? "offline" : "connecting"}</span>
      {ms !== null ? <span className="tnum hidden text-text-2 xl:inline">· {ms} ms</span> : null}
    </Link>
  );
}
