import { Star } from "lucide-react";

import { UnderConstruction } from "../../app/shell/UnderConstruction";
import { useRouteParam } from "../../app/routes/useRoute";
import { shortAddress } from "../../lib/format";

/** Own Stars at /app/portfolio/:address? (spec §6). Placeholder until the portfolio build lands; replace this file. */
export default function PortfolioPage() {
  const address = useRouteParam("address");
  return (
    <UnderConstruction
      icon={Star}
      title={address ? `Portfolio of ${shortAddress(address)}` : "Portfolio"}
      eyebrow="YOUR OWN STARS · THREE LAYERS"
      description="One portfolio across HyperCore, HyperEVM and Elysium: perps, spot, vaults, staking and tokens valued in USD, drawn as a constellation where every holding is a star, with tables and honest PnL beside it."
      planned={[
        "Constellation of holdings across three skies",
        "Net worth with freshness on every number",
        "Exposure by asset and liquidation distance",
        "Fills, funding and ledger history",
      ]}
      example="move all my HyperEVM USDC to perps"
    />
  );
}
