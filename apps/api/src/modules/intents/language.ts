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
import { LANGUAGE_LIMITS, LANGUAGE_LOCALES, type LanguageContext, type ParseIntentResponse } from "@elyia/core/api/language";
import type { Router } from "express";
import { z } from "zod";
import type { AppContext } from "../../context.js";
import { cachePublicly } from "../../http/request.js";
import { evmAddress, parseBody, parseQuery } from "../../http/validate.js";
import { chipsFor, examplesFor, executableOf, readIntent, signerFor, type ReaderFacts } from "../../language/index.js";
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

async function accountFacts(ctx: AppContext, account: string): Promise<Pick<ReaderFacts, "positions" | "balances">> {
  const network = `hypercore-${ctx.config.mode}` as const;
  const info = ctx.hyperliquid.info(network);
  const [perps, spot] = await Promise.all([info.clearinghouseState(account).catch(() => null), info.spotClearinghouseState(account).catch(() => null)]);
  return {
    ...(perps
      ? {
          positions: perps.assetPositions
            .filter((entry) => Number(entry.position.szi) !== 0)
            .map((entry) => ({ coin: entry.position.coin, side: Number(entry.position.szi) > 0 ? ("long" as const) : ("short" as const), size: entry.position.szi.replace(/^-/u, ""), leverage: entry.position.leverage.value })),
        }
      : {}),
    ...(spot ? { balances: spot.balances.filter((entry) => Number(entry.total) > 0).map((entry) => ({ network, symbol: entry.coin, amount: entry.total })) } : {}),
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

export function registerLanguage(router: Router, ctx: AppContext): void {
  router.post("/intents/parse", async (req, res) => {
    const body = parseBody(req, parseBodySchema);
    const environment = ctx.config.mode;
    const [markets, prices, account] = await Promise.all([
      within(marketFacts(ctx, environment), []),
      within(referencePrices(ctx, namedSymbols(body.text)), {}),
      body.account ? within(accountFacts(ctx, body.account), {}) : Promise.resolve({}),
    ]);
    const client = contextFacts(body.context);
    const facts: Partial<ReaderFacts> = {
      ...(markets.length > 0 ? { markets } : {}),
      ...(Object.keys(prices).length > 0 ? { prices } : {}),
      ...client,
      ...account,
      now: ctx.clock.now(),
    };
    const reading = await readIntent(body.text, {
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
