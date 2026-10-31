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
import { ARB_RETRYABLE_TX_ABI } from "./flow/abis";
import { ARB_RETRYABLE_TX } from "./flow/orbit";
import { formatEta, layerOf, shortRouteId } from "./flow/routeModel";
import { traceHash, traceMoving, type Trace } from "./flow/trace";
import { explainRunError } from "./flow/useFlowRun";
import { traceRoute } from "./traceRoute";
import { HashMark, TraceScene } from "./TraceScene";
import { stationsOf } from "./traceTrail";

/** Gas paid, in HYPE ("<0.001 HYPE" for the usual Elysium dust). */
function gasText(gasUsed: bigint, price: bigint | undefined): string {
  if (!gasUsed || !price) return "—";
  const hype = Number(gasUsed * price) / 1e18;
  return hype < 0.001 ? "<0.001 HYPE" : `${hype.toFixed(4)} HYPE`;
}

function short(hash: string): string {
  return `${hash.slice(0, 10)}…${hash.slice(-6)}`;
}

/** The trace's head, centred: the hash's pixel fingerprint, the headline, one line of detail. */
export function TraceHead({ hash, title, detail, kicker }: { readonly hash: string; readonly title: string; readonly detail?: string; readonly kicker?: string }) {
  return (
    <div className="mx-auto flex max-w-[760px] flex-col items-center gap-3 text-center">
      <HashMark hash={hash} />
      <p className="caption">{kicker ?? `Trace · ${short(hash)} · read from chain`}</p>
      <h2 className="font-display text-[34px] font-bold leading-none text-ink">{title}</h2>
      {detail ? <p className="text-[15px] leading-relaxed text-ink-2 text-pretty">{detail}</p> : null}
    </div>
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
      <div className="flex flex-col gap-6" aria-busy="true">
        <TraceScene stations={[]} idleText="READING THE CHAIN" idleMood="climb" caption={[`◆ ${short(hash)}`, "Elysium and HyperEVM", "tracing…"]} label={`Tracing ${short(hash)} on Elysium and HyperEVM`} />
        {trace.error ? (
          <p className="text-center text-sm text-down" role="alert">
            {explainRunError(trace.error)}
          </p>
        ) : null}
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
      <div className="flex flex-col gap-8" role="status">
        <TraceScene stations={[]} idleText="NOT ON THE MAP YET" caption={[`◆ ${short(hash)}`, "searched Elysium and HyperEVM", "no receipt"]} label={`${view.headline}: ${view.detail}`} />
        <TraceHead hash={hash} title={view.headline} detail={view.detail} />
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
  const stations = stationsOf(view.stages.length > 0 ? view.stages : [{ label: view.steps[0]?.layer === "summit" ? "On the Summit" : "HyperEVM", state: view.steps[0]?.state === "failed" ? "alert" : "done" }], layerOf(trace.data.found.network));
  const open = view.claimableAt ? now / 1000 >= view.claimableAt : false;
  return (
    <div className="flex flex-col gap-10">
      <TraceScene
        stations={stations}
        idleText=""
        caption={[`◆ ${short(hash)}`, `${trace.data.kind === "ascent" ? "ascent" : trace.data.kind === "descent" ? "descent" : trace.data.kind === "ticket" ? "retryable ticket" : "one layer"} · read from chain`, view.claimableAt ? (open ? "claim open" : `claim in ${formatEta(view.claimableAt - now / 1000)}`) : "following live"]}
        label={`Trace of ${short(hash)} across the layers: ${stations.map((station, index) => `${index + 1} ${station.label} on the ${station.layer}, ${station.state}`).join("; ")}`}
      />
      <TraceHead hash={hash} title={view.headline} detail={view.detail} />
      <RouteCard
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
