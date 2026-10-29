import { ConnectButton } from "@rainbow-me/rainbowkit";
import { Wallet } from "lucide-react";

import { Button } from "../../ui/Button";
import { cx, FOCUS_RING } from "../../ui/cx";
import { NetworkGlyph } from "../../ui/NetworkGlyph";

/**
 * The top bar's wallet control, drawn with Elyia's kit on RainbowKit's
 * ConnectButton.Custom: connect, wrong network, or the connected chain and
 * account (the account opens RainbowKit's account modal).
 */
export function WalletButton({ compact = false }: { readonly compact?: boolean }) {
  return (
    <ConnectButton.Custom>
      {({ account, chain, mounted, openAccountModal, openChainModal, openConnectModal, authenticationStatus }) => {
        const ready = mounted && authenticationStatus !== "loading";
        const connected = ready && account && chain;
        if (!ready) return <span aria-hidden="true" className="h-10 w-32 rounded-lg bg-bg-2/60" />;
        if (!connected) {
          return (
            <Button variant="primary" size="md" onClick={openConnectModal} leftIcon={<Wallet className="h-4 w-4" aria-hidden="true" />}>
              {compact ? "Connect" : "Connect wallet"}
            </Button>
          );
        }
        if (chain.unsupported) {
          return (
            <Button variant="danger" size="md" onClick={openChainModal}>
              Wrong network
            </Button>
          );
        }
        const family = chain.id === 998 || chain.id === 999 ? "hyperevm" : "elysium";
        return (
          <span className="inline-flex items-center gap-1.5">
            {compact ? null : (
              <button
                type="button"
                onClick={openChainModal}
                title={`Network: ${chain.name ?? "unknown"}`}
                aria-label={`Network ${chain.name ?? ""}, change network`}
                className={cx(
                  "inline-flex h-10 items-center gap-2 rounded-lg border border-line-strong bg-bg-1/60 px-3 text-[13px] text-text-1 transition-colors hover:border-violet-glow/40 hover:text-text-0",
                  family === "elysium" ? "[&>svg]:text-gold" : "[&>svg]:text-sky",
                  FOCUS_RING,
                )}
              >
                <NetworkGlyph family={family} size={14} />
                <span className="hidden xl:inline">{family === "elysium" ? "Elysium" : "HyperEVM"}</span>
              </button>
            )}
            <button
              type="button"
              onClick={openAccountModal}
              aria-label={`Account ${account.address}`}
              className={cx(
                "inline-flex h-10 items-center gap-2 rounded-lg border border-line-strong bg-bg-1/60 px-3 font-mono text-[13px] text-text-0 transition-colors hover:border-violet-glow/40",
                FOCUS_RING,
              )}
            >
              <span aria-hidden="true" className="h-2 w-2 rounded-full bg-mint" />
              <span className="tnum">{account.displayName}</span>
            </button>
          </span>
        );
      }}
    </ConnectButton.Custom>
  );
}
