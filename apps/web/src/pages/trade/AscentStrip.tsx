import { useEffect } from "react";

import { Ely } from "../../pixel/Ely";
import { PixelStamp } from "../../pixel/PixelStamp";
import type { ElyState } from "../../pixel/states";
import { cx } from "../../ui/cx";
import type { Ascent } from "./pixelTerminal";
import { useTerminalUi } from "./terminalUi";

/** How long an outcome stays on the ticket before Ely steps aside. */
const HOLD_MS = 7_000;

const LOOK: Readonly<Record<Ascent["state"], { readonly ely: ElyState; readonly stamp: "settled" | "signed" | "queued" | "refused"; readonly tone: string }>> = {
  climb: { ely: "climb", stamp: "queued", tone: "text-summit-ink" },
  summit: { ely: "summit", stamp: "signed", tone: "text-up" },
  rest: { ely: "watch", stamp: "queued", tone: "text-summit-ink" },
  refused: { ely: "worry", stamp: "refused", tone: "text-down" },
};

/**
 * Ely after the trade button: climbing the rope while the order flies, then
 * the summit stamp when it fills (camp when it rests, worried when HyperCore
 * or the Rule Book refuses). It speaks once per send and steps aside.
 */
export function AscentStrip({ className }: { readonly className?: string }) {
  const ascent = useTerminalUi((state) => state.ascent);
  useEffect(() => {
    if (!ascent || ascent.state === "climb") return undefined;
    const timer = window.setTimeout(() => {
      if (useTerminalUi.getState().ascent?.id === ascent.id) useTerminalUi.getState().set({ ascent: null });
    }, HOLD_MS);
    return () => window.clearTimeout(timer);
  }, [ascent]);
  if (!ascent) return null;
  const look = LOOK[ascent.state];
  return (
    <div role="status" aria-live="polite" className={cx("px-frame-thin relative mt-1 flex items-center gap-3 bg-paper-2 py-1.5 pl-1.5 pr-3", className)}>
      <Ely key={`${ascent.id}-${ascent.state}`} state={look.ely} size={44} label={null} />
      <div className="min-w-0 flex-1 leading-snug">
        <p className={cx("font-tag text-[11px] uppercase", look.tone)}>{ascent.state === "climb" ? "Climbing…" : ascent.state === "summit" ? "Summit" : ascent.state === "rest" ? "Camp set" : "Turned back"}</p>
        <p className="truncate font-display text-[15px] font-bold text-ink">{ascent.title}</p>
        <p className="truncate font-mono text-[11px] text-ink-2" title={ascent.detail}>
          {ascent.detail}
        </p>
      </div>
      {ascent.state !== "climb" ? <PixelStamp key={ascent.id} state={look.stamp} text={ascent.stamp} size="sm" animate label={null} className="absolute -top-3 right-2 bg-card" /> : null}
    </div>
  );
}
