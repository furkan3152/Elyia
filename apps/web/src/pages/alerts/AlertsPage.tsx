import { Bell } from "lucide-react";

import { UnderConstruction } from "../../app/shell/UnderConstruction";

/** Alerts (spec §6). Placeholder until its feature build lands; replace this file. */
export default function AlertsPage() {
  return (
    <UnderConstruction
      icon={Bell}
      title="Alerts"
      eyebrow="ALERTS · WEB AND TELEGRAM"
      description="Price, funding, liquidation distance, fills, whale moves and bridge settlement, delivered where you already are, with actions in the message."
      planned={[
        "Rules for price, funding and liquidation distance",
        "Fill and bridge-settled notifications",
        "Telegram link and the Mini App",
        "Approve agent proposals from Telegram",
      ]}
      example="alert me if ETH funding goes above 0.05%"
    />
  );
}
