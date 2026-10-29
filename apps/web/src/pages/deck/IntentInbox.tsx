import { PenLine, Sparkles, X } from "lucide-react";

import { navigate } from "../../app/routes/history";
import { routeHref } from "../../app/routes/routeTable";
import { IntentChips } from "../../oracle/IntentChips";
import { openOracle } from "../../oracle/oracleStore";
import { previewChips } from "../../oracle/preview";
import { Badge } from "../../ui/Badge";
import { Button } from "../../ui/Button";
import { IconButton } from "../../ui/IconButton";
import { Panel } from "../../ui/Panel";

/**
 * A sentence handed to the deck as ?intent= (from the landing page or the
 * Oracle). The planner (POST /v1/intents?dryRun=true) wires in with the intent
 * build and renders its steps here; until then the card says so plainly.
 */
export function IntentInbox({ sentence }: { readonly sentence: string }) {
  return (
    <Panel variant="raised" padding="md" className="rounded-3xl border-gold/30">
      <div className="flex flex-wrap items-start gap-4">
        <span aria-hidden="true" className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-gold/35 bg-gold/[0.1] text-gold">
          <Sparkles className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="label-caps">Your intent</p>
            <Badge tone="gold">planner arrives in the intent build</Badge>
          </div>
          <p className="mt-1.5 break-words text-lg text-text-0">“{sentence}”</p>
          <IntentChips tokens={previewChips(sentence)} className="mt-2.5" />
          <p className="mt-2.5 text-xs text-text-2">The plan, with each step quoted live and checked against your Rule Book, will appear here. Nothing moves until you sign.</p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button variant="outline" size="sm" leftIcon={<PenLine className="h-3.5 w-3.5" aria-hidden="true" />} onClick={() => openOracle(sentence)}>
            Edit
          </Button>
          <IconButton label="Dismiss" size="sm" icon={<X className="h-4 w-4" aria-hidden="true" />} onClick={() => navigate(routeHref("deck"), { replace: true })} />
        </div>
      </div>
    </Panel>
  );
}
