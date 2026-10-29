import { Compass } from "lucide-react";

import { UnderConstruction } from "../../app/shell/UnderConstruction";

/** Discover (spec §6). Placeholder until its feature build lands; replace this file. */
export default function DiscoverPage() {
  return (
    <UnderConstruction
      icon={Compass}
      title="Discover"
      eyebrow="DISCOVER · THE ELYSIAN FIELDS"
      description="The Elysium ecosystem in one directory, plus fresh pools and tokens with safety scores, so you can find what is live on Elysium and what is only announced."
      planned={[
        "Protocol directory with live and announced status",
        "New pools and tokens as they appear",
        "Safety scores with the checks behind them",
        "One-click ape, inside your guardrails",
      ]}
      example="show new pools on Elysium"
    />
  );
}
