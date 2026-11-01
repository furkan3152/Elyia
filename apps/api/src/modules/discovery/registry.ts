/**
 * The protocol registry as this server runs it: core rows with `executable`
 * replaced by what the engine's adapters really execute
 * (`activeProtocolIds` -> `withExecutable`), plus the listing filters of
 * GET /v1/protocols (network, kind, category, status, executable, tag, q).
 */
import {
  countByKind,
  countByProtocolStatus,
  isNetworkKey,
  listProtocols,
  NETWORKS,
  PROTOCOLS,
  withExecutable,
  type NetworkEnvironment,
  type NetworkKey,
  type ProtocolDescriptor,
  type ProtocolKind,
  type ProtocolStatus,
} from "@elyia/core";
import type { ProtocolCounts } from "@elyia/core/api/discovery";
import type { AppContext } from "../../context.js";
import { engineFor } from "../../engine/index.js";
import { activeProtocolIds } from "../../engine/registry.js";

/** Engine adapter ids that are not registry protocols (plain native / ERC-20 sends; Elyia's own router, recorded in the deployment registry). */
export const ENGINE_ONLY_IDS: ReadonlySet<string> = new Set(["evm-transfer", "elyia-router"]);

export interface LiveRegistry {
  readonly rows: readonly ProtocolDescriptor[];
  /** Registry ids the running adapters execute. */
  readonly executableIds: readonly string[];
  byId(id: string): ProtocolDescriptor | null;
}

const registries = new WeakMap<AppContext, LiveRegistry>();

/** The context's registry with `executable` from its engine (computed once; adapters do not change at run time). */
export function liveRegistry(ctx: AppContext): LiveRegistry {
  let registry = registries.get(ctx);
  if (!registry) {
    const active = activeProtocolIds(engineFor(ctx).registry.adapters).filter((id) => !ENGINE_ONLY_IDS.has(id));
    registry = registryFrom(active);
    registries.set(ctx, registry);
  }
  return registry;
}

export function registryFrom(active: readonly string[], protocols: readonly ProtocolDescriptor[] = PROTOCOLS): LiveRegistry {
  const rows = withExecutable(active, protocols);
  const byId = new Map(rows.map((row) => [row.id, row]));
  const executableIds = rows.filter((row) => row.executable).map((row) => row.id);
  return { rows, executableIds, byId: (id) => byId.get(id) ?? null };
}

export interface RegistryFilter {
  readonly network?: NetworkKey;
  readonly environment?: NetworkEnvironment;
  readonly kind?: ProtocolKind;
  readonly category?: ProtocolKind;
  readonly status?: ProtocolStatus;
  readonly executable?: boolean;
  readonly tag?: string;
  readonly q?: string;
}

function haystack(row: ProtocolDescriptor): string {
  return [
    row.id,
    row.name,
    row.description,
    row.kind,
    row.category,
    ...row.tags,
    row.x ?? "",
    ...row.deployments.flatMap((deployment) => Object.values(deployment.contracts)),
    ...row.deployments.flatMap((deployment) => (deployment.contractInfo ?? []).map((contract) => contract.role)),
  ]
    .join(" ")
    .toLowerCase();
}

/** Rows matching every filter, in registry order. `q` matches all of its words. */
export function filterRegistry(rows: readonly ProtocolDescriptor[], filter: RegistryFilter): ProtocolDescriptor[] {
  const words = (filter.q ?? "").toLowerCase().split(/\s+/u).filter((word) => word.length > 0);
  return listProtocols(
    {
      ...(filter.network ? { network: filter.network } : {}),
      ...(filter.kind ? { kind: filter.kind } : {}),
      ...(filter.category ? { category: filter.category } : {}),
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.executable !== undefined ? { executable: filter.executable } : {}),
      ...(filter.tag ? { tag: filter.tag } : {}),
    },
    rows,
  ).filter((row) => {
    if (filter.environment && !row.deployments.some((deployment) => isNetworkKey(deployment.network) && NETWORKS[deployment.network].environment === filter.environment)) return false;
    if (words.length === 0) return true;
    const text = haystack(row);
    return words.every((word) => text.includes(word));
  });
}

export function registryCounts(rows: readonly ProtocolDescriptor[]): ProtocolCounts {
  return { byKind: countByKind(rows), byStatus: countByProtocolStatus(rows) };
}
