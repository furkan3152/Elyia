import { spotUsdc } from "../../features/trading/accountModel";
import { useTerminal } from "./terminalContext";

/** Where the user stands: what the big button can do right now. */
export type Access = "loading" | "connect" | "readOnly" | "unfunded" | "unsupported" | "enable" | "unlock" | "ready";

export function useAccess(): Access {
  const { connected, readOnly, feeds, agent, canSign } = useTerminal();
  if (readOnly) return "readOnly";
  if (!connected) return "connect";
  if (canSign) return "ready";
  const phase = agent.session.phase;
  if (phase === "unsupported") return "unsupported";
  if (phase === "loading") return "loading";
  if (feeds.summary && feeds.spot) {
    const usdc = spotUsdc(feeds.spot);
    if (feeds.summary.accountValue < 1 && usdc.total < 1 && (feeds.positions?.length ?? 0) === 0) return "unfunded";
  }
  return phase === "locked" ? "unlock" : "enable";
}

