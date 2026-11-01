import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useEffect } from "react";

import { useWalletBridge } from "./bridgeStore";
import { useSiweSignIn } from "./useSiweSignIn";

/**
 * The wallet side of the session (needs the wagmi + RainbowKit providers):
 * publishes the account and the connect / sign-in actions to the wallet-free
 * bridge store. Renders nothing.
 */
export function SessionBridge() {
  const { address, chainId, isConnected, phase, error, signIn } = useSiweSignIn();
  const { openConnectModal } = useConnectModal();

  useEffect(() => {
    useWalletBridge.setState({ ready: true, wanted: true, address, chainId, isConnected, phase, error, openConnect: openConnectModal ?? null, signIn });
  }, [address, chainId, isConnected, phase, error, openConnectModal, signIn]);

  useEffect(() => {
    const { pendingConnect } = useWalletBridge.getState();
    if (!pendingConnect || !openConnectModal) return;
    useWalletBridge.setState({ pendingConnect: false });
    if (!isConnected) openConnectModal();
  }, [openConnectModal, isConnected]);

  useEffect(() => () => useWalletBridge.setState({ ready: false, openConnect: null, signIn: null }), []);
  return null;
}
