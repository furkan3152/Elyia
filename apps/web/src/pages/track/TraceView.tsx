import { explorerTxUrl, getEvmNetwork, layersFor, NETWORKS, type NetworkKey } from "@elyia/core/networks";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { encodeFunctionData, type Hex, type PublicClient } from "viem";
import { useAccount, useConfig } from "wagmi";
import { getAccount, getPublicClient, sendTransaction, switchChain, waitForTransactionReceipt } from "wagmi/actions";

import { useUiStore } from "../../app/state/uiStore";
import { useNow } from "../../hooks/useNow";
import { RouteCard, type RouteEvidence } from "../../topo/RouteCard";
import { Button } from "../../ui/Button";
import { cx } from "../../ui/cx";
import { Skeleton } from "../../ui/Skeleton";
import { ARB_RETRYABLE_TX_ABI } from "./flow/abis";
import { ARB_RETRYABLE_TX } from "./flow/orbit";
import { formatEta, shortRouteId } from "./flow/routeModel";
import { traceHash, traceMoving, type Trace } from "./flow/trace";
import { explainRunError } from "./flow/useFlowRun";
import { traceRoute, type Stage } from "./traceRoute";

/** Gas paid, in HYPE ("<0.001 HYPE" for the usual Elysium dust). */
function gasText(gasUsed: bigint, price: bigint | undefined): string {
  if (!gasUsed || !price) return "—";
  const hype = Number(gasUsed * price) / 1e18;
  return hype < 0.001 ? "<0.001 HYPE" : `${hype.toFixed(4)} HYPE`;
}

function short(hash: string): string {
  return `${hash.slice(0, 10)}…${hash.slice(-6)}`;
}

/** The ticket-watch strip: stages as stations, the current one inked. */
export function StageStrip({ stages, className }: { readonly stages: readonly Stage[]; readonly className?: string }) {
  if (stages.length === 0) return null;
  return (
    <ol className={cx("flex flex-wrap items-center gap-x-1.5 gap-y-2", className)} aria-label="Stages">
      {stages.map((stage, index) => (
        <li key={stage.label} className="flex items-center gap-1.5">
          <span
            className={cx(
              "border-2 px-2.5 py-1 font-mono text-[11px] font-semibold uppercase tracking-[0.1em]",
              stage.state === "done" && "border-rule bg-ink text-paper",
              stage.state === "now" && "border-rule bg-signal text-signal-ink shadow-hard-sm",
              stage.state === "alert" && "border-down bg-card text-down shadow-hard-sm",
              stage.state === "todo" && "border-dashed border-rule/60 bg-card text-ink-3",
            )}
          >
            {stage.state === "done" ? "✓ " : stage.state === "alert" ? "! " : ""}
            {stage.label}
            <span className="sr-only"> ({stage.state})</span>
          </span>
          {index < stages.length - 1 ? <span aria-hidden="true" className="font-mono text-ink-3">→</span> : null}
        </li>
      ))}
    </ol>
  );
}

function evidenceOf(trace: Trace): RouteEvidence[] {
  if (trace.kind === "not-found") return [];
  const out: RouteEvidence[] = [];
  const link = (network: NetworkKey, hash: string) => {
    const url = explorerTxUrl(network, hash);
    return url ? (
      <a href={url} target="_blank" rel="noreferrer" className="underline decoration-dotted underline-offset-2 hover:text-accent">
        {short(hash)}
      </a>
    ) : (
      short(hash)
    );
  };
  out.push({ step: "W1", proven: trace.found.receipt.status === "success", text: <>receipt on {NETWORKS[trace.found.network].shortName} · status {trace.found.receipt.status === "success" ? "1" : "0"} · {link(trace.found.network, trace.found.receipt.transactionHash)}</> });
  if (trace.kind === "ascent") {
    out.push({ step: "W2", proven: trace.landed !== null, text: <>{trace.child.kind === "deposit" ? "kind-12 id computed from the inbox message" : "ticket id computed from the inbox message"} · {link(trace.landed?.network ?? trace.found.network, trace.child.id)}{trace.landed ? " · landed" : " · not landed yet"}</> });
  }
  if (trace.kind === "descent") out.push({ step: "W2", proven: false, text: <>L2ToL1Tx position {trace.position.toString()} · to {short(trace.destination)}</> });
  return out;
}

/**
 * One transaction followed across the layers, read from the public RPCs:
 * the route card of what it did, a ticket-watch strip, and the one action
 * it may need (redeem a stalled retryable ticket, by an explicit click).
 */
export function TraceView({ hash }: { readonly hash: Hex }) {
  const config = useConfig();
  const mode = useUiStore((state) => state.mode);
  const { isConnected } = useAccount();
  const now = useNow(1000);
  const [redeeming, setRedeeming] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const clientFor = (network: NetworkKey) => {
    const chain = NETWORKS[network];
    return chain.vm === "evm" ? (getPublicClient(config, { chainId: chain.chainId as never }) as PublicClient | undefined) : undefined;
  };
  const trace = useQuery({
    queryKey: ["trace", mode, hash],
    queryFn: () => traceHash(hash, mode, clientFor),
    refetchInterval: (query) => (query.state.data && !traceMoving(query.state.data, Math.floor(Date.now() / 1000)) ? false : 4_000),
    retry: 1,
  });

  if (!trace.data) {
    return (
      <div className="border-2 border-rule bg-card p-5 shadow-hard-lg" aria-busy="true">
        <p className="caption">Tracing {short(hash)} · Elysium and HyperEVM</p>
        <Skeleton className="mt-4 h-48 w-full" />
        {trace.error ? <p className="mt-3 text-sm text-down">{explainRunError(trace.error)}</p> : null}
      </div>
    );
  }
  const view = traceRoute(trace.data, Math.floor(now / 1000));
  const redeem = async () => {
    if (!view.ticketId) return;
    setRedeeming(true);
    setMessage(null);
    try {
      const elysium = getEvmNetwork(layersFor(mode).elysium.key);
      const account = getAccount(config);
      if (!account.address) throw new Error("Connect a wallet first.");
      if (account.chainId !== elysium.chainId) await switchChain(config, { chainId: elysium.chainId as never });
      const sent = await sendTransaction(config, { account: account.address, chainId: elysium.chainId as never, to: ARB_RETRYABLE_TX, data: encodeFunctionData({ abi: ARB_RETRYABLE_TX_ABI, functionName: "redeem", args: [view.ticketId] }) });
      setMessage(`Redeem sent: ${short(sent)}. Waiting for Elysium…`);
      await waitForTransactionReceipt(config, { hash: sent, chainId: elysium.chainId as never });
      setMessage("Redeemed. The ticket is gone and the tokens are on the Summit.");
      void trace.refetch();
    } catch (error) {
      setMessage(explainRunError(error));
    } finally {
      setRedeeming(false);
    }
  };

  if (trace.data.kind === "not-found") {
    return (
      <div className="border-2 border-rule bg-card p-5 shadow-hard-lg" role="status">
        <p className="caption">Trace · {short(hash)}</p>
        <h2 className="mt-2 text-[28px] font-bold tracking-[-0.02em] text-ink">{view.headline}</h2>
        <p className="mt-1.5 max-w-2xl text-[15px] text-ink-2">{view.detail}</p>
      </div>
    );
  }
  const action =
    view.action === "redeem" ? (
      isConnected ? (
        <Button variant="primary" size="lg" fullWidth loading={redeeming} onClick={() => void redeem()}>
          Redeem the ticket
        </Button>
      ) : (
        <ConnectButton.Custom>
          {({ openConnectModal }) => (
            <Button variant="primary" size="lg" fullWidth onClick={openConnectModal}>
              Connect to redeem
            </Button>
          )}
        </ConnectButton.Custom>
      )
    ) : null;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="caption">Trace · {short(hash)} · read from chain</p>
          <h2 className="mt-1.5 text-[32px] font-bold leading-tight tracking-[-0.02em] text-ink">{view.headline}</h2>
          <p className="mt-1 max-w-2xl text-[15px] leading-snug text-ink-2">{view.detail}</p>
        </div>
        {view.claimableAt ? (
          <p className="tnum border-2 border-rule bg-card px-3 py-2 font-mono text-sm text-ink shadow-hard">
            claim {now / 1000 >= view.claimableAt ? "open" : `in ${formatEta(view.claimableAt - now / 1000)}`}
          </p>
        ) : null}
      </div>
      <StageStrip stages={view.stages} />
      <RouteCard
        className="grid-cols-[minmax(0,1fr)]"
        id={shortRouteId(hash)}
        sentence={`track ${short(hash)}`}
        grade={1}
        steps={view.steps}
        fees={gasText(trace.data.found.receipt.gasUsed, trace.data.found.receipt.effectiveGasPrice)}
        signatures={{ done: 1, needed: view.action === "redeem" ? 2 : 1, note: view.action === "redeem" ? "redeem" : undefined }}
        rules={["checked, not trusted", "receipts from public RPCs", trace.data.kind === "ascent" ? "id computed from the inbox message" : "logs decoded locally"]}
        evidence={evidenceOf(trace.data)}
        action={action}
        note={message ?? (view.action === "redeem" ? "One transaction on Elysium. Nothing signs until you press it." : trace.data.kind === "descent" ? "The claim needs the outbox proof the Elyia planner builds: claim from the journey that planned it." : "Following live; this page updates itself.")}
      />
    </div>
  );
}
