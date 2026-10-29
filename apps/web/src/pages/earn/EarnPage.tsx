import { Sprout } from "lucide-react";

import { UnderConstruction } from "../../app/shell/UnderConstruction";

/** Earn (spec §6). Placeholder until its feature build lands; replace this file. */
export default function EarnPage() {
  return (
    <UnderConstruction
      icon={Sprout}
      title="Earn"
      eyebrow="EARN · STAKING, LENDING, VAULTS"
      description="Put idle HYPE and USDC to work: kHYPE and HyperCore staking, lending markets on Elysium and HyperEVM, and vaults including HLP, ranked by live yield."
      planned={[
        "kHYPE and HyperCore staking",
        "Lending markets as they launch on Elysium",
        "Vaults including HLP, with drawdown history",
        "Yields ranked with their source and risk",
      ]}
      example="stake 10 HYPE"
    />
  );
}
