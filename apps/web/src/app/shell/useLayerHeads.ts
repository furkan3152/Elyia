import { NETWORKS } from "@elyia/core/networks";
import { useEffect, useState } from "react";

import { usePulseSelector } from "../../hooks/usePulse";
import type { PulseSnapshot } from "../../lib/pulse/pulseHub";
import { usePageVisible } from "../../motion/usePageVisible";
import { useUiStore } from "../state/uiStore";

export type HeadStatus = "live" | "stale" | "offline" | "connecting";

export interface LayerHead {
  /** Latest block (null for the Floor: HyperCore has no public block head to read cheaply). */
  readonly head: number | null;
  readonly status: HeadStatus;
}

const selectHead = (snapshot: PulseSnapshot) => snapshot.head?.number ?? snapshot.pulse?.head ?? null;
const selectStatus = (snapshot: PulseSnapshot) => snapshot.status;

/** SUMMIT: Elysium's head from the shared pulse hub (API stream, public RPC fallback). */
export function useSummitHead(): LayerHead {
  const head = usePulseSelector(selectHead);
  const status = usePulseSelector(selectStatus);
  return { head, status: status === "live" || status === "fallback" ? "live" : status === "stale" ? "stale" : status === "offline" ? "offline" : "connecting" };
}

/** RIDGE: HyperEVM's head, read with eth_blockNumber every 4 s while the tab is visible. */
export function useRidgeHead(): LayerHead {
  const mode = useUiStore((state) => state.mode);
  const visible = usePageVisible();
  const [state, setState] = useState<LayerHead>({ head: null, status: "connecting" });
  useEffect(() => {
    if (!visible) return undefined;
    const network = NETWORKS[mode === "mainnet" ? "hyperevm-mainnet" : "hyperevm-testnet"];
    const url = network.vm === "evm" ? network.rpcUrls[0] : undefined;
    if (!url) return undefined;
    let cancelled = false;
    let failures = 0;
    const read = async () => {
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }),
        });
        const body = (await response.json()) as { result?: string };
        const head = typeof body.result === "string" ? Number.parseInt(body.result, 16) : Number.NaN;
        if (!cancelled && Number.isSafeInteger(head)) {
          failures = 0;
          setState({ head, status: "live" });
        }
      } catch {
        failures += 1;
        if (!cancelled) setState((previous) => ({ head: previous.head, status: failures >= 3 ? "offline" : "stale" }));
      }
    };
    void read();
    const timer = window.setInterval(() => void read(), 4_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [mode, visible]);
  return state;
}

/** FLOOR: HyperCore's info API answering (checked every 15 s while visible). */
export function useFloorStatus(): LayerHead {
  const mode = useUiStore((state) => state.mode);
  const visible = usePageVisible();
  const [status, setStatus] = useState<HeadStatus>("connecting");
  useEffect(() => {
    if (!visible) return undefined;
    const network = NETWORKS[mode === "mainnet" ? "hypercore-mainnet" : "hypercore-testnet"];
    const url = network.vm === "hypercore" ? network.infoUrl : undefined;
    if (!url) return undefined;
    let cancelled = false;
    const read = async () => {
      try {
        const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "exchangeStatus" }) });
        if (!cancelled) setStatus(response.ok ? "live" : "stale");
      } catch {
        if (!cancelled) setStatus("offline");
      }
    };
    void read();
    const timer = window.setInterval(() => void read(), 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [mode, visible]);
  return { head: null, status };
}
