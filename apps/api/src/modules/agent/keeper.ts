/**
 * Keeper mode: opt-in, bounded, revocable.
 *
 * - `prepare` generates a fresh secp256k1 key on the server, stores it
 *   AES-256-GCM-sealed with a key derived (HKDF-SHA256) from
 *   ELYIA_KEEPER_SECRET, and returns ONLY the agent address plus what the
 *   owner signs: HyperCore `approveAgent` typed data named
 *   `elyia-keeper valid_until <ms>` (at most 30 days), or, on Elysium, the
 *   ElyAccount `setAgentPolicy` transaction (router swaps only, per-tx and
 *   daily token caps, expiry; outputs stay in the account by contract).
 * - `activate` checks the chain: HyperCore `extraAgents` lists the agent for
 *   the owner, or the ElyAccount's `agent()` is the keeper.
 * - `execute` runs one proposal through the guard (active, not killed, not
 *   expired, trade-only reduce-only orders, coin allowlist, per-order and
 *   daily USD caps) and only then signs its L1 actions with the keeper key.
 * - `revoke` deletes the key material at once and returns what to sign to
 *   revoke on chain; `kill` pauses the keeper and every automation.
 * - Every step is written to the audit log and emitted as `agent.action`.
 *
 * Key material is never logged or returned. Without ELYIA_KEEPER_SECRET
 * every keeper endpoint answers 503 KEEPER_NOT_CONFIGURED.
 */
import { getEvmNetwork, getHyperCoreNetwork, hypercore, signatureChainIdHex, type HyperCoreL1ActionRequest, type NetworkKey } from "@elyia/core";
import { DEFAULT_KEEPER_LIMITS, KEEPER_MAX_DAYS, type KeeperAuditEntry, type KeeperLimits, type KeeperPrepareResponse, type KeeperRealm, type KeeperRevokeResponse, type KeeperStatusResponse, type Proposal } from "@elyia/core/api/agent";
import { encodeFunctionData, parseAbi, toFunctionSelector, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { AppContext } from "../../context.js";
import { elysiumNetworkFor, hypercoreNetworkFor } from "../../config.js";
import { elyiaRouterDeployment } from "../../engine/adapters/elyiaRouter.js";
import { engineFor } from "../../engine/index.js";
import { ElyiaHttpError } from "../../http/errors.js";
import { deriveKey, open, randomHex, seal } from "../ops/auth/crypto.js";
import { docs, iso, PLATFORM_COLLECTIONS } from "../ops/docs.js";
import { accountsFor, referencePrices } from "./perception.js";

declare module "../../bus.js" {
  interface ElyiaEvents {
    /** A keeper or automation action (ops may deliver it to Telegram). */
    "agent.action": { readonly owner: string; readonly kind: string; readonly text: { readonly en: string; readonly tr: string }; readonly ok: boolean; readonly proposalId: string | null };
  }
}

export const ELY_ACCOUNT_ABI = parseAbi([
  "struct CallRule { address target; bytes4 action; }",
  "struct TokenRule { address token; uint128 perTxCap; uint128 dailyCap; }",
  "function setAgentPolicy(address agent_, uint64 validUntil, CallRule[] calls, TokenRule[] tokens, bytes32[] markets)",
  "function revokeAgent()",
  "function agent() view returns (address)",
  "function owner() view returns (address)",
]);
const ROUTER_SWAP_SELECTOR = toFunctionSelector("function swap((address,address,uint256,uint256,address,uint256,address,uint16,(uint256,(uint8,address,address,address,uint24)[])[]))");

export type KeeperState = "prepared" | "active" | "revoked" | "killed";

export interface KeeperRecord {
  readonly owner: string;
  readonly realm: KeeperRealm;
  readonly agentAddress: string;
  readonly agentName: string;
  /** Sealed private key; null once revoked. */
  readonly sealedKey: string | null;
  readonly validUntil: number;
  readonly limits: KeeperLimits;
  readonly state: KeeperState;
  readonly account: string | null;
  readonly createdAt: number;
  readonly activatedAt: number | null;
  readonly spent: { readonly day: string; readonly usd: number };
}

export function keeperUnavailable(): ElyiaHttpError {
  return new ElyiaHttpError("KEEPER_NOT_CONFIGURED", 503, "Keeper mode is not configured on this server (ELYIA_KEEPER_SECRET is missing).");
}

function keyFor(ctx: AppContext): Buffer {
  if (!ctx.config.keeperSecret) throw keeperUnavailable();
  return deriveKey(ctx.config.keeperSecret, "keeper-key");
}

function sealContext(owner: string, agent: string): string {
  return `keeper:${owner.toLowerCase()}:${agent.toLowerCase()}`;
}

function keepers(ctx: AppContext) {
  return docs<KeeperRecord>(ctx, PLATFORM_COLLECTIONS.keepers);
}

export async function keeperOf(ctx: AppContext, owner: string): Promise<KeeperRecord | null> {
  return (await keepers(ctx).get(owner.toLowerCase()))?.value ?? null;
}

async function save(ctx: AppContext, record: KeeperRecord): Promise<void> {
  await keepers(ctx).put(record.owner, record);
}

export async function audit(ctx: AppContext, owner: string, entry: Omit<KeeperAuditEntry, "at">): Promise<void> {
  const at = ctx.clock.now();
  await docs<KeeperAuditEntry>(ctx, PLATFORM_COLLECTIONS.keeperAudit).put(`${owner}:${String(at).padStart(15, "0")}:${randomHex(4)}`, { ...entry, at: new Date(at).toISOString() }, { ttlMs: 90 * 24 * 60 * 60_000 });
  ctx.bus.emit("agent.action", { owner, kind: entry.action, text: { en: entry.detail, tr: entry.detail }, ok: entry.ok, proposalId: entry.proposalId });
}

export async function auditLog(ctx: AppContext, owner: string, limit = 50): Promise<KeeperAuditEntry[]> {
  const rows = await docs<KeeperAuditEntry>(ctx, PLATFORM_COLLECTIONS.keeperAudit).list({ prefix: `${owner}:`, limit: 1_000 });
  return rows.map((row) => row.value).reverse().slice(0, limit);
}

function day(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function limitsOf(input: Partial<KeeperLimits> | undefined): KeeperLimits {
  const maxOrderUsd = Math.max(1, Math.min(10_000, input?.maxOrderUsd ?? DEFAULT_KEEPER_LIMITS.maxOrderUsd));
  return {
    maxOrderUsd,
    maxDailyUsd: Math.max(maxOrderUsd, Math.min(50_000, input?.maxDailyUsd ?? DEFAULT_KEEPER_LIMITS.maxDailyUsd)),
    coins: [...new Set((input?.coins ?? []).map((coin) => coin.trim()).filter(Boolean))].slice(0, 20),
    // The keeper only ever shrinks risk: reduce-only is not negotiable.
    reduceOnly: true,
  };
}

/* -------------------------------------------------------------- prepare */

export async function prepareKeeper(
  ctx: AppContext,
  owner: string,
  input: { readonly realm: KeeperRealm; readonly days: number; readonly limits?: Partial<KeeperLimits>; readonly account?: string; readonly signatureChainId?: number },
): Promise<KeeperPrepareResponse> {
  const key = keyFor(ctx);
  const current = await keeperOf(ctx, owner);
  if (current?.state === "killed") throw new ElyiaHttpError("KEEPER_KILLED", 409, "The kill switch is on. Turn it off (POST /v1/agent/kill { on: false }) before preparing a keeper.");
  const now = ctx.clock.now();
  const days = Math.max(1, Math.min(KEEPER_MAX_DAYS, Math.floor(input.days)));
  const validUntil = now + days * 86_400_000 - 60_000;
  const privateKey = generatePrivateKey();
  const agent = privateKeyToAccount(privateKey);
  const agentAddress = agent.address.toLowerCase();
  const agentName = hypercore.keeperAgentName(validUntil, now);
  const limits = limitsOf(input.limits);
  const record: KeeperRecord = {
    owner,
    realm: input.realm,
    agentAddress,
    agentName,
    sealedKey: seal(key, privateKey, sealContext(owner, agentAddress)),
    validUntil,
    limits,
    state: "prepared",
    account: input.account?.toLowerCase() ?? null,
    createdAt: now,
    activatedAt: null,
    spent: { day: day(now), usd: 0 },
  };
  await save(ctx, record);
  await audit(ctx, owner, { action: "prepare", detail: `Keeper ${agentAddress} prepared (${input.realm}, ${days} days, max $${limits.maxOrderUsd}/order, $${limits.maxDailyUsd}/day, reduce-only).`, proposalId: null, ok: true });
  if (input.realm === "hypercore") {
    const network = getHyperCoreNetwork(hypercoreNetworkFor(ctx.config.mode));
    const action = hypercore.approveAgentAction(
      { hyperliquidChain: network.hyperliquidChain, signatureChainId: signatureChainIdHex(input.signatureChainId ?? getEvmNetwork(elysiumNetworkFor(ctx.config.mode)).chainId) },
      { agentAddress, agentName, nonce: now },
    );
    return { realm: "hypercore", agentAddress, agentName, validUntil: new Date(validUntil).toISOString(), limits, sign: { kind: "hypercore-approve-agent", action: action as unknown as Record<string, unknown>, typedData: hypercore.typedDataForUserAction(action) } };
  }
  return { realm: "elysium", agentAddress, agentName, validUntil: new Date(validUntil).toISOString(), limits, sign: await elysiumGrant(ctx, record) };
}

async function elysiumGrant(ctx: AppContext, record: KeeperRecord): Promise<Extract<KeeperPrepareResponse["sign"], { kind: "elyaccount-grant" }>> {
  const network = elysiumNetworkFor(ctx.config.mode);
  const router = elyiaRouterDeployment(network);
  if (!record.account) return { kind: "elyaccount-grant", transaction: null, note: "Pass `account` (your ElyAccount address) to build the policy grant." };
  if (!router) return { kind: "elyaccount-grant", transaction: null, note: "ElyiaRouter is not deployed on this network yet: the agent policy can only allow router swaps." };
  const prices = await referencePrices(ctx, ["HYPE"]).catch(() => ({ HYPE: null }) as Record<string, number | null>);
  const hype = prices.HYPE;
  if (!hype) return { kind: "elyaccount-grant", transaction: null, note: "No HYPE reference price right now: the HYPE caps cannot be set. Try again shortly." };
  const perTx = BigInt(Math.floor((record.limits.maxOrderUsd / hype) * 1e6)) * 10n ** 12n;
  const daily = BigInt(Math.floor((record.limits.maxDailyUsd / hype) * 1e6)) * 10n ** 12n;
  const wrapped = getEvmNetwork(network).contracts.wrappedNative as Address;
  const data = encodeFunctionData({
    abi: ELY_ACCOUNT_ABI,
    functionName: "setAgentPolicy",
    args: [
      record.agentAddress as Address,
      BigInt(Math.floor(record.validUntil / 1000)),
      [{ target: router.address, action: ROUTER_SWAP_SELECTOR }],
      [
        { token: "0x0000000000000000000000000000000000000000", perTxCap: perTx, dailyCap: daily },
        { token: wrapped, perTxCap: perTx, dailyCap: daily },
      ],
      [],
    ],
  });
  return { kind: "elyaccount-grant", transaction: { network, to: record.account, data, value: "0" }, note: "Allows only ElyiaRouter swaps that return to your ElyAccount, within these HYPE caps, until the expiry. Revoke any time with revokeAgent()." };
}

/* ------------------------------------------------------------- activate */

export async function activateKeeper(ctx: AppContext, owner: string): Promise<KeeperRecord> {
  keyFor(ctx);
  const record = await keeperOf(ctx, owner);
  if (!record || record.state !== "prepared") throw new ElyiaHttpError("KEEPER_NOT_PREPARED", 409, "Prepare a keeper first.");
  if (record.validUntil <= ctx.clock.now()) throw new ElyiaHttpError("KEEPER_EXPIRED", 409, "This keeper key already expired. Prepare a new one.");
  if (record.realm === "hypercore") {
    const agents = await ctx.hyperliquid.info(hypercoreNetworkFor(ctx.config.mode)).extraAgents(owner);
    const found = agents.find((entry) => entry.address.toLowerCase() === record.agentAddress);
    if (!found) throw new ElyiaHttpError("KEEPER_NOT_APPROVED", 409, "HyperCore does not list this keeper as your agent yet. Sign and send the approveAgent action, then retry.");
  } else {
    if (!record.account) throw new ElyiaHttpError("KEEPER_NOT_APPROVED", 409, "No ElyAccount recorded for this keeper.");
    const network = elysiumNetworkFor(ctx.config.mode);
    const agent = await ctx.chains.client(network).readContract({ address: record.account as Address, abi: ELY_ACCOUNT_ABI, functionName: "agent" });
    if (agent.toLowerCase() !== record.agentAddress) throw new ElyiaHttpError("KEEPER_NOT_APPROVED", 409, "Your ElyAccount's agent is not this keeper yet. Send the policy grant transaction, then retry.");
  }
  const next: KeeperRecord = { ...record, state: "active", activatedAt: ctx.clock.now() };
  await save(ctx, next);
  await audit(ctx, owner, { action: "activate", detail: `Keeper ${record.agentAddress} active until ${new Date(record.validUntil).toISOString()}.`, proposalId: null, ok: true });
  return next;
}

/* --------------------------------------------------------------- status */

export async function keeperStatus(ctx: AppContext, owner: string): Promise<KeeperStatusResponse> {
  const record = await keeperOf(ctx, owner);
  const now = ctx.clock.now();
  const killed = await isKilled(ctx, owner);
  return {
    configured: ctx.config.keeperSecret !== null,
    state: killed ? "killed" : !record ? "none" : record.state,
    realm: record?.realm ?? null,
    agentAddress: record?.agentAddress ?? null,
    validUntil: iso(record?.validUntil ?? null),
    limits: record?.limits ?? null,
    spentTodayUsd: record && record.spent.day === day(now) ? record.spent.usd : 0,
    killed,
    audit: await auditLog(ctx, owner, 25),
  };
}

/* --------------------------------------------------------------- revoke */

export async function revokeKeeper(ctx: AppContext, owner: string, signatureChainId?: number): Promise<KeeperRevokeResponse> {
  const record = await keeperOf(ctx, owner);
  if (!record) return { revoked: false, revokeOnChain: null };
  // Key material goes first, before anything that could fail.
  await save(ctx, { ...record, sealedKey: null, state: "revoked" });
  await audit(ctx, owner, { action: "revoke", detail: `Keeper ${record.agentAddress} revoked; key material deleted.`, proposalId: null, ok: true });
  if (record.realm === "hypercore") {
    const network = getHyperCoreNetwork(hypercoreNetworkFor(ctx.config.mode));
    const now = ctx.clock.now();
    // Approving the zero address under the same name replaces (revokes) the named agent.
    const action = hypercore.approveAgentAction(
      { hyperliquidChain: network.hyperliquidChain, signatureChainId: signatureChainIdHex(signatureChainId ?? getEvmNetwork(elysiumNetworkFor(ctx.config.mode)).chainId) },
      { agentAddress: "0x0000000000000000000000000000000000000000", agentName: hypercore.KEEPER_AGENT_NAME, nonce: now },
    );
    return { revoked: true, revokeOnChain: { kind: "hypercore-approve-agent", action: action as unknown as Record<string, unknown>, typedData: hypercore.typedDataForUserAction(action) } };
  }
  return { revoked: true, revokeOnChain: { kind: "elyaccount-revoke", note: `Call revokeAgent() on your ElyAccount ${record.account ?? ""} (data ${encodeFunctionData({ abi: ELY_ACCOUNT_ABI, functionName: "revokeAgent" })}).` } };
}

/* ----------------------------------------------------------- kill switch */

export async function isKilled(ctx: AppContext, owner: string): Promise<boolean> {
  return (await docs<{ on: boolean }>(ctx, PLATFORM_COLLECTIONS.agentMemory).get(`kill:${owner}`))?.value.on === true;
}

export async function setKill(ctx: AppContext, owner: string, on: boolean): Promise<void> {
  await docs<{ on: boolean; at: number }>(ctx, PLATFORM_COLLECTIONS.agentMemory).put(`kill:${owner}`, { on, at: ctx.clock.now() });
  await audit(ctx, owner, { action: on ? "kill" : "unkill", detail: on ? "Kill switch on: keeper and automations paused." : "Kill switch off.", proposalId: null, ok: true });
}

/* ---------------------------------------------------------------- guard */

export interface GuardCheck {
  readonly id: string;
  readonly ok: boolean;
  readonly observed: string;
  readonly limit: string;
}

/** True when every action is a reduce-only HyperCore order (a protective TP/SL or a reduce). */
export function tradeOnlyReducing(proposal: Pick<Proposal, "actions">): boolean {
  return (
    proposal.actions.length > 0 &&
    proposal.actions.every((action) => action.kind === "order" && action.network.startsWith("hypercore") && (action.reduceOnly === true || action.params?.protect === true || action.params?.reduce === true || action.params?.close === true))
  );
}

export function keeperGuard(record: KeeperRecord | null, proposal: Pick<Proposal, "actions" | "card">, input: { readonly now: number; readonly killed: boolean }): { readonly ok: boolean; readonly checks: GuardCheck[] } {
  const checks: GuardCheck[] = [];
  const add = (id: string, ok: boolean, observed: string, limit: string) => checks.push({ id, ok, observed, limit });
  add("KEEPER_ACTIVE", record?.state === "active", record?.state ?? "none", "active");
  add("KILL_SWITCH", !input.killed, input.killed ? "on" : "off", "off");
  add("KEY_PRESENT", Boolean(record?.sealedKey), record?.sealedKey ? "present" : "deleted", "present");
  add("NOT_EXPIRED", (record?.validUntil ?? 0) > input.now, iso(record?.validUntil ?? null) ?? "none", "in the future");
  add("REALM", record?.realm === "hypercore", record?.realm ?? "none", "hypercore");
  add("TRADE_ONLY_REDUCING", tradeOnlyReducing(proposal), proposal.actions.map((action) => action.kind).join(","), "reduce-only orders");
  const coins = record?.limits.coins ?? [];
  const markets = proposal.actions.map((action) => action.market ?? "");
  add("COIN_ALLOWED", coins.length === 0 || markets.every((market) => coins.includes(market)), markets.join(","), coins.length === 0 ? "* (reduce-only)" : coins.join(","));
  const notional = Number(proposal.card?.notionalUsd ?? NaN);
  const max = record?.limits.maxOrderUsd ?? 0;
  add("MAX_ORDER_USD", Number.isFinite(notional) && notional <= max, Number.isFinite(notional) ? notional.toFixed(2) : "unpriced", String(max));
  const spent = record && record.spent.day === day(input.now) ? record.spent.usd : 0;
  const daily = record?.limits.maxDailyUsd ?? 0;
  add("MAX_DAILY_USD", Number.isFinite(notional) && spent + notional <= daily, (spent + (Number.isFinite(notional) ? notional : 0)).toFixed(2), String(daily));
  return { ok: checks.every((check) => check.ok), checks };
}

/* -------------------------------------------------------------- execute */

interface ExchangeReply {
  readonly status?: string;
  readonly response?: { readonly data?: { readonly statuses?: readonly unknown[] } } | string;
}

/** Signs and sends one L1 action with the keeper key. Returns the references to submit. */
async function sendL1(ctx: AppContext, record: KeeperRecord, privateKey: Hex, request: HyperCoreL1ActionRequest): Promise<string[]> {
  if (request.agent.toLowerCase() !== record.agentAddress) throw new ElyiaHttpError("KEEPER_SIGNER_MISMATCH", 409, "The prepared action expects another agent signer.");
  if (!request.typedData) throw new ElyiaHttpError("KEEPER_SIGN_FAILED", 422, "The prepared action carries no typed data.");
  const account = privateKeyToAccount(privateKey);
  const { domain, types, primaryType, message } = request.typedData as unknown as { domain: Record<string, unknown>; types: Record<string, unknown>; primaryType: string; message: Record<string, unknown> };
  const typesWithoutDomain = Object.fromEntries(Object.entries(types).filter(([name]) => name !== "EIP712Domain"));
  const signature = await account.signTypedData({ domain, types: typesWithoutDomain, primaryType, message } as never);
  const body = hypercore.buildExchangeRequest({ action: request.action, nonce: Number(request.nonce), signature, vaultAddress: request.vaultAddress ?? null, expiresAfter: request.expiresAfter });
  const network = getHyperCoreNetwork(request.network as NetworkKey);
  const response = await ctx.fetch(network.exchangeUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(8_000) });
  const reply = (await response.json().catch(() => ({}))) as ExchangeReply;
  if (!response.ok || reply.status !== "ok") throw new ElyiaHttpError("KEEPER_EXCHANGE_REJECTED", 422, `HyperCore refused the keeper action: ${typeof reply.response === "string" ? reply.response.slice(0, 160) : `HTTP ${response.status}`}.`);
  const statuses = typeof reply.response === "object" ? (reply.response.data?.statuses ?? []) : [];
  const failed = statuses.find((status) => typeof status === "object" && status !== null && "error" in status) as { error?: string } | undefined;
  if (failed) throw new ElyiaHttpError("KEEPER_EXCHANGE_REJECTED", 422, `HyperCore refused the order: ${String(failed.error).slice(0, 160)}.`);
  if (request.cloids && request.cloids.length > 0) return request.cloids.map((cloid) => `hc:cloid:${request.from}:${cloid}`);
  return [`hc:nonce:${record.agentAddress}:${request.nonce}`];
}

export async function executeWithKeeper(ctx: AppContext, owner: string, proposal: Proposal): Promise<{ readonly executed: boolean; readonly detail: string; readonly intentId: string | null; readonly checks: GuardCheck[] }> {
  const record = await keeperOf(ctx, owner);
  const killed = await isKilled(ctx, owner);
  const verdict = keeperGuard(record, proposal, { now: ctx.clock.now(), killed });
  if (!verdict.ok || !record?.sealedKey) {
    const failed = verdict.checks.filter((check) => !check.ok).map((check) => `${check.id} (${check.observed} vs ${check.limit})`);
    await audit(ctx, owner, { action: "guard-deny", detail: `Keeper refused proposal ${proposal.id}: ${failed.join("; ")}.`, proposalId: proposal.id, ok: false });
    return { executed: false, detail: `The keeper guard refused: ${failed.join("; ")}.`, intentId: null, checks: verdict.checks };
  }
  const privateKey = open(keyFor(ctx), record.sealedKey, sealContext(owner, record.agentAddress)) as Hex;
  const engine = engineFor(ctx);
  const created = await engine.service.create({ actions: proposal.actions, accounts: accountsFor(ctx, owner), environment: ctx.config.mode, signer: "keeper", agent: record.agentAddress, dryRun: false, source: "automation", metadata: { proposalId: proposal.id, via: "keeper" } });
  const intentId = created.intent.id;
  try {
    for (const step of created.intent.steps) {
      const prepared = await engine.service.prepare(intentId, step.id, { agent: record.agentAddress as Address, confirmed: true });
      const references: string[] = [];
      for (const request of prepared.payload.requests) {
        if (request.vm !== "hypercore" || request.kind !== "l1-action") throw new ElyiaHttpError("KEEPER_SCOPE", 403, "The keeper only signs HyperCore trading actions.");
        references.push(...(await sendL1(ctx, record, privateKey, request)));
      }
      await engine.service.submit(intentId, step.id, references);
    }
  } catch (error) {
    await audit(ctx, owner, { action: "execute", detail: `Keeper execution of ${proposal.id} failed: ${error instanceof Error ? error.message.slice(0, 160) : "unknown"}.`, proposalId: proposal.id, ok: false });
    return { executed: false, detail: error instanceof Error ? error.message : "Keeper execution failed.", intentId, checks: verdict.checks };
  }
  const notional = Number(proposal.card?.notionalUsd ?? 0);
  const today = day(ctx.clock.now());
  const spent = record.spent.day === today ? record.spent.usd : 0;
  await save(ctx, { ...record, spent: { day: today, usd: spent + notional } });
  await audit(ctx, owner, { action: "execute", detail: `Keeper executed ${proposal.title} (intent ${intentId}, $${notional.toFixed(2)}).`, proposalId: proposal.id, ok: true });
  return { executed: true, detail: `Executed through the keeper (intent ${intentId}).`, intentId, checks: verdict.checks };
}

/** For tests: the address a sealed key opens to (proves the round trip without exposing the key). */
export function sealedKeyAddress(ctx: AppContext, record: KeeperRecord): string | null {
  if (!record.sealedKey) return null;
  return privateKeyToAccount(open(keyFor(ctx), record.sealedKey, sealContext(record.owner, record.agentAddress)) as Hex).address.toLowerCase();
}
