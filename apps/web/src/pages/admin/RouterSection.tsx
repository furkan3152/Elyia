import { useState } from "react";
import type { Abi, Address } from "viem";
import { useAccount, usePublicClient, useSwitchChain, useWriteContract } from "wagmi";

import { sameAddress } from "../../features/session";
import { describeError } from "../../lib/api";
import { Button } from "../../ui/Button";
import { cx } from "../../ui/cx";
import { toast } from "../../ui/toast";
import { Card, CardHead, KV, Pill, SectionHead } from "../developers/portal/ui";
import { useInvalidateAdmin, useRouterSettings } from "./adminApi";
import { KillSwitch } from "./AdminCanvases";
import { NETWORK_OPTIONS, shortHex, type AdminNetwork } from "./deployModel";
import { clampFee, confirmPhrase, phraseMatches, protocolFeeCap, readBool, setProtocolFeeData } from "./routerModel";
import { ARTIFACTS } from "./useDeploy";

const ABI = ARTIFACTS.ElyiaRouter.abi as Abi;

type TxState = { readonly state: "idle" } | { readonly state: "wallet" } | { readonly state: "pending"; readonly hash: string } | { readonly state: "done"; readonly hash: string } | { readonly state: "failed"; readonly error: string };

function useOwnerWrite(network: AdminNetwork) {
  const option = NETWORK_OPTIONS.find((entry) => entry.key === network)!;
  const { chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const client = usePublicClient({ chainId: option.chainId });
  const invalidate = useInvalidateAdmin();
  const [tx, setTx] = useState<TxState>({ state: "idle" });
  const send = async (address: string, functionName: "setProtocolFee" | "pause" | "unpause", args: readonly unknown[]) => {
    setTx({ state: "wallet" });
    try {
      if (chainId !== option.chainId) await switchChainAsync({ chainId: option.chainId });
      const hash = await writeContractAsync({ chainId: option.chainId, address: address as Address, abi: ABI, functionName, args: args as never });
      setTx({ state: "pending", hash });
      const receipt = await client?.waitForTransactionReceipt({ hash, timeout: 180_000 });
      if (receipt && receipt.status !== "success") throw new Error("The transaction reverted.");
      setTx({ state: "done", hash });
      invalidate();
      toast.success(`${functionName} confirmed`, { description: `tx ${shortHex(hash, 6, 4)}` });
    } catch (error) {
      const text = describeError(error);
      setTx({ state: "failed", error: /reject|denied/iu.test(text) ? "Rejected in your wallet. Nothing was sent." : text.split("\n")[0]!.slice(0, 200) });
    }
  };
  return { tx, send, reset: () => setTx({ state: "idle" }) } as const;
}

function TxLine({ tx }: { readonly tx: TxState }) {
  if (tx.state === "idle") return null;
  const text = tx.state === "wallet" ? "Check your wallet…" : tx.state === "pending" ? `Sent · waiting for a block (${shortHex(tx.hash, 6, 4)})` : tx.state === "done" ? `Confirmed · ${shortHex(tx.hash, 6, 4)}` : tx.error;
  return (
    <p role="status" className={cx("text-[12px]", tx.state === "failed" ? "text-down" : tx.state === "done" ? "text-up" : "text-ink-2")}>
      {text}
    </p>
  );
}

export function RouterSection({ network, routerAddress }: { readonly network: AdminNetwork; readonly routerAddress: string | null }) {
  const option = NETWORK_OPTIONS.find((entry) => entry.key === network)!;
  const settings = useRouterSettings(network, option.enabled);
  const { address: wallet } = useAccount();
  const reads = settings.data?.reads;
  const cap = protocolFeeCap(reads);
  const current = reads?.protocolFeeBps ? Number(reads.protocolFeeBps) : 0;
  const [draft, setDraft] = useState<number | null>(null);
  const fee = draft ?? current;
  // Owner (and other set-later state) only exists on a recorded router; before that the API leaves it out (`unset`).
  const recorded = settings.data ? settings.data.recorded !== false && settings.data.source !== "artifact-defaults" : Boolean(routerAddress);
  const owner = recorded ? (reads?.owner ?? null) : null;
  const recipientRead = reads?.feeRecipient && !/^0x0{40}$/iu.test(reads.feeRecipient) ? reads.feeRecipient : null;
  const recipient = recipientRead ?? wallet ?? null;
  const paused = routerAddress ? (settings.data?.paused ?? readBool(reads?.paused)) : null;
  const notOwner = Boolean(routerAddress && owner && wallet && !sameAddress(owner, wallet));
  const feeWrite = useOwnerWrite(network);
  const pauseWrite = useOwnerWrite(network);
  const [prepared, setPrepared] = useState<string | null>(null);
  const [typing, setTyping] = useState<string | null>(null);
  const action = paused ? "unpause" : "pause";
  const phrase = confirmPhrase(action, option.chainId);
  const disabledReason = !routerAddress ? "Deploy and record ElyiaRouter first." : notOwner ? `This wallet is not the router owner (${shortHex(owner)}); the call would revert.` : !wallet ? "Connect the owner wallet." : null;

  return (
    <section id="router" aria-labelledby="router-title" className="mt-14 scroll-mt-28 border-t-2 border-dashed border-rule pt-14">
      <SectionHead id="router-title" tag={`ElyiaRouter · ${option.chainId}`} title="Fee and pause." lede={routerAddress && recorded ? `Live reads from ${shortHex(routerAddress)}. Every change is a transaction your wallet signs.` : (settings.data?.note ?? "No ElyiaRouter is recorded on this network: deploy it from Contracts first. Values below are the artifact's constants, and nothing can be signed.")} />
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <Card className="flex flex-col gap-3.5">
          <CardHead glyph="percent" title="Protocol fee" right={<Pill tone="mute">owner tx</Pill>} />
          <div className="text-center">
            <span className="font-display text-[56px] font-bold leading-none text-ink tnum">{fee}</span>
            <span className="font-display text-[20px] text-ink"> bps</span>
            <div className="mt-1 font-tag text-[10px] uppercase tracking-[0.06em] text-ink-3">
              on-chain cap {cap} · now {current}
            </div>
          </div>
          <input
            type="range"
            className="portal-range"
            min={0}
            max={cap}
            value={fee}
            onChange={(event) => {
              setDraft(clampFee(Number(event.target.value), cap));
              setPrepared(null);
              feeWrite.reset();
            }}
            aria-label="Protocol fee in basis points"
            aria-valuetext={`${fee} basis points of ${cap} maximum`}
          />
          <KV
            rows={[
              ["Recipient", <span key="r" className="font-mono">{recipient ? shortHex(recipient) : "—"}{recipientRead ? "" : " (your wallet)"}</span>],
              ["Applies to", "new routes only · shown on every card"],
              ["Owner", owner && routerAddress ? <span key="o" className="font-mono">{shortHex(owner)}</span> : <span key="o" className="text-ink-3">no router recorded</span>],
            ]}
          />
          {prepared ? (
            <div className="bg-paper p-3 px-frame-thin">
              <div className="mb-1 font-tag text-[10px] uppercase text-ink-3">Prepared · calldata to {shortHex(routerAddress)}</div>
              <code className="block break-all font-mono text-[11px] text-ink-2">{prepared}</code>
            </div>
          ) : null}
          <TxLine tx={feeWrite.tx} />
          {prepared && routerAddress && recipient && feeWrite.tx.state !== "done" ? (
            <Button variant="primary" className="mt-auto portal-pulse" loading={feeWrite.tx.state === "wallet" || feeWrite.tx.state === "pending"} onClick={() => void feeWrite.send(routerAddress, "setProtocolFee", [fee, recipient])}>
              Sign setProtocolFee({fee}) in wallet
            </Button>
          ) : (
            <Button variant="primary" className="mt-auto" disabled={Boolean(disabledReason) || !recipient || fee === current} onClick={() => setPrepared(setProtocolFeeData(ABI, fee, recipient!))}>
              Prepare setProtocolFee({fee})
            </Button>
          )}
          {disabledReason ? <p className="text-[11.5px] text-ink-3">{disabledReason}</p> : null}
        </Card>
        <Card id="pause" className="flex scroll-mt-28 flex-col items-center gap-3 text-center">
          <div className="w-full">
            <CardHead glyph="pause" title="Kill switch" right={paused === null ? <Pill tone="mute">not deployed</Pill> : paused ? <Pill tone="dn" dot>Paused</Pill> : <Pill tone="up" dot>Running</Pill>} />
          </div>
          <KillSwitch paused={paused} label={`Router pause switch under a safety cover; router is ${paused === null ? "not deployed" : paused ? "paused" : "running"}`} />
          <p className="max-w-[380px] text-[12.5px] text-ink-2">
            {paused ? "Paused: new swaps through ElyiaRouter are refused. Resume when it is safe." : `Pausing stops new swaps through ElyiaRouter on ${option.chainId}. The router never holds funds between transactions, so nothing is stuck.`}
          </p>
          {typing === null ? (
            <Button variant={paused ? "primary" : "danger"} disabled={Boolean(disabledReason) || paused === null} onClick={() => setTyping("")}>
              {paused ? "Resume router…" : "Pause router…"}
            </Button>
          ) : (
            <form
              className="flex w-full max-w-[360px] flex-col gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (phraseMatches(typing, phrase) && routerAddress) void pauseWrite.send(routerAddress, action, []).then(() => setTyping(null));
              }}
            >
              <label htmlFor="kill-confirm" className="font-tag text-[10px] uppercase text-ink-2">
                Type {phrase} to confirm
              </label>
              <input id="kill-confirm" autoComplete="off" value={typing} onChange={(event) => setTyping(event.target.value)} className="h-10 bg-paper px-3 text-center font-mono text-[13px] uppercase text-ink outline-none px-frame-thin focus-visible:outline-dashed focus-visible:outline-4 focus-visible:outline-offset-[4px] focus-visible:outline-signal" />
              <div className="flex gap-2">
                <Button variant="ink" fullWidth onClick={() => setTyping(null)}>
                  Cancel
                </Button>
                <Button variant={paused ? "primary" : "danger"} fullWidth type="submit" disabled={!phraseMatches(typing, phrase)} loading={pauseWrite.tx.state === "wallet" || pauseWrite.tx.state === "pending"}>
                  {paused ? "Sign resume" : "Sign pause"}
                </Button>
              </div>
            </form>
          )}
          <TxLine tx={pauseWrite.tx} />
          <span className="mt-auto font-tag text-[9.5px] uppercase text-ink-3">type {phrase} to confirm · your wallet signs</span>
        </Card>
      </div>
      {settings.isError ? <p className="mt-3 text-center text-[12px] text-down">Router reads did not load: {describeError(settings.error)}</p> : null}
    </section>
  );
}
