/**
 * The protocols a sentence can name, with the words people use for them.
 * Ids are the engine's venue ids where an adapter exists (`kalos-v3`,
 * `dex-da-costa`, `hyperswap-v3`) and the core registry / research ids
 * otherwise (research/elysium-protocols.json, 2026-10-31). The reader reads
 * every row (a named venue is a constraint on the route) and warns when the
 * engine does not execute it, so a venue the engine cannot use is never
 * silently replaced by another one. What executes is not written here: it
 * comes from the same source as the engine and GET /v1/protocols (the running
 * adapters -> `activeProtocolIds` -> `withExecutable`; `REGISTRY_EXECUTABLE`,
 * the core registry's pinned copy of that set, when no server is at hand).
 */
import { PROTOCOLS, type NetworkFamily } from "@elyia/core";

export type VenueCategory = "dex" | "bridge" | "liquid-staking" | "staking" | "vault" | "lending" | "launchpad" | "perps" | "names" | "aggregator";

export interface VenueWord {
  readonly id: string;
  readonly label: string;
  readonly category: VenueCategory;
  readonly family: NetworkFamily;
  /** Folded words and phrases ("dex da costa"). */
  readonly words: readonly string[];
  /** Mainnet only, announced: never on testnet. */
  readonly mainnetOnly?: true;
  /** For staking vaults: what goes in and what comes out. */
  readonly stakes?: { readonly asset: string; readonly receipt: string };
}

export const VENUE_WORDS: readonly VenueWord[] = Object.freeze([
  { id: "kalos-v3", label: "Kalos V3", category: "dex", family: "elysium", words: ["kalos", "kalos v3", "kalos dex", "kalos swap"] },
  { id: "dex-da-costa", label: "Dex Da Costa", category: "dex", family: "elysium", words: ["dex da costa", "dexdacosta", "da costa", "ddc"] },
  { id: "hexswap", label: "HexSwap", category: "dex", family: "elysium", words: ["hexswap", "hex swap"] },
  { id: "perpme", label: "PerpMe", category: "dex", family: "elysium", words: ["perpme", "perp me", "perpme v3"] },
  { id: "hyperswap-v3", label: "HyperSwap V3", category: "dex", family: "hyperevm", words: ["hyperswap", "hyper swap", "hyperswap v3"] },
  { id: "kalos-stkalos", label: "stKALOS vault", category: "vault", family: "elysium", words: ["stkalos vault", "kalos staking", "kalos vault"], stakes: { asset: "KALOS", receipt: "stKALOS" } },
  { id: "kinetiq", label: "Kinetiq", category: "liquid-staking", family: "hyperevm", words: ["kinetiq", "kinetiq staking"], stakes: { asset: "HYPE", receipt: "kHYPE" } },
  { id: "hypercore-staking", label: "HyperCore staking", category: "staking", family: "hypercore", words: ["native staking", "hypercore staking", "validator", "validators", "dogal staking"] },
  { id: "elysium-canonical-bridge", label: "Elysium canonical bridge", category: "bridge", family: "elysium", words: ["canonical bridge", "official bridge", "elysium bridge", "token bridge", "orbit bridge", "resmi kopru"] },
  { id: "elysium-mirror-bridge", label: "Elysium mirror bridge", category: "bridge", family: "elysium", words: ["mirror bridge", "mirror kopru"] },
  { id: "cheshire", label: "Cheshire", category: "lending", family: "elysium", words: ["cheshire"] },
  { id: "elyra-lending", label: "Elyra lending", category: "lending", family: "elysium", words: ["elyra", "elyra lending", "useelyra"] },
  { id: "hypercore-vaults", label: "HyperCore vaults (HLP)", category: "vault", family: "hypercore", words: ["hlp", "hyperliquidity provider"] },
  { id: "elysium-names", label: "Elysium Names", category: "names", family: "elysium", words: ["elynames", "ely names", "elysium names"] },
  { id: "signal", label: "Signal", category: "launchpad", family: "elysium", words: ["signal", "signal family"] },
  { id: "ascend", label: "Ascend", category: "launchpad", family: "elysium", words: ["ascend"] },
  { id: "chainzy", label: "Chainzy", category: "launchpad", family: "elysium", words: ["chainzy"] },
  { id: "neuriio", label: "Neuriio", category: "launchpad", family: "elysium", words: ["neuriio"] },
  { id: "bunnypad", label: "BunnyPad", category: "launchpad", family: "elysium", words: ["bunnypad", "bunny pad"] },
  { id: "corepad", label: "CorePad", category: "launchpad", family: "elysium", words: ["corepad", "core pad"] },
  { id: "kiln", label: "Kiln", category: "launchpad", family: "elysium", words: ["kiln"] },
  { id: "anemos", label: "ANEMOS", category: "launchpad", family: "elysium", words: ["anemos"] },
  { id: "oxley", label: "Oxley", category: "launchpad", family: "elysium", words: ["oxley"] },
  { id: "aka-fun", label: "aka.fun", category: "launchpad", family: "elysium", words: ["aka.fun", "akafun", "aka fun"] },
  { id: "reactor-perps", label: "Reactor Perps", category: "perps", family: "elysium", words: ["reactor", "reactor perps", "perps studio"] },
  { id: "nest", label: "Nest", category: "dex", family: "elysium", words: ["nest"], mainnetOnly: true },
  { id: "uniswap", label: "Uniswap", category: "dex", family: "elysium", words: ["uniswap"], mainnetOnly: true },
  { id: "kyberswap", label: "KyberSwap", category: "aggregator", family: "elysium", words: ["kyberswap", "kyber"], mainnetOnly: true },
  { id: "pump-fun", label: "Pump.fun", category: "launchpad", family: "elysium", words: ["pump.fun", "pumpfun", "pump fun"], mainnetOnly: true },
]);

/**
 * Registry ids the core registry marks executable: the engine adapters'
 * protocol ids, pinned by the core and discovery tests. Readers given a
 * server context use that server's live set (`liveRegistry(ctx)`) instead.
 */
export const REGISTRY_EXECUTABLE: ReadonlySet<string> = new Set(PROTOCOLS.filter((protocol) => protocol.executable).map((protocol) => protocol.id));

/** Whether a named venue is one the engine executes (by the given executable set). */
export function venueExecutable(venue: VenueWord, executable: ReadonlySet<string> = REGISTRY_EXECUTABLE): boolean {
  return executable.has(venue.id);
}

const BY_ID = new Map(VENUE_WORDS.map((venue) => [venue.id, venue]));

export function venueById(id: string): VenueWord | null {
  return BY_ID.get(id) ?? null;
}
