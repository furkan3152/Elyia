/**
 * zod schemas of the intents endpoints. Everything a client sends is
 * validated here (shape, bounds, formats); semantic checks (assets,
 * routes, balances, the Rule Book) happen in the engine.
 */
import { evmChecksumState, isNetworkKey, parseAccountId, STEP_KINDS, INTENT_ID_PATTERN, STEP_ID_PATTERN, type NetworkKey } from "@elyia/core";
import { z } from "zod";

const DECIMAL = /^(?:0|[1-9]\d{0,29})(?:\.\d{1,30})?$/u;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/u;

const decimal = z.string().regex(DECIMAL, "Expected a positive decimal like 1.5 (no commas or exponents).");
const networkKey = z.string().refine((value): value is NetworkKey => isNetworkKey(value), "Unknown network (see GET /v1/networks).") as unknown as z.ZodType<NetworkKey>;
const symbolOrId = z.string().trim().min(1).max(120);
const address = z
  .string()
  .regex(ADDRESS, "Expected a 0x address.")
  .refine((value) => evmChecksumState(value) !== "invalid", "The address checksum is wrong (a typo?).")
  .transform((value) => value.toLowerCase() as `0x${string}`);
const paramValue = z.union([z.string().max(120), z.number().finite(), z.boolean()]);
const params = z
  .record(z.string().regex(/^[A-Za-z][A-Za-z0-9]{0,39}$/u), paramValue)
  .refine((value) => Object.keys(value).length <= 20, "At most 20 params.");

export const actionSchema = z
  .object({
    kind: z.enum(STEP_KINDS),
    network: networkKey,
    from: symbolOrId.optional(),
    to: symbolOrId.optional(),
    amount: z.union([decimal, z.literal("max")]).optional(),
    toNetwork: networkKey.optional(),
    recipient: z.string().trim().min(1).max(140).optional(),
    protocol: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/u).optional(),
    market: z.string().trim().min(1).max(40).optional(),
    side: z.enum(["buy", "sell", "long", "short"]).optional(),
    size: decimal.optional(),
    price: decimal.optional(),
    tif: z.enum(["Gtc", "Ioc", "Alo"]).optional(),
    reduceOnly: z.boolean().optional(),
    leverage: z.object({ value: z.number().int().min(1).max(100), mode: z.enum(["cross", "isolated"]).optional() }).strict().optional(),
    takeProfit: decimal.optional(),
    stopLoss: decimal.optional(),
    minutes: z.number().int().min(5).max(1_440).optional(),
    after: z.array(z.number().int().min(0).max(11)).max(12).optional(),
    params: params.optional(),
  })
  .strict();

/* ------------------------------------------------------------- goals */

const assetSel = z.union([z.object({ symbol: symbolOrId }).strict(), z.object({ class: z.enum(["usd-stable", "hype", "any-stable", "gas"]) }).strict()]);
const amountSel = z.union([
  z.object({ t: z.literal("exact"), value: decimal }).strict(),
  z.object({ t: z.literal("usd"), value: decimal }).strict(),
  z.object({ t: z.literal("portion"), bps: z.number().int().min(1).max(10_000) }).strict(),
  z.object({ t: z.literal("max") }).strict(),
  z.object({ t: z.literal("allBut"), keep: decimal }).strict(),
  z.object({ t: z.literal("previous") }).strict(),
]);
const custody = z.union([
  z.object({ kind: z.literal("wallet") }).strict(),
  z.object({ kind: z.literal("venue"), protocol: z.string().max(64).optional(), vault: z.string().max(64).optional(), category: z.enum(["lending", "staking", "vault", "any"]).optional() }).strict(),
  z.object({ kind: z.literal("position"), protocol: z.string().max(64).optional() }).strict(),
  z.object({ kind: z.literal("hypercore"), class: z.enum(["spot", "perp", "unknown"]), vault: z.string().max(64).optional(), subAccount: z.string().max(64).optional() }).strict(),
  z.object({ kind: z.literal("loan"), protocol: z.string().max(64).optional() }).strict(),
]);
const place = z.object({ network: networkKey.optional(), custody }).strict();
const holder = z.union([
  z.object({ t: z.literal("self") }).strict(),
  z.object({ t: z.literal("address"), value: z.string().max(140) }).strict(),
  z.object({ t: z.literal("name"), value: z.string().max(64) }).strict(),
  z.object({ t: z.literal("nickname") }).strict(),
  z.object({ t: z.literal("selfOther") }).strict(),
]);
const confidence = z.enum(["exact", "frame", "assistant"]);
const valueGoal = z
  .object({
    kind: z.enum(["convert", "relocate", "deliver", "earn", "exit", "acquire", "stake", "unstake", "borrow", "repay"]),
    op: z.string().max(32).optional(),
    spend: z.object({ asset: assetSel.optional(), amount: amountSel.optional(), from: place.optional() }).strict(),
    want: z.object({ asset: assetSel.optional(), amount: amountSel.optional(), at: place.optional() }).strict(),
    holder,
    constraints: z.object({ via: z.array(z.string().max(64)).max(4).optional(), avoid: z.array(z.string().max(64)).max(8).optional(), prefer: z.enum(["cheapest", "fastest", "safest"]).optional(), keepGas: z.boolean().optional() }).strict(),
    chain: z.object({ after: z.number().int().min(0).max(11) }).strict().optional(),
    confidence,
  })
  .strict();
const priceSel = z.union([
  z.object({ t: z.literal("market") }).strict(),
  z.object({ t: z.literal("limit"), px: decimal }).strict(),
  z.object({ t: z.literal("offset"), pct: decimal, from: z.enum(["mark", "mid", "oracle", "entry"]), dir: z.enum(["above", "below"]) }).strict(),
  z.object({ t: z.literal("breakeven") }).strict(),
]);
const trigger = z.object({ kind: z.enum(["tp", "sl"]), px: priceSel, exec: z.enum(["market", "limit"]) }).strict();
const marketSel = z.union([z.object({ coin: z.string().min(1).max(32), kind: z.enum(["perp", "spot"]), dex: z.string().max(32).optional() }).strict(), z.object({ all: z.literal(true) }).strict()]);
const sizeSel = z.union([
  z.object({ t: z.literal("base"), value: decimal }).strict(),
  z.object({ t: z.literal("notional"), usd: decimal }).strict(),
  z.object({ t: z.literal("margin"), usd: decimal }).strict(),
  z.object({ t: z.literal("portion"), bps: z.number().int().min(1).max(10_000), of: z.enum(["position", "accountValue", "withdrawable"]) }).strict(),
  z.object({ t: z.literal("max") }).strict(),
]);
const tradeGoal = z
  .object({
    kind: z.enum(["open", "close", "reduce", "order", "twap", "protect", "cancel", "setLeverage"]),
    market: marketSel,
    side: z.enum(["long", "short", "buy", "sell"]).optional(),
    size: sizeSel.optional(),
    leverage: z.object({ x: z.union([z.number().int().min(1).max(100), z.literal("max")]), mode: z.enum(["cross", "isolated"]).optional() }).strict().optional(),
    price: priceSel.optional(),
    tif: z.enum(["gtc", "ioc", "alo"]).optional(),
    reduceOnly: z.boolean().optional(),
    tp: trigger.optional(),
    sl: trigger.optional(),
    twap: z.object({ minutes: z.number().int().min(5).max(1_440), randomize: z.boolean().optional() }).strict().optional(),
    maxSlippageBps: z.number().int().min(1).max(1_000).optional(),
    confidence,
  })
  .strict();
export const goalItemSchema = z.union([
  z.object({ t: z.literal("value"), goal: valueGoal }).strict(),
  z.object({ t: z.literal("trade"), goal: tradeGoal }).strict(),
  z.object({ t: z.literal("alert"), goal: z.object({ channel: z.enum(["telegram", "web"]), repeat: z.enum(["once", "always"]), cooldownSec: z.number().int().min(0).optional() }).strict() }).strict(),
]);

/* ------------------------------------------------------------ bodies */

const account = z
  .string()
  .max(140)
  .refine((value) => parseAccountId(value) !== null, "Expected a CAIP-10 account, for example eip155:99801:0x… or hypercore:testnet:0x….")
  .refine((value) => evmChecksumState(value.slice(value.lastIndexOf(":") + 1)) !== "invalid", "The address checksum is wrong (a typo?).");

export const constraintsSchema = z
  .object({
    maxSlippageBps: z.number().int().min(1).max(1_000).optional(),
    deadline: z.number().int().positive().optional(),
    maxFeeUsd: decimal.optional(),
    maxSeconds: z.number().int().min(1).max(30 * 24 * 3600).optional(),
    preferProtocols: z.array(z.string().max(64)).max(8).optional(),
    avoidProtocols: z.array(z.string().max(64)).max(8).optional(),
  })
  .strict();

export const createBodySchema = z
  .object({
    text: z.string().trim().min(1).max(500).optional(),
    /** Signed answers of earlier turns (from a 422 INTENT_CLARIFY's `details.thread`), with `text`. */
    thread: z.string().min(1).max(4_000).optional(),
    actions: z.array(actionSchema).min(1).max(12).optional(),
    goals: z.array(goalItemSchema).min(1).max(12).optional(),
    accounts: z.array(account).min(1).max(6),
    mode: z.enum(["testnet", "mainnet"]).optional(),
    constraints: constraintsSchema.optional(),
    signer: z.enum(["agent", "keeper"]).optional(),
    agent: address.optional(),
    dryRun: z.boolean().optional(),
    metadata: z
      .record(z.string().regex(/^[A-Za-z][A-Za-z0-9_.-]{0,39}$/u), z.string().max(200))
      .refine((value) => Object.keys(value).length <= 10, "At most 10 metadata keys.")
      .optional(),
    clientReference: z.string().regex(/^[A-Za-z0-9_.:-]{1,64}$/u).optional(),
  })
  .strict()
  .refine((body) => [body.text, body.actions, body.goals].filter((value) => value !== undefined).length === 1, { message: "Send exactly one of text, actions or goals.", path: ["text"] });

export const createQuerySchema = z.object({ dryRun: z.enum(["true", "false", "1", "0"]).optional() }).strict();

export const intentParamsSchema = z.object({ id: z.string().regex(INTENT_ID_PATTERN, "Expected an intent id (int_ + 32 hex).") }).strict();
export const stepParamsSchema = z
  .object({ id: z.string().regex(INTENT_ID_PATTERN, "Expected an intent id (int_ + 32 hex)."), sid: z.string().regex(STEP_ID_PATTERN, "Expected a step id (s1, s2, ...).") })
  .strict();

export const prepareBodySchema = z
  .object({
    signatureChainId: z.number().int().min(1).max(2 ** 53 - 1).optional(),
    agent: address.optional(),
    confirmed: z.boolean().optional(),
  })
  .strict();

export const submitBodySchema = z
  .object({ references: z.array(z.string().trim().min(1).max(200)).min(1).max(4) })
  .strict();


const VENUE_KINDS = ["dex", "bridge", "link", "trading", "transfer", "wrap", "staking", "vault", "lending", "names", "launchpad", "aggregator", "perps"] as const;

/** GET /v1/venues filters. */
export const venuesQuerySchema = z
  .object({
    network: z.string().regex(/^[a-z]+-(?:testnet|mainnet)$/u).optional(),
    environment: z.enum(["testnet", "mainnet"]).optional(),
    kind: z.enum(VENUE_KINDS).optional(),
    status: z.enum(["live", "read-only", "unavailable"]).optional(),
  })
  .strict();
