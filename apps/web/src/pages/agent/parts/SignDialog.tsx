import { useMemo, useState } from "react";

import { WalletButton } from "../../../app/shell/WalletButton";
import type { SubmitResult, TradePlan } from "../../../features/trading/executor";
import { guardLines } from "../../../features/trading/guard";
import { Ely } from "../../../pixel/Ely";
import { PixelRope } from "../../../pixel/PixelRope";
import { PixelStamp } from "../../../pixel/PixelStamp";
import { Button } from "../../../ui/Button";
import { cx } from "../../../ui/cx";
import { Dialog } from "../../../ui/Dialog";
import { px, type Proposal } from "../guide/planner";
import type { GuideSigner } from "../guide/useGuideSigner";

const VERDICT = {
  allow: { stamp: "CHECKED", state: "signed", text: "text-up", tone: "px-tone-up", head: "Passes your Rule Book." },
  confirm: { stamp: "CONFIRM", state: "queued", text: "text-warn-ink", tone: "px-tone-signal", head: "Your Rule Book asks you to confirm this." },
  deny: { stamp: "BLOCKED", state: "refused", text: "text-down", tone: "px-tone-down", head: "Your Rule Book blocks this." },
} as const;

const ACCESS_COPY = {
  sample: "This is the sample range, so there is nothing of yours to sign. Connect a wallet (or watch your own address) and the Guide reads your ropes.",
  connect: "Connect the wallet that owns this range. Your wallet key never leaves it; orders are signed by a separate trade-only key.",
  watching: "You are watching someone else's range: read only. Nothing here can move its money.",
  enable: "Enable trading first: a fresh trade-only key for this browser, approved once by your wallet. It can place and cancel orders, never withdraw.",
  unlock: "Your trading key is locked on this device. Unlock it to sign.",
  ready: "",
} as const;

export interface SignDialogProps {
  readonly open: boolean;
  readonly proposal: Proposal | null;
  readonly signer: GuideSigner;
  readonly onClose: () => void;
  readonly onEnable: () => void;
  readonly onUnlock: () => Promise<void>;
  readonly onResult: (result: SubmitResult, plan: TradePlan) => void;
}

function describeLeg(leg: NonNullable<TradePlan["legs"]>[number], coin: string): string {
  const side = leg.isBuy ? "Buy" : "Sell";
  if (leg.triggerPx) return `Stop: ${side.toLowerCase()} ${leg.sz} ${coin} if the mark crosses ${leg.triggerPx} · at market · reduce-only`;
  return `${side} ${leg.sz} ${coin} up to ${leg.px} · IOC${leg.reduceOnly ? " · reduce-only" : ""}`;
}

/**
 * The review step for a Guide proposal: exactly what the trade-only key
 * will sign, the Rule Book's verdict, and the one button. Without a wallet,
 * a key or an unlocked key it says what is missing and how to fix it.
 */
export function SignDialog({ open, proposal, signer, onClose, onEnable, onUnlock, onResult }: SignDialogProps) {
  const built = useMemo(() => (proposal ? signer.build(proposal) : null), [proposal, signer]);
  const plan = built?.plan ?? null;
  const verdict = plan && signer.access === "ready" ? signer.verdict(plan) : null;
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unlocking, setUnlocking] = useState(false);
  const close = () => {
    if (sending) return;
    setError(null);
    onClose();
  };
  const send = async () => {
    if (!plan) return;
    setSending(true);
    setError(null);
    const result = await signer.sign(plan, true);
    setSending(false);
    onResult(result, plan);
    if (result.ok) onClose();
    else if (result.kind !== "confirm") setError(result.message);
  };
  const title = plan?.label ?? (proposal?.kind === "anchor" ? `Anchor ${proposal.coin}` : proposal?.kind === "halve" ? `Halve ${proposal.coin}` : "Review");
  const coin = proposal && "coin" in proposal ? proposal.coin : "";
  const tone = verdict ? VERDICT[verdict.decision] : null;

  return (
    <Dialog open={open} onClose={close} title={title} description="Ely proposes; you sign. Check it, then the trade-only key signs it in this browser." size="md">
      <div className="flex flex-col gap-5">
        <div className="flex items-center gap-4 bg-paper-2 px-3 py-3 px-frame-thin">
          <Ely state={verdict?.decision === "deny" || verdict?.decision === "confirm" ? "worry" : signer.access === "ready" ? "talk" : "idle"} size={88} label={null} className="shrink-0" />
          <p className="min-w-0 font-mono text-[13px] leading-snug text-ink-2">
            <span className="block font-tag text-[11px] uppercase text-ink">Ely · read it back</span>
            {verdict?.decision === "deny" ? "Your own rules stop this one. Nothing signs." : verdict?.decision === "confirm" ? "Your rules want a second look. Check the legs, then confirm." : signer.access === "ready" ? "Exactly this, and nothing else, is what your trade-only key signs." : "I drafted it. A signature needs your key first."}
          </p>
        </div>
        {proposal?.kind === "anchor" ? (
          <div className="bg-card px-3 pb-2 pt-4 px-frame-thin" aria-label="The rope with the new anchor">
            <PixelRope variant="full" symbol={proposal.coin} side={proposal.side} entry={proposal.entry} mark={proposal.mark} liquidation={proposal.liquidation} stop={proposal.stop} takeProfit={proposal.takeProfit} formatPrice={px} />
          </div>
        ) : null}
        {plan?.legs ? (
          <ol className="flex flex-col gap-3">
            {plan.legs.map((leg, index) => (
              <li key={leg.cloid || index} className="flex gap-3 bg-card px-3 py-2 font-mono text-[13px] text-ink px-frame-thin">
                <span className="tnum font-tag text-[11px] text-ink-3">{String(index + 1).padStart(2, "0")}</span>
                <span className="min-w-0">{describeLeg(leg, coin)}</span>
              </li>
            ))}
          </ol>
        ) : null}
        {built?.problem ? <p className="bg-paper-2 px-3 py-2 text-sm text-ink-2 px-frame-thin px-tone-signal">{built.problem}</p> : null}
        {signer.access !== "ready" ? <p className="bg-paper-2 px-3 py-2.5 text-[14px] leading-snug text-ink-2 px-frame-thin">{ACCESS_COPY[signer.access]}</p> : null}
        {tone && verdict ? (
          <div role="status" className={cx("flex items-start gap-4 bg-card px-3 py-3 text-[13px] leading-snug px-frame-thin", tone.tone)}>
            <PixelStamp state={tone.state} text={tone.stamp} size="sm" label={null} className="mt-1 shrink-0" />
            <div className="min-w-0">
              <p className={cx("font-medium", tone.text)}>{tone.head}</p>
              <ul className="mt-0.5 flex flex-col gap-0.5 text-ink-2">
                {guardLines(verdict.reasons)
                  .slice(0, 3)
                  .map((line) => (
                    <li key={line.text}>{line.text}</li>
                  ))}
                {verdict.reasons.length === 0 ? <li className="font-mono text-[11px] text-ink-3">{verdict.passed} checks passed · reduce-only always runs, even under the kill switch</li> : null}
              </ul>
            </div>
          </div>
        ) : null}
        {error ? (
          <p role="alert" className="bg-card px-3 py-2 text-sm text-down px-frame-thin px-tone-down">
            {error}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center justify-end gap-x-6 gap-y-4 pt-1">
          <Button variant="ghost" onClick={close} disabled={sending}>
            Not now
          </Button>
          {signer.access === "connect" || signer.access === "sample" ? <WalletButton /> : null}
          {signer.access === "enable" ? (
            <Button variant="primary" onClick={onEnable}>
              Enable trading
            </Button>
          ) : null}
          {signer.access === "unlock" ? (
            <Button
              variant="primary"
              loading={unlocking}
              onClick={() => {
                setUnlocking(true);
                void onUnlock().finally(() => setUnlocking(false));
              }}
            >
              Unlock the key
            </Button>
          ) : null}
          {signer.access === "ready" ? (
            <Button variant="primary" loading={sending} disabled={!plan || verdict?.decision === "deny"} onClick={() => void send()} autoFocus>
              {verdict?.decision === "confirm" ? "Confirm & sign" : "Sign with trading key"}
            </Button>
          ) : null}
        </div>
      </div>
    </Dialog>
  );
}
