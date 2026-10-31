import type { NetworkFamily, NetworkKey } from "@elyia/core/networks";

import { cx } from "./cx";
import { networkView } from "./networkMeta";
import { NetworkGlyph } from "./NetworkGlyph";
import { SOFT_TONE } from "./tones";

export interface NetworkBadgeProps {
  /** A network key ("elysium-testnet") or a realm family ("hypercore"). */
  readonly network: NetworkKey | NetworkFamily;
  /** Append "testnet" for testnet keys (default true). */
  readonly showEnvironment?: boolean;
  readonly size?: "sm" | "md";
  /** Glyph only, with the name as accessible label. */
  readonly iconOnly?: boolean;
  readonly className?: string;
}

const GLYPH_TEXT: Readonly<Record<NetworkFamily, string>> = { elysium: "text-summit-ink", hyperevm: "text-ridge", hypercore: "text-floor" };

/** Realm badge: Elysium (THE SUMMIT), HyperEVM (THE RIDGE), HyperCore (THE FLOOR), in their altitude colours. */
export function NetworkBadge({ network, showEnvironment = true, size = "sm", iconOnly = false, className }: NetworkBadgeProps) {
  const view = networkView(network);
  const name = `${view.label}${view.environment === "testnet" ? " testnet" : ""}`;
  if (iconOnly) {
    return (
      <span role="img" aria-label={name} title={name} className={cx("inline-flex", GLYPH_TEXT[view.family], className)}>
        <NetworkGlyph family={view.family} size={size === "sm" ? 14 : 16} />
      </span>
    );
  }
  return (
    <span
      className={cx(
        "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap px-frame-thin [--pf-c:currentColor] font-tag",
        size === "sm" ? "h-5 px-2 text-[11px]" : "h-6 px-2.5 text-xs",
        SOFT_TONE[view.realm.tone],
        className,
      )}
    >
      <NetworkGlyph family={view.family} size={size === "sm" ? 12 : 14} />
      {view.label}
      {showEnvironment && view.environment === "testnet" ? <span className="opacity-70">testnet</span> : null}
    </span>
  );
}
