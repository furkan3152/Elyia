import { Waypoints } from "lucide-react";

import { UnderConstruction } from "../../app/shell/UnderConstruction";

/** Bridge (spec §6). Placeholder until its feature build lands; replace this file. */
export default function BridgePage() {
  return (
    <UnderConstruction
      icon={Waypoints}
      title="Bridge"
      eyebrow="BRIDGE · HYPEREVM ↔ ELYSIUM ↔ HYPERCORE"
      description="Move value between the three layers: the canonical Elysium bridge and the mirror bridge between HyperEVM and Elysium, HyperEVM to HyperCore, and spot to perp on HyperCore."
      planned={[
        "Canonical deposits and withdrawals with claim tracking",
        "Mirror bridge for ERC-20s",
        "HyperEVM ↔ HyperCore transfers",
        "Retryable redeem and expiry warnings",
      ]}
      example="bridge 20 HYPE to Elysium"
    />
  );
}
