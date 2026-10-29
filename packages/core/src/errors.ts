/**
 * Error catalog. Every `error.code` the API returns and every
 * `step.failure.code` a step can carry is listed with its HTTP status, a
 * category, whether repeating the same request later can succeed, a short
 * title and a plain-language message that says what to do. The API serves
 * it at `GET /v1/errors`; web and Telegram show `message` as-is.
 *
 * Provider failures carry the provider in the code (`HYPERLIQUID_UNAVAILABLE`,
 * `RPC_REJECTED`); `resolveErrorCode` maps such codes to their family entry.
 */

export type ErrorStatus = 400 | 401 | 403 | 404 | 405 | 409 | 410 | 413 | 415 | 422 | 429 | 500 | 502 | 503 | 504;

export const ERROR_CATEGORIES = Object.freeze([
  "request",
  "authentication",
  "permission",
  "policy",
  "not_found",
  "conflict",
  "expired",
  "intent",
  "trading",
  "verification",
  "settlement",
  "rate_limit",
  "upstream",
  "unavailable",
  "internal",
] as const);

export type ErrorCategory = (typeof ERROR_CATEGORIES)[number];

export interface ErrorCatalogEntry {
  /** HTTP status as an API error; null when the code only appears as `step.failure.code`. */
  readonly status: ErrorStatus | null;
  readonly category: ErrorCategory;
  /** Repeating the same request later can succeed without changing it. */
  readonly retryable: boolean;
  /** Also used as `step.failure.code`. */
  readonly step?: boolean;
  readonly title: string;
  /** Plain words: what happened and what to do. */
  readonly message: string;
}

type Entry = ErrorCatalogEntry;
const entry = (status: ErrorStatus | null, category: ErrorCategory, retryable: boolean, title: string, message: string, extra: Partial<Entry> = {}): Entry => ({
  status,
  category,
  retryable,
  title,
  message,
  ...extra,
});
const request = (title: string, message: string, status: ErrorStatus = 400) => entry(status, "request", false, title, message);
const intent = (title: string, message: string) => entry(422, "intent", false, title, message);
const trading = (title: string, message: string, extra: Partial<Entry> = {}) => entry(422, "trading", false, title, message, { step: true, ...extra });
const conflict = (title: string, message: string, retryable = false) => entry(409, "conflict", retryable, title, message);
const verification = (title: string, message: string, status: ErrorStatus | null = 422) => entry(status, "verification", false, title, message, { step: true });
const upstream = (title: string, message: string, status: ErrorStatus = 502, retryable = true) => entry(status, "upstream", retryable, title, message);
const policy = (title: string, message: string, retryable = false) => entry(403, "policy", retryable, title, message);

const RESUBMIT = "Submit the references of the payload prepared for this step, sent by the step account.";

export const ERROR_CATALOG = {
  /* ------------------------------------------------------------- request */
  INVALID_REQUEST: request("Invalid request", "Some fields are wrong; error.details lists them. Fix them and send the request again."),
  INVALID_JSON: request("Malformed JSON", "The body is not valid JSON. Send a JSON object."),
  PAYLOAD_TOO_LARGE: request("Request too large", "Keep request bodies under 64 KB.", 413),
  UNSUPPORTED_MEDIA_TYPE: request("Unsupported media type", "Send the body as application/json.", 415),
  METHOD_NOT_ALLOWED: request("Method not allowed", "Use one of the methods in the Allow header.", 405),
  NOT_FOUND: entry(404, "not_found", false, "Unknown route", "This path does not exist. Check it against the API reference."),
  ACCOUNT_INVALID: request("Invalid account", "Send accounts as CAIP-10 ids, for example eip155:99801:0x… or hypercore:testnet:0x…."),
  ADDRESS_CHECKSUM_INVALID: request("Address checksum wrong", "The capital letters of this address do not match its checksum, which usually means a typo. Copy the address again."),
  AMOUNT_INVALID: request("Invalid amount", "Use a positive number with a dot for decimals, like 1.5, without commas or exponents."),
  REFERENCE_INVALID: request("Invalid reference", "Send a 0x transaction hash for Elysium or HyperEVM steps, or hc:cloid:<user>:<cloid> / hc:nonce:<signer>:<nonce> for HyperCore steps."),
  REFERENCE_COUNT_MISMATCH: request("Wrong number of references", "Submit exactly one reference per prepared request, in order."),
  NETWORK_UNKNOWN: request("Unknown network", "Use a network from GET /v1/networks (for example elysium-testnet)."),
  TOKEN_UNKNOWN: entry(422, "intent", false, "Unknown token", "Elyia does not list this token on that network. Use a listed symbol or the token's address."),
  RULE_BOOK_INVALID: request("Invalid rule book", "Some rules are malformed; error.details lists them. validateRuleBook in @elyia/core reports the same issues."),

  /* ------------------------------------------------------ authentication */
  SESSION_REQUIRED: entry(401, "authentication", false, "Sign in required", "Connect your wallet and sign the Elyia sign-in message first."),
  SESSION_INVALID: entry(401, "authentication", false, "Session expired", "Your Elyia session is invalid or expired. Sign in again with your wallet."),
  SIWE_NONCE_INVALID: entry(401, "authentication", false, "Sign-in message invalid", "The sign-in message is unknown, used or expired. Request a new one and sign it unchanged."),
  SIWE_SIGNATURE_INVALID: entry(401, "authentication", false, "Sign-in signature invalid", "The signature does not match the message and address. Sign the exact message with the wallet it names."),
  TELEGRAM_AUTH_INVALID: entry(401, "authentication", false, "Telegram sign-in invalid", "Telegram could not confirm this session. Open the Mini App again from the Elyia bot."),
  TELEGRAM_LINK_INVALID: entry(400, "authentication", false, "Link code invalid", "This Telegram link code is unknown or expired. Create a new one in Settings."),
  ACCOUNT_NOT_OWNED: entry(403, "permission", false, "Not your account", "This action needs the wallet that owns the account. Connect that wallet."),

  /* --------------------------------------------------------------- policy */
  POLICY_DENIED: policy("Blocked by your rule book", "Your rule book does not allow this. error.details lists the rules and limits; change the request or your rules."),
  POLICY_CONFIRMATION_REQUIRED: policy("Confirmation needed", "Your rule book asks you to confirm this before it runs. Approve it in Elyia or Telegram, then continue.", true),
  POLICY_LIMIT_REACHED: policy("Limit reached", "A daily or weekly limit in your rule book is used up. Try again after it resets, or raise the limit.", true),
  POLICY_FACTS_UNAVAILABLE: policy("Cannot check your rules right now", "A price or account fact your rules need could not be read, so Elyia refuses rather than guess. Try again in a moment.", true),
  POLICY_PAUSED: policy("Rule book paused", "Your rule book is paused (kill switch). Resume it in Agent settings to run anything."),
  POLICY_SCHEDULE_CLOSED: policy("Outside your trading hours", "Your rule book only allows this during its schedule. Try again when the window opens.", true),

  /* ------------------------------------------------------------ not found */
  INTENT_NOT_FOUND: entry(404, "not_found", false, "Intent not found", "Check the intent id. Dry runs are never stored."),
  STEP_NOT_FOUND: entry(404, "not_found", false, "Step not found", "Use a step id from the intent (s1, s2, ...)."),
  AUTOMATION_NOT_FOUND: entry(404, "not_found", false, "Automation not found", "This automation does not exist or belongs to another account."),
  ALERT_NOT_FOUND: entry(404, "not_found", false, "Alert not found", "This alert does not exist or belongs to another account."),
  TRACK_NOT_FOUND: entry(404, "not_found", false, "Nothing tracked here", "Check the tracking id, or track the transaction again."),
  MARKET_NOT_FOUND: entry(404, "not_found", false, "Market not found", "HyperCore has no market by that name. Check the coin (BTC, ETH, HYPE/USDC)."),

  /* ------------------------------------------------------------- conflict */
  INTENT_CONFLICT: conflict("Intent changed meanwhile", "The intent changed while your request ran. Read it again and retry.", true),
  INTENT_STOPPED: conflict("Intent stopped", "This intent was stopped. Create a new one."),
  INTENT_COMPLETED: conflict("Intent finished", "Nothing is left to run in this intent."),
  INTENT_IN_FLIGHT: conflict("A step is still moving", "A step is in flight and cannot be stopped. Wait for it to settle (or cancel the resting order), then stop the intent.", true),
  CLIENT_REFERENCE_EXISTS: conflict("Already created", "This clientReference was used before. Read the existing intent, or use a new reference."),
  STEP_NOT_READY: conflict("Step not ready", "Earlier steps have not settled yet. Wait for them, then prepare this one.", true),
  STEP_NOT_PREPARABLE: conflict("Step cannot be prepared", "Only ready, awaiting-signature or retryable failed steps can be prepared."),
  STEP_NOT_AWAITING_SIGNATURE: conflict("Nothing to submit", "Prepare the step before submitting references."),
  STEP_TRANSITION_INVALID: conflict("Step already moved on", "Read the intent again; the step changed state."),
  QUOTE_MOVED: conflict("Price moved", "The price moved past your slippage limit since planning. Plan the intent again to get a fresh quote."),
  NONCE_INVALID: entry(409, "conflict", false, "Nonce refused", "HyperCore refused the nonce (used, too old or too far ahead). Prepare the step again.", { step: true }),

  /* -------------------------------------------------------------- expired */
  INTENT_EXPIRED: entry(410, "expired", false, "Plan expired", "The plan expired before it started. Plan it again for fresh prices."),
  PAYLOAD_EXPIRED: entry(410, "expired", false, "Payload expired", "The prepared payload expired before it was signed. Prepare the step again.", { step: true }),
  DEADLINE_PASSED: entry(410, "expired", false, "Deadline passed", "The deadline you set is in the past. Plan again with a later deadline."),

  /* --------------------------------------------------------------- intent */
  INTENT_UNSUPPORTED: intent("Not understood", "Elyia could not turn this into steps. Rephrase it like one of the examples, or use the trade ticket."),
  INTENT_CLARIFY: entry(422, "intent", false, "A detail is missing", "Answer the question in error.details (amount, market or network) and Elyia will plan it."),
  CAPITAL_LANE_MIXED: intent("Testnet and mainnet mixed", "One intent runs on testnet or on mainnet, never both. Pick one environment."),
  ENVIRONMENT_UNAVAILABLE: entry(503, "unavailable", true, "Mainnet not open yet", "Elysium mainnet is not live in Elyia yet. Use testnet until launch."),
  ACCOUNT_REQUIRED: intent("Account missing", "Connect a wallet for every network this intent touches."),
  INSUFFICIENT_BALANCE: intent("Not enough funds", "The account holds less than this needs, including gas. Lower the amount or add funds."),
  INSUFFICIENT_GAS: intent("Not enough HYPE for gas", "Keep a little HYPE on this network for gas, or bridge some first."),
  AMOUNT_TOO_SMALL: intent("Amount too small", "This amount rounds to zero or is below the venue's minimum. Use a larger amount."),
  ASSET_NETWORK_MISMATCH: intent("Token on another network", "This token does not live on that network. Bridge it first, or pick the network it is on."),
  TOKEN_UNVERIFIED: intent("Unverified token", "This token is not in Elyia's verified list (look-alikes exist). Use its exact address to proceed deliberately."),
  ROUTE_UNSUPPORTED: intent("No route", "No listed protocol does this between these networks yet. See the ecosystem page for what is supported."),
  ROUTE_UNAVAILABLE: intent("Route unavailable now", "The venue cannot route this right now. Try another amount or try again later."),
  PRICE_IMPACT_TOO_HIGH: intent("Price impact too high", "This would move the price too much. Trade a smaller amount."),
  RECIPIENT_INVALID: intent("Invalid recipient", "Use an address or CAIP-10 account on the network that receives the funds."),
  BRIDGE_DISABLED: intent("Bridge not open here", "This bridge route is not open in Elyia yet (mainnet token gateways are unpublished). Use testnet for now."),
  PLAN_INVALID: entry(422, "intent", false, "Plan invalid", "The plan broke a structural rule. Simplify the request; at most 12 steps are planned."),

  /* -------------------------------------------------------------- trading */
  MARKET_UNKNOWN: trading("Unknown market", "HyperCore has no such market. Check the coin name (BTC, ETH, HYPE/USDC)."),
  MARKET_DELISTED: trading("Market delisted", "This market is delisted; you can only close existing positions."),
  ORDER_PRICE_INVALID: trading("Invalid price", "Prices take at most 5 significant figures and a limited number of decimals. Use the suggested price."),
  ORDER_SIZE_INVALID: trading("Invalid size", "The size has more decimals than this market allows. Use the rounded size shown."),
  ORDER_MIN_NOTIONAL: trading("Order too small", "HyperCore orders must be worth at least $10. Increase the size."),
  ORDER_REJECTED: trading("Order rejected", "HyperCore rejected or canceled the order (see the reason). Any filled part stays in your position."),
  ORDER_UNKNOWN: trading("Order not found", "HyperCore does not know this order yet. If it was just sent, wait a few seconds."),
  REDUCE_ONLY_VIOLATION: trading("Would not reduce", "A reduce-only order must shrink an existing position. Check the side and size."),
  MARGIN_INSUFFICIENT: trading("Not enough margin", "Your perp account lacks margin for this. Move USDC from spot to perps, lower size or leverage."),
  LEVERAGE_INVALID: trading("Leverage not allowed", "Leverage must be a whole number between 1 and the market's maximum."),
  TWAP_INVALID: trading("Invalid TWAP", "A TWAP runs between 5 minutes and 24 hours. Pick a duration in that range."),
  AGENT_NOT_APPROVED: trading("Trading key not approved", "Approve Elyia's trade-only key on HyperCore first (one wallet signature). It can trade but never withdraw."),
  AGENT_EXPIRED: trading("Trading key expired", "Your trade-only key expired. Approve a fresh one; Elyia never reuses old keys."),
  AGENT_KEY_REQUIRED: trading("Trading key missing on this device", "This browser has no Elyia trading key. Create one here, or sign each trade in your wallet."),
  KEEPER_DISABLED: entry(403, "permission", false, "Keeper mode is off", "Keeper mode (24/7 automations) is off or not available on this server. Use browser autopilot or approve each trade."),
  HYPERCORE_REJECTED: entry(422, "trading", false, "HyperCore refused", "HyperCore refused the action (see the reason). Nothing was executed.", { step: true }),
  CORE_LINK_UNLINKED_TOKEN: trading("Token not linked to HyperCore", "This token has no HyperCore link, so it cannot move between HyperEVM and HyperCore."),
  CORE_LINK_DUST: trading("Amount would lose dust", "HyperCore keeps fewer decimals than this token; the remainder would be lost. Use the rounded amount shown."),

  /* --------------------------------------------------------- verification */
  REFERENCE_ALREADY_USED: verification("Already used", "This transaction or HyperCore action already completed another step. " + RESUBMIT),
  REFERENCE_MISMATCH: verification("Not the prepared payload", "What landed does not match what Elyia prepared for this step. " + RESUBMIT),
  REFERENCE_STALE: verification("Older than the payload", "This landed before the step was prepared. " + RESUBMIT),
  REFERENCE_WRONG_NETWORK: verification("On another network", "Send the prepared payload on the step's network."),
  REFERENCE_WRONG_SENDER: verification("From another account", "The step account (or its approved agent) must send the prepared payload."),
  TRANSACTION_REVERTED: verification("Transaction reverted", "The transaction failed on-chain; nothing moved except gas. Check it in the explorer and prepare again.", null),
  TRANSACTION_EXPIRED: verification("Never landed", "The signed action expired before it landed. Prepare the step again.", null),
  OUTCOME_NOT_PROVEN: verification("Outcome not proven", "It landed, but the effect does not match the plan. Elyia holds the step for review; contact support with the intent id.", null),
  OUTCOME_UNKNOWN: entry(null, "verification", false, "Outcome unknown", "Elyia could not confirm what happened in time. The step is held for review and will not be retried automatically.", { step: true }),

  /* ----------------------------------------------------------- settlement */
  RETRYABLE_REDEEM_FAILED: entry(null, "settlement", false, "Bridge ticket expired", "The Elysium retryable ticket was not redeemed within 7 days. Funds stay in the gateway; contact support with the intent id.", { step: true }),
  RETRYABLE_REDEEM_NEEDED: entry(null, "settlement", true, "Bridge needs a nudge", "The automatic redeem on Elysium failed. Redeem the ticket (anyone can) before it expires in 7 days.", { step: true }),
  WITHDRAWAL_NOT_CLAIMABLE: entry(409, "settlement", true, "Not claimable yet", "The withdrawal is still in its challenge period. Claim it on HyperEVM after the time shown.", { step: true }),
  SETTLEMENT_TIMEOUT: entry(null, "settlement", false, "Taking too long", "The destination has not shown the funds in the expected time. Elyia keeps watching and holds the step for review.", { step: true }),

  /* ----------------------------------------------------------- rate limit */
  RATE_LIMITED: entry(429, "rate_limit", true, "Slow down", "Too many requests. Wait for Retry-After seconds."),
  TOO_MANY_STREAMS: entry(429, "rate_limit", true, "Too many live streams", "Close another live view or tab; at most 10 streams per client."),

  /* ------------------------------------------------------------- upstream */
  PROVIDER_UNAVAILABLE: upstream("Data source unavailable", "A network or data source is not answering. Try again shortly. Also returned as <PROVIDER>_UNAVAILABLE."),
  PROVIDER_REJECTED: upstream("Data source refused", "A network or data source refused the request. Also returned as <PROVIDER>_REJECTED.", 502, false),
  UPSTREAM_TIMEOUT: upstream("Data source timed out", "A network or data source took too long. Try again shortly.", 504),
  PRICE_UNAVAILABLE: upstream("No fresh price", "Elyia has no fresh price for an asset here, so it will not guess. Try again shortly.", 503),

  /* ----------------------------------------------------------- unavailable */
  FEATURE_UNAVAILABLE: entry(503, "unavailable", false, "Not available yet", "This needs something that is not live yet (for example ElysiumCoreWriter, about four weeks after mainnet)."),
  ASSISTANT_UNAVAILABLE: entry(503, "unavailable", true, "Assistant offline", "The AI assistant is not configured here; the deterministic intent engine still works."),

  /* -------------------------------------------------------------- internal */
  INTERNAL_ERROR: entry(500, "internal", true, "Something broke", "Elyia hit an unexpected error. Try again; if it persists, report it with the requestId."),
  STEP_INVALID: entry(500, "internal", false, "Step cannot run", "This stored step cannot be executed. Plan the intent again.", { step: true }),
  PAYLOAD_INVALID: entry(502, "internal", true, "Payload refused by safety checks", "The prepared payload failed Elyia's own checks and was not handed out. Try again shortly."),
} as const satisfies Record<string, ErrorCatalogEntry>;

export type ErrorCode = keyof typeof ERROR_CATALOG;

/** Dynamic provider codes (`<PROVIDER>_<SUFFIX>`) and the entry describing them. */
export const ERROR_CODE_FAMILIES: readonly { readonly suffix: string; readonly code: ErrorCode }[] = Object.freeze([
  { suffix: "_UNAVAILABLE", code: "PROVIDER_UNAVAILABLE" },
  { suffix: "_REJECTED", code: "PROVIDER_REJECTED" },
  { suffix: "_TIMEOUT", code: "UPSTREAM_TIMEOUT" },
]);

const CODE_SHAPE = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/u;

export function isErrorCode(code: unknown): code is ErrorCode {
  return typeof code === "string" && Object.prototype.hasOwnProperty.call(ERROR_CATALOG, code);
}

/** The catalog code describing `code`: itself when listed, its provider family otherwise, null when unknown. */
export function resolveErrorCode(code: string): ErrorCode | null {
  if (isErrorCode(code)) return code;
  if (!CODE_SHAPE.test(code)) return null;
  for (const family of ERROR_CODE_FAMILIES) {
    if (code.endsWith(family.suffix) && code.length > family.suffix.length) return family.code;
  }
  return null;
}

export function describeError(code: string): (ErrorCatalogEntry & { readonly code: ErrorCode }) | null {
  const resolved = resolveErrorCode(code);
  return resolved ? { code: resolved, ...ERROR_CATALOG[resolved] } : null;
}

/** HTTP status for a code (500 for unknown codes or step-only codes). */
export function errorStatus(code: string): ErrorStatus {
  return describeError(code)?.status ?? 500;
}

/** True when repeating the same request later can succeed (unknown codes: by status, 429 and 5xx). */
export function isRetryableError(code: string, status?: number): boolean {
  const described = describeError(code);
  if (described) return described.retryable;
  return status === 429 || (status !== undefined && status >= 500);
}

/** The API error envelope `{error: {code, message, details?, requestId?}}`. */
export interface ErrorEnvelope {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly details?: unknown;
    readonly requestId?: string;
  };
}

/** Builds the envelope with the catalog's plain-language message unless a specific one is given. */
export function errorEnvelope(code: ErrorCode | string, options: { readonly message?: string; readonly details?: unknown; readonly requestId?: string } = {}): ErrorEnvelope {
  const described = describeError(code);
  return {
    error: {
      code,
      message: options.message ?? described?.message ?? ERROR_CATALOG.INTERNAL_ERROR.message,
      ...(options.details !== undefined ? { details: options.details } : {}),
      ...(options.requestId !== undefined ? { requestId: options.requestId } : {}),
    },
  };
}

/** Failures whose outcome is unknown: held for manual review, never prepared again automatically. */
export const REVIEW_FAILURE_CODES: readonly ErrorCode[] = Object.freeze(["OUTCOME_UNKNOWN", "OUTCOME_NOT_PROVEN", "SETTLEMENT_TIMEOUT", "RETRYABLE_REDEEM_FAILED"]);

/**
 * A step failure record from a catalog code. `retryable` here means "the
 * step may be prepared again": true for a proven failure of the step's own
 * payload (reverted, expired, rejected order, refused nonce), false for review
 * codes and for failures a new payload cannot fix.
 */
export function stepFailure(
  code: ErrorCode,
  options: { readonly message?: string; readonly retryable?: boolean } = {},
): { readonly code: ErrorCode; readonly message: string; readonly retryable: boolean; readonly review?: true } {
  const described: ErrorCatalogEntry = ERROR_CATALOG[code];
  const message = options.message ?? described.message;
  if (REVIEW_FAILURE_CODES.includes(code)) return { code, message, retryable: false, review: true };
  const preparable = described.retryable || described.category === "verification" || described.category === "trading" || described.category === "expired" || code === "NONCE_INVALID";
  return { code, message, retryable: options.retryable ?? preparable };
}

export interface ErrorCatalogRow extends ErrorCatalogEntry {
  readonly code: ErrorCode;
}

/** The catalog as rows sorted by code (`GET /v1/errors`). */
export function errorCatalogRows(): ErrorCatalogRow[] {
  return (Object.keys(ERROR_CATALOG) as ErrorCode[]).sort().map((code) => ({ code, ...ERROR_CATALOG[code] }));
}
