import { Check, KeyRound, LoaderCircle, Lock, ShieldCheck, Wallet } from "lucide-react";
import { useState } from "react";
import { useAccount } from "wagmi";

import { Button } from "../../ui/Button";
import { cx } from "../../ui/cx";
import { Dialog } from "../../ui/Dialog";
import { SegmentedControl } from "../../ui/SegmentedControl";
import { DEFAULT_EXPIRY_DAYS, EXPIRY_CHOICES, WEB_AGENT_NAME, type ExpiryDays } from "./approve";
import type { AgentKeyApi, EnableStep } from "./useAgentKey";

const STEPS: readonly { readonly id: Exclude<EnableStep, "idle" | "done" | "error">; readonly label: string }[] = [
  { id: "generate", label: "Create a fresh key in this browser" },
  { id: "sign", label: "Approve it with your wallet (one signature)" },
  { id: "submit", label: "Send the approval to HyperCore" },
  { id: "verify", label: "Confirm HyperCore lists the key" },
];

const ORDER: readonly EnableStep[] = ["idle", "generate", "sign", "submit", "verify", "done"];

function chainLabel(chainId: number | undefined): string {
  if (chainId === 99801) return "Elysium testnet (99801)";
  if (chainId === 998) return "HyperEVM testnet (998)";
  if (chainId === 99901) return "Elysium (99901)";
  if (chainId === 999) return "HyperEVM (999)";
  return chainId ? `chain ${chainId}` : "your wallet's network";
}

export interface EnableTradingDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly api: AgentKeyApi;
  readonly hyperliquidChain: "Mainnet" | "Testnet";
}

/**
 * "Enable trading": a fresh trade-only key, approved once by the user's
 * wallet (approveAgent, user-signed in the wallet's own chain domain),
 * encrypted at rest in this browser.
 */
export function EnableTradingDialog({ open, onClose, api, hyperliquidChain }: EnableTradingDialogProps) {
  const [days, setDays] = useState<ExpiryDays>(DEFAULT_EXPIRY_DAYS);
  const { chainId } = useAccount();
  const step = api.progress.step;
  const busy = step === "generate" || step === "sign" || step === "submit" || step === "verify";
  const close = () => {
    if (busy) return;
    if (step === "done" || step === "error") api.resetProgress();
    onClose();
  };
  const reached = ORDER.indexOf(step);
  return (
    <Dialog
      open={open}
      onClose={close}
      title="Enable trading"
      description={`A trade-only key for HyperCore ${hyperliquidChain.toLowerCase()}, kept in this browser. Your wallet signs once.`}
      footer={
        step === "done" ? (
          <Button variant="primary" onClick={close} leftIcon={<Check className="h-4 w-4" aria-hidden="true" />}>
            Start trading
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={close} disabled={busy}>
              Cancel
            </Button>
            <Button variant="gold" loading={busy} onClick={() => void api.enable(days)} leftIcon={<Wallet className="h-4 w-4" aria-hidden="true" />}>
              {step === "error" ? "Try again" : "Approve in wallet"}
            </Button>
          </>
        )
      }
    >
      <div className="flex flex-col gap-5">
        <ul className="flex flex-col gap-3 text-sm leading-relaxed text-text-1">
          <li className="flex gap-3">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-mint" aria-hidden="true" />
            <span>
              <b className="font-medium text-text-0">Trade-only.</b> It can place, change and cancel orders and set leverage. HyperCore itself forbids agent keys to withdraw or transfer your funds.
            </span>
          </li>
          <li className="flex gap-3">
            <Lock className="mt-0.5 h-5 w-5 shrink-0 text-violet-soft" aria-hidden="true" />
            <span>
              <b className="font-medium text-text-0">Never leaves this browser.</b> It is encrypted with a key your browser can use but never export (WebCrypto, stored in IndexedDB). Elyia’s servers never see it.
            </span>
          </li>
          <li className="flex gap-3">
            <KeyRound className="mt-0.5 h-5 w-5 shrink-0 text-gold" aria-hidden="true" />
            <span>
              <b className="font-medium text-text-0">On your terms.</b> Every signature passes your Rule Book first. Lock it, or revoke it with one wallet signature, any time.
            </span>
          </li>
        </ul>

        <div className="flex flex-col gap-2">
          <p className="label-caps">Expires after</p>
          <SegmentedControl<string>
            label="Key expiry"
            value={String(days)}
            onChange={(value) => setDays(Number(value) as ExpiryDays)}
            fullWidth
            options={EXPIRY_CHOICES.map((choice) => ({ value: String(choice), label: `${choice} days`, disabled: busy }))}
          />
          <p className="font-mono text-xs text-text-2">
            HyperCore name: {WEB_AGENT_NAME} valid_until &lt;{days} days from now&gt; · your wallet signs on {chainLabel(chainId)}, which HyperCore accepts.
          </p>
        </div>

        {step !== "idle" && step !== "error" ? (
          <ol className="flex flex-col gap-2 rounded-2xl border border-line bg-bg-2/40 p-3">
            {STEPS.map((item) => {
              const index = ORDER.indexOf(item.id);
              const state = index < reached || step === "done" ? "done" : index === reached ? "active" : "todo";
              return (
                <li key={item.id} className="flex items-center gap-2.5 text-sm">
                  <span
                    aria-hidden="true"
                    className={cx(
                      "flex h-5 w-5 items-center justify-center rounded-full border",
                      state === "done" ? "border-mint/50 bg-mint/15 text-mint" : state === "active" ? "border-gold/50 text-gold" : "border-line-strong text-text-2",
                    )}
                  >
                    {state === "done" ? <Check className="h-3 w-3" /> : state === "active" ? <LoaderCircle className="h-3 w-3 animate-spin" /> : null}
                  </span>
                  <span className={state === "todo" ? "text-text-2" : "text-text-0"}>{item.label}</span>
                </li>
              );
            })}
          </ol>
        ) : null}

        {api.progress.error ? (
          <p role="alert" className={cx("rounded-xl border px-3 py-2 text-sm", step === "error" ? "border-rose/40 bg-rose/[0.08] text-rose" : "border-gold/40 bg-gold/[0.08] text-gold")}>
            {api.progress.error}
          </p>
        ) : null}
        <p className="text-xs leading-relaxed text-text-2">One elyia-web key per account: enabling trading on another device replaces the key here (HyperCore keeps one agent per name). Your other agents, such as the Hyperliquid app’s, are untouched.</p>
      </div>
    </Dialog>
  );
}
