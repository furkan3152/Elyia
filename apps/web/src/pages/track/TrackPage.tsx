import { Route } from "lucide-react";

import { UnderConstruction } from "../../app/shell/UnderConstruction";

/** Track (spec §6). Placeholder until its feature build lands; replace this file. */
export default function TrackPage() {
  return (
    <UnderConstruction
      icon={Route}
      title="Track"
      eyebrow="TRACK · EVERY STEP, LIVE"
      description="Paste a transaction hash or a HyperCore reference and follow it to final: included, posted to HyperEVM, claimable, settled. Watch wallets and whales across all three layers."
      planned={[
        "Journeys for every intent, step by step",
        "Watchlists and whale tracking",
        "Bridge settlement and claim reminders",
        "Telegram alerts when a step lands",
      ]}
      example="track my bridge to Elysium"
    />
  );
}
