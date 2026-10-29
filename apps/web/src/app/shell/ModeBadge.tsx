import { cx, FOCUS_RING } from "../../ui/cx";
import { Popover } from "../../ui/Popover";
import { SegmentedControl } from "../../ui/SegmentedControl";
import { modeAvailability, type NetworkMode } from "../state/uiPrefs";
import { useUiStore } from "../state/uiStore";

/**
 * The network-mode chip: "PRACTICE WALL · TESTNET" (separate capital, like
 * a climbing wall) or "MAINNET". Mainnet stays disabled, with the reason in
 * plain words, until Elysium mainnet is live and public; testnet and mainnet
 * capital never share an intent.
 */
export function ModeBadge({ className, compact = false }: { readonly className?: string; readonly compact?: boolean }) {
  const mode = useUiStore((state) => state.mode);
  const setMode = useUiStore((state) => state.setMode);
  const mainnet = modeAvailability("mainnet");
  return (
    <Popover
      label="Network mode"
      trigger={(props) => (
        <button
          type="button"
          {...props}
          className={cx(
            "inline-flex h-7 shrink-0 items-center gap-2 border-2 border-rule px-2 font-mono text-[11px] font-semibold tracking-[0.1em]",
            mode === "testnet" ? "bg-signal text-signal-ink" : "bg-ink text-paper",
            FOCUS_RING,
            className,
          )}
        >
          {mode === "testnet" ? (compact ? "TESTNET" : "PRACTICE WALL · TESTNET") : "MAINNET"}
          <span aria-hidden="true">▾</span>
        </button>
      )}
    >
      {() => (
        <div className="flex w-[290px] flex-col gap-3">
          <p className="caption !text-ink">Network mode</p>
          <SegmentedControl<NetworkMode>
            label="Network mode"
            value={mode}
            onChange={(next) => setMode(next)}
            fullWidth
            options={[
              { value: "testnet", label: "Practice wall" },
              { value: "mainnet", label: "Mainnet", disabled: !mainnet.available, hint: mainnet.reason ?? undefined },
            ]}
          />
          <p className="text-[13px] leading-relaxed text-ink-2">
            {mainnet.available
              ? "Mainnet uses real funds. The practice wall and mainnet never share an intent."
              : (mainnet.reason ?? "Mainnet is not available yet.")}
          </p>
          <p className="font-mono text-[11px] text-ink-3">Elysium 99801 · HyperEVM 998 · HyperCore testnet · separate capital</p>
        </div>
      )}
    </Popover>
  );
}
