import { ChevronDown } from "lucide-react";

import { cx, FOCUS_RING } from "../../ui/cx";
import { Popover } from "../../ui/Popover";
import { SegmentedControl } from "../../ui/SegmentedControl";
import { modeAvailability, type NetworkMode } from "../state/uiPrefs";
import { useUiStore } from "../state/uiStore";

/**
 * The Testnet badge and network-mode switch. Mainnet stays disabled, with the
 * reason in plain words, until Elysium mainnet is live and public; testnet
 * and mainnet capital never share an intent.
 */
export function ModeBadge({ className }: { readonly className?: string }) {
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
            "inline-flex h-8 items-center gap-2 rounded-full border px-3 font-mono text-xs transition-colors",
            mode === "testnet" ? "border-mint/35 text-mint hover:bg-mint/[0.08]" : "border-gold/40 text-gold hover:bg-gold/[0.08]",
            FOCUS_RING,
            className,
          )}
        >
          <span aria-hidden="true" className={cx("el-loop h-1.5 w-1.5 animate-breathe rounded-full", mode === "testnet" ? "bg-mint" : "bg-gold")} />
          {mode === "testnet" ? "Testnet" : "Mainnet"}
          <ChevronDown className="h-3 w-3 opacity-70" aria-hidden="true" />
        </button>
      )}
    >
      {() => (
        <div className="flex w-[280px] flex-col gap-3">
          <p className="label-caps">Network mode</p>
          <SegmentedControl<NetworkMode>
            label="Network mode"
            value={mode}
            onChange={(next) => setMode(next)}
            fullWidth
            options={[
              { value: "testnet", label: "Testnet" },
              { value: "mainnet", label: "Mainnet", disabled: !mainnet.available, hint: mainnet.reason ?? undefined },
            ]}
          />
          <p className="text-xs leading-relaxed text-text-2">
            {mainnet.available
              ? "Mainnet uses real funds. Testnet and mainnet never share an intent."
              : (mainnet.reason ?? "Mainnet is not available yet.")}
          </p>
          <p className="font-mono text-xs text-text-1">Elysium 99801 · HyperEVM 998 · HyperCore testnet</p>
        </div>
      )}
    </Popover>
  );
}
