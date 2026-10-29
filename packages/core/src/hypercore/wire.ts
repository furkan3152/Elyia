/**
 * HyperCore wire formatting: the exact strings prices and sizes must have
 * inside signed actions, the exchange's tick and lot rules, asset indexes
 * and client order ids.
 *
 * Tick and lot rules (Hyperliquid docs, "Tick and lot size"):
 * - a price has at most 5 significant figures and at most
 *   `MAX_DECIMALS - szDecimals` decimals (6 for perps, 8 for spot);
 *   integer prices are always allowed, whatever their significant figures;
 * - a size has at most `szDecimals` decimals;
 * - wire strings carry no trailing zeros ("1670.1", never "1670.10").
 *
 * All arithmetic here is exact decimal (bigint) arithmetic; floats are only
 * accepted at the edge, through `floatToWire`, which mirrors the official
 * Python SDK's `float_to_wire` (round to 8 decimals, refuse if that changes
 * the value by 1e-12 or more).
 */

export const PERP_MAX_DECIMALS = 6;
export const SPOT_MAX_DECIMALS = 8;
export const MAX_SIGNIFICANT_FIGURES = 5;
/** Spot asset ids are 10000 + the pair's index in `spotMeta.universe`. */
export const SPOT_ASSET_OFFSET = 10_000;
/** Builder-deployed perp dex `i` (perpDexs index, i >= 1) starts at 100000 + i * 10000 (Python SDK: 110000 + (i - 1) * 10000). */
export const BUILDER_PERP_ASSET_OFFSET = 100_000;

export type WireErrorCode =
  | "FLOAT_INVALID"
  | "FLOAT_ROUNDING"
  | "DECIMAL_INVALID"
  | "PRICE_INVALID"
  | "PRICE_TICK"
  | "SIZE_INVALID"
  | "SIZE_LOT"
  | "ASSET_UNKNOWN"
  | "CLOID_INVALID";

export class HyperCoreWireError extends Error {
  readonly code: WireErrorCode;
  constructor(code: WireErrorCode, message: string) {
    super(message);
    this.name = "HyperCoreWireError";
    this.code = code;
  }
}

/* ------------------------------------------------------------ exact decimals */

interface Dec {
  /** Absolute value in units of 10^-scale. */
  readonly units: bigint;
  readonly scale: number;
  readonly negative: boolean;
}

const DECIMAL = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/u;

function parseDec(text: string, what = "value"): Dec {
  if (!DECIMAL.test(text)) throw new HyperCoreWireError("DECIMAL_INVALID", `${what} ${JSON.stringify(text)} is not a plain decimal.`);
  const negative = text.startsWith("-");
  const body = negative ? text.slice(1) : text;
  const [whole = "0", fraction = ""] = body.split(".");
  return { units: BigInt(`${whole}${fraction}`), scale: fraction.length, negative };
}

function normalize(value: Dec): Dec {
  let { units, scale } = value;
  while (scale > 0 && units % 10n === 0n) {
    units /= 10n;
    scale -= 1;
  }
  return { units, scale, negative: value.negative && units !== 0n };
}

function decToText(value: Dec): string {
  const { units, scale, negative } = normalize(value);
  const digits = units.toString().padStart(scale + 1, "0");
  const whole = digits.slice(0, digits.length - scale);
  const fraction = digits.slice(digits.length - scale);
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

export type PriceRounding = "nearest" | "down" | "up";

function roundDec(value: Dec, decimals: number, mode: PriceRounding): Dec {
  if (value.scale <= decimals) return value;
  const divisor = 10n ** BigInt(value.scale - decimals);
  let quotient = value.units / divisor;
  const remainder = value.units % divisor;
  // Modes act on the magnitude: "down" never moves away from zero.
  if (mode === "up" && remainder > 0n) quotient += 1n;
  if (mode === "nearest" && remainder * 2n >= divisor) quotient += 1n;
  return { units: quotient, scale: decimals, negative: value.negative };
}

function integerDigits(value: Dec): number {
  const whole = value.units / 10n ** BigInt(value.scale);
  return whole === 0n ? 0 : whole.toString().length;
}

function leadingFractionZeros(value: Dec): number {
  const digits = value.units.toString();
  return value.scale - digits.length;
}

/** Expands a JS number's shortest round-trip form ("1.5e-7") into a plain decimal string. */
export function numberToPlainString(x: number): string {
  if (!Number.isFinite(x)) throw new HyperCoreWireError("FLOAT_INVALID", `${x} is not a finite number.`);
  const text = Object.is(x, -0) ? "0" : String(x);
  const match = /^(-?)(\d+)(?:\.(\d+))?e([+-]\d+)$/u.exec(text);
  if (!match) return text;
  const [, sign = "", whole = "", fraction = "", exponentText = "0"] = match;
  const exponent = Number(exponentText);
  const digits = `${whole}${fraction}`;
  const point = whole.length + exponent;
  let out: string;
  if (point <= 0) out = `0.${"0".repeat(-point)}${digits}`;
  else if (point >= digits.length) out = `${digits}${"0".repeat(point - digits.length)}`;
  else out = `${digits.slice(0, point)}.${digits.slice(point)}`;
  return `${sign}${decToText(parseDec(out.replace(/^0+(?=\d)/u, "")))}`;
}

/* ------------------------------------------------------------- float_to_wire */

/**
 * The official SDK's `float_to_wire`: format with 8 decimals, refuse when
 * that rounding moves the value by 1e-12 or more, strip trailing zeros, and
 * never emit "-0".
 */
export function floatToWire(x: number): string {
  if (!Number.isFinite(x) || Math.abs(x) >= 1e21) throw new HyperCoreWireError("FLOAT_INVALID", `${x} cannot be sent to HyperCore.`);
  const rounded = x.toFixed(8);
  if (Math.abs(Number(rounded) - x) >= 1e-12) {
    throw new HyperCoreWireError("FLOAT_ROUNDING", `${x} has more than 8 decimals; formatting it would change the value.`);
  }
  const text = decToText(parseDec(rounded));
  return text === "-0" ? "0" : text;
}

/** A decimal string in wire form: at most 8 decimals, trailing zeros removed ("2.50" -> "2.5"). */
export function decimalToWire(text: string): string {
  const value = normalize(parseDec(text));
  if (value.scale > 8) throw new HyperCoreWireError("FLOAT_ROUNDING", `${text} has more than 8 decimals.`);
  return decToText(value);
}

/** True when `text` is already a canonical wire decimal (non-negative, no trailing zeros, at most 8 decimals). */
export function isWireDecimal(text: unknown): text is string {
  if (typeof text !== "string" || !/^(?:0|[1-9]\d*)(?:\.\d*[1-9])?$/u.test(text)) return false;
  const dot = text.indexOf(".");
  return dot < 0 || text.length - dot - 1 <= 8;
}

function toWireText(value: string | number, what: string): string {
  if (typeof value === "number") return floatToWire(value);
  try {
    return decimalToWire(value);
  } catch (error) {
    if (error instanceof HyperCoreWireError) throw new HyperCoreWireError(error.code, `${what}: ${error.message}`);
    throw error;
  }
}

/* -------------------------------------------------------------- tick rules */

export function maxPriceDecimals(szDecimals: number, isSpot: boolean): number {
  if (!Number.isInteger(szDecimals) || szDecimals < 0) throw new HyperCoreWireError("SIZE_INVALID", `szDecimals ${szDecimals} is invalid.`);
  return Math.max(0, (isSpot ? SPOT_MAX_DECIMALS : PERP_MAX_DECIMALS) - szDecimals);
}

/** True when the exchange accepts `px` as a price for an asset with `szDecimals`. */
export function isValidPrice(px: string, szDecimals: number, isSpot: boolean): boolean {
  let value: Dec;
  try {
    value = normalize(parseDec(px));
  } catch {
    return false;
  }
  if (value.negative || value.units === 0n) return false;
  if (value.scale === 0) return true;
  return value.units.toString().length <= MAX_SIGNIFICANT_FIGURES && value.scale <= maxPriceDecimals(szDecimals, isSpot);
}

/**
 * The nearest valid price (or the one below / above it): 5 significant
 * figures, at most `maxPriceDecimals` decimals; at or above 100000 it rounds
 * to an integer, which is always valid. Throws when the price would round to 0.
 */
export function roundPrice(px: string | number, szDecimals: number, isSpot: boolean, mode: PriceRounding = "nearest"): string {
  const text = typeof px === "number" ? numberToPlainString(px) : px;
  const value = normalize(parseDec(text, "price"));
  if (value.negative || value.units === 0n) throw new HyperCoreWireError("PRICE_INVALID", `Price ${text} must be positive.`);
  const maxDecimals = maxPriceDecimals(szDecimals, isSpot);
  const ints = integerDigits(value);
  const sigDecimals = ints >= 1 ? MAX_SIGNIFICANT_FIGURES - ints : MAX_SIGNIFICANT_FIGURES + leadingFractionZeros(value);
  const decimals = Math.max(0, Math.min(sigDecimals, maxDecimals));
  const rounded = roundDec(value, decimals, mode);
  if (rounded.units === 0n) throw new HyperCoreWireError("PRICE_INVALID", `Price ${text} is below the smallest tick.`);
  return decToText(rounded);
}

/** Wire string for a price; refuses (never silently rounds) a price the exchange would reject. */
export function priceToWire(px: string | number, szDecimals: number, isSpot: boolean): string {
  const text = toWireText(px, "price");
  if (!isValidPrice(text, szDecimals, isSpot)) {
    const hint = (() => {
      try {
        return `; the nearest valid price is ${roundPrice(text, szDecimals, isSpot)}`;
      } catch {
        return "";
      }
    })();
    throw new HyperCoreWireError(
      "PRICE_TICK",
      `Price ${text} breaks the tick rules (at most ${MAX_SIGNIFICANT_FIGURES} significant figures and ${maxPriceDecimals(szDecimals, isSpot)} decimals)${hint}.`,
    );
  }
  return text;
}

/** Size rounded to `szDecimals`, by default down so an order never exceeds what was asked. */
export function roundSize(sz: string | number, szDecimals: number, mode: PriceRounding = "down"): string {
  const text = typeof sz === "number" ? numberToPlainString(sz) : sz;
  const value = normalize(parseDec(text, "size"));
  if (value.negative) throw new HyperCoreWireError("SIZE_INVALID", `Size ${text} must not be negative.`);
  return decToText(roundDec(value, szDecimals, mode));
}

/** Wire string for a size; refuses zero and sizes finer than `szDecimals`. */
export function sizeToWire(sz: string | number, szDecimals: number): string {
  const text = toWireText(sz, "size");
  const value = normalize(parseDec(text, "size"));
  if (value.negative || value.units === 0n) throw new HyperCoreWireError("SIZE_INVALID", `Size ${text} must be positive.`);
  if (value.scale > szDecimals) {
    throw new HyperCoreWireError("SIZE_LOT", `Size ${text} has more than ${szDecimals} decimals; round it to ${roundSize(text, szDecimals)}.`);
  }
  return text;
}

/**
 * Limit price of an IOC "market" order: mid x (1 +/- slippage), rounded to a
 * valid tick toward the mid (a buy rounds down, a sell up), so the order can
 * never fill worse than the slippage the user allowed.
 */
export function marketPrice(input: {
  readonly mid: string;
  readonly isBuy: boolean;
  readonly slippageBps: number;
  readonly szDecimals: number;
  readonly isSpot: boolean;
}): string {
  if (!Number.isInteger(input.slippageBps) || input.slippageBps < 0 || input.slippageBps >= 10_000) {
    throw new HyperCoreWireError("PRICE_INVALID", "slippageBps must be an integer between 0 and 9999.");
  }
  const mid = normalize(parseDec(input.mid, "mid"));
  if (mid.negative || mid.units === 0n) throw new HyperCoreWireError("PRICE_INVALID", `Mid ${input.mid} must be positive.`);
  const factor = BigInt(10_000 + (input.isBuy ? input.slippageBps : -input.slippageBps));
  const raw = decToText({ units: mid.units * factor, scale: mid.scale + 4, negative: false });
  const limit = roundPrice(raw, input.szDecimals, input.isSpot, input.isBuy ? "down" : "up");
  // On a coarse tick the rounding toward the mid can cross it, leaving an IOC that can never fill.
  const limitDec = normalize(parseDec(limit));
  const scale = Math.max(limitDec.scale, mid.scale);
  const limitUnits = limitDec.units * 10n ** BigInt(scale - limitDec.scale);
  const midUnits = mid.units * 10n ** BigInt(scale - mid.scale);
  if (input.slippageBps > 0 && (input.isBuy ? limitUnits <= midUnits : limitUnits >= midUnits)) {
    throw new HyperCoreWireError("PRICE_TICK", `A ${input.slippageBps} bps slippage is smaller than one price tick here; allow more slippage or use a limit order.`);
  }
  return limit;
}

/* ------------------------------------------------------- integer encodings */

function scaledInteger(value: number | string, power: number, what: string): bigint {
  const text = typeof value === "number" ? numberToPlainString(value) : value;
  const parsed = normalize(parseDec(text, what));
  if (parsed.scale > power) throw new HyperCoreWireError("FLOAT_ROUNDING", `${what} ${text} has more than ${power} decimals.`);
  const units = parsed.units * 10n ** BigInt(power - parsed.scale);
  return parsed.negative ? -units : units;
}

/** The SDK's `float_to_int_for_hashing`: value x 1e8 as an exact integer (refuses finer values). */
export function floatToIntForHashing(value: number | string): bigint {
  return scaledInteger(value, 8, "value");
}

/** The SDK's `float_to_usd_int`: USD x 1e6 as an exact integer (e.g. `ntli`, vault `usd`). */
export function floatToUsdInt(value: number | string): bigint {
  return scaledInteger(value, 6, "USD amount");
}

/** USD (decimal string, may be negative) -> the safe-integer micro-USD number HyperCore actions carry. */
export function usdToMicros(amount: string): number {
  const micros = floatToUsdInt(amount);
  if (micros > BigInt(Number.MAX_SAFE_INTEGER) || micros < -BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new HyperCoreWireError("FLOAT_INVALID", `${amount} USD is too large.`);
  }
  return Number(micros);
}

/* ------------------------------------------------------------ asset indexes */

export interface PerpUniverseAsset {
  readonly name: string;
  readonly szDecimals: number;
  readonly maxLeverage: number;
  readonly onlyIsolated?: boolean;
  readonly isDelisted?: boolean;
}

export interface SpotUniversePair {
  readonly name: string;
  readonly tokens: readonly [number, number] | readonly number[];
  readonly index: number;
}

export interface SpotTokenMeta {
  readonly name: string;
  readonly index: number;
  readonly szDecimals: number;
  readonly weiDecimals: number;
}

/** One tradable market with what an order needs to be built. */
export interface MarketInfo {
  /** Order-book coin: `BTC` for perps, `PURR/USDC` or `@1035` for spot. */
  readonly coin: string;
  /** Display name: `BTC`, `HYPE/USDC`. */
  readonly displayName: string;
  readonly asset: number;
  readonly szDecimals: number;
  readonly isSpot: boolean;
  readonly maxLeverage: number | null;
  readonly onlyIsolated: boolean;
  readonly isDelisted: boolean;
}

export function isSpotAsset(asset: number): boolean {
  return asset >= SPOT_ASSET_OFFSET && asset < BUILDER_PERP_ASSET_OFFSET;
}

export function spotAssetIndex(spotUniverseIndex: number): number {
  if (!Number.isInteger(spotUniverseIndex) || spotUniverseIndex < 0 || spotUniverseIndex >= BUILDER_PERP_ASSET_OFFSET - SPOT_ASSET_OFFSET) {
    throw new HyperCoreWireError("ASSET_UNKNOWN", `Spot index ${spotUniverseIndex} is out of range.`);
  }
  return SPOT_ASSET_OFFSET + spotUniverseIndex;
}

/** Asset id of a builder-deployed (HIP-3) perp: `perpDexIndex` is the dex's index in `perpDexs` (>= 1). */
export function builderPerpAssetIndex(perpDexIndex: number, universeIndex: number): number {
  if (!Number.isInteger(perpDexIndex) || perpDexIndex < 1 || !Number.isInteger(universeIndex) || universeIndex < 0 || universeIndex >= 10_000) {
    throw new HyperCoreWireError("ASSET_UNKNOWN", "Builder perp indexes are out of range.");
  }
  return BUILDER_PERP_ASSET_OFFSET + perpDexIndex * 10_000 + universeIndex;
}

/** Index of `coin` in the default perp dex's `meta.universe` (its asset id). */
export function perpAssetIndex(universe: readonly PerpUniverseAsset[], coin: string): number {
  const index = universe.findIndex((asset) => asset.name === coin);
  if (index < 0) throw new HyperCoreWireError("ASSET_UNKNOWN", `${coin} is not a HyperCore perp market.`);
  return index;
}

/**
 * Market index for order building: every perp by name, every spot pair by
 * its book coin (`@1035`) and, when token metadata is given, by
 * `BASE/QUOTE` token names (`HYPE/USDC`). Canonical pairs win name clashes.
 */
export function buildMarketIndex(
  universe: readonly PerpUniverseAsset[],
  spot?: { readonly universe: readonly (SpotUniversePair & { readonly isCanonical?: boolean })[]; readonly tokens: readonly SpotTokenMeta[] },
): Map<string, MarketInfo> {
  const markets = new Map<string, MarketInfo>();
  universe.forEach((asset, index) => {
    markets.set(asset.name, {
      coin: asset.name,
      displayName: asset.name,
      asset: index,
      szDecimals: asset.szDecimals,
      isSpot: false,
      maxLeverage: asset.maxLeverage,
      onlyIsolated: asset.onlyIsolated === true,
      isDelisted: asset.isDelisted === true,
    });
  });
  if (!spot) return markets;
  const tokens = new Map(spot.tokens.map((token) => [token.index, token]));
  const ordered = [...spot.universe].sort((a, b) => Number(b.isCanonical === true) - Number(a.isCanonical === true));
  for (const pair of ordered) {
    const base = tokens.get(pair.tokens[0] ?? -1);
    const quote = tokens.get(pair.tokens[1] ?? -1);
    if (!base || !quote) continue;
    const displayName = `${base.name}/${quote.name}`;
    const info: MarketInfo = {
      coin: pair.name,
      displayName,
      asset: spotAssetIndex(pair.index),
      szDecimals: base.szDecimals,
      isSpot: true,
      maxLeverage: null,
      onlyIsolated: false,
      isDelisted: false,
    };
    if (!markets.has(pair.name)) markets.set(pair.name, info);
    if (!markets.has(displayName)) markets.set(displayName, info);
  }
  return markets;
}

/* ------------------------------------------------------------------- cloids */

/** Client order id: 0x + 16 bytes of hex. */
export type Cloid = `0x${string}`;

const CLOID = /^0x[0-9a-fA-F]{32}$/u;

export function isCloid(value: unknown): value is Cloid {
  return typeof value === "string" && CLOID.test(value);
}

/** Lower-cased cloid; throws when malformed. */
export function normalizeCloid(value: string): Cloid {
  if (!isCloid(value)) throw new HyperCoreWireError("CLOID_INVALID", `${value} is not a cloid (0x + 32 hex characters).`);
  return value.toLowerCase() as Cloid;
}

export interface RandomSource {
  getRandomValues(array: Uint8Array): Uint8Array;
}

/** A fresh cloid from 16 bytes of `crypto.getRandomValues` (browsers, Workers, Node 20+). */
export function newCloid(random: RandomSource | undefined = globalThis.crypto): Cloid {
  if (!random || typeof random.getRandomValues !== "function") {
    throw new HyperCoreWireError("CLOID_INVALID", "No secure random source (crypto.getRandomValues) is available.");
  }
  const bytes = random.getRandomValues(new Uint8Array(16));
  let hex = "0x";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return hex as Cloid;
}

/** The SDK's `Cloid.from_int`: an integer as a zero-padded 16-byte cloid. */
export function cloidFromInt(value: number | bigint): Cloid {
  const big = BigInt(value);
  if (big < 0n || big >= 1n << 128n) throw new HyperCoreWireError("CLOID_INVALID", "A cloid integer must fit in 16 bytes.");
  return `0x${big.toString(16).padStart(32, "0")}`;
}
