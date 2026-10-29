/**
 * `POST {apiUrl}/exchange`: sends a signed action (built and signed
 * elsewhere: the wallet for user-signed actions, the in-browser agent key for
 * L1 actions) and turns HyperCore's terse errors into plain words with the
 * fix. An exchange reply is a hint, never proof: the terminal reconciles from
 * the WebSocket feeds (orders, fills, positions).
 */
import type { ExchangeResponse } from "@elyia/core/hypercore/info";
import type { ExchangeRequest } from "@elyia/core/hypercore/signing";

export type ExchangeErrorCode =
  | "NO_DEPOSIT"
  | "AGENT_UNKNOWN"
  | "AGENT_LIMIT"
  | "MIN_NOTIONAL"
  | "TICK"
  | "MARGIN"
  | "REDUCE_ONLY"
  | "ALO_CROSS"
  | "IOC_NO_MATCH"
  | "BAD_TRIGGER"
  | "NO_LIQUIDITY"
  | "OI_CAP"
  | "SPOT_BALANCE"
  | "ORACLE"
  | "MAX_POSITION"
  | "MISSING_ORDER"
  | "NONCE"
  | "EXPIRED"
  | "RATE_LIMIT"
  | "LEVERAGE"
  | "HALTED"
  | "SIGNATURE"
  | "NETWORK"
  | "HTTP"
  | "UNKNOWN";

export interface ExplainedError {
  readonly code: ExchangeErrorCode;
  /** Short headline for a toast. */
  readonly title: string;
  /** What happened and what to do, in plain words. */
  readonly message: string;
}

const RULES: readonly { readonly test: RegExp; readonly code: ExchangeErrorCode; readonly title: string; readonly message: string }[] = [
  {
    test: /must deposit before performing actions/iu,
    code: "NO_DEPOSIT",
    title: "No funds on HyperCore yet",
    message: "This account has never received funds on HyperCore, so it cannot act yet. Deposit USDC first: on testnet use the faucet (it needs a mainnet deposit history) or bridge USDC from HyperEVM.",
  },
  {
    test: /(user or api wallet .* does not exist|api wallet .* (not found|expired)|agent .* (not found|expired))/iu,
    code: "AGENT_UNKNOWN",
    title: "Trading key not recognised",
    message: "HyperCore does not know this trading key for your account: it expired, was revoked, or another device replaced it. Enable trading again.",
  },
  {
    test: /(extra agent|too many (api|agent)|maximum number of (api|agent)|agent limit)/iu,
    code: "AGENT_LIMIT",
    title: "All trading-key slots are used",
    message: "Your account already uses every named trading key HyperCore allows (3). Revoke one in the Hyperliquid app, or re-use the elyia-web slot.",
  },
  { test: /minimum value of \$?10/iu, code: "MIN_NOTIONAL", title: "Order too small", message: "HyperCore orders must be worth at least $10 (10 quote units on spot). Increase the size." },
  { test: /divisible by tick size|tick size/iu, code: "TICK", title: "Price off the tick", message: "The price does not fit the market's tick (5 significant figures). Elyia rounds prices for you; adjust it and try again." },
  { test: /insufficient margin|not enough margin|margin.*insufficient/iu, code: "MARGIN", title: "Not enough margin", message: "There is not enough free margin for this order. Lower the size or the leverage, or add USDC." },
  { test: /reduce only order would increase/iu, code: "REDUCE_ONLY", title: "Reduce-only would grow the position", message: "A reduce-only order may only shrink a position. Check the side and size, or turn reduce-only off." },
  { test: /post only order would have immediately matched/iu, code: "ALO_CROSS", title: "Post-only would have filled", message: "A post-only (ALO) order would have filled at once. Move the price away from the spread, or use a normal limit order." },
  { test: /could not immediately match/iu, code: "IOC_NO_MATCH", title: "Nothing to fill against", message: "No resting orders could fill this within your slippage. Allow more slippage or place a limit order." },
  { test: /invalid tp\/sl|tp\/sl price|trigger price/iu, code: "BAD_TRIGGER", title: "TP/SL price is on the wrong side", message: "A take profit must sit above the entry for a long (below for a short), a stop below it (above for a short)." },
  { test: /no liquidity/iu, code: "NO_LIQUIDITY", title: "No liquidity", message: "The book has no liquidity for a market order right now. Use a limit order." },
  { test: /open interest|oi cap/iu, code: "OI_CAP", title: "Open-interest cap reached", message: "This market is at its open-interest cap: only orders that reduce positions go through for now." },
  { test: /insufficient spot balance|insufficient balance/iu, code: "SPOT_BALANCE", title: "Balance too low", message: "Your spot balance does not cover this order. Lower the size or move funds to spot." },
  { test: /too far from oracle|oracle/iu, code: "ORACLE", title: "Too far from the oracle", message: "HyperCore refuses prices this far from the oracle price. Move the price closer to the market." },
  { test: /margin tier|max position|position size/iu, code: "MAX_POSITION", title: "Position limit", message: "This would exceed the market's position limit at this leverage. Lower the leverage or the size." },
  { test: /never placed, already canceled, or filled/iu, code: "MISSING_ORDER", title: "Order already gone", message: "That order was already filled or cancelled." },
  { test: /nonce/iu, code: "NONCE", title: "Sequence number refused", message: "HyperCore refused the request's sequence number (an older one was already used, or the clock is off). Try again." },
  { test: /expire/iu, code: "EXPIRED", title: "Request expired", message: "The signed request expired before HyperCore processed it. Try again." },
  { test: /too many requests|rate limit/iu, code: "RATE_LIMIT", title: "Rate limited", message: "HyperCore is rate limiting this account or connection. Wait a few seconds and try again." },
  { test: /leverage|cross margin|isolated/iu, code: "LEVERAGE", title: "Leverage refused", message: "HyperCore refused this leverage or margin mode for the market. Check its maximum and whether it is isolated-only." },
  { test: /halted|delisted|not trading/iu, code: "HALTED", title: "Market not trading", message: "This market is halted or delisted." },
  { test: /signature|recover/iu, code: "SIGNATURE", title: "Signature refused", message: "HyperCore could not verify the signature. Enable trading again to refresh the key." },
];

/** Plain-language reading of a HyperCore error string. */
export function explainExchangeError(raw: string): ExplainedError {
  for (const rule of RULES) if (rule.test.test(raw)) return { code: rule.code, title: rule.title, message: rule.message };
  return { code: "UNKNOWN", title: "HyperCore refused this", message: raw.length > 240 ? `${raw.slice(0, 240)}…` : raw };
}

export class ExchangeError extends Error {
  readonly code: ExchangeErrorCode;
  readonly title: string;
  /** HyperCore's own words. */
  readonly raw: string;
  constructor(explained: ExplainedError, raw: string) {
    super(explained.message);
    this.name = "ExchangeError";
    this.code = explained.code;
    this.title = explained.title;
    this.raw = raw;
  }
}

export function exchangeError(raw: string): ExchangeError {
  return new ExchangeError(explainExchangeError(raw), raw);
}

/** One order's (or cancel's) outcome, read from an exchange reply. */
export type ActionOutcome =
  | { readonly kind: "resting"; readonly oid: number }
  | { readonly kind: "filled"; readonly oid: number; readonly totalSz: string; readonly avgPx: string }
  | { readonly kind: "waiting" }
  | { readonly kind: "success" }
  | { readonly kind: "running"; readonly twapId: number }
  | { readonly kind: "error"; readonly error: ExplainedError; readonly raw: string };

/**
 * Every per-item status of an `ok` reply (orders, cancels, TWAP), in batch
 * order. A whole-request error (`status: "err"`) is one error outcome.
 */
export function readOutcomes(response: ExchangeResponse): ActionOutcome[] {
  if (response.status === "err") return [{ kind: "error", error: explainExchangeError(response.response), raw: response.response }];
  const body = response.response as { readonly type?: string; readonly data?: unknown };
  const data = body.data as { readonly statuses?: unknown; readonly status?: unknown } | undefined;
  const items: unknown[] = Array.isArray(data?.statuses) ? data.statuses : data?.status !== undefined ? [data.status] : [];
  if (items.length === 0) return [{ kind: "success" }];
  return items.map((item): ActionOutcome => {
    if (item === "success") return { kind: "success" };
    if (item === "waitingForFill" || item === "waitingForTrigger") return { kind: "waiting" };
    if (item && typeof item === "object") {
      const value = item as Record<string, unknown>;
      if (typeof value.error === "string") return { kind: "error", error: explainExchangeError(value.error), raw: value.error };
      const resting = value.resting as { oid?: unknown } | undefined;
      if (resting && typeof resting.oid === "number") return { kind: "resting", oid: resting.oid };
      const filled = value.filled as { oid?: unknown; totalSz?: unknown; avgPx?: unknown } | undefined;
      if (filled && typeof filled.oid === "number") return { kind: "filled", oid: filled.oid, totalSz: String(filled.totalSz ?? ""), avgPx: String(filled.avgPx ?? "") };
      const running = value.running as { twapId?: unknown } | undefined;
      if (running && typeof running.twapId === "number") return { kind: "running", twapId: running.twapId };
    }
    return { kind: "success" };
  });
}

/**
 * POSTs one signed request. Resolves with the parsed reply (including
 * `status: "err"` replies: callers read them with `readOutcomes`); rejects
 * with an ExchangeError only when the request itself could not be delivered
 * or understood.
 */
export async function postExchange(url: string, request: ExchangeRequest, fetchImpl: typeof fetch = (input, init) => globalThis.fetch(input, init)): Promise<ExchangeResponse> {
  let response: Response;
  try {
    response = await fetchImpl(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(request) });
  } catch {
    throw new ExchangeError({ code: "NETWORK", title: "Could not reach HyperCore", message: "The request did not reach HyperCore. Check your connection; nothing was placed." }, "network");
  }
  const text = await response.text().catch(() => "");
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  if (!response.ok) {
    if (response.status === 429) throw exchangeError("Too many requests");
    const raw = typeof body === "object" && body && "response" in body ? String((body as { response: unknown }).response) : text.slice(0, 200) || `HTTP ${response.status}`;
    const explained = explainExchangeError(raw);
    throw new ExchangeError(explained.code === "UNKNOWN" ? { code: "HTTP", title: `HyperCore answered ${response.status}`, message: explained.message } : explained, raw);
  }
  if (!body || typeof body !== "object" || !("status" in body)) {
    throw new ExchangeError({ code: "UNKNOWN", title: "Unreadable reply", message: "HyperCore sent a reply Elyia could not read. Check your orders before retrying." }, text.slice(0, 200));
  }
  return body as ExchangeResponse;
}
