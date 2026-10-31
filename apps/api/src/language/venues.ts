/**
 * The protocols a sentence can name, with the words people use for them.
 * Ids are the engine's venue ids where an adapter exists (`kalos-v3`,
 * `dex-da-costa`, `hyperswap-v3`) and the core registry / research ids
 * otherwise (research/elysium-protocols.json, 2026-10-31). `engine` marks
 * what the engine executes today; the reader reads every row (a named venue
 * is a constraint on the route) and warns when it is discovery-only, so a
 * venue the engine cannot use is never silently replaced by another one.
 */
import type { NetworkFamily } from "@elyia/core";

export type VenueCategory = "dex" | "bridge" | "liquid-staking" | "staking" | "vault" | "lending" | "launchpad" | "perps" | "names" | "aggregator";

export interface VenueWord {
  readonly id: string;
  readonly label: string;
  readonly category: VenueCategory;
  readonly family: NetworkFamily;
  /** Folded words and phrases ("dex da costa"). */
  readonly words: readonly string[];
  /** The engine plans through it today (an adapter exists). */
  readonly engine: boolean;
  /** Mainnet only, announced: never on testnet. */
  readonly mainnetOnly?: true;
  /** For staking vaults: what goes in and what comes out. */
  readonly stakes?: { readonly asset: string; readonly receipt: string };
}

export const VENUE_WORDS: readonly VenueWord[] = Object.freeze([
  { id: "kalos-v3", label: "Kalos V3", category: "dex", family: "elysium", words: ["kalos", "kalos v3", "kalos dex", "kalos swap"], engine: true },
  { id: "dex-da-costa", label: "Dex Da Costa", category: "dex", family: "elysium", words: ["dex da costa", "dexdacosta", "da costa", "ddc"], engine: true },
  { id: "hexswap", label: "HexSwap", category: "dex", family: "elysium", words: ["hexswap", "hex swap"], engine: false },
  { id: "perpme", label: "PerpMe", category: "dex", family: "elysium", words: ["perpme", "perp me", "perpme v3"], engine: false },
  { id: "hyperswap-v3", label: "HyperSwap V3", category: "dex", family: "hyperevm", words: ["hyperswap", "hyper swap", "hyperswap v3"], engine: true },
  { id: "kalos-stkalos", label: "stKALOS vault", category: "vault", family: "elysium", words: ["stkalos vault", "kalos staking", "kalos vault"], engine: false, stakes: { asset: "KALOS", receipt: "stKALOS" } },
  { id: "kinetiq", label: "Kinetiq", category: "liquid-staking", family: "hyperevm", words: ["kinetiq", "kinetiq staking"], engine: true, stakes: { asset: "HYPE", receipt: "kHYPE" } },
  { id: "hypercore-staking", label: "HyperCore staking", category: "staking", family: "hypercore", words: ["native staking", "hypercore staking", "validator", "validators", "dogal staking"], engine: false },
  { id: "elysium-canonical-bridge", label: "Elysium canonical bridge", category: "bridge", family: "elysium", words: ["canonical bridge", "official bridge", "elysium bridge", "token bridge", "orbit bridge", "resmi kopru"], engine: true },
  { id: "elysium-mirror-bridge", label: "Elysium mirror bridge", category: "bridge", family: "elysium", words: ["mirror bridge", "mirror kopru"], engine: true },
  { id: "cheshire", label: "Cheshire", category: "lending", family: "elysium", words: ["cheshire"], engine: false },
  { id: "elyra-lending", label: "Elyra lending", category: "lending", family: "elysium", words: ["elyra", "elyra lending", "useelyra"], engine: false },
  { id: "hypercore-vaults", label: "HyperCore vaults (HLP)", category: "vault", family: "hypercore", words: ["hlp", "hyperliquidity provider"], engine: false },
  { id: "elysium-names", label: "Elysium Names", category: "names", family: "elysium", words: ["elynames", "ely names", "elysium names"], engine: false },
  { id: "signal", label: "Signal", category: "launchpad", family: "elysium", words: ["signal", "signal family"], engine: false },
  { id: "ascend", label: "Ascend", category: "launchpad", family: "elysium", words: ["ascend"], engine: false },
  { id: "chainzy", label: "Chainzy", category: "launchpad", family: "elysium", words: ["chainzy"], engine: false },
  { id: "neuriio", label: "Neuriio", category: "launchpad", family: "elysium", words: ["neuriio"], engine: false },
  { id: "bunnypad", label: "BunnyPad", category: "launchpad", family: "elysium", words: ["bunnypad", "bunny pad"], engine: false },
  { id: "corepad", label: "CorePad", category: "launchpad", family: "elysium", words: ["corepad", "core pad"], engine: false },
  { id: "kiln", label: "Kiln", category: "launchpad", family: "elysium", words: ["kiln"], engine: false },
  { id: "anemos", label: "ANEMOS", category: "launchpad", family: "elysium", words: ["anemos"], engine: false },
  { id: "oxley", label: "Oxley", category: "launchpad", family: "elysium", words: ["oxley"], engine: false },
  { id: "aka-fun", label: "aka.fun", category: "launchpad", family: "elysium", words: ["aka.fun", "akafun", "aka fun"], engine: false },
  { id: "reactor-perps", label: "Reactor Perps", category: "perps", family: "elysium", words: ["reactor", "reactor perps", "perps studio"], engine: false },
  { id: "nest", label: "Nest", category: "dex", family: "elysium", words: ["nest"], engine: false, mainnetOnly: true },
  { id: "uniswap", label: "Uniswap", category: "dex", family: "elysium", words: ["uniswap"], engine: false, mainnetOnly: true },
  { id: "kyberswap", label: "KyberSwap", category: "aggregator", family: "elysium", words: ["kyberswap", "kyber"], engine: false, mainnetOnly: true },
  { id: "pump-fun", label: "Pump.fun", category: "launchpad", family: "elysium", words: ["pump.fun", "pumpfun", "pump fun"], engine: false, mainnetOnly: true },
]);

const BY_ID = new Map(VENUE_WORDS.map((venue) => [venue.id, venue]));

export function venueById(id: string): VenueWord | null {
  return BY_ID.get(id) ?? null;
}
