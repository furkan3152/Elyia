/** Shared request schemas of the markets and portfolio routes. */
import type { NetworkEnvironment } from "@elyia/core";
import type { HyperCoreNetworkKey } from "@elyia/core/api/markets";
import { z } from "zod";
import { queryString } from "../../http/validate.js";

const NETWORK_ALIASES: Readonly<Record<string, HyperCoreNetworkKey>> = Object.freeze({
  "hypercore-testnet": "hypercore-testnet",
  "hypercore-mainnet": "hypercore-mainnet",
  testnet: "hypercore-testnet",
  mainnet: "hypercore-mainnet",
});

/** `?network=hypercore-testnet|hypercore-mainnet` (or `testnet` / `mainnet`). */
export const hyperCoreNetworkParam = queryString(32)
  .trim()
  .refine((value) => value in NETWORK_ALIASES, "Expected hypercore-testnet or hypercore-mainnet.")
  .transform((value) => NETWORK_ALIASES[value] as HyperCoreNetworkKey);

export function hyperCoreKeyFor(mode: NetworkEnvironment): HyperCoreNetworkKey {
  return mode === "mainnet" ? "hypercore-mainnet" : "hypercore-testnet";
}

/** A market coin as HyperCore names books: `BTC`, `kPEPE`, `xyz:TSLA`, `@1035`, `PURR/USDC`. */
export const coinParam = z
  .string({ invalid_type_error: "Expected a single coin." })
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9@:/#._+-]+$/u, "Expected a market coin such as BTC, xyz:TSLA, @1035 or PURR/USDC.");

/** A HIP-3 dex name as listed by `perpDexs`. */
export const dexName = z
  .string()
  .trim()
  .min(1)
  .max(32)
  .regex(/^[A-Za-z0-9_-]+$/u, "Expected a perp dex name.");

export const CoinParams = z.object({ coin: coinParam });
