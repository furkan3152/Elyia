import { keccak256, toHex } from "viem";
/** Which art a token shows (pure): the placeholder (0) before reveal, else (id - 1 + revealOffset) % supply + 1, as ElyHerd.metadataIndexOf. */
import type { HerdConfigResponse } from "@elyia/core/api/herd";

export function artOfToken(tokenId: number, config: HerdConfigResponse | null | undefined): number {
  if (!config || config.reveal.revealed !== true || config.admin?.revealOffset === null || config.admin?.revealOffset === undefined) return 0;
  return ((tokenId - 1 + config.admin.revealOffset) % config.maxSupply) + 1;
}

/** The applicant's card goat: a stable art number from the wallet (the API's card uses the same rule). */
export function cardGoatOf(wallet: string, supply = 3333): number {
  return Number(BigInt(keccak256(toHex(wallet.toLowerCase()))) % BigInt(supply)) + 1;
}
