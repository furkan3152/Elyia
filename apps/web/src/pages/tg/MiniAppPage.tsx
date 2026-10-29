import { Send } from "lucide-react";

import { ElyiaLogo } from "../../app/shell/ElyiaMark";
import { Badge } from "../../ui/Badge";
import { ButtonLink } from "../../ui/Button";
import { Panel } from "../../ui/Panel";
import { routeHref } from "../../app/routes/routeTable";

/** The Telegram Mini App at /tg (spec §6). Placeholder until the Telegram build lands; replace this file. */
export default function MiniAppPage() {
  return (
    <div className="mx-auto flex min-h-[100dvh] max-w-md flex-col gap-5 bg-bg-0 px-4 py-6">
      <div className="flex items-center justify-between">
        <ElyiaLogo size="sm" />
        <Badge tone="mint" dot="pulse">
          Testnet
        </Badge>
      </div>
      <Panel variant="glow" padding="lg" className="flex flex-col gap-4">
        <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-violet-glow/30 bg-violet/[0.12] text-violet-soft">
          <Send className="h-5 w-5" aria-hidden="true" />
        </span>
        <Badge tone="gold" dot className="self-start">
          Under construction in this build
        </Badge>
        <h1 className="font-display text-3xl text-text-0">Elyia in Telegram</h1>
        <p className="text-sm leading-relaxed text-text-1">
          A compact deck inside Telegram: portfolio, positions, alerts, quick trades and agent proposals to approve with one tap. Signing always happens in your own wallet.
        </p>
        <ButtonLink to={routeHref("deck")} variant="primary">
          Open the full deck
        </ButtonLink>
      </Panel>
    </div>
  );
}
