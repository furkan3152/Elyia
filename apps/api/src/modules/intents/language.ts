/**
 * The language endpoints (owned by the language area; mounted by the intents module):
 *
 *   POST /intents/parse       sentence -> goals, questions, chips, canonical   ParseIntentResponse
 *   GET  /language/examples   curated examples per category (?locale=en|tr)    LanguageExamplesResponse
 *
 * Contract types: @elyia/core/api/language. Facts (markets, reference prices,
 * the account's HyperCore positions and spot balances, client context) only
 * sharpen questions; the planner re-reads everything before anything is signed.
 */
import { LANGUAGE_LIMITS, LANGUAGE_LOCALES, type LanguageAnswer, type LanguageContext, type ParseIntentResponse } from "@elyia/core/api/language";
import type { Router } from "express";
import { z } from "zod";
import type { NetworkKey } from "@elyia/core";
import { formatEther } from "viem";
import type { AppContext } from "../../context.js";
import { elysiumNetworkFor } from "../../config.js";
import { cachePublicly } from "../../http/request.js";
import { evmAddress, parseBody, parseQuery } from "../../http/validate.js";
import { chipsFor, examplesFor, executableOf, readIntent, signerFor, type ReaderFacts, type ReadResult } from "../../language/index.js";
import { marketFacts, referencePrices, resolveElyName } from "../../language/facts.js";

const decimal = z.string().regex(/^(?:0|[1-9]\d{0,29})(?:\.\d{1,30})?$/u, "Expected a decimal string.");

const contextSchema = z
  .object({
    balances: z.array(z.object({ network: z.string().max(40), symbol: z.string().min(1).max(32), amount: decimal }).strict()).max(100).optional(),
    positions: z.array(z.object({ coin: z.string().min(1).max(40), side: z.enum(["long", "short"]), size: decimal, leverage: z.number().int().min(1).max(100).optional() }).strict()).max(100).optional(),
    timezone: z.string().min(1).max(64).optional(),
    telegramLinked: z.boolean().optional(),
  })
  .strict();

export const parseBodySchema = z
  .object({
    text: z.string().max(LANGUAGE_LIMITS.maxTextLength),
    locale: z.enum(LANGUAGE_LOCALES).optional(),
    answers: z
      .array(
        z
          .object({
            question: z.string().min(1).max(80),
            option: z.string().min(1).max(80).optional(),
            text: z.string().min(1).max(LANGUAGE_LIMITS.maxAnswerTextLength).optional(),
          })
          .strict()
          .refine((answer) => (answer.option === undefined) !== (answer.text === undefined), "Give either option or text."),
      )
      .max(LANGUAGE_LIMITS.maxAnswers)
      .optional(),
    thread: z.string().min(1).max(8_192).optional(),
    account: evmAddress.optional(),
    context: contextSchema.optional(),
  })
  .strict();

const examplesQuerySchema = z.object({ locale: z.enum(LANGUAGE_LOCALES).optional() }).strict();

/** Facts the reader may use: never required, each read bounded in time. */
export const FACTS_TIMEOUT_MS = 2_500;

function within<T>(promise: Promise<T>, fallback: T, ms = FACTS_TIMEOUT_MS): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
    timer.unref();
  });
  return Promise.race([promise.catch(() => fallback), timeout]).finally(() => clearTimeout(timer));
}

/** Native HYPE on the EVM layers (Elysium, HyperEVM); a layer that cannot be read is left out (and not covered). */
async function evmHype(ctx: AppContext, account: string): Promise<Array<{ readonly network: string; readonly symbol: string; readonly amount: string }>> {
  const keys = [elysiumNetworkFor(ctx.config.mode), `hyperevm-${ctx.config.mode}` as NetworkKey];
  const reads = await Promise.all(
    keys.map(async (key) => {
      try {
        const wei = await ctx.chains.client(key).getBalance({ address: account as `0x${string}` });
        return { network: key, symbol: "HYPE", amount: formatEther(wei) };
      } catch {
        return null;
      }
    }),
  );
  return reads.filter((entry): entry is { network: NetworkKey; symbol: string; amount: string } => entry !== null);
}

async function accountFacts(ctx: AppContext, account: string): Promise<Pick<ReaderFacts, "positions" | "balances" | "balanceNetworks">> {
  const network = `hypercore-${ctx.config.mode}` as const;
  const info = ctx.hyperliquid.info(network);
  const [perps, spot, evm] = await Promise.all([info.clearinghouseState(account).catch(() => null), info.spotClearinghouseState(account).catch(() => null), within(evmHype(ctx, account), [])]);
  const evmHeld = evm.filter((entry) => Number(entry.amount) > 0);
  // Only HYPE is read on the EVM layers: other symbols there stay unknown, so the reader asks rather than guess.
  const coreBalances = spot ? spot.balances.filter((entry) => Number(entry.total) > 0).map((entry) => ({ network, symbol: entry.coin, amount: entry.total })) : [];
  return {
    ...(spot || evm.length > 0 ? { balances: [...coreBalances, ...evmHeld], balanceNetworks: [...(spot ? [network] : []), ...evm.map((entry) => entry.network)] } : {}),
    ...(perps
      ? {
          positions: perps.assetPositions
            .filter((entry) => Number(entry.position.szi) !== 0)
            .map((entry) => ({ coin: entry.position.coin, side: Number(entry.position.szi) > 0 ? ("long" as const) : ("short" as const), size: entry.position.szi.replace(/^-/u, ""), leverage: entry.position.leverage.value })),
        }
      : {}),
  };
}

function contextFacts(context: LanguageContext | undefined): Partial<ReaderFacts> {
  if (!context) return {};
  return {
    ...(context.balances ? { balances: context.balances } : {}),
    ...(context.positions ? { positions: context.positions } : {}),
    ...(context.timezone ? { timezone: context.timezone } : {}),
    ...(context.telegramLinked !== undefined ? { telegramLinked: context.telegramLinked } : {}),
  };
}

/** Symbols a sentence names (assets and markets), for reference prices. */
function namedSymbols(text: string): string[] {
  return chipsFor(text)
    .filter((chip) => chip.kind === "asset" || chip.kind === "market")
    .map((chip) => (chip.value ?? chip.text).replace(/ (?:perp|spot)$/u, "").replace(/^[a-z0-9]+:/u, "").split(" ")[0] as string)
    .filter((symbol) => /^[A-Za-z0-9]{1,16}$/u.test(symbol));
}

export interface SentenceRequest {
  readonly text: string;
  readonly locale?: (typeof LANGUAGE_LOCALES)[number];
  readonly answers?: readonly LanguageAnswer[];
  readonly thread?: string;
  readonly account?: string;
  readonly context?: LanguageContext;
}

/**
 * One reading with every fact the reader may use (markets, reference
 * prices, the account's HyperCore positions and balances, client context),
 * each bounded in time. `POST /intents/parse` and Ely's chat clarify share
 * it, so both ask the same questions with the same options.
 */
export async function readSentenceFor(ctx: AppContext, body: SentenceRequest): Promise<ReadResult> {
  const environment = ctx.config.mode;
  const [markets, prices, account] = await Promise.all([
    within(marketFacts(ctx, environment), []),
    within(referencePrices(ctx, namedSymbols(body.text)), {}),
    body.account ? within(accountFacts(ctx, body.account), {}) : Promise.resolve({}),
  ]);
  const client = contextFacts(body.context);
  // The client's balances (any network) and the account's read ones together: neither replaces the other.
  const { balanceNetworks, ...read } = account as Pick<ReaderFacts, "positions" | "balances" | "balanceNetworks">;
  const balances = client.balances ? { balances: [...client.balances, ...(read.balances ?? [])] } : read.balances ? { balances: read.balances, ...(balanceNetworks ? { balanceNetworks } : {}) } : {};
  const facts: Partial<ReaderFacts> = {
    ...(markets.length > 0 ? { markets } : {}),
    ...(Object.keys(prices).length > 0 ? { prices } : {}),
    ...client,
    ...read,
    ...balances,
    now: ctx.clock.now(),
  };
  return readIntent(body.text, {
    environment,
    facts,
    answers: body.answers ?? [],
    ...(body.locale ? { locale: body.locale } : {}),
    ...(body.thread ? { thread: body.thread } : {}),
    signer: signerFor(ctx),
    executable: executableOf(ctx),
    resolveName: (name) => within(resolveElyName(ctx, environment, name), undefined),
    now: ctx.clock.now(),
  });
}

export function registerLanguage(router: Router, ctx: AppContext): void {
  router.post("/intents/parse", async (req, res) => {
    const body = parseBody(req, parseBodySchema);
    const reading = await readSentenceFor(ctx, body);
    const { usedAnswers: _used, names: _names, clarify: _clarify, unsupported: _unsupported, ...response } = reading;
    res.json(response satisfies ParseIntentResponse);
  });

  router.get("/language/examples", (req, res) => {
    const query = parseQuery(req, examplesQuerySchema);
    cachePublicly(res, 300);
    res.json(examplesFor(query.locale ?? "en"));
  });
}

/** The name the intents module calls. */
export const registerLanguageRoutes = registerLanguage;
