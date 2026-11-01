/**
 * Wire contract of the admin surface and the public contract config:
 * Elyia's own contracts per network (deployed by the owner from his own
 * wallet and verified by the server), router settings, feature flags and
 * read-only system dashboards. Import as `@elyia/core/api/admin`.
 */
import type { NetworkKey } from "../networks.js";

export const ADMIN_API_VERSION = "elyia.api.admin/v1" as const;

/** Contracts Elyia ships (packages/contracts; artifacts in @elyia/core/contracts). */
export const ELYIA_CONTRACT_NAMES = Object.freeze(["ElyiaRouter", "ElyAccountFactory", "ElyAccount", "ElyOrders"] as const);
export type ElyiaContractName = (typeof ELYIA_CONTRACT_NAMES)[number];

/** The artifact shape the server and the web read (ABI + bytecode + version). */
export interface ContractArtifact {
  readonly contractName: string;
  readonly abi: readonly unknown[];
  /** Creation code, 0x hex. */
  readonly bytecode: `0x${string}`;
  /** Runtime code, 0x hex (immutables zero-filled). */
  readonly deployedBytecode: `0x${string}`;
  readonly version: string;
}

export interface DeploymentChecks {
  readonly receiptSuccess: boolean;
  /** The receipt (or a creation log) names this address. */
  readonly createdAddress: boolean;
  /** The creation input starts with the artifact's creation code (metadata hash ignored). */
  readonly creationCodeMatches: boolean | null;
  /** On-chain runtime code equals the artifact's, except immutables and metadata. */
  readonly runtimeCodeMatches: boolean;
  /** The deployer is an admin address. */
  readonly deployerIsAdmin: boolean;
}

export interface DeploymentRecord {
  readonly network: NetworkKey;
  readonly contract: ElyiaContractName;
  readonly address: string;
  readonly txHash: string;
  readonly deployer: string;
  readonly blockNumber: string;
  readonly artifactVersion: string;
  readonly codeHash: string;
  readonly checks: DeploymentChecks;
  readonly recordedAt: string;
  readonly recordedBy: string;
}

/** POST /v1/admin/deployments. */
export interface RecordDeploymentRequest {
  readonly network: NetworkKey;
  readonly contract: ElyiaContractName;
  readonly txHash: string;
  /** Required when a factory created the contract (the receipt has no contractAddress). */
  readonly address?: string;
}

export interface RecordDeploymentResponse {
  readonly deployment: DeploymentRecord;
}

/** GET /v1/config/contracts?network=. */
export interface ContractsConfigResponse {
  readonly networks: readonly {
    readonly network: NetworkKey;
    readonly contracts: Readonly<Partial<Record<ElyiaContractName, { readonly address: string; readonly artifactVersion: string; readonly recordedAt: string }>>>;
  }[];
  /** Artifacts this server knows (null: the contracts package has not exported them yet). */
  readonly artifacts: readonly { readonly contractName: string; readonly version: string }[] | null;
}

/** GET /v1/admin/deploy-plan?network=: unsigned creation transactions for the owner's wallet. */
export interface DeployPlanResponse {
  readonly network: NetworkKey;
  readonly chainId: number;
  readonly steps: readonly {
    readonly contract: string;
    readonly deployed: string | null;
    /** Creation transaction (to = null) with constructor args encoded, or null when args need values the server lacks. */
    readonly transaction: { readonly data: `0x${string}`; readonly value: "0" } | null;
    readonly constructorArgs: readonly { readonly name: string; readonly type: string; readonly value: string | null }[];
    readonly note: string | null;
  }[];
  readonly simulated: boolean;
}

/** GET /v1/admin/router?network=. Every zero-argument view of the router ABI, read live. */
export interface RouterSettingsResponse {
  readonly network: NetworkKey;
  readonly address: string | null;
  readonly paused: boolean | null;
  readonly reads: Readonly<Record<string, string | null>>;
  readonly note: string | null;
}

export const FEATURE_FLAGS = Object.freeze(["elyiaRouterVenue", "agentLlm", "keeper", "telegram", "webhooks", "mcp", "alerts"] as const);
export type FeatureFlag = (typeof FEATURE_FLAGS)[number];
export type FeatureFlags = Readonly<Record<FeatureFlag, boolean>>;

export const DEFAULT_FEATURE_FLAGS: FeatureFlags = Object.freeze({
  elyiaRouterVenue: true,
  agentLlm: true,
  keeper: true,
  telegram: true,
  webhooks: true,
  mcp: true,
  alerts: true,
});

export interface FeatureFlagsResponse {
  readonly flags: FeatureFlags;
  readonly updatedAt: string | null;
  readonly updatedBy: string | null;
}

/** GET /v1/admin/system. */
export interface SystemDashboardResponse {
  readonly generatedAt: string;
  readonly health: { readonly status: string; readonly store: string; readonly uptimeSeconds: number };
  readonly usage: { readonly day: string; readonly requests: number; readonly plans: number; readonly prepares: number; readonly developers: number; readonly keys: number };
  readonly queues: Readonly<Record<string, { readonly pending: number; readonly note?: string }>>;
  readonly workers: Readonly<Record<string, { readonly running: boolean; readonly lastRunAt: string | null; readonly lastError: string | null }>>;
  readonly agent: { readonly mode: "ai" | "deterministic"; readonly model: string; readonly keepersActive: number };
}
