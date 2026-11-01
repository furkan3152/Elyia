/**
 * Contract artifacts exported by packages/contracts into
 * `packages/core/src/contracts/` (generated `.ts` with ABI + bytecode +
 * version, compiled into @elyia/core's dist). They are optional at runtime:
 * until the contracts package exports them, every artifact-dependent route
 * answers 503 CONTRACTS_NOT_EXPORTED and the router venue stays off.
 *
 * The loader imports `@elyia/core/contracts/index` when it exists, and
 * otherwise every module in the compiled `dist/contracts/` folder, and keeps
 * any export that looks like an artifact (`abi` array + `bytecode` hex), by
 * `contractName` or export name.
 */
import { readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { ContractArtifact } from "@elyia/core/api/admin";
import { ElyiaHttpError } from "../../http/errors.js";

const HEX = /^0x[0-9a-fA-F]*$/u;

function asArtifact(name: string, value: unknown, fallbackVersion: string | null): ContractArtifact | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const abi = record.abi;
  const bytecode = record.bytecode ?? (record.evm as { bytecode?: { object?: unknown } } | undefined)?.bytecode?.object;
  const deployed = record.deployedBytecode ?? (record.evm as { deployedBytecode?: { object?: unknown } } | undefined)?.deployedBytecode?.object;
  if (!Array.isArray(abi) || typeof bytecode !== "string" || !HEX.test(bytecode) || bytecode.length < 4) return null;
  const contractName = typeof record.contractName === "string" ? record.contractName : typeof record.name === "string" ? record.name : name;
  const version = typeof record.version === "string" ? record.version : fallbackVersion ?? "unversioned";
  return {
    contractName,
    abi,
    bytecode: bytecode as `0x${string}`,
    deployedBytecode: (typeof deployed === "string" && HEX.test(deployed) ? deployed : "0x") as `0x${string}`,
    version,
  };
}

function collect(module: Record<string, unknown>, into: Map<string, ContractArtifact>): void {
  const version = typeof module.VERSION === "string" ? module.VERSION : typeof module.CONTRACTS_VERSION === "string" ? module.CONTRACTS_VERSION : null;
  const visit = (name: string, value: unknown, depth: number) => {
    const artifact = asArtifact(name, value, version);
    if (artifact) {
      into.set(artifact.contractName, artifact);
      return;
    }
    if (depth < 2 && typeof value === "object" && value !== null && !Array.isArray(value)) {
      for (const [key, nested] of Object.entries(value as Record<string, unknown>)) visit(key, nested, depth + 1);
    }
  };
  for (const [name, value] of Object.entries(module)) visit(name, value, 0);
}

/** A deployment manifest exported next to the artifacts (`<network>DeployManifest`). */
export interface DeployManifest {
  readonly network: string;
  readonly chainId: number;
  readonly version: string;
  readonly order: ReadonlyArray<{ readonly step: number; readonly contract: string; readonly constructor: ReadonlyArray<{ readonly name: string; readonly type: string; readonly value: unknown }> }>;
  /** Standalone contracts (the Herd collection): constructor values may name `$PARAM.<name>` deploy-time inputs. */
  readonly collections?: ReadonlyArray<{ readonly key: string; readonly contract: string; readonly constructor: ReadonlyArray<{ readonly name: string; readonly type: string; readonly value: unknown }> }>;
}

const manifests = new Map<string, DeployManifest>();

function collectManifests(module: Record<string, unknown>): void {
  for (const value of Object.values(module)) {
    const record = value as Partial<DeployManifest> | null;
    if (record && typeof record === "object" && typeof record.network === "string" && Array.isArray(record.order)) manifests.set(record.network, record as DeployManifest);
  }
}

/** The exported manifest of a network, once artifacts were loaded. */
export async function deployManifest(network: string): Promise<DeployManifest | null> {
  await contractArtifacts();
  return manifests.get(network) ?? null;
}

let loaded: Promise<ReadonlyMap<string, ContractArtifact>> | null = null;
let override: ReadonlyMap<string, ContractArtifact> | null = null;

async function load(): Promise<ReadonlyMap<string, ContractArtifact>> {
  const found = new Map<string, ContractArtifact>();
  try {
    const index = (await import("@elyia/core/contracts/index" as string)) as Record<string, unknown>;
    collect(index, found);
    collectManifests(index);
    if (found.size > 0) return found;
  } catch {
    // No index module: scan the folder.
  }
  try {
    const require = createRequire(import.meta.url);
    const dir = join(dirname(require.resolve("@elyia/core/package.json")), "dist", "contracts");
    for (const file of (await readdir(dir)).filter((entry) => entry.endsWith(".js")).sort()) {
      try {
        const module = (await import(pathToFileURL(join(dir, file)).href)) as Record<string, unknown>;
        collect(module, found);
        collectManifests(module);
      } catch {
        // A module that fails to import is skipped.
      }
    }
  } catch {
    // Not exported yet.
  }
  return found;
}

/** Every artifact the contracts package exported (empty until it does). Cached per process. */
export function contractArtifacts(): Promise<ReadonlyMap<string, ContractArtifact>> {
  if (override) return Promise.resolve(override);
  loaded ??= load();
  return loaded;
}

/** Installs artifacts directly (tests) or clears the cache (null) so the next call reloads. */
export function setContractArtifacts(artifacts: ReadonlyMap<string, ContractArtifact> | null): void {
  override = artifacts;
  loaded = null;
}

export async function artifactOf(name: string): Promise<ContractArtifact> {
  const artifact = (await contractArtifacts()).get(name);
  if (!artifact) throw new ElyiaHttpError("CONTRACTS_NOT_EXPORTED", 503, `The ${name} artifact is not exported yet (packages/contracts -> packages/core/src/contracts).`, { contract: name });
  return artifact;
}
