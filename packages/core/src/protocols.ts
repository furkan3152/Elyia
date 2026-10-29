/**
 * Protocol registry: who is building what on Elysium, HyperEVM and
 * HyperCore, where each deployment stands, and which verbs Elyia can run
 * through it. The rows live in protocolData.ts as plain data so protocols
 * can be appended without touching logic; this module validates them once
 * at load (a typo'd row fails fast) and answers questions about them.
 *
 * Statuses are strict: `live` and `testnet-live` only when contracts or
 * endpoints were seen working, `announced` / `coming` for public plans,
 * `unverified` when a third party reports something nobody here confirmed.
 */
import { isEvmAddress } from "./caip.js";
import { isNetworkKey, NETWORKS, type NetworkEnvironment, type NetworkKey } from "./networks.js";
import { PROTOCOL_DATA } from "./protocolData.js";

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

/**
 * live: working on a mainnet; testnet-live: working on a testnet;
 * announced: publicly announced, nothing deployed; coming: scheduled with a
 * date or milestone; unverified: reported by a third party, not confirmed.
 */
export type DeploymentStatus = "live" | "testnet-live" | "announced" | "coming" | "unverified";

export const DEPLOYMENT_STATUSES: readonly DeploymentStatus[] = Object.freeze(["live", "testnet-live", "announced", "coming", "unverified"]);

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

export interface ProtocolDeployment {
  readonly network: NetworkKey;
  readonly status: DeploymentStatus;
  /** Role -> address (EVM) or endpoint URL. Empty when nothing is published. */
  readonly contracts: Readonly<Record<string, string>>;
  /** How the status and every contract were established, with dates. */
  readonly evidence?: string;
  /** ISO date the deployment went (or goes) live, when known. */
  readonly since?: string;
}

export interface ProtocolDescriptor {
  /** Lower-case kebab id, stable API. */
  readonly id: string;
  readonly name: string;
  readonly category: ProtocolCategory;
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
   * Elyia v1 plans and executes these verbs here. The API reports what its
   * running adapters actually execute (see `withExecutable`).
   */
  readonly executable: boolean;
  readonly tags: readonly string[];
}

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const HANDLE = /^[A-Za-z0-9_]{1,15}$/u;
const DATE = /^\d{4}-\d{2}-\d{2}$/u;

export interface ProtocolRowIssue {
  readonly id: string;
  readonly message: string;
}

/** Structural checks for registry rows; an empty list means every row is usable. */
export function validateProtocolRows(rows: readonly ProtocolDescriptor[]): ProtocolRowIssue[] {
  const issues: ProtocolRowIssue[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const fail = (message: string) => issues.push({ id: row.id, message });
    if (!ID_PATTERN.test(row.id)) fail("id must be lower-case kebab");
    if (seen.has(row.id)) fail("duplicate id");
    seen.add(row.id);
    if (!row.name.trim()) fail("name is empty");
    if (!PROTOCOL_CATEGORIES.includes(row.category)) fail(`unknown category ${row.category}`);
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
    const networks = new Set<string>();
    for (const deployment of row.deployments) {
      if (!isNetworkKey(deployment.network)) fail(`unknown network ${String(deployment.network)}`);
      if (networks.has(deployment.network)) fail(`two deployments on ${deployment.network}`);
      networks.add(deployment.network);
      if (!DEPLOYMENT_STATUSES.includes(deployment.status)) fail(`unknown status ${deployment.status}`);
      if (deployment.since !== undefined && !DATE.test(deployment.since)) fail("since must be YYYY-MM-DD");
      for (const [role, value] of Object.entries(deployment.contracts)) {
        if (!isEvmAddress(value) && !value.startsWith("https://") && !value.startsWith("wss://")) fail(`${role} is neither an address nor a URL`);
      }
      const testnet = isNetworkKey(deployment.network) && NETWORKS[deployment.network].environment === "testnet";
      if (deployment.status === "live" && testnet) fail(`${deployment.network} is a testnet: use testnet-live`);
      if (deployment.status === "testnet-live" && !testnet) fail(`${deployment.network} is a mainnet: use live`);
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

export function isProtocolId(value: unknown): value is string {
  return typeof value === "string" && BY_ID.has(value);
}

/** Protocols with any deployment on `network`, optionally only in the given statuses. */
export function protocolsFor(network: NetworkKey, statuses?: readonly DeploymentStatus[]): ProtocolDescriptor[] {
  return PROTOCOLS.filter((protocol) =>
    protocol.deployments.some((deployment) => deployment.network === network && (!statuses || statuses.includes(deployment.status))),
  );
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

/** Number of protocols per category (every category present, zero when empty). */
export function countByCategory(protocols: readonly ProtocolDescriptor[] = PROTOCOLS): Record<ProtocolCategory, number> {
  const counts = Object.fromEntries(PROTOCOL_CATEGORIES.map((category) => [category, 0])) as Record<ProtocolCategory, number>;
  for (const protocol of protocols) counts[protocol.category] += 1;
  return counts;
}

/** Number of deployments per status across protocols. */
export function countByStatus(protocols: readonly ProtocolDescriptor[] = PROTOCOLS): Record<DeploymentStatus, number> {
  const counts = Object.fromEntries(DEPLOYMENT_STATUSES.map((status) => [status, 0])) as Record<DeploymentStatus, number>;
  for (const protocol of protocols) for (const deployment of protocol.deployments) counts[deployment.status] += 1;
  return counts;
}

/**
 * The registry with `executable` replaced by what a running service really
 * executes (its active adapters' protocol ids). Used by `GET /v1/protocols`.
 */
export function withExecutable(activeProtocolIds: Iterable<string>, protocols: readonly ProtocolDescriptor[] = PROTOCOLS): ProtocolDescriptor[] {
  const active = new Set(activeProtocolIds);
  return protocols.map((protocol) => ({ ...protocol, executable: active.has(protocol.id) && protocol.capabilities.length > 0 }));
}
