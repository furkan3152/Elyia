import { useCardSign, type SignSource } from "../../../features/ely/useCardSign";
import { Dialog } from "../../../ui/Dialog";
import { FlowCard } from "../../track/flow/FlowCard";

export interface SignRequest {
  readonly title: string;
  readonly source: SignSource;
}

/** The real sign flow for one draft: planner dry run, then each step signed in the wallet when pressed. */
function DraftSign({ source }: { readonly source: SignSource }) {
  const sign = useCardSign(source);
  return (
    <FlowCard
      ask={sign.ask}
      plan={sign.plan}
      planning={sign.planning}
      updatedAt={sign.updatedAt}
      run={sign.run}
      empty={null}
      fineprint="A draft until you sign: the planner re-quotes each step at prepare and binds the quote. Ely never signs."
    />
  );
}

/**
 * One dialog for every one-tap Ely draft on the page (an insight, a
 * position's Protect / Anchor / Ease / Close). It opens the same planner and
 * wallet flow as the deck; nothing moves until the wallet signs.
 */
export function SignDialog({ request, onClose }: { readonly request: SignRequest | null; readonly onClose: () => void }) {
  return (
    <Dialog open={request !== null} onClose={onClose} title={request ? request.title : "Draft"} description="Ely drafted this. Your wallet signs each step; nothing moves until you do." size="lg">
      {request ? <DraftSign source={request.source} /> : null}
    </Dialog>
  );
}
