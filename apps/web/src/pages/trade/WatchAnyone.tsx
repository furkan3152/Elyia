import { Eye } from "lucide-react";
import { useState } from "react";

import { routeHref } from "../../app/routes/routeTable";
import { navigate } from "../../app/routes/useRoute";
import { Button } from "../../ui/Button";
import { cx } from "../../ui/cx";
import { fieldBoxClasses } from "../../ui/fieldStyles";
import { useTerminal } from "./terminalContext";

/** A testnet account with live positions and orders, to show what a full sheet looks like. */
export const SAMPLE_WATCH = "0xdc0054d9962fb4adf760f669dc3e02c07aa5af95";

/** "Survey any address": open the terminal read only on someone's HyperCore account (?as=0x…). */
export function WatchAnyone({ className }: { readonly className?: string }) {
  const { market } = useTerminal();
  const [value, setValue] = useState("");
  const valid = /^0x[0-9a-fA-F]{40}$/u.test(value.trim());
  const go = (address: string) => navigate(`${routeHref("trade", { market: market?.slug ?? "BTC" })}?as=${address.toLowerCase()}`);
  return (
    <div className={cx("flex w-full max-w-md flex-col gap-2", className)}>
      <div role="group" aria-label="Survey an address" className="flex items-center gap-2">
        <label className={cx(fieldBoxClasses({ size: "sm" }), "flex-1")}>
          <Eye className="h-3.5 w-3.5 shrink-0 text-ink-3" aria-hidden="true" />
          <input
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || !valid) return;
              event.preventDefault();
              go(value.trim());
            }}
            placeholder="0x… any HyperCore account"
            aria-label="Address to survey, read only"
            spellCheck={false}
            className="h-full min-w-0 flex-1 bg-transparent font-mono text-xs text-ink outline-none placeholder:text-ink-3"
          />
        </label>
        <Button type="button" size="sm" variant="ink" disabled={!valid} onClick={() => go(value.trim())}>
          Survey
        </Button>
      </div>
      <button type="button" onClick={() => go(SAMPLE_WATCH)} className="self-center font-mono text-[11px] text-summit-ink underline underline-offset-2 hover:text-ink">
        or open a sample testnet account (0xdc00…af95)
      </button>
    </div>
  );
}
