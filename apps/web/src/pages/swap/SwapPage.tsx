import { ArrowLeftRight } from "lucide-react";

import { UnderConstruction } from "../../app/shell/UnderConstruction";

/** Swap (spec §6). Placeholder until its feature build lands; replace this file. */
export default function SwapPage() {
  return (
    <UnderConstruction
      icon={ArrowLeftRight}
      title="Swap"
      eyebrow="SWAP · ELYSIUM AND HYPEREVM"
      description="Swap any token on Elysium or HyperEVM at the best quoted route, with the minimum output written into the transaction so a worse price reverts instead of filling."
      planned={[
        "Best route across Elysium testnet pools",
        "Live quote, price impact and minimum out",
        "Token safety score before you swap",
        "One signature, tracked to settlement",
      ]}
      example="swap 10 HYPE to USDC on Elysium"
    />
  );
}
