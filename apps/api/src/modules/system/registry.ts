/**
 * GET /v1/tokens: the core token registry (`TOKENS` from @elyia/core),
 * filtered by network or mode. GET /v1/protocols moved to the discovery
 * module (registry rows with `executable` from the running engine); the
 * protocol filter helper stays here for callers that filter core rows.
 */
import { NETWORKS, TOKENS, type NetworkEnvironment, type NetworkKey, type ProtocolDescriptor, type TokenDescriptor } from "@elyia/core";
import type { Router } from "express";
import { z } from "zod";
import type { AppContext } from "../../context.js";
import { cachePublicly } from "../../http/request.js";
import { parseQuery } from "../../http/validate.js";
import { networkKey } from "./query.js";

const TokensQuery = z.object({ network: networkKey.optional() });

export interface ProtocolFilter {
  readonly network?: NetworkKey;
  readonly environment?: NetworkEnvironment;
}

/** Protocols with a deployment on `network` and/or in `environment` (both optional). */
export function filterProtocols(rows: readonly ProtocolDescriptor[], filter: ProtocolFilter): ProtocolDescriptor[] {
  return rows.filter(
    (protocol) =>
      (!filter.network || protocol.deployments.some((deployment) => deployment.network === filter.network)) &&
      (!filter.environment || protocol.deployments.some((deployment) => NETWORKS[deployment.network].environment === filter.environment)),
  );
}

/** Tokens of one network, or of every network in `mode` when none is given. */
export function filterTokens(rows: readonly TokenDescriptor[], network: NetworkKey | undefined, mode: NetworkEnvironment): TokenDescriptor[] {
  return rows.filter((token) => (network ? token.network === network : NETWORKS[token.network].environment === mode));
}

export function registerRegistry(router: Router, ctx: AppContext): void {
  router.get("/tokens", (req, res) => {
    const query = parseQuery(req, TokensQuery);
    const tokens = filterTokens(TOKENS, query.network, ctx.config.mode);
    cachePublicly(res, 60);
    res.json({ network: query.network ?? null, mode: ctx.config.mode, count: tokens.length, tokens });
  });
}
