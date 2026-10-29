import { isNetworkKey, type NetworkKey } from "@elyia/core";
import { z } from "zod";

/** `?network=` as a registry key. */
export const networkKey = z
  .string({ invalid_type_error: "Expected a single network key." })
  .trim()
  .refine((value) => isNetworkKey(value), "Unknown network key (see GET /v1/networks).")
  .transform((value) => value as NetworkKey);

export const environment = z.enum(["testnet", "mainnet"], { errorMap: () => ({ message: "Expected testnet or mainnet." }) });
