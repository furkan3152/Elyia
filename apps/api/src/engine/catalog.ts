/**
 * The venue catalog behind GET /v1/venues: every venue the engine executes
 * (from the same pins the adapters use, so the list cannot drift from what
 * runs), plus the Elysium protocols Elyia only reads (launchpads, perps,
 * aggregators from the core protocol registry), each with its network, kind
 * and status. Mainnet rows are `unavailable` while the network has no RPC or
 * the deployment is not executable here.
 */
import { NETWORKS, PROTOCOLS, type NetworkKey, type ProtocolDescriptor } from "@elyia/core";
import type { VenueContractView, VenueKind, VenueStatus, VenueView } from "@elyia/core/api/intents";
import type { Network } from "@elyia/core";
import { SIGNAL_V4, CORE_DEPOSIT_WALLET, ELY_NAMES, ELY_NAMES_EVIDENCE, KINETIQ_STAKING, LENDING_VENUES, V2_VENUES, V3_VENUES, VAULT_VENUES } from "./venues.js";

const TESTNET_PRICE_NOTE = "Testnet pool prices are fake; Elyia shows USD at HyperCore mainnet reference mids.";

function contract(role: string, address: string, network: NetworkKey): VenueContractView {
  return { role, address: address.toLowerCase() as VenueContractView["address"], network };
}

/** A network the engine can execute on right now (EVM: at least one RPC; HyperCore: always, through the info API). */
export function networkReachable(networks: Readonly<Record<NetworkKey, Network>>, key: NetworkKey): boolean {
  const network = networks[key];
  if (!network) return false;
  return network.vm === "hypercore" || network.rpcUrls.length > 0;
}

function row(input: Omit<VenueView, "environment" | "explicitOnly" | "notes"> & { readonly explicitOnly?: boolean; readonly notes?: readonly string[] }, reachable: (key: NetworkKey) => boolean): VenueView {
  const status: VenueStatus = input.status === "live" && !reachable(input.network) ? "unavailable" : input.status;
  return {
    ...input,
    environment: NETWORKS[input.network].environment,
    explicitOnly: input.explicitOnly ?? false,
    status,
    notes: [...(input.notes ?? []), ...(status === "unavailable" && input.status === "live" ? [`${NETWORKS[input.network].name} has no RPC configured on this server.`] : [])],
  };
}

function protocolContracts(protocol: ProtocolDescriptor, network: NetworkKey): VenueContractView[] {
  const deployment = protocol.deployments.find((entry) => entry.network === network);
  if (!deployment) return [];
  return Object.entries(deployment.contracts)
    .filter(([, address]) => /^0x[0-9a-fA-F]{40}$/u.test(address))
    .map(([role, address]) => contract(role, address, network));
}

const KIND_OF_CATEGORY: Readonly<Record<string, VenueKind>> = Object.freeze({
  launchpad: "launchpad",
  perps: "perps",
  aggregator: "aggregator",
  dex: "dex",
  lending: "lending",
  vault: "vault",
  "liquid-staking": "staking",
  staking: "staking",
  prediction: "launchpad",
});

/** Every venue, executable first. */
export function venueCatalog(networks: Readonly<Record<NetworkKey, Network>>): VenueView[] {
  const reachable = (key: NetworkKey) => networkReachable(networks, key);
  const out: VenueView[] = [];
  const executed = new Set<string>();
  const add = (view: VenueView) => {
    out.push(view);
    executed.add(view.id);
  };

  for (const venue of V3_VENUES) {
    add(row({
      id: venue.id, label: venue.label, kind: "dex", network: venue.network, status: "live", actions: ["swap"], explicitOnly: venue.explicitOnly ?? false,
      ...(venue.network.startsWith("elysium") ? { census: venue.census } : {}),
      contracts: [contract("swapRouter", venue.router, venue.network), contract("factory", venue.factory, venue.network), ...(venue.quoter ? [contract("quoterV2", venue.quoter, venue.network)] : []), contract("wrappedNative", venue.wrappedNative, venue.network)],
      notes: [
        `Uniswap V3 style (${venue.dialect === "router01" ? "SwapRouter v1" : "SwapRouter02"}); fee tiers ${venue.feeTiers.map((fee) => `${fee / 10_000}%`).join(", ")}.`,
        ...(venue.canonicalWrapped ? [] : [`Native HYPE routes through the venue's own wrapped token ${venue.wrappedNative}, not canonical WHYPE.`]),
        ...(venue.explicitOnly ? ["Name the venue to trade its launch tokens by address (unverified tokens, look-alikes refused)."] : []),
        ...(NETWORKS[venue.network].environment === "testnet" ? [TESTNET_PRICE_NOTE] : []),
      ],
      evidence: venue.evidence,
    }, reachable));
  }
  for (const venue of V2_VENUES) {
    add(row({
      id: venue.id, label: venue.label, kind: "dex", network: venue.network, status: "live", actions: ["swap"], explicitOnly: venue.explicitOnly ?? false, census: venue.census,
      contracts: [contract("router", venue.router, venue.network), contract("factory", venue.factory, venue.network), contract("wrappedNative", venue.wrappedNative, venue.network)],
      notes: [`Uniswap V2 style, ${venue.feeBps / 100}% LP fee, direct pairs.`, `Native HYPE routes through its own wrapped token ${venue.wrappedNative}, not canonical WHYPE.`, ...(venue.explicitOnly ? ["Its pairs hold its own test tokens: name the venue and the token address to use it."] : []), TESTNET_PRICE_NOTE],
      evidence: venue.evidence,
    }, reachable));
  }
  add(row({
    id: SIGNAL_V4.id, label: SIGNAL_V4.label, kind: "launchpad", network: SIGNAL_V4.network, status: "live", actions: ["swap"], explicitOnly: true, census: SIGNAL_V4.census,
    contracts: [contract("launchRouter", SIGNAL_V4.launchRouter, SIGNAL_V4.network), contract("v4Quoter", SIGNAL_V4.quoter, SIGNAL_V4.network), contract("poolManager", SIGNAL_V4.poolManager, SIGNAL_V4.network), contract("hook", SIGNAL_V4.hook, SIGNAL_V4.network)],
    notes: ["Buys only: HYPE -> a Signal launch token (name `signal` and the token address). Sells and the UniversalRouter path are not offered (encoding not proven).", "Third-party launchpad, a Uniswap v4 copy; reportedly removed from the official ecosystem map.", TESTNET_PRICE_NOTE],
    evidence: SIGNAL_V4.evidence,
  }, reachable));
  for (const venue of VAULT_VENUES) {
    add(row({
      id: venue.id, label: venue.label, kind: "vault", network: venue.network, status: "live", actions: ["deposit", "withdraw"], explicitOnly: venue.explicitOnly ?? false, census: venue.census,
      contracts: [contract("vault", venue.vault, venue.network), contract("asset", venue.asset, venue.network)],
      notes: [`ERC-4626: ${venue.assetSymbol} in, ${venue.shareSymbol} out (redeem to withdraw).`, ...venue.warnings],
      evidence: venue.evidence,
    }, reachable));
  }
  for (const venue of LENDING_VENUES) {
    add(row({
      id: venue.id, label: venue.label, kind: "lending", network: venue.network, status: "live", actions: ["deposit", "withdraw"], explicitOnly: venue.explicitOnly ?? false, census: venue.census,
      contracts: [contract("core", venue.core, venue.network)],
      notes: [`Markets: ${venue.markets.map((market) => `lend ${market.loanSymbol} against ${market.collateralSymbol} (${market.id.slice(0, 10)}…)`).join("; ")}. Supply and withdraw only, no borrowing.`, ...venue.warnings],
      evidence: venue.evidence,
    }, reachable));
  }

  // Protocol-registry venues the engine executes (bridges, link, HyperCore, staking, wrap, transfers).
  const fixed: { readonly id: string; readonly label: string; readonly kind: VenueKind; readonly actions: readonly string[]; readonly networks: readonly NetworkKey[]; readonly notes: readonly string[]; readonly census?: string; readonly extra?: (network: NetworkKey) => VenueContractView[] }[] = [
    { id: "elysium-canonical-bridge", census: "elysium-canonical-bridge", label: "Elysium canonical bridge", kind: "bridge", actions: ["bridge", "claim"], networks: ["hyperevm-testnet", "elysium-testnet"], notes: ["HYPE: Inbox.depositEth / ArbSys.withdrawEth. ERC-20: gateway outboundTransferCustomRefund (retryable ticket, redeem step when the auto-redeem fails) / L2GatewayRouter.outboundTransfer. Withdrawals claim on HyperEVM via Outbox.executeTransaction after the challenge period."] },
    { id: "elysium-mirror-bridge", census: "elysium-mirror-bridge", label: "Elysium mirror bridge", kind: "bridge", actions: ["bridge", "claim"], networks: ["elysium-testnet"], notes: ["Elysium-native tokens: escrow wallet (createL2Wallet), mirror registration on HyperEVM, approve l2WalletFor, outboundTransfer."] },
    { id: "hyperevm-core-link", label: "HyperEVM <-> HyperCore link", kind: "link", actions: ["link"], networks: ["hyperevm-testnet", "hypercore-testnet"], notes: ["HYPE to 0x2222…2222, USDC through CoreDepositWallet.deposit, linked tokens to their system address (exact decimal conversion); back with a user-signed spotSend to the system address."], extra: (network) => (CORE_DEPOSIT_WALLET[network] ? [contract("coreDepositWallet", CORE_DEPOSIT_WALLET[network] as string, network)] : []) },
    { id: "hypercore-perps", label: "HyperCore perps", kind: "trading", actions: ["order", "cancel", "leverage", "margin"], networks: ["hypercore-testnet", "hypercore-mainnet"], notes: ["L1 actions signed by your in-browser trade-only agent key (or the opt-in Keeper); approveAgent inserted when needed."] },
    { id: "hypercore-spot", label: "HyperCore spot", kind: "trading", actions: ["order", "cancel"], networks: ["hypercore-testnet", "hypercore-mainnet"], notes: [] },
    { id: "hypercore-twap", label: "HyperCore TWAP", kind: "trading", actions: ["twap", "cancel"], networks: ["hypercore-testnet", "hypercore-mainnet"], notes: [] },
    { id: "hypercore-transfers", label: "HyperCore transfers", kind: "transfer", actions: ["transfer", "margin"], networks: ["hypercore-testnet", "hypercore-mainnet"], notes: ["usdSend / spotSend / usdClassTransfer, user-signed."] },
    { id: "kinetiq", census: "kinetiq-khype", label: "Kinetiq kHYPE staking", kind: "staking", actions: ["stake"], networks: Object.keys(KINETIQ_STAKING) as NetworkKey[], notes: ["StakingManager.stake() payable, min 0.1 HYPE; testnet manager identity INFERRED (kHYPE's sole minter). Unstaking is Kinetiq's withdrawal queue: shown, not executed."], extra: (network) => { const pins = KINETIQ_STAKING[network]; return pins ? [contract("stakingManager", pins.manager, network), contract("kHYPE", pins.kHYPE, network)] : []; } },
    { id: "wrapped-hype", census: "whype-canonical", label: "WHYPE wrap / unwrap", kind: "wrap", actions: ["swap"], networks: ["elysium-testnet", "hyperevm-testnet", "hyperevm-mainnet"], notes: ["deposit() / withdraw(wad) on the network's canonical WHYPE only."], extra: (network) => { const wrapped = (networks[network] as { contracts?: { wrappedNative?: string | null } }).contracts?.wrappedNative; return wrapped ? [contract("WHYPE", wrapped, network)] : []; } },
    { id: "evm-transfer", label: "Send (native / ERC-20)", kind: "transfer", actions: ["transfer"], networks: ["elysium-testnet", "hyperevm-testnet", "hyperevm-mainnet"], notes: ["Recipients may be 0x addresses or .ely names."] },
  ];
  for (const entry of fixed) {
    const protocol = PROTOCOLS.find((candidate) => candidate.id === entry.id);
    for (const network of entry.networks) {
      out.push(row({
        id: entry.id, label: entry.label, kind: entry.kind, network, status: "live", actions: entry.actions,
        ...(entry.census ? { census: entry.census } : {}),
        contracts: [...(protocol ? protocolContracts(protocol, network) : []), ...(entry.extra?.(network) ?? [])],
        notes: entry.notes,
      }, reachable));
    }
    executed.add(entry.id);
  }
  for (const [network, address] of Object.entries(ELY_NAMES) as [NetworkKey, string][]) {
    add(row({ id: "elysium-names", label: "Elysium Names (.ely)", kind: "names", network, status: "live", actions: ["resolve"], census: "elysium-names", contracts: [contract("ElyNames", address, network)], notes: ["Recipient resolver for sends and bridges (\"send 5 HYPE to bona.ely\"). Registration is not offered."], evidence: ELY_NAMES_EVIDENCE }, reachable));
  }

  // Everything else the registry lists on Elysium: read-only (launchpads, perps, aggregators) or unavailable.
  for (const protocol of PROTOCOLS) {
    if (executed.has(protocol.id)) continue;
    const kind = KIND_OF_CATEGORY[protocol.category];
    if (!kind) continue;
    for (const deployment of protocol.deployments) {
      if (!deployment.network.startsWith("elysium")) continue;
      const live = deployment.status === "live" || deployment.status === "testnet-live";
      out.push(row({
        id: protocol.id, label: protocol.name, kind, network: deployment.network, status: live ? "read-only" : "unavailable", actions: ["read"], census: protocol.id,
        contracts: protocolContracts(protocol, deployment.network),
        notes: [
          live ? "Shown for information: Elyia does not build transactions for it yet (its calldata is not proven by simulation)." : `Status: ${deployment.status}.`,
          ...(deployment.network === "elysium-mainnet" ? ["Elysium mainnet is pre-launch; Elyia never sends user transactions through the third-party mainnet relay."] : []),
        ],
        ...(deployment.evidence ? { evidence: deployment.evidence } : {}),
      }, reachable));
    }
  }
  return out;
}
