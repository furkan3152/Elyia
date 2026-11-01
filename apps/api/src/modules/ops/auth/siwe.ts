/**
 * Sign-In with Ethereum (EIP-4361).
 *
 * `issueNonce` stores a random nonce for 10 minutes. `verifySiwe` checks, in
 * order: the message parses; the domain is one of Elyia's (web origins' hosts
 * + ELYIA_SIWE_DOMAINS); the URI is on that domain; the chain id is one Elyia
 * serves; issuedAt / expirationTime / notBefore hold; the nonce exists and is
 * consumed exactly once (a replay finds it gone); and the signature recovers
 * the message's address (EOA), or the address's contract accepts it
 * (ERC-1271 / ERC-6492 through the chain's RPC) for smart accounts.
 */
import { NETWORKS, evmNetworkByChainId, type NetworkKey } from "@elyia/core";
import type { SiweNonceResponse } from "@elyia/core/api/ops";
import { verifyMessage, type Hex } from "viem";
import { createSiweMessage, generateSiweNonce, parseSiweMessage } from "viem/siwe";
import type { AppContext } from "../../../context.js";
import { ElyiaHttpError } from "../../../http/errors.js";

export const NONCE_TTL_MS = 10 * 60_000;
export const SIWE_STATEMENT = "Sign in to Elyia. This proves you control this address; it moves no funds and costs no gas.";
/** Common wallet chains besides Elyia's own networks (a wallet may sit on any of them while signing in). */
const EXTRA_CHAIN_IDS = [1, 42161] as const;

export function siweChainIds(): number[] {
  const ids = new Set<number>(EXTRA_CHAIN_IDS);
  for (const network of Object.values(NETWORKS)) if (network.vm === "evm") ids.add(network.chainId);
  return [...ids].sort((a, b) => a - b);
}

/** Allowed SIWE domains (host[:port]) and their origins. */
export function siweDomains(ctx: AppContext): { readonly domains: readonly string[]; readonly origins: readonly string[] } {
  const origins = new Set<string>(ctx.config.webOrigins);
  const domains = new Set<string>(ctx.config.siweDomains);
  for (const origin of ctx.config.webOrigins) domains.add(new URL(origin).host);
  for (const domain of ctx.config.siweDomains) origins.add(`https://${domain}`);
  return { domains: [...domains], origins: [...origins] };
}

function siweError(code: string, message: string): ElyiaHttpError {
  return new ElyiaHttpError(code, 401, message);
}

export async function issueNonce(ctx: AppContext, input: { readonly address?: string; readonly chainId?: number }): Promise<SiweNonceResponse> {
  const nonce = generateSiweNonce();
  const now = ctx.clock.now();
  await ctx.store.collection("siwe_nonces").put(nonce, { issuedAt: now }, { ttlMs: NONCE_TTL_MS });
  const { domains, origins } = siweDomains(ctx);
  const domain = domains[0] ?? "localhost";
  const uri = origins[0] ?? `https://${domain}`;
  const chainIds = siweChainIds();
  const message =
    input.address && input.chainId && chainIds.includes(input.chainId)
      ? createSiweMessage({
          address: input.address as Hex,
          chainId: input.chainId,
          domain,
          nonce,
          uri,
          version: "1",
          statement: SIWE_STATEMENT,
          issuedAt: new Date(now),
          expirationTime: new Date(now + NONCE_TTL_MS),
        })
      : null;
  return { nonce, expiresAt: new Date(now + NONCE_TTL_MS).toISOString(), domain, uri, chainIds, statement: SIWE_STATEMENT, message };
}

export interface VerifiedSiwe {
  readonly address: string;
  readonly chainId: number;
}

export async function verifySiwe(ctx: AppContext, message: string, signature: string): Promise<VerifiedSiwe> {
  const parsed = parseSiweMessage(message);
  if (!parsed.address || !parsed.domain || !parsed.nonce || !parsed.uri || !parsed.chainId || parsed.version !== "1") {
    throw siweError("SIWE_INVALID", "The message is not a complete EIP-4361 sign-in message.");
  }
  const { domains, origins } = siweDomains(ctx);
  if (!domains.includes(parsed.domain.toLowerCase())) throw siweError("SIWE_DOMAIN", `This message is for ${parsed.domain}, not for Elyia.`);
  let uriOrigin: string;
  try {
    uriOrigin = new URL(parsed.uri).origin;
  } catch {
    throw siweError("SIWE_INVALID", "The message URI is not a URL.");
  }
  if (!origins.includes(uriOrigin) && new URL(parsed.uri).host !== parsed.domain) throw siweError("SIWE_DOMAIN", "The message URI is not on the signing domain.");
  if (!siweChainIds().includes(parsed.chainId)) throw siweError("SIWE_CHAIN", `Chain ${parsed.chainId} is not one Elyia signs in on.`);
  const now = ctx.clock.now();
  if (parsed.expirationTime && parsed.expirationTime.getTime() <= now) throw siweError("SIWE_EXPIRED", "The sign-in message expired. Request a new nonce.");
  if (parsed.notBefore && parsed.notBefore.getTime() > now) throw siweError("SIWE_NOT_YET_VALID", "The sign-in message is not valid yet.");
  if (parsed.issuedAt && (parsed.issuedAt.getTime() > now + 60_000 || parsed.issuedAt.getTime() < now - NONCE_TTL_MS)) {
    throw siweError("SIWE_STALE", "The message's issuedAt is outside the nonce lifetime.");
  }
  if (!/^0x[0-9a-fA-F]+$/u.test(signature)) throw siweError("SIWE_SIGNATURE", "The signature is not hex.");
  // Single use: whoever deletes the nonce first wins; a replay finds it gone.
  const consumed = await ctx.store.collection("siwe_nonces").delete(parsed.nonce);
  if (!consumed) throw siweError("SIWE_NONCE", "This nonce is unknown, expired or already used. Request a new one.");

  const address = parsed.address.toLowerCase() as Hex;
  let valid = await verifyMessage({ address, message, signature: signature as Hex }).catch(() => false);
  if (!valid) {
    const network = evmNetworkByChainId(parsed.chainId);
    if (network && ctx.chains.isAvailable(network.key as NetworkKey)) {
      valid = await ctx.chains
        .client(network.key as NetworkKey)
        .verifyMessage({ address, message, signature: signature as Hex })
        .catch(() => false);
    }
  }
  if (!valid) throw siweError("SIWE_SIGNATURE", "The signature does not match the message's address.");
  return { address, chainId: parsed.chainId };
}
