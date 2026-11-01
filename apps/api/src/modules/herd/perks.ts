/**
 * Holder perks, from one place: `perksFor(ctx, address)`. The holder check
 * is ElyHerd.balanceOf on chain (the recorded deployment of the configured
 * mode's Elysium), cached for a minute, never trusted from the client. No
 * deployment or an unreadable chain gives the base perks.
 *
 * Wired into: agent chat turns per day (agent), automations (agent),
 * alert slots (ops), developer API key quotas (developers gate), keeper
 * scheduling priority (agent automations), early access (flags).
 */
import { HERD_BASE_PERKS, HERD_HOLDER_PERKS, type HerdPerks } from "@elyia/core/api/herd";
import type { AppContext } from "../../context.js";
import { balanceOf, herdNetwork, herdRecord } from "./chain.js";

export const PERKS_TTL_MS = 60_000;

const caches = new WeakMap<AppContext, Map<string, { readonly at: number; readonly perks: HerdPerks }>>();

export function perksOf(balance: number, source: HerdPerks["source"], at: number): HerdPerks {
  const holder = balance > 0;
  const table = holder ? HERD_HOLDER_PERKS : HERD_BASE_PERKS;
  return { holder, balance, ...table, priorityKeeper: holder, earlyAccess: holder, badge: holder, source, checkedAt: new Date(at).toISOString() };
}

/** Base perks (no read): what anyone gets. */
export function basePerks(ctx: AppContext): HerdPerks {
  return perksOf(0, "not-deployed", ctx.clock.now());
}

export async function perksFor(ctx: AppContext, address: string | null | undefined): Promise<HerdPerks> {
  const now = ctx.clock.now();
  if (!address || !/^0x[0-9a-fA-F]{40}$/u.test(address)) return perksOf(0, "not-deployed", now);
  const owner = address.toLowerCase();
  let cache = caches.get(ctx);
  if (!cache) {
    cache = new Map();
    caches.set(ctx, cache);
  }
  const hit = cache.get(owner);
  if (hit && now - hit.at < PERKS_TTL_MS) return hit.perks;
  const network = herdNetwork(ctx);
  let perks: HerdPerks;
  try {
    const record = await herdRecord(ctx, network);
    if (!record || !ctx.chains.isAvailable(network)) perks = perksOf(0, "not-deployed", now);
    else perks = perksOf(await balanceOf(ctx, network, record.address, owner), "chain", now);
  } catch {
    // Unreadable: base perks, cached briefly so a down RPC is not hammered.
    perks = perksOf(0, "chain-error", now);
  }
  if (cache.size > 20_000) cache.clear();
  cache.set(owner, { at: now, perks });
  return perks;
}

/** Drop cached perks (after a mint the holder can refresh; tests). */
export function forgetPerks(ctx: AppContext, address?: string): void {
  if (!address) caches.delete(ctx);
  else caches.get(ctx)?.delete(address.toLowerCase());
}
