import React from "react";

/*
 * The wallet stack (wagmi, viem, RainbowKit) as an island inside a site page:
 * it downloads only when the island mounts, so a visitor who never signs in
 * never pays for it. Inside the deck (/app) the providers already exist and
 * this is not needed.
 */
const LazyProviders = React.lazy(() => import("../../app/providers").then((module) => ({ default: module.WalletProviders })));

export interface WalletIslandProps {
  readonly children: React.ReactNode;
  /** Drawn while the wallet chunk loads (and if it fails). */
  readonly fallback?: React.ReactNode;
}

class IslandBoundary extends React.Component<{ readonly fallback: React.ReactNode; readonly children: React.ReactNode }, { readonly failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export function WalletIsland({ children, fallback = null }: WalletIslandProps) {
  return (
    <IslandBoundary fallback={fallback}>
      <React.Suspense fallback={fallback}>
        <LazyProviders>{children}</LazyProviders>
      </React.Suspense>
    </IslandBoundary>
  );
}
