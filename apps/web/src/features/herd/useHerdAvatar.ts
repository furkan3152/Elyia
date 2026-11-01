/**
 * The user's Ely: when the wallet holds a Herd goat (balanceOf on chain via
 * the API, cached), its first token's art (the fog placeholder before
 * reveal); otherwise null and the caller keeps the default Ely.
 */
import { artOfToken } from "./art";
import { useHerdConfig, useHolder } from "./herdApi";

export interface HerdAvatar {
  readonly tokenId: number | null;
  /** Art number to draw (0 = the unrevealed placeholder). */
  readonly art: number;
}

export function useHerdAvatar(address: string | null | undefined): HerdAvatar | null {
  const holder = useHolder(address);
  const config = useHerdConfig();
  const data = holder.data;
  if (!data || !data.perks.holder) return null;
  const tokenId = data.tokenIds[0] ?? null;
  return { tokenId, art: tokenId === null ? 0 : artOfToken(tokenId, config.data) };
}
