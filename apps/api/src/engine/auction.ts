/**
 * Venue auction (ported from Kletia's auction.ts): every candidate adapter
 * plans the same action in parallel (each with a timeout); quotes rank by
 * net guaranteed output (minimum output minus extra costs in the output
 * asset; costs in another asset are converted through reference prices and
 * a venue whose costs cannot be priced is excluded, never guessed), then
 * preferred protocols, fewer seconds, fewer requests, on-chain floors before
 * claimed ones, then preference order.
 */
import { sameAsset } from "@elyia/core";
import type { ElyiaHttpError } from "../http/errors.js";
import type { EngineDeps } from "./deps.js";
import { engineError, isEngineError } from "./errors.js";
import { ReferencePrices } from "./prices.js";
import type { AdapterAction, PlannedStep, ProtocolAdapter } from "./types.js";

export const VENUE_QUOTE_TIMEOUT_MS = 8_000;
/** On mainnet a swap quote further than this from the reference price is excluded (a fake or broken pool). */
export const MAINNET_PRICE_BAND_BPS = 2_500;
/** Any environment: a swap quote further than this from the reference price gets a fake-price warning. */
export const PRICE_WARNING_BPS = 1_000;
/** Winner beating the runner-up by more than this share is called out (one pool's price is off). */
export const VENUE_SPREAD_WARNING_BPS = 2_000;

export interface VenueQuote {
  readonly adapter: ProtocolAdapter;
  readonly planned: PlannedStep;
  /** Minimum output net of extra costs (output base units); null when a cost is unpriced. */
  readonly netMinimum: bigint | null;
  readonly excluded?: "unpriced" | "asset" | "slow" | "price";
  /** Expected output vs input at reference prices, bps (null when unpriced or not a conversion). */
  readonly deviationBps: number | null;
  /** USD of the expected output at reference prices. */
  readonly referenceUsd: string | null;
}

export interface VenueFailure {
  readonly adapter: ProtocolAdapter;
  readonly error: ElyiaHttpError | Error;
}

export interface AuctionResult {
  readonly winner: VenueQuote;
  readonly losers: readonly VenueQuote[];
  readonly failures: readonly VenueFailure[];
  /** Fake-price and spread warnings about the winning quote (added to the step). */
  readonly warnings: readonly string[];
}

/**
 * Value of the expected output vs the input at reference prices, in basis
 * points ((outUsd - inUsd) / inUsd). Testnet pools price HYPE at tens of
 * thousands of test-USDC, so this is how a "fake" price is shown, never hidden.
 */
export async function referenceDeviation(deps: EngineDeps, planned: PlannedStep): Promise<{ readonly bps: number | null; readonly usd: string | null }> {
  const input = planned.inputs[0];
  const output = planned.outputs[0];
  if (!input || !output) return { bps: null, usd: null };
  const snapshot = await deps.prices.snapshot();
  const inMicros = ReferencePrices.assetMicros(snapshot, input.asset, input.symbol);
  const outMicros = ReferencePrices.assetMicros(snapshot, output.asset, output.symbol);
  const usd = ReferencePrices.usdText(BigInt(output.expected), output.decimals, outMicros);
  if (inMicros === null || outMicros === null || inMicros === 0n) return { bps: null, usd };
  const inValue = (BigInt(input.expected) * inMicros) / 10n ** BigInt(input.decimals);
  const outValue = (BigInt(output.expected) * outMicros) / 10n ** BigInt(output.decimals);
  if (inValue === 0n) return { bps: null, usd };
  const bps = ((outValue - inValue) * 10_000n) / inValue;
  const clamped = bps > 10_000_000n ? 10_000_000n : bps < -10_000n ? -10_000n : bps;
  return { bps: Number(clamped), usd };
}

function percent(bps: number): string {
  const value = Math.abs(bps) / 100;
  return value >= 100 ? `${Math.round(value).toLocaleString("en-US")}%` : `${value.toFixed(value >= 10 ? 0 : 1)}%`;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(engineError("UPSTREAM_TIMEOUT", "The venue did not quote in time.")), ms);
    timer.unref?.();
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** Net guaranteed output of a quote, in output base units (null when an extra cost is unpriced). */
export async function netMinimum(deps: EngineDeps, planned: PlannedStep): Promise<bigint | null> {
  const output = planned.outputs[0];
  if (!output) return 0n;
  let net = BigInt(output.minimum ?? output.expected);
  const costs = planned.extraCosts ?? [];
  if (costs.length === 0) return net;
  const snapshot = await deps.prices.snapshot();
  const outputPrice = ReferencePrices.assetMicros(snapshot, output.asset, output.symbol);
  for (const cost of costs) {
    if (sameAsset(cost.asset, output.asset)) {
      net -= BigInt(cost.expected);
      continue;
    }
    const costPrice = ReferencePrices.assetMicros(snapshot, cost.asset, cost.symbol);
    if (outputPrice === null || costPrice === null || outputPrice === 0n) return null;
    // cost in output units, rounded against the venue.
    const numerator = BigInt(cost.expected) * costPrice * 10n ** BigInt(output.decimals);
    const denominator = outputPrice * 10n ** BigInt(cost.decimals);
    net -= (numerator + denominator - 1n) / denominator;
  }
  return net;
}

function compare(a: VenueQuote, b: VenueQuote, order: readonly ProtocolAdapter[], prefer: readonly string[]): number {
  if (!a.excluded !== !b.excluded) return a.excluded ? 1 : -1;
  const preferred = (quote: VenueQuote) => (prefer.includes(quote.planned.protocol) ? 0 : 1);
  if (preferred(a) !== preferred(b)) return preferred(a) - preferred(b);
  const netA = a.netMinimum ?? -1n;
  const netB = b.netMinimum ?? -1n;
  if (netA !== netB) return netA > netB ? -1 : 1;
  if (a.planned.estimatedSeconds !== b.planned.estimatedSeconds) return a.planned.estimatedSeconds - b.planned.estimatedSeconds;
  if (a.planned.requestCount !== b.planned.requestCount) return a.planned.requestCount - b.planned.requestCount;
  const floor = (quote: VenueQuote) => (quote.planned.floor === "onchain" ? 0 : 1);
  if (floor(a) !== floor(b)) return floor(a) - floor(b);
  return order.indexOf(a.adapter) - order.indexOf(b.adapter);
}

/**
 * Plans `action` with every candidate. A single candidate is never timed
 * out; with several, the best eligible quote wins and failures are kept for
 * the response. All failing: the most informative error is thrown.
 */
export async function runAuction(deps: EngineDeps, candidates: readonly ProtocolAdapter[], action: AdapterAction, options: { readonly prefer?: readonly string[]; readonly maxSeconds?: number; readonly environment?: "testnet" | "mainnet" } = {}): Promise<AuctionResult> {
  if (candidates.length === 0) throw engineError("ROUTE_UNSUPPORTED", "No listed venue does this on these networks yet.");
  const timeout = candidates.length > 1 ? VENUE_QUOTE_TIMEOUT_MS : 0;
  const settled = await Promise.allSettled(candidates.map((adapter) => (timeout > 0 ? withTimeout(adapter.plan(action), timeout) : adapter.plan(action))));
  const quotes: VenueQuote[] = [];
  const failures: VenueFailure[] = [];
  for (const [index, result] of settled.entries()) {
    const adapter = candidates[index] as ProtocolAdapter;
    if (result.status === "rejected") {
      failures.push({ adapter, error: result.reason instanceof Error ? result.reason : new Error(String(result.reason)) });
      continue;
    }
    const planned = result.value;
    const net = await netMinimum(deps, planned);
    const wrongAsset = action.output !== null && planned.outputs[0] !== undefined && action.kind === "swap" && !sameAsset(planned.outputs[0].asset, action.output.id);
    const slow = options.maxSeconds !== undefined && planned.estimatedSeconds > options.maxSeconds;
    const reference = action.kind === "swap" ? await referenceDeviation(deps, planned).catch(() => ({ bps: null, usd: null })) : { bps: null, usd: null };
    const offPrice = options.environment === "mainnet" && reference.bps !== null && Math.abs(reference.bps) > MAINNET_PRICE_BAND_BPS;
    const excluded = wrongAsset ? "asset" : net === null && candidates.length > 1 ? "unpriced" : slow ? "slow" : offPrice ? "price" : undefined;
    quotes.push({ adapter, planned, netMinimum: net, deviationBps: reference.bps, referenceUsd: reference.usd, ...(excluded ? { excluded } : {}) });
  }
  if (quotes.length === 0) {
    const first = failures.find((failure) => isEngineError(failure.error) && (failure.error as ElyiaHttpError).status < 500) ?? failures[0];
    throw first?.error ?? engineError("ROUTE_UNAVAILABLE");
  }
  const ranked = [...quotes].sort((a, b) => compare(a, b, candidates, options.prefer ?? []));
  const winner = ranked[0] as VenueQuote;
  if (winner.excluded === "slow") throw engineError("ROUTE_UNSUPPORTED", `Every route takes longer than ${options.maxSeconds} s.`, { estimatedSeconds: winner.planned.estimatedSeconds });
  if (winner.excluded === "price") {
    throw engineError("ROUTE_UNAVAILABLE", `Every venue quotes more than ${percent(MAINNET_PRICE_BAND_BPS)} away from the reference price; Elyia does not route into a price that looks fake.`, { deviationBps: winner.deviationBps });
  }
  if (winner.excluded) throw engineError("ROUTE_UNAVAILABLE", "No venue returned an eligible quote.");
  return { winner, losers: ranked.slice(1), failures, warnings: priceWarnings(winner, ranked.slice(1), options.environment) };
}

/** Fake-price warnings: the winner's distance from the reference, and a winner far ahead of the next venue. */
export function priceWarnings(winner: VenueQuote, losers: readonly VenueQuote[], environment?: "testnet" | "mainnet"): string[] {
  const warnings: string[] = [];
  const label = winner.adapter.label;
  if (winner.deviationBps !== null && Math.abs(winner.deviationBps) > PRICE_WARNING_BPS) {
    const direction = winner.deviationBps > 0 ? "more" : "less";
    warnings.push(
      environment === "mainnet"
        ? `${label} pays ${percent(winner.deviationBps)} ${direction} than the reference price (HyperCore mainnet mids). Check the pool before signing.`
        : `Fake price: ${label}'s testnet pool pays ${percent(winner.deviationBps)} ${direction} than the reference price (HyperCore mainnet mids). Testnet tokens have no market value.`,
    );
  }
  const runnerUp = losers.find((quote) => !quote.excluded && quote.netMinimum !== null && quote.netMinimum > 0n);
  if (runnerUp && winner.netMinimum !== null && winner.netMinimum > 0n && runnerUp.netMinimum !== null) {
    const spread = ((winner.netMinimum - runnerUp.netMinimum) * 10_000n) / runnerUp.netMinimum;
    if (spread > BigInt(VENUE_SPREAD_WARNING_BPS)) warnings.push(`${label} quotes ${percent(Number(spread))} more than ${runnerUp.adapter.label}: one of the two pools is mispriced.`);
  }
  return warnings;
}
