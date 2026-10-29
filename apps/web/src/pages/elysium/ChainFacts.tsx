import { ELYSIUM_RETRYABLE_LIFETIME_SECONDS, NETWORKS, type NetworkKey } from "@elyia/core/networks";

import { formatDuration } from "../../lib/format";
import { AddressPill } from "../../ui/AddressPill";
import { NetworkBadge } from "../../ui/NetworkBadge";

const elysium = NETWORKS["elysium-testnet"];
const bridge = elysium.vm === "evm" ? elysium.elysiumBridge : null;

const FACTS: ReadonlyArray<readonly [string, string]> = [
  ["Chain id", "99801 (0x185d9)"],
  ["Stack", "Arbitrum Orbit · ArbOS 61"],
  ["Settles to", "HyperEVM testnet (998)"],
  ["Data availability", "AnyTrust committee"],
  ["Gas token", "HYPE (native, 18 decimals)"],
  ["Base fee floor", "0.1 gwei"],
  ["Block gas limit", "32M"],
  ["Retryable lifetime", formatDuration(ELYSIUM_RETRYABLE_LIFETIME_SECONDS)],
  ["Confirm period", bridge?.confirmPeriodBlocks ? `${bridge.confirmPeriodBlocks} HyperEVM blocks` : "read on-chain"],
];

interface Contract {
  readonly label: string;
  readonly address: string;
  readonly network: NetworkKey;
}

function contracts(): Contract[] {
  if (!bridge) return [];
  const out: Contract[] = [];
  const add = (label: string, address: string | null, network: NetworkKey) => {
    if (address) out.push({ label, address, network });
  };
  add("Inbox", bridge.parent.inbox, "hyperevm-testnet");
  add("Bridge", bridge.parent.bridge, "hyperevm-testnet");
  add("Outbox", bridge.parent.outbox, "hyperevm-testnet");
  add("Rollup", bridge.parent.rollup, "hyperevm-testnet");
  add("L1 gateway router", bridge.parent.l1GatewayRouter, "hyperevm-testnet");
  add("Mirror factory", bridge.parent.mirrorFactory, "hyperevm-testnet");
  add("L2 gateway router", bridge.child.l2GatewayRouter, "elysium-testnet");
  add("L2 WHYPE gateway", bridge.child.l2WhypeGateway, "elysium-testnet");
  add("L2 custom (mirror) gateway", bridge.child.l2CustomGateway, "elysium-testnet");
  add("Bridge factory", bridge.child.bridgeFactory, "elysium-testnet");
  if (elysium.vm === "evm") add("WHYPE", elysium.contracts.wrappedNative, "elysium-testnet");
  return out;
}

const CONTRACTS = contracts();

/** Elysium testnet facts, from @elyia/core's verified registry and the measured chain. */
export function ChainFacts() {
  return (
    <dl className="grid gap-x-8 sm:grid-cols-2">
      {FACTS.map(([label, value]) => (
        <div key={label} className="flex items-baseline justify-between gap-4 border-b border-line py-2 text-[13px]">
          <dt className="text-text-2">{label}</dt>
          <dd className="text-right text-text-0">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The canonical bridge contracts on both sides, with explorer links (HyperEVM sky, Elysium gold). */
export function BridgeContracts() {
  return (
    <ul className="grid gap-x-6 gap-y-2.5 sm:grid-cols-2">
      {CONTRACTS.map((contract) => (
        <li key={`${contract.network}-${contract.label}`} className="flex min-w-0 items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-2 truncate text-[13px] text-text-1">
            <NetworkBadge network={contract.network} iconOnly />
            <span className="truncate">{contract.label}</span>
          </span>
          <AddressPill address={contract.address} network={contract.network} className="shrink-0" />
        </li>
      ))}
    </ul>
  );
}
