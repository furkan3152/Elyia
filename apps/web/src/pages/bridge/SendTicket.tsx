import { useId, useState } from "react";

import { cx, FOCUS_RING } from "../../ui/cx";
import { NumberField } from "../../ui/NumberInput";
import { SegmentedControl } from "../../ui/SegmentedControl";
import { SentenceRoute } from "../track/flow/SentenceRoute";
import { useDebounced } from "../track/flow/useFlowPlan";
import { recipientProblem } from "./recipient";

/**
 * Send to a friend: a 0x address or a name.ely, an amount, an asset, a
 * layer. The words go to the reader (which resolves .ely names on Elysium
 * and shows the address it found) and the planner; the Rule Book asks you to
 * confirm before anything pays an address that is not yours.
 */
export function SendTicket({ account }: { readonly account: string | null }) {
  const id = useId();
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [asset, setAsset] = useState<"HYPE" | "USDC">("HYPE");
  const [where, setWhere] = useState<"elysium" | "hyperevm">("elysium");
  const problem = recipientProblem(recipient);
  const ready = recipient.trim() && !problem && /^\d*\.?\d+$/u.test(amount) && Number(amount) > 0;
  const sentence = useDebounced(ready ? `send ${amount} ${asset} to ${recipient.trim()} on ${where}` : "", 450);
  return (
    <div className="flex flex-col gap-10">
      <div className="mx-auto flex w-full max-w-[720px] flex-col gap-5 bg-card p-5 px-frame px-drop sm:p-6" aria-label="Send ticket">
        <div className="flex flex-col gap-2">
          <div className="flex min-h-12 w-full min-w-0 items-stretch bg-paper px-frame-thin">
            <label htmlFor={id} className="flex shrink-0 items-center bg-ink px-3 font-tag text-[12px] uppercase text-paper">
              To
            </label>
            <input
              id={id}
              value={recipient}
              onChange={(event) => setRecipient(event.target.value.slice(0, 80))}
              placeholder="0x… or name.ely"
              autoComplete="off"
              spellCheck={false}
              aria-invalid={problem ? true : undefined}
              aria-describedby={`${id}-hint`}
              className={cx("min-w-0 flex-1 bg-transparent px-3 font-mono text-sm text-ink outline-none placeholder:text-ink-3", FOCUS_RING)}
            />
          </div>
          <p id={`${id}-hint`} className={cx("text-center font-mono text-[11px]", problem ? "text-down" : "text-ink-3")}>
            {problem ?? "names.ely resolve on Elysium; the card shows the address before you sign"}
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <SegmentedControl label="Asset" fullWidth value={asset} onChange={setAsset} options={(["HYPE", "USDC"] as const).map((value) => ({ value, label: value }))} />
          <SegmentedControl
            label="Layer"
            fullWidth
            value={where}
            onChange={setWhere}
            options={[
              { value: "elysium", label: "Summit" },
              { value: "hyperevm", label: "Ridge" },
            ]}
          />
        </div>
        <NumberField label={`Amount · ${asset}`} value={amount} onChange={setAmount} decimals={asset === "HYPE" ? 18 : 6} unit={asset} placeholder={asset === "HYPE" ? "0.5" : "10"} />
      </div>
      {sentence ? <SentenceRoute key={sentence} sentence={sentence} account={account} /> : null}
    </div>
  );
}
