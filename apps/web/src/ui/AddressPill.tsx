import { explorerAddressUrl, type NetworkKey } from "@elyia/core/networks";
import { Check, Copy, ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";

import { shortAddress } from "../lib/format";
import { copyText } from "./clipboard";
import { cx, FOCUS_RING } from "./cx";
import { toast } from "./toast";

export interface AddressPillProps {
  readonly address: string;
  /** Network for the explorer link; without it only copy is offered. */
  readonly network?: NetworkKey;
  /** Optional name shown before the address ("Inbox", "L2 gateway router"). */
  readonly label?: string;
  readonly head?: number;
  readonly tail?: number;
  readonly className?: string;
}

/**
 * Short address with copy and an explorer link (from @elyia/core's registry).
 * When the network has no public explorer yet (Elysium mainnet before launch)
 * the link is omitted and the title says why, instead of linking nowhere.
 */
export function AddressPill({ address, network, label, head = 4, tail = 4, className }: AddressPillProps) {
  const [copied, setCopied] = useState(false);
  const url = network ? explorerAddressUrl(network, address) : null;

  useEffect(() => {
    if (!copied) return undefined;
    const timer = window.setTimeout(() => setCopied(false), 1400);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const copy = async () => {
    const ok = await copyText(address);
    if (ok) {
      setCopied(true);
      toast.success("Address copied", { id: "address-copied", description: shortAddress(address, 6, 6) });
    } else {
      toast.error("Could not copy", { id: "address-copied", description: "Your browser blocked the clipboard. Select the address and copy it by hand." });
    }
  };

  return (
    <span className={cx("inline-flex min-w-0 items-center gap-0.5 rounded-lg border border-line bg-bg-2/60 py-0.5 pl-2.5 pr-0.5", className)}>
      {label ? <span className="mr-1.5 truncate text-xs text-text-2">{label}</span> : null}
      <span className="tnum truncate font-mono text-xs text-text-0" title={address}>
        {shortAddress(address, head, tail)}
      </span>
      <button
        type="button"
        onClick={() => void copy()}
        aria-label={`Copy address ${address}`}
        className={cx("ml-1 inline-flex h-6 w-6 items-center justify-center rounded-md text-text-2 transition-colors hover:bg-text-0/[0.06] hover:text-text-0", FOCUS_RING)}
      >
        {copied ? <Check className="h-3.5 w-3.5 text-mint" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
      </button>
      {network ? (
        url ? (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Open ${shortAddress(address)} in the explorer (new tab)`}
            className={cx("inline-flex h-6 w-6 items-center justify-center rounded-md text-text-2 transition-colors hover:bg-text-0/[0.06] hover:text-violet-soft", FOCUS_RING)}
          >
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
        ) : (
          <span className="px-1.5 text-xs text-text-2" title="This network has no public explorer yet">
            no explorer
          </span>
        )
      ) : null}
    </span>
  );
}
