/**
 * ElyHerd's ABI for the browser: the exported artifact (packages/contracts →
 * @elyia/core/contracts). The wallet signs the mints; owner calls are
 * prepared by the API as calldata.
 */
import { elyHerdArtifact } from "@elyia/core/contracts/index";
import type { Abi } from "viem";

export const HERD_WEB_ABI = elyHerdArtifact.abi as unknown as Abi;
export const HERD_ARTIFACT = elyHerdArtifact;
