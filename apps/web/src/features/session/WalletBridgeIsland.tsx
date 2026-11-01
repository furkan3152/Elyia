import React from "react";

import { useWalletBridge } from "./bridgeStore";
import { WalletIsland } from "./WalletIsland";

const LazyBridge = React.lazy(() => import("./SessionBridge").then((module) => ({ default: module.SessionBridge })));

/**
 * Mount once on a site page: loads the wallet stack only after the visitor
 * asks for it (`eager` loads it at once, e.g. when a session already exists
 * and the page needs the wallet to act).
 */
export function WalletBridgeIsland({ eager = false }: { readonly eager?: boolean }) {
  const wanted = useWalletBridge((state) => state.wanted);
  if (!wanted && !eager) return null;
  return (
    <WalletIsland>
      <React.Suspense fallback={null}>
        <LazyBridge />
      </React.Suspense>
    </WalletIsland>
  );
}
