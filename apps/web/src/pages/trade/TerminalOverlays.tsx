import { AgentPanel } from "../../features/agentKey/AgentPanel";
import { EnableTradingDialog } from "../../features/agentKey/EnableTradingDialog";
import { MarketPicker } from "./MarketPicker";
import { ReviewDialog } from "./ReviewDialog";
import { CloseDialog, FlattenDialog, TpslDialog } from "./RiskDialogs";
import { RuleBookSheet } from "./RuleBookSheet";
import { useTerminal } from "./terminalContext";
import { useTerminalUi } from "./terminalUi";

/** Every terminal overlay, mounted once. */
export function TerminalOverlays() {
  const { agent, endpoints, now } = useTerminal();
  const enableOpen = useTerminalUi((state) => state.enableOpen);
  const agentOpen = useTerminalUi((state) => state.agentOpen);
  const set = useTerminalUi((state) => state.set);
  return (
    <>
      <MarketPicker />
      <ReviewDialog />
      <FlattenDialog />
      <CloseDialog />
      <TpslDialog />
      <RuleBookSheet />
      <EnableTradingDialog open={enableOpen} onClose={() => set({ enableOpen: false })} api={agent} hyperliquidChain={endpoints.hyperliquidChain} />
      <AgentPanel open={agentOpen} onClose={() => set({ agentOpen: false })} api={agent} now={now} onEnable={() => set({ agentOpen: false, enableOpen: true })} />
    </>
  );
}
