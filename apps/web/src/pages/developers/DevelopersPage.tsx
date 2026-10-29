import { Terminal } from "lucide-react";

import { UnderConstruction } from "../../app/shell/UnderConstruction";

/** /developers (spec §6). Placeholder until the developer portal lands; replace this file. */
export default function DevelopersPage() {
  return (
    <UnderConstruction
      variant="site"
      icon={Terminal}
      title="Developers"
      eyebrow="BUILDERS · API · MCP · SDK"
      description="The Elyia API for Elysium, HyperEVM and HyperCore: plan intents, track journeys, read portfolios and the live Elysium pulse. An MCP server gives AI agents the same read-only tools, with proposals that return a signing link."
      planned={[
        "REST reference with live examples",
        "SSE streams: blocks, markets, journeys",
        "MCP server setup for AI agents",
        "TypeScript snippets for every endpoint",
      ]}
      example="go pulse"
    />
  );
}
