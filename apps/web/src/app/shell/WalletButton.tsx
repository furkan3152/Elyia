import { ConnectButton } from "@rainbow-me/rainbowkit";

import { Button } from "../../ui/Button";
import { cx, FOCUS_RING } from "../../ui/cx";
import { NetworkGlyph } from "../../ui/NetworkGlyph";

/**
 * The wallet control in Survey dress, on RainbowKit's ConnectButton.Custom:
 * connect, wrong network, or the connected layer and account (the account
 * opens RainbowKit's account modal). Your key never leaves your wallet.
 */
export function WalletButton({ compact = false }: { readonly compact?: boolean }) {
  return (
    <ConnectButton.Custom>
      {({ account, chain, mounted, openAccountModal, openChainModal, openConnectModal, authenticationStatus }) => {
        const ready = mounted && authenticationStatus !== "loading";
        const connected = ready && account && chain;
        if (!ready) return <span aria-hidden="true" className="el-skeleton h-9 w-28" />;
        if (!connected) {
          return (
            <Button variant="ink" size="sm" onClick={openConnectModal} className="h-9">
              {compact ? "Connect" : "Connect wallet"}
            </Button>
          );
        }
        if (chain.unsupported) {
          return (
            <Button variant="danger" size="sm" onClick={openChainModal} className="h-9">
              Wrong network
            </Button>
          );
        }
        const family = chain.id === 998 || chain.id === 999 ? "hyperevm" : "elysium";
        return (
          <span className="inline-flex h-9 items-stretch border-2 border-rule bg-card shadow-hard-sm">
            {compact ? null : (
              <button
                type="button"
                onClick={openChainModal}
                title={`Network: ${chain.name ?? "unknown"}`}
                aria-label={`Network ${chain.name ?? ""}, change network`}
                className={cx(
                  "inline-flex items-center gap-1.5 border-r-2 border-rule px-2 font-mono text-[11px] font-semibold tracking-[0.1em] hover:bg-paper-2",
                  family === "elysium" ? "text-summit-ink" : "text-ridge",
                  FOCUS_RING,
                )}
              >
                <NetworkGlyph family={family} size={14} />
                <span className="hidden xl:inline">{family === "elysium" ? "SUMMIT" : "RIDGE"}</span>
              </button>
            )}
            <button type="button" onClick={openAccountModal} aria-label={`Account ${account.address}`} className={cx("inline-flex items-center gap-2 px-2.5 font-mono text-xs text-ink hover:bg-paper-2", FOCUS_RING)}>
              <span aria-hidden="true" className="h-2 w-2 rotate-45 bg-up" />
              <span className="tnum">{account.displayName}</span>
            </button>
          </span>
        );
      }}
    </ConnectButton.Custom>
  );
}
