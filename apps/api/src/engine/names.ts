/**
 * Recipient names: "bona.ely" resolves through Elysium Names on the
 * environment's Elysium network (`resolve("bona")`, labels only, lower-case
 * ASCII so homoglyph names never resolve). An unregistered name is an error
 * (422 NAME_UNRESOLVED), never the zero address. The same 0x key is the
 * recipient on every EVM network and HyperCore; the plan says which name
 * resolved to which address.
 */
import { NETWORKS, type NetworkEnvironment, type NetworkKey } from "@elyia/core";
import type { Address } from "viem";
import { ELY_NAMES_ABI } from "./abis.js";
import type { EngineDeps } from "./deps.js";
import { engineError } from "./errors.js";
import { ELY_NAMES } from "./venues.js";

const NAME = /^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)\.ely$/u;
const ZERO = "0x0000000000000000000000000000000000000000";
const CACHE_MS = 60_000;

export interface ResolvedName {
  readonly name: string;
  readonly address: Address;
  readonly network: NetworkKey;
}

const cache = new Map<string, { readonly value: ResolvedName; readonly at: number }>();

/** The `.ely` label of `raw`, or null when it is not a name (addresses and CAIP-10 ids pass through). */
export function elyLabel(raw: string): string | null {
  const text = raw.trim();
  if (!/\.ely$/iu.test(text)) return null;
  const lower = text.toLowerCase();
  const match = NAME.exec(lower);
  if (!match) throw engineError("NAME_UNRESOLVED", `${text} is not a valid .ely name (letters, digits and hyphens only).`);
  return match[1] as string;
}

export async function resolveElyName(deps: EngineDeps, environment: NetworkEnvironment, raw: string): Promise<ResolvedName | null> {
  const label = elyLabel(raw);
  if (label === null) return null;
  const network = `elysium-${environment}` as NetworkKey;
  const registry = ELY_NAMES[network];
  if (!registry) throw engineError("NAME_UNRESOLVED", `.ely names are not readable on ${NETWORKS[network]?.name ?? network} yet.`);
  const key = `${network}:${label}`;
  const cached = cache.get(key);
  if (cached && deps.clock.now() - cached.at < CACHE_MS) return cached.value;
  const address = (await deps.evm.read(network, { address: registry, abi: ELY_NAMES_ABI, functionName: "resolve", args: [label] })).toLowerCase() as Address;
  if (address === ZERO) throw engineError("NAME_UNRESOLVED", `${label}.ely is not registered on ${NETWORKS[network].name}.`, { name: `${label}.ely`, network });
  const value: ResolvedName = { name: `${label}.ely`, address, network };
  cache.set(key, { value, at: deps.clock.now() });
  return value;
}
