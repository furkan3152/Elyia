import { navigate } from "../../app/routes/history";
import { routeHref } from "../../app/routes/routeTable";
import { intentHref } from "../../oracle/preview";
import { openOracle } from "../../oracle/oracleStore";
import { Button } from "../../ui/Button";
import { SentenceRoute } from "../track/flow/SentenceRoute";

/**
 * A sentence handed to the deck (`/app?intent=`, from WHERE TO?, ⌘K, the
 * landing card or the Guide): the reader's chips and questions, the
 * planner's dry run as the pixel route card, and, with a wallet connected,
 * each step prepared, signed in the wallet, submitted and followed live.
 */
export function IntentDraft({ sentence, account }: { readonly sentence: string; readonly account: string | null }) {
  const dismiss = () => navigate(`${routeHref("deck")}${account ? `?as=${account}` : ""}`, { replace: true });
  return (
    <div className="flex flex-col gap-8">
      <SentenceRoute key={sentence} sentence={sentence} account={account} onExample={(example) => navigate(intentHref(example))} />
      <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-4">
        <Button variant="ink" size="sm" onClick={() => openOracle(sentence)}>
          Edit the sentence
        </Button>
        <Button variant="ghost" size="sm" onClick={dismiss}>
          Dismiss
        </Button>
        <span className="font-tag text-[11px] uppercase text-ink-3">dry run · nothing signs until you press sign</span>
      </div>
    </div>
  );
}
