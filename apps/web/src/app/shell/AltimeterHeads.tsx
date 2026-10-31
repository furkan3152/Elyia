import { formatBlockNumber } from "../../lib/format";
import { cx } from "../../ui/cx";
import { Link } from "../routes/Link";
import { routeHref } from "../routes/routeTable";
import { useFloorStatus, useRidgeHead, useSummitHead, type LayerHead } from "./useLayerHeads";

const STATUS_WORD: Readonly<Record<LayerHead["status"], string>> = { live: "live", stale: "stale", offline: "offline", connecting: "…" };

function Head({ name, tone, head, compact }: { readonly name: string; readonly tone: string; readonly head: LayerHead; readonly compact: boolean }) {
  const up = head.status === "live";
  return (
    <span className="inline-flex items-baseline gap-1.5 whitespace-nowrap">
      <span aria-hidden="true" className={cx("text-[11px]", up ? tone : "text-ink-3")}>
        {up ? "▲" : "△"}
      </span>
      <span className={tone}>{name}</span>
      {!compact ? (
        <span className="tnum font-mono text-xs normal-case text-ink">{head.head !== null ? formatBlockNumber(head.head) : STATUS_WORD[head.status].toUpperCase()}</span>
      ) : null}
    </span>
  );
}

/**
 * The layer altimeter: live heads for THE FLOOR (HyperCore answering), THE
 * RIDGE (HyperEVM block) and THE SUMMIT (Elysium block, from the shared pulse).
 * Links to the Elysium barograph.
 */
export function AltimeterHeads({ compact = false, className }: { readonly compact?: boolean; readonly className?: string }) {
  const floor = useFloorStatus();
  const ridge = useRidgeHead();
  const summit = useSummitHead();
  const label = `Layer heads: Floor ${floor.status}; Ridge ${ridge.head ?? ridge.status}; Summit ${summit.head ?? summit.status}`;
  return (
    <Link to={routeHref("elysium")} aria-label={label} className={cx("inline-flex items-center gap-5 font-tag text-[11px] uppercase hover:underline", className)}>
      <Head name="FLOOR" tone="text-floor" head={floor} compact={compact} />
      <Head name="RIDGE" tone="text-ridge" head={ridge} compact={compact} />
      <Head name="SUMMIT" tone="text-summit-ink" head={summit} compact={compact} />
    </Link>
  );
}
