/**
 * The deployment registry of Elyia's own contracts.
 *
 * The owner deploys from his own wallet (the web admin panel signs the
 * creation transactions of `GET /v1/admin/deploy-plan`); the server never
 * deploys. `POST /v1/admin/deployments` records one only after checking:
 *
 * - the receipt exists and succeeded;
 * - the created address is the receipt's `contractAddress` (or, for a
 *   factory-created contract, appears in the receipt's logs);
 * - the deployer (`tx.from`) is an admin address;
 * - the creation input starts with the artifact's creation code (metadata
 *   hashes masked) when the contract was created directly;
 * - the on-chain runtime code equals the artifact's runtime code, except
 *   inside the artifact's zero-filled immutable slots and the CBOR metadata.
 *
 * A recorded ElyiaRouter turns on the `elyia-router` engine venue for that
 * network at once (and at every boot).
 */
import { ELYIA_CONTRACT_NAMES, type ContractArtifact, type DeploymentRecord, type DeployPlanResponse, type ElyiaContractName, type RouterSettingsResponse } from "@elyia/core/api/admin";
import { getEvmNetwork, NETWORKS, type NetworkKey } from "@elyia/core";
import { decodeFunctionResult, encodeDeployData, encodeFunctionData, keccak256, toFunctionSelector, type Abi, type AbiFunction, type Address, type Hex } from "viem";
import type { AppContext } from "../../context.js";
import { ELYIA_ROUTER_ABI, setElyiaRouterArtifact, setElyiaRouterDeployment, routerAllowlist, VIRTUAL_ROUTER } from "../../engine/adapters/elyiaRouter.js";
import { ElyiaHttpError } from "../../http/errors.js";
import { docs, PLATFORM_COLLECTIONS } from "../ops/docs.js";
import { artifactOf, contractArtifacts, deployManifest } from "./artifacts.js";

/* ------------------------------------------------------- code matching */

const METADATA = /a264697066735822[0-9a-f]{68}64736f6c6343[0-9a-f]{6}0033/gu;

export function maskMetadata(code: string): string {
  return code.toLowerCase().replace(METADATA, (match) => "0".repeat(match.length));
}

function strip0x(hex: string): string {
  return hex.startsWith("0x") ? hex.slice(2).toLowerCase() : hex.toLowerCase();
}

/**
 * Runtime code equality up to immutables and metadata: every differing byte
 * must sit inside a run of at least 32 zero bytes of the artifact (solc
 * zero-fills immutable slots in `deployedBytecode`).
 */
export function runtimeMatches(onchain: string, artifact: string): boolean {
  const a = maskMetadata(strip0x(onchain));
  const b = maskMetadata(strip0x(artifact));
  if (a.length !== b.length || a.length === 0) return false;
  const bytes = b.length / 2;
  // Zero runs of the artifact.
  const inZeroRun = new Uint8Array(bytes);
  let start = -1;
  for (let i = 0; i <= bytes; i += 1) {
    const zero = i < bytes && b.slice(i * 2, i * 2 + 2) === "00";
    if (zero && start < 0) start = i;
    if (!zero && start >= 0) {
      if (i - start >= 32) inZeroRun.fill(1, start, i);
      start = -1;
    }
  }
  for (let i = 0; i < bytes; i += 1) {
    if (a.slice(i * 2, i * 2 + 2) !== b.slice(i * 2, i * 2 + 2) && inZeroRun[i] !== 1) return false;
  }
  return true;
}

export function creationMatches(input: string, creationCode: string): boolean {
  const code = maskMetadata(strip0x(creationCode));
  return code.length > 0 && maskMetadata(strip0x(input)).startsWith(code);
}

/* ------------------------------------------------------------ registry */

type RawRequest = (args: { method: string; params?: readonly unknown[] }) => Promise<unknown>;

function rpc(ctx: AppContext, network: NetworkKey): RawRequest {
  if (!ctx.chains.isAvailable(network)) throw new ElyiaHttpError("NETWORK_UNAVAILABLE", 503, `${network} has no RPC configured.`, { network });
  return ctx.chains.client(network).request as unknown as RawRequest;
}

export interface DeploymentInput {
  readonly network: NetworkKey;
  readonly contract: ElyiaContractName;
  readonly txHash: Hex;
  readonly address?: string;
  readonly recordedBy: string;
}

export async function verifyDeployment(ctx: AppContext, input: DeploymentInput, artifact: ContractArtifact): Promise<DeploymentRecord> {
  const request = rpc(ctx, input.network);
  const [receipt, tx] = (await Promise.all([
    request({ method: "eth_getTransactionReceipt", params: [input.txHash] }),
    request({ method: "eth_getTransactionByHash", params: [input.txHash] }),
  ])) as [Record<string, unknown> | null, Record<string, unknown> | null];
  if (!receipt || !tx) throw new ElyiaHttpError("DEPLOYMENT_NOT_FOUND", 404, "No receipt for that transaction on this network yet.");
  const success = receipt.status === "0x1";
  const contractAddress = typeof receipt.contractAddress === "string" ? receipt.contractAddress.toLowerCase() : null;
  const address = (input.address?.toLowerCase() ?? contractAddress) as Address | null;
  if (!address) throw new ElyiaHttpError("DEPLOYMENT_INVALID", 422, "The transaction created no contract; pass `address` for a factory-created one.");
  const logs = Array.isArray(receipt.logs) ? (receipt.logs as Array<{ address?: string; topics?: string[]; data?: string }>) : [];
  const bare = address.slice(2);
  const createdAddress = contractAddress === address || logs.some((log) => log.address?.toLowerCase() === address || (log.topics ?? []).some((topic) => topic.toLowerCase().endsWith(bare)) || (log.data ?? "").toLowerCase().includes(bare));
  const deployer = String(tx.from ?? "").toLowerCase();
  const code = String(await request({ method: "eth_getCode", params: [address, "latest"] }));
  const direct = contractAddress === address && (tx.to === null || tx.to === undefined);
  const checks = {
    receiptSuccess: success,
    createdAddress,
    creationCodeMatches: direct ? creationMatches(String(tx.input ?? ""), artifact.bytecode) : null,
    runtimeCodeMatches: artifact.deployedBytecode.length > 2 ? runtimeMatches(code, artifact.deployedBytecode) : false,
    deployerIsAdmin: ctx.config.adminAddresses.includes(deployer),
  };
  const failed = Object.entries(checks).filter(([, value]) => value === false).map(([name]) => name);
  if (failed.length > 0) throw new ElyiaHttpError("DEPLOYMENT_REJECTED", 422, `The deployment did not verify: ${failed.join(", ")}.`, { checks });
  return {
    network: input.network,
    contract: input.contract,
    address,
    txHash: input.txHash,
    deployer,
    blockNumber: BigInt(String(receipt.blockNumber)).toString(),
    artifactVersion: artifact.version,
    codeHash: keccak256(code as Hex),
    checks,
    recordedAt: new Date(ctx.clock.now()).toISOString(),
    recordedBy: input.recordedBy,
  };
}

export async function recordDeployment(ctx: AppContext, input: DeploymentInput): Promise<DeploymentRecord> {
  const artifact = await artifactOf(input.contract);
  const record = await verifyDeployment(ctx, input, artifact);
  await docs<DeploymentRecord>(ctx, PLATFORM_COLLECTIONS.deployments).put(`${record.network}:${record.contract}`, record);
  await docs<DeploymentRecord>(ctx, PLATFORM_COLLECTIONS.deploymentHistory).put(`${record.network}:${record.contract}:${record.recordedAt}`, record);
  applyDeployment(record);
  return record;
}

export function applyDeployment(record: DeploymentRecord): void {
  if (record.contract === "ElyiaRouter") setElyiaRouterDeployment(record.network, { address: record.address as Address, artifactVersion: record.artifactVersion });
}

export async function listDeployments(ctx: AppContext, network?: NetworkKey): Promise<DeploymentRecord[]> {
  return (await docs<DeploymentRecord>(ctx, PLATFORM_COLLECTIONS.deployments).list({ ...(network ? { prefix: `${network}:` } : {}), limit: 200 })).map((doc) => doc.value);
}

/** Boot: re-arm the router venue from the registry and give the engine the artifact's runtime code. */
export async function loadRegistry(ctx: AppContext): Promise<void> {
  const router = (await contractArtifacts()).get("ElyiaRouter");
  if (router && router.deployedBytecode.length > 2) {
    if (routerAbiCompatible(router.abi)) setElyiaRouterArtifact({ deployedBytecode: router.deployedBytecode, version: router.version });
    else ctx.log.warn("ElyiaRouter artifact ABI does not match the engine adapter's swap/venueKind selectors; router venue stays off", { version: router.version });
  }
  for (const record of await listDeployments(ctx)) applyDeployment(record);
}

/** The adapter encodes `swap`, `venueKind`, `integratorMaxFeeBps` itself: the artifact must expose the same selectors. */
export function routerAbiCompatible(abi: readonly unknown[]): boolean {
  const selectors = new Set((abi as AbiFunction[]).filter((entry) => entry.type === "function").map((entry) => toFunctionSelector(entry)));
  return (ELYIA_ROUTER_ABI as readonly AbiFunction[]).filter((entry) => entry.type === "function" && entry.name !== "paused").every((entry) => selectors.has(toFunctionSelector(entry)));
}

/* ---------------------------------------------------------- deploy plan */

function constructorOf(abi: readonly unknown[]): { readonly inputs: ReadonlyArray<{ readonly name?: string; readonly type: string }> } | null {
  return (abi.find((entry) => (entry as { type?: string }).type === "constructor") as { inputs: Array<{ name?: string; type: string }> } | undefined) ?? null;
}

/**
 * Ordered creation transactions. Constructor args come from the contracts
 * package's manifest (`$OWNER` = the admin's wallet, `$ElyiaRouter` = the
 * recorded router), else from what the server knows (router allowlist from
 * the engine's pinned venues).
 */
export async function deployPlan(ctx: AppContext, network: NetworkKey, owner: string): Promise<DeployPlanResponse> {
  const evm = getEvmNetwork(network);
  const artifacts = await contractArtifacts();
  const manifest = await deployManifest(network);
  const deployed = new Map((await listDeployments(ctx, network)).map((record) => [record.contract, record.address]));
  const allowlist = routerAllowlist(network);
  const resolve = (value: unknown): unknown => {
    if (value === "$OWNER") return owner;
    if (typeof value === "string" && value.startsWith("$")) return deployed.get(value.slice(1) as ElyiaContractName) ?? null;
    if (Array.isArray(value)) return value.map(resolve);
    return value;
  };
  const order = manifest ? [...manifest.order].sort((a, b) => a.step - b.step).map((step) => step.contract) : ["ElyiaRouter", "ElyAccountFactory", "ElyOrders"];
  const steps: DeployPlanResponse["steps"][number][] = [];
  for (const name of order) {
    const artifact = artifacts.get(name);
    if (!artifact) {
      steps.push({ contract: name, deployed: deployed.get(name as ElyiaContractName) ?? null, transaction: null, constructorArgs: [], note: "Artifact not exported yet." });
      continue;
    }
    const inputs = constructorOf(artifact.abi)?.inputs ?? [];
    const fromManifest = manifest?.order.find((step) => step.contract === name)?.constructor ?? null;
    const values: unknown[] = [];
    const shown: Array<{ name: string; type: string; value: string | null }> = [];
    for (const [index, input] of inputs.entries()) {
      const key = (input.name ?? "").toLowerCase().replace(/_/gu, "");
      let value: unknown = null;
      const entry = fromManifest?.find((arg) => arg.name === input.name) ?? fromManifest?.[index];
      if (entry) value = resolve(entry.value);
      else if (key === "initialowner" || key === "owner") value = owner;
      else if (key === "permit2") value = evm.contracts.permit2;
      else if (key === "venues") value = allowlist.map((item) => item.venue);
      else if (key === "kinds") value = allowlist.map((item) => item.kind);
      else if (key === "router") value = deployed.get("ElyiaRouter") ?? null;
      values.push(value);
      shown.push({ name: input.name ?? "", type: input.type, value: value === null ? null : Array.isArray(value) ? value.join(",") : String(value) });
    }
    const ready = values.every((value) => value !== null && value !== undefined);
    steps.push({
      contract: name,
      deployed: deployed.get(name as ElyiaContractName) ?? null,
      transaction: ready ? { data: encodeDeployData({ abi: artifact.abi as Abi, bytecode: artifact.bytecode, args: values } as never), value: "0" } : null,
      constructorArgs: shown,
      note: ready ? (manifest ? `From the contracts manifest v${manifest.version}.` : null) : name === "ElyOrders" ? "Deploy and record ElyiaRouter first: ElyOrders takes the router's address." : "A constructor argument is unknown to the server.",
    });
  }
  return { network, chainId: evm.chainId, steps, simulated: false };
}

/* ------------------------------------------------------ router settings */

/** Every zero-argument view of the router ABI, read live from the recorded router. */
export async function routerSettings(ctx: AppContext, network: NetworkKey): Promise<RouterSettingsResponse> {
  const record = (await listDeployments(ctx, network)).find((entry) => entry.contract === "ElyiaRouter") ?? null;
  const artifact = (await contractArtifacts()).get("ElyiaRouter") ?? null;
  if (!artifact) return { network, address: record?.address ?? null, paused: null, reads: {}, note: "ElyiaRouter artifact not exported yet." };
  const views = (artifact.abi as AbiFunction[]).filter((entry) => entry.type === "function" && (entry.stateMutability === "view" || entry.stateMutability === "pure") && entry.inputs.length === 0);
  const reads: Record<string, string | null> = {};
  const target = (record?.address ?? VIRTUAL_ROUTER) as Address;
  const request = rpc(ctx, network);
  const override = record ? undefined : { [VIRTUAL_ROUTER]: { code: artifact.deployedBytecode } };
  for (const view of views) {
    try {
      const data = encodeFunctionData({ abi: [view], functionName: view.name });
      const raw = (await request({ method: "eth_call", params: [{ to: target, data }, "latest", ...(override ? [override] : [])] })) as Hex;
      const value: unknown = decodeFunctionResult({ abi: [view], functionName: view.name, data: raw });
      reads[view.name] = typeof value === "object" && value !== null ? JSON.stringify(value, (_key, item: unknown) => (typeof item === "bigint" ? item.toString() : item)) : String(value);
    } catch {
      reads[view.name] = null;
    }
  }
  return {
    network,
    address: record?.address ?? null,
    paused: reads.paused === undefined || reads.paused === null ? null : reads.paused === "true",
    reads,
    note: record ? null : "Not deployed: these are the artifact's defaults read through a code override (constructor state such as the owner and venues is absent).",
  };
}

export function isContractName(value: string): value is ElyiaContractName {
  return (ELYIA_CONTRACT_NAMES as readonly string[]).includes(value);
}

export function networkLabel(network: NetworkKey): string {
  return NETWORKS[network].name;
}
