/**
 * Protocol registry: who is building what on Elysium, HyperEVM and
 * HyperCore, where each deployment stands, and which verbs Elyia can run
 * through it. The rows live in protocolData.ts as plain data so protocols
 * can be appended without touching logic; this module validates them once
 * at load (a typo'd row fails fast) and answers questions about them.
 *
 * Deployment statuses are strict: `live` and `testnet-live` only when
 * contracts or endpoints were seen working, `announced` / `coming` for
 * public plans, `unverified` when something exists or is reported but
 * nobody here confirmed whose it is or that it works.
 *
 * Every EVM contract listed is verified: it carries a `contractInfo` entry
 * with the bytecode size an `eth_getCode` re-check returned and how its
 * label was established. Bytecode proves a contract exists, not who owns it.
 */
import type { ProtocolSummary } from "./api/discovery.js";
import { isEvmAddress, toChecksumAddress, type EvmAddress } from "./caip.js";
import { isNetworkKey, NETWORKS, type NetworkEnvironment, type NetworkKey } from "./networks.js";
import { PROTOCOL_DATA } from "./protocolData.js";

/**
 * Coarse category (stable since v0.1; UIs key labels on it). The finer
 * `ProtocolKind` adds kinds this union has no slot for and maps each of
 * them onto one of these (`KIND_CATEGORY`).
 */
export type ProtocolCategory =
  | "bridge"
  | "perps"
  | "spot-orderbook"
  | "dex"
  | "aggregator"
  | "lending"
  | "cdp"
  | "liquid-staking"
  | "staking"
  | "vault"
  | "launchpad"
  | "prediction"
  | "oracle"
  | "infra"
  | "wallet"
  | "indexer"
  | "analytics";

export const PROTOCOL_CATEGORIES: readonly ProtocolCategory[] = Object.freeze([
  "bridge", "perps", "spot-orderbook", "dex", "aggregator", "lending", "cdp", "liquid-staking", "staking", "vault",
  "launchpad", "prediction", "oracle", "infra", "wallet", "indexer", "analytics",
]);

/** What a protocol is, at the grain of the 2026-10-31 census: every category plus the kinds it has no slot for. */
export type ProtocolKind = ProtocolCategory | "game" | "tools" | "nft" | "rwa" | "names" | "otc" | "stablecoin";

export const PROTOCOL_KINDS: readonly ProtocolKind[] = Object.freeze([
  ...PROTOCOL_CATEGORIES, "game", "tools", "nft", "rwa", "names", "otc", "stablecoin",
]);

/** The coarse category each kind files under (a category is its own kind). */
export const KIND_CATEGORY: Readonly<Record<ProtocolKind, ProtocolCategory>> = Object.freeze({
  ...(Object.fromEntries(PROTOCOL_CATEGORIES.map((category) => [category, category])) as Record<ProtocolCategory, ProtocolCategory>),
  game: "prediction",
  tools: "analytics",
  nft: "launchpad",
  rwa: "vault",
  names: "infra",
  otc: "dex",
  stablecoin: "infra",
});

/**
 * live: working on a mainnet; testnet-live: working on a testnet;
 * announced: publicly announced, nothing deployed; coming: scheduled with a
 * date or milestone (also: deployed on the private Elysium mainnet ahead of
 * its public launch); unverified: exists or is reported, not confirmed.
 */
export type DeploymentStatus = "live" | "testnet-live" | "announced" | "coming" | "unverified";

export const DEPLOYMENT_STATUSES: readonly DeploymentStatus[] = Object.freeze(["live", "testnet-live", "announced", "coming", "unverified"]);

/**
 * One word per protocol, derived from its deployments (the validator checks
 * it): live-mainnet when any deployment is `live`, live-testnet when any is
 * `testnet-live`, announced-mainnet when only `coming` / `announced`,
 * unknown otherwise. `deprecated` is set by hand and overrides.
 */
export type ProtocolStatus = "live-mainnet" | "live-testnet" | "announced-mainnet" | "unknown" | "deprecated";

export const PROTOCOL_STATUSES: readonly ProtocolStatus[] = Object.freeze(["live-mainnet", "live-testnet", "announced-mainnet", "unknown", "deprecated"]);

/** Verbs Elyia's intent language can route through a protocol. */
export type ProtocolVerb =
  | "bridge"
  | "link"
  | "transfer"
  | "swap"
  | "long"
  | "short"
  | "buy"
  | "sell"
  | "close"
  | "limit"
  | "tpsl"
  | "twap"
  | "cancel"
  | "leverage"
  | "margin"
  | "stake"
  | "unstake"
  | "deposit"
  | "withdraw"
  | "lend"
  | "borrow"
  | "launch"
  | "predict"
  | "read";

export const PROTOCOL_VERBS: readonly ProtocolVerb[] = Object.freeze([
  "bridge", "link", "transfer", "swap", "long", "short", "buy", "sell", "close", "limit", "tpsl", "twap", "cancel",
  "leverage", "margin", "stake", "unstake", "deposit", "withdraw", "lend", "borrow", "launch", "predict", "read",
]);

/** A verified EVM contract of a deployment. */
export interface ProtocolContract {
  /** Its key in `ProtocolDeployment.contracts`. */
  readonly key: string;
  /** What the contract is, in words ("SwapRouter (v1, deadline)"). */
  readonly role: string;
  /** EIP-55. */
  readonly address: EvmAddress;
  /** Bytecode size `eth_getCode` returned at `checkedAt` (precompiles answer 1 byte). */
  readonly codeBytes: number;
  /** YYYY-MM-DD of the eth_getCode re-check. */
  readonly checkedAt: string;
  /** Getters, selectors or source verification that tie the role to the address. */
  readonly evidence: string;
  /** Where the label came from (project docs, elysiumeco.xyz, census attribution). */
  readonly labelSource?: string;
  /** A superseded version kept so old positions can be recognised. */
  readonly deprecated?: boolean;
}

export interface ProtocolDeployment {
  readonly network: NetworkKey;
  readonly status: DeploymentStatus;
  /** Key -> address (EVM) or endpoint URL. Empty when nothing is published. */
  readonly contracts: Readonly<Record<string, string>>;
  /** One entry per EVM address in `contracts` (required on EVM networks). */
  readonly contractInfo?: readonly ProtocolContract[];
  /** How the status and every contract were established, with dates. */
  readonly evidence?: string;
  /** ISO date the deployment went (or goes) live, when known. */
  readonly since?: string;
}

/** A function whose selector was verified in the deployed bytecode (or by a simulation). */
export interface AdapterFunction {
  readonly contract: string;
  readonly address: EvmAddress;
  readonly network: NetworkKey;
  /** Solidity signature, `exactInputSingle((address,address,uint24,address,uint256,uint256,uint256,uint160))`. */
  readonly signature: string;
  readonly selector: `0x${string}`;
  readonly verification: string;
}

/** An `eth_call` / `eth_estimateGas` simulation the census ran (testnet amounts; prices are fake). */
export interface AdapterSimulation {
  readonly call: string;
  readonly selector?: string;
  readonly ok: boolean;
  readonly result?: string;
  readonly gas?: number;
}

/** What an engine adapter for this protocol would build on: never a promise that one exists. */
export interface ProtocolAdapterHints {
  /** The census lists it among the 26 adapter candidates. */
  readonly candidate: boolean;
  /** simulated: end-to-end eth_call succeeded; selectors: selectors verified, calldata still to build. */
  readonly tier: "simulated" | "selectors";
  /** Verbs an adapter would offer here. */
  readonly verbs: readonly ProtocolVerb[];
  readonly functions: readonly AdapterFunction[];
  readonly simulations: readonly AdapterSimulation[];
  /** What an adapter must get right (pinned wrapped native, quote token, payload format). */
  readonly caveat?: string;
}

export interface ProtocolDescriptor {
  /** Lower-case kebab id, stable API. */
  readonly id: string;
  readonly name: string;
  /** Coarse category (always `KIND_CATEGORY[kind]`). */
  readonly category: ProtocolCategory;
  readonly kind: ProtocolKind;
  readonly status: ProtocolStatus;
  readonly description: string;
  readonly url: string;
  readonly docs?: string;
  /** X handle without the @. */
  readonly x?: string;
  readonly github?: string;
  readonly deployments: readonly ProtocolDeployment[];
  /** Verbs Elyia executes through this protocol (empty: discovery only). */
  readonly capabilities: readonly ProtocolVerb[];
  /**
   * An Elyia engine adapter executes this protocol. The API reports what its
   * running adapters actually execute (see `withExecutable`).
   */
  readonly executable: boolean;
  /** Kebab tags: `prelaunch-mainnet`, `community-tracker`, `name-collision`, `unaudited`, `lookalike-tokens`… */
  readonly tags: readonly string[];
  readonly adapter?: ProtocolAdapterHints;
  /** Row id in the 2026-10-31 census, when it came from there. */
  readonly researchId?: string;
  /** Contracts or activity on the private Elysium mainnet before its public launch. */
  readonly mainnetPrelaunch?: boolean;
  /** Risks and open questions in one paragraph. */
  readonly notes?: string;
  readonly sources?: readonly string[];
}

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const TAG_PATTERN = ID_PATTERN;
const HANDLE = /^[A-Za-z0-9_]{1,15}$/u;
const DATE = /^\d{4}-\d{2}-\d{2}$/u;
const SELECTOR = /^0x[0-9a-f]{8}$/u;
const SIGNATURE = /^[A-Za-z_][A-Za-z0-9_]*\(.*\)$/u;
const KEY = /^[A-Za-z][A-Za-z0-9]*$/u;

export interface ProtocolRowIssue {
  readonly id: string;
  readonly message: string;
}

const STATUS_RANK: readonly DeploymentStatus[] = ["live", "testnet-live", "coming", "announced", "unverified"];

/** The protocol status its deployments imply (`deprecated` is never derived). */
export function deriveProtocolStatus(deployments: readonly ProtocolDeployment[]): Exclude<ProtocolStatus, "deprecated"> {
  const statuses = new Set(deployments.map((deployment) => deployment.status));
  if (statuses.has("live")) return "live-mainnet";
  if (statuses.has("testnet-live")) return "live-testnet";
  if (statuses.has("coming") || statuses.has("announced")) return "announced-mainnet";
  return "unknown";
}

function isEvmNetwork(network: NetworkKey): boolean {
  return NETWORKS[network].vm === "evm";
}

/** Structural checks for registry rows; an empty list means every row is usable. */
export function validateProtocolRows(rows: readonly ProtocolDescriptor[]): ProtocolRowIssue[] {
  const issues: ProtocolRowIssue[] = [];
  const seen = new Set<string>();
  const research = new Set<string>();
  for (const row of rows) {
    const fail = (message: string) => issues.push({ id: row.id, message });
    if (!ID_PATTERN.test(row.id)) fail("id must be lower-case kebab");
    if (seen.has(row.id)) fail("duplicate id");
    seen.add(row.id);
    if (row.researchId !== undefined) {
      if (!ID_PATTERN.test(row.researchId)) fail("researchId must be lower-case kebab");
      if (research.has(row.researchId)) fail(`researchId ${row.researchId} is used twice`);
      research.add(row.researchId);
    }
    if (!row.name.trim()) fail("name is empty");
    if (!PROTOCOL_CATEGORIES.includes(row.category)) fail(`unknown category ${row.category}`);
    if (!PROTOCOL_KINDS.includes(row.kind)) fail(`unknown kind ${String(row.kind)}`);
    else if (KIND_CATEGORY[row.kind] !== row.category) fail(`kind ${row.kind} files under category ${KIND_CATEGORY[row.kind]}, not ${row.category}`);
    if (!PROTOCOL_STATUSES.includes(row.status)) fail(`unknown status ${String(row.status)}`);
    if (!row.description.trim()) fail("description is empty");
    if (!row.url.startsWith("https://")) fail("url must be https");
    if (row.docs !== undefined && !row.docs.startsWith("https://")) fail("docs must be https");
    if (row.x !== undefined && !HANDLE.test(row.x)) fail("x must be a handle without @");
    if (row.github !== undefined && !/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)?$/u.test(row.github)) fail("github must be owner or owner/repo");
    for (const verb of row.capabilities) if (!PROTOCOL_VERBS.includes(verb)) fail(`unknown verb ${verb}`);
    if (row.executable && row.capabilities.length === 0) fail("an executable protocol needs at least one verb");
    if (row.executable && !row.deployments.some((deployment) => deployment.status === "live" || deployment.status === "testnet-live")) {
      fail("an executable protocol needs a live deployment");
    }
    if (row.executable && row.status === "deprecated") fail("a deprecated protocol cannot be executable");
    if (new Set(row.tags).size !== row.tags.length) fail("duplicate tag");
    for (const tag of row.tags) if (!TAG_PATTERN.test(tag)) fail(`tag ${tag} must be lower-case kebab`);
    if ((row.mainnetPrelaunch === true) !== row.tags.includes("prelaunch-mainnet")) fail("mainnetPrelaunch and the prelaunch-mainnet tag go together");
    if (row.status === "deprecated" && !row.tags.includes("deprecated")) fail("a deprecated protocol carries the deprecated tag");
    if (PROTOCOL_STATUSES.includes(row.status) && row.status !== "deprecated" && row.status !== deriveProtocolStatus(row.deployments)) {
      fail(`status ${row.status} disagrees with its deployments (${deriveProtocolStatus(row.deployments)})`);
    }

    const verified = new Map<string, ProtocolContract>();
    const networks = new Set<string>();
    for (const deployment of row.deployments) {
      if (!isNetworkKey(deployment.network)) {
        fail(`unknown network ${String(deployment.network)}`);
        continue;
      }
      if (networks.has(deployment.network)) fail(`two deployments on ${deployment.network}`);
      networks.add(deployment.network);
      if (!DEPLOYMENT_STATUSES.includes(deployment.status)) fail(`unknown status ${deployment.status}`);
      if (deployment.since !== undefined && !DATE.test(deployment.since)) fail("since must be YYYY-MM-DD");
      const testnet = NETWORKS[deployment.network].environment === "testnet";
      if (deployment.status === "live" && testnet) fail(`${deployment.network} is a testnet: use testnet-live`);
      if (deployment.status === "testnet-live" && !testnet) fail(`${deployment.network} is a mainnet: use live`);
      if ((deployment.status === "live" || deployment.status === "testnet-live") && !deployment.evidence?.trim()) fail(`${deployment.network}: a working deployment needs evidence`);
      const evm = isEvmNetwork(deployment.network);
      const info = deployment.contractInfo ?? [];
      if (!evm && info.length > 0) fail(`${deployment.network} is not an EVM network: no contractInfo`);
      const infoByKey = new Map<string, ProtocolContract>();
      for (const contract of info) {
        const where = `${deployment.network} ${contract.key}`;
        if (infoByKey.has(contract.key)) fail(`${where}: contractInfo key used twice`);
        infoByKey.set(contract.key, contract);
        if (!KEY.test(contract.key)) fail(`${where}: key must be camelCase alphanumerics`);
        if (!contract.role.trim()) fail(`${where}: role is empty`);
        if (!contract.evidence.trim()) fail(`${where}: evidence is empty`);
        if (!DATE.test(contract.checkedAt)) fail(`${where}: checkedAt must be YYYY-MM-DD`);
        if (!Number.isInteger(contract.codeBytes) || contract.codeBytes <= 0) fail(`${where}: only contracts with bytecode are listed (codeBytes ${contract.codeBytes})`);
        if (deployment.contracts[contract.key] !== contract.address) fail(`${where}: contractInfo does not match contracts.${contract.key}`);
        verified.set(`${deployment.network}|${contract.address}`, contract);
      }
      for (const [key, value] of Object.entries(deployment.contracts)) {
        if (isEvmAddress(value)) {
          if (toChecksumAddress(value) !== value) fail(`${deployment.network} ${key}: address must be EIP-55 checksummed`);
          if (evm && !infoByKey.has(key)) fail(`${deployment.network} ${key}: unverified contract (no contractInfo entry)`);
        } else if (!value.startsWith("https://") && !value.startsWith("wss://")) {
          fail(`${key} is neither an address nor a URL`);
        } else if (evm && infoByKey.has(key)) {
          fail(`${deployment.network} ${key}: a URL cannot carry contractInfo`);
        }
      }
    }

    if (row.adapter) {
      const hints = row.adapter;
      if (hints.tier !== "simulated" && hints.tier !== "selectors") fail(`unknown adapter tier ${String(hints.tier)}`);
      if (hints.functions.length === 0) fail("adapter hints need at least one verified function");
      for (const verb of hints.verbs) if (!PROTOCOL_VERBS.includes(verb)) fail(`adapter: unknown verb ${verb}`);
      for (const fn of hints.functions) {
        if (!SELECTOR.test(fn.selector)) fail(`adapter ${fn.signature}: selector must be 0x + 8 lower-case hex`);
        if (!SIGNATURE.test(fn.signature)) fail(`adapter ${fn.signature}: not a function signature`);
        if (!verified.has(`${fn.network}|${fn.address}`)) fail(`adapter ${fn.signature}: ${fn.address} is not a verified contract of this row on ${fn.network}`);
      }
      for (const simulation of hints.simulations) if (simulation.selector !== undefined && !SELECTOR.test(simulation.selector)) fail(`adapter simulation ${simulation.call}: bad selector`);
    }
  }
  return issues;
}

function freezeRows(rows: readonly ProtocolDescriptor[]): readonly ProtocolDescriptor[] {
  const issues = validateProtocolRows(rows);
  if (issues.length > 0) {
    throw new Error(`Invalid protocol registry rows: ${issues.map((issue) => `${issue.id}: ${issue.message}`).join("; ")}`);
  }
  return Object.freeze(rows.map((row) => Object.freeze({ ...row })));
}

export const PROTOCOLS: readonly ProtocolDescriptor[] = freezeRows(PROTOCOL_DATA);

const BY_ID = new Map(PROTOCOLS.map((protocol) => [protocol.id, protocol]));

export function getProtocol(id: string): ProtocolDescriptor | null {
  return BY_ID.get(id) ?? null;
}

/** Same as `getProtocol`. */
export function protocolById(id: string): ProtocolDescriptor | null {
  return getProtocol(id);
}

export function isProtocolId(value: unknown): value is string {
  return typeof value === "string" && BY_ID.has(value);
}

export interface ProtocolQuery {
  /** Has a deployment on this network. */
  readonly network?: NetworkKey;
  /** A kind or a coarse category: `nft` matches kind nft; `launchpad` matches the category (launchpads and NFT rows). */
  readonly category?: ProtocolKind;
  readonly kind?: ProtocolKind;
  readonly status?: ProtocolStatus | readonly ProtocolStatus[];
  /** With `network`: only deployments in these statuses count. */
  readonly deploymentStatus?: DeploymentStatus | readonly DeploymentStatus[];
  readonly executable?: boolean;
  readonly tag?: string;
}

const asList = <T>(value: T | readonly T[] | undefined): readonly T[] | null => (value === undefined ? null : Array.isArray(value) ? value : [value as T]);

/** Registry rows matching every given filter, in registry order. */
export function listProtocols(query: ProtocolQuery = {}, protocols: readonly ProtocolDescriptor[] = PROTOCOLS): ProtocolDescriptor[] {
  const statuses = asList(query.status);
  const deploymentStatuses = asList(query.deploymentStatus);
  return protocols.filter((protocol) => {
    if (query.category !== undefined && protocol.kind !== query.category && protocol.category !== query.category) return false;
    if (query.kind !== undefined && protocol.kind !== query.kind) return false;
    if (statuses && !statuses.includes(protocol.status)) return false;
    if (query.executable !== undefined && protocol.executable !== query.executable) return false;
    if (query.tag !== undefined && !protocol.tags.includes(query.tag)) return false;
    if (query.network !== undefined || deploymentStatuses) {
      return protocol.deployments.some(
        (deployment) => (query.network === undefined || deployment.network === query.network) && (!deploymentStatuses || deploymentStatuses.includes(deployment.status)),
      );
    }
    return true;
  });
}

/** Protocols with any deployment on `network`, optionally only in the given statuses. */
export function protocolsFor(network: NetworkKey, statuses?: readonly DeploymentStatus[]): ProtocolDescriptor[] {
  return listProtocols({ network, ...(statuses ? { deploymentStatus: statuses } : {}) });
}

/** Protocols with any deployment in one environment (the ecosystem directory per mode). */
export function protocolsIn(environment: NetworkEnvironment): ProtocolDescriptor[] {
  return PROTOCOLS.filter((protocol) => protocol.deployments.some((deployment) => NETWORKS[deployment.network].environment === environment));
}

/** Protocols Elyia executes, optionally only those with a working deployment on `network`. */
export function executableProtocols(network?: NetworkKey): ProtocolDescriptor[] {
  return PROTOCOLS.filter(
    (protocol) =>
      protocol.executable &&
      (network === undefined ||
        protocol.deployments.some((deployment) => deployment.network === network && (deployment.status === "live" || deployment.status === "testnet-live"))),
  );
}

/** Executable protocols offering `verb` on `network` with a working deployment there. */
export function capableProtocols(network: NetworkKey, verb: ProtocolVerb): ProtocolDescriptor[] {
  return executableProtocols(network).filter((protocol) => protocol.capabilities.includes(verb));
}

export function deploymentOn(protocol: ProtocolDescriptor, network: NetworkKey): ProtocolDeployment | null {
  return protocol.deployments.find((deployment) => deployment.network === network) ?? null;
}

/** A registry contract at an address. */
export interface ProtocolTouch {
  readonly protocol: ProtocolDescriptor;
  readonly network: NetworkKey;
  readonly deploymentStatus: DeploymentStatus;
  readonly contract: ProtocolContract;
}

const TOUCHES = new Map<string, ProtocolTouch[]>();
for (const protocol of PROTOCOLS) {
  for (const deployment of protocol.deployments) {
    for (const contract of deployment.contractInfo ?? []) {
      const key = contract.address.toLowerCase();
      const list = TOUCHES.get(key) ?? [];
      list.push({ protocol, network: deployment.network, deploymentStatus: deployment.status, contract });
      TOUCHES.set(key, list);
    }
  }
}

/**
 * Which registry protocols list a contract at `address` (any case), and as
 * what. Shared infrastructure (Multicall3, the canonical bridge, canonical
 * WHYPE) can appear under several protocols; `network` narrows to one chain.
 */
export function protocolsTouching(address: string, network?: NetworkKey): ProtocolTouch[] {
  if (!isEvmAddress(address)) return [];
  const touches = TOUCHES.get(address.toLowerCase()) ?? [];
  return network === undefined ? [...touches] : touches.filter((touch) => touch.network === network);
}

/** Number of protocols per category (every category present, zero when empty). */
export function countByCategory(protocols: readonly ProtocolDescriptor[] = PROTOCOLS): Record<ProtocolCategory, number> {
  const counts = Object.fromEntries(PROTOCOL_CATEGORIES.map((category) => [category, 0])) as Record<ProtocolCategory, number>;
  for (const protocol of protocols) counts[protocol.category] += 1;
  return counts;
}

/** Number of protocols per kind (every kind present, zero when empty). */
export function countByKind(protocols: readonly ProtocolDescriptor[] = PROTOCOLS): Record<ProtocolKind, number> {
  const counts = Object.fromEntries(PROTOCOL_KINDS.map((kind) => [kind, 0])) as Record<ProtocolKind, number>;
  for (const protocol of protocols) counts[protocol.kind] += 1;
  return counts;
}

/** Number of deployments per status across protocols. */
export function countByStatus(protocols: readonly ProtocolDescriptor[] = PROTOCOLS): Record<DeploymentStatus, number> {
  const counts = Object.fromEntries(DEPLOYMENT_STATUSES.map((status) => [status, 0])) as Record<DeploymentStatus, number>;
  for (const protocol of protocols) for (const deployment of protocol.deployments) counts[deployment.status] += 1;
  return counts;
}

/** Number of protocols per protocol status. */
export function countByProtocolStatus(protocols: readonly ProtocolDescriptor[] = PROTOCOLS): Record<ProtocolStatus, number> {
  const counts = Object.fromEntries(PROTOCOL_STATUSES.map((status) => [status, 0])) as Record<ProtocolStatus, number>;
  for (const protocol of protocols) counts[protocol.status] += 1;
  return counts;
}

/** The most real deployment status of a protocol (live, testnet-live, coming, announced, unverified), null without deployments. */
export function bestDeploymentStatus(protocol: ProtocolDescriptor): DeploymentStatus | null {
  let best: DeploymentStatus | null = null;
  for (const deployment of protocol.deployments) {
    if (best === null || STATUS_RANK.indexOf(deployment.status) < STATUS_RANK.indexOf(best)) best = deployment.status;
  }
  return best;
}

/** The light listing row of `GET /v1/protocols?view=summary` (no contracts, no hints). */
export function protocolSummary(protocol: ProtocolDescriptor): ProtocolSummary {
  return {
    id: protocol.id,
    name: protocol.name,
    category: protocol.category,
    kind: protocol.kind,
    status: protocol.status,
    url: protocol.url,
    networks: protocol.deployments.map((deployment) => ({ network: deployment.network, status: deployment.status, contracts: deployment.contractInfo?.length ?? 0 })),
    executable: protocol.executable,
    capabilities: protocol.capabilities,
    adapterTier: protocol.adapter?.tier ?? null,
    tags: protocol.tags,
  };
}

/**
 * The registry with `executable` replaced by what a running service really
 * executes (its active adapters' protocol ids). Used by `GET /v1/protocols`.
 */
export function withExecutable(activeProtocolIds: Iterable<string>, protocols: readonly ProtocolDescriptor[] = PROTOCOLS): ProtocolDescriptor[] {
  const active = new Set(activeProtocolIds);
  return protocols.map((protocol) => ({ ...protocol, executable: active.has(protocol.id) && protocol.capabilities.length > 0 }));
}
