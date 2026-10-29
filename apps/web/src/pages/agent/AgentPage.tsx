import { Bot } from "lucide-react";

import { UnderConstruction } from "../../app/shell/UnderConstruction";

/** Agent (spec §6). Placeholder until its feature build lands; replace this file. */
export default function AgentPage() {
  return (
    <UnderConstruction
      icon={Bot}
      title="Agent"
      eyebrow="THE ELYSIUM AGENT"
      description="An agent that can trade for you but can never withdraw: proposals you sign, browser autopilot under a policy guard, or opt-in Keeper mode with a separate trade-only key, all inside a Rule Book you set."
      planned={[
        "Chat and proposals you approve",
        "Automations: schedules and conditions",
        "Guardrails: limits, caps, allowlists, kill switch",
        "Keeper mode (opt-in), revocable at any time",
      ]}
      example="every day buy 10 HYPE"
    />
  );
}
