import { ChartCandlestick } from "lucide-react";

import { UnderConstruction } from "../../app/shell/UnderConstruction";
import { useRouteParam } from "../../app/routes/useRoute";

/** The HyperCore terminal at /app/trade/:market? (spec §6). Placeholder until the trading build lands; replace this file. */
export default function TradePage() {
  const market = useRouteParam("market")?.toUpperCase();
  return (
    <UnderConstruction
      icon={ChartCandlestick}
      title={market ? `Trade ${market}` : "Trade"}
      eyebrow="HYPERCORE TERMINAL"
      description="A keyboard-first HyperCore terminal: chart, order book and trades, a risk-first ticket with leverage, TP/SL, TWAP and scale orders, and liquidation distance on every position. Orders are signed by a trade-only key that never leaves your browser."
      planned={[
        "Chart, book and live trades",
        "Ticket: leverage, TP/SL, TWAP, scale",
        "Positions, orders, fills and funding tabs",
        "Flatten all and cancel all, with hotkeys",
      ]}
      example={market ? `long ${market} 5x with 200 USDC, stop at -3%` : "long ETH 5x with 200 USDC, stop at -3%"}
    />
  );
}
