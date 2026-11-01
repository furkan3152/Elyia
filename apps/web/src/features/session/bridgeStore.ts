/**
 * The wallet bridge: a wallet-free store that the lazily mounted wallet side
 * (SessionBridge, inside the wagmi providers) fills with the connected
 * account and the connect / sign-in actions. Buttons anywhere on a site page
 * call them without importing the wallet stack.
 */
import { create } from "zustand";

import type { SignInPhase } from "./useSiweSignIn";

export interface WalletBridgeState {
  /** The visitor asked for the wallet (mounts the island). */
  readonly wanted: boolean;
  /** The wallet side is mounted and wired. */
  readonly ready: boolean;
  readonly address: string | null;
  readonly chainId: number | null;
  readonly isConnected: boolean;
  readonly phase: SignInPhase;
  readonly error: string | null;
  /** Set by the bridge: opens the connect modal. */
  readonly openConnect: (() => void) | null;
  /** Set by the bridge: runs Sign-In with Ethereum. */
  readonly signIn: (() => Promise<boolean>) | null;
  /** A connect request made before the bridge was ready (opened once it is). */
  readonly pendingConnect: boolean;
  readonly request: () => void;
}

export const useWalletBridge = create<WalletBridgeState>()((set, get) => ({
  wanted: false,
  ready: false,
  address: null,
  chainId: null,
  isConnected: false,
  phase: "idle",
  error: null,
  openConnect: null,
  signIn: null,
  pendingConnect: false,
  request: () => {
    const state = get();
    if (state.ready && state.openConnect && !state.isConnected) {
      state.openConnect();
      return;
    }
    set({ wanted: true, pendingConnect: !state.isConnected });
  },
}));
