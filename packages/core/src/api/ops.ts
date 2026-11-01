/**
 * Wire contract of the ops endpoints: wallet sessions (SIWE), roles,
 * Telegram linking, transaction tracking, watchlists and alerts. Import as
 * `@elyia/core/api/ops`.
 *
 * Sessions are HMAC-signed tokens sent back in the `Elyia-Session` header.
 * The server never holds a wallet key: signing in proves control of an
 * address, nothing more.
 */
import type { NetworkKey } from "../networks.js";

export const OPS_API_VERSION = "elyia.api.ops/v1" as const;

/** Request header that carries a session token. */
export const SESSION_HEADER = "Elyia-Session" as const;

export const SESSION_ROLES = Object.freeze(["user", "developer", "admin"] as const);
export type SessionRole = (typeof SESSION_ROLES)[number];

/* ----------------------------------------------------------------- auth */

/** POST /v1/auth/siwe/nonce. */
export interface SiweNonceRequest {
  readonly address?: string;
  readonly chainId?: number;
}

export interface SiweNonceResponse {
  readonly nonce: string;
  /** ISO time after which the nonce is refused. */
  readonly expiresAt: string;
  /** What the message must say (EIP-4361 fields the server checks). */
  readonly domain: string;
  readonly uri: string;
  readonly chainIds: readonly number[];
  readonly statement: string;
  /** A ready EIP-4361 message when `address` and `chainId` were sent (sign it as is). */
  readonly message: string | null;
}

/** POST /v1/auth/siwe/verify. */
export interface SiweVerifyRequest {
  readonly message: string;
  readonly signature: string;
}

export interface SessionView {
  readonly address: string;
  /** Roles held now (admin and developer are re-checked on every request). */
  readonly roles: readonly SessionRole[];
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly sessionId: string;
  /** Telegram user bound to this session (Mini App sign-in), when any. */
  readonly telegramUserId: number | null;
}

export interface SessionResponse {
  /** Send it back as the `Elyia-Session` header. */
  readonly token: string;
  readonly session: SessionView;
}

/** POST /v1/auth/telegram: Mini App `initData`, validated with the bot token. */
export interface TelegramAuthRequest {
  readonly initData: string;
}

export interface LinkCodeResponse {
  readonly code: string;
  readonly expiresAt: string;
  /** `https://t.me/<bot>?start=<code>`; null while the bot is not configured. */
  readonly deepLink: string | null;
}

/* ------------------------------------------------------------- tracking */

export type TrackKind = "evm-tx" | "hypercore-order" | "hypercore-action";
export type TrackStatus = "pending" | "confirmed" | "failed" | "not_found" | "expired";

/** POST /v1/track. `reference`: a 0x tx hash, `hc:cloid:<user>:<cloid>` or `hc:nonce:<signer>:<nonce>`. */
export interface TrackRequest {
  readonly network: NetworkKey;
  readonly reference: string;
  readonly label?: string;
}

export interface TrackedLog {
  readonly address: string;
  /** Registry label of the emitting contract, when it is one Elyia knows. */
  readonly contract: string | null;
  readonly event: string | null;
}

export interface TrackView {
  readonly id: string;
  readonly kind: TrackKind;
  readonly network: NetworkKey;
  readonly reference: string;
  readonly label: string | null;
  readonly status: TrackStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly checks: number;
  readonly nextCheckAt: string | null;
  readonly detail: {
    readonly blockNumber: string | null;
    readonly from: string | null;
    readonly to: string | null;
    readonly toContract: string | null;
    readonly logs: readonly TrackedLog[];
    readonly explorerUrl: string | null;
    readonly note: string | null;
  };
}

export const TRACK_STREAM_EVENTS = Object.freeze({ snapshot: "track.snapshot", updated: "track.updated" } as const);

/* ------------------------------------------------------------ watchlist */

export interface WatchEntry {
  readonly address: string;
  readonly label: string | null;
  readonly createdAt: string;
}

export interface WatchListResponse {
  readonly entries: readonly WatchEntry[];
}

/* --------------------------------------------------------------- alerts */

export const ALERT_KINDS = Object.freeze([
  "price-above",
  "price-below",
  "funding-above",
  "funding-below",
  "liquidation-distance-below",
  "intent-step",
] as const);
export type AlertKind = (typeof ALERT_KINDS)[number];

export type AlertChannel = "feed" | "telegram" | "webhook";

/** POST /v1/alerts. */
export interface AlertInput {
  readonly kind: AlertKind;
  /** HyperCore coin for price / funding (`BTC`, `HYPE`); position coin (or omitted for all) for liquidation distance. */
  readonly coin?: string;
  /** Price in USD, funding in % per hour (decimal string), distance in %. */
  readonly threshold?: string;
  /** For `intent-step`: the intent to follow. */
  readonly intentId?: string;
  /** HyperCore account watched for liquidation distance (default: the session address). */
  readonly account?: string;
  readonly channels?: readonly AlertChannel[];
  /** Minimum seconds between two firings (default 900, at least 60). */
  readonly cooldownSeconds?: number;
  readonly note?: string;
}

export interface AlertView {
  readonly id: string;
  readonly owner: string;
  readonly kind: AlertKind;
  readonly coin: string | null;
  readonly threshold: string | null;
  readonly intentId: string | null;
  readonly account: string | null;
  readonly channels: readonly AlertChannel[];
  readonly cooldownSeconds: number;
  readonly note: string | null;
  readonly enabled: boolean;
  readonly createdAt: string;
  readonly lastFiredAt: string | null;
  readonly fireCount: number;
  /** HyperCore network the evaluator reads (the mode's). */
  readonly network: NetworkKey;
}

export interface AlertListResponse {
  readonly alerts: readonly AlertView[];
}

export interface AlertFiring {
  readonly id: string;
  readonly alertId: string;
  readonly owner: string;
  readonly kind: AlertKind;
  readonly firedAt: string;
  /** Observed value that crossed the threshold. */
  readonly observed: string;
  readonly threshold: string | null;
  readonly message: { readonly en: string; readonly tr: string };
  readonly delivered: readonly AlertChannel[];
}

export interface AlertFeedResponse {
  readonly firings: readonly AlertFiring[];
}

/** GET /v1/telegram/status. */
export interface TelegramStatusResponse {
  readonly configured: boolean;
  readonly mode: "webhook" | "polling" | "off";
  readonly botUsername: string | null;
  readonly linked: boolean;
}

/**
 * GET /v1/admin/telegram (admin): the bot as the owner console's flag note
 * shows it. Never carries the token or any chat id.
 */
export interface AdminTelegramStatusResponse {
  /** A bot token is configured (TELEGRAM_BOT_TOKEN). */
  readonly configured: boolean;
  readonly mode: "webhook" | "polling" | "off";
  readonly botUsername: string | null;
  /** The bot runs in this process (polling started or the webhook mounted). */
  readonly running: boolean;
  /** The `telegram` feature flag. */
  readonly flag: boolean;
  /** TELEGRAM_WEBHOOK_URL is set (webhook mode registers it on start). */
  readonly webhookUrlSet: boolean;
  /** Wallets linked to a chat. */
  readonly linkedWallets: number;
  readonly lastError: string | null;
  /** One honest line for the flag ("not configured · no bot token"). */
  readonly note: string;
}
