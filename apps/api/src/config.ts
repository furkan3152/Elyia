/**
 * Environment parsing. `loadConfig(env)` validates every variable with zod and
 * returns a frozen, typed Config; a bad value fails at boot with the variable
 * name and the rule it broke (values are never echoed: some are secrets).
 *
 * Everything optional stays optional: without keys the API serves read-only
 * data. RPC overrides are prepended to the public endpoints of the core
 * network registry, so a keyed endpoint is preferred and the public ones stay
 * as fallbacks.
 */
import { createRequire } from "node:module";
import { NETWORKS, type EvmNetwork, type Network, type NetworkEnvironment, type NetworkKey } from "@elyia/core";
import { z } from "zod";
import { LOG_LEVELS, type LogLevel } from "./log.js";

export const DEFAULT_PORT = 3001;
export const DEV_WEB_ORIGINS = ["http://localhost:5173", "http://localhost:5174"] as const;
/** Default model for the Elysium Agent. */
/** Hyperliquid allows about 1200 REST weight per minute per IP; Elyia keeps a margin by default. */
export const HYPERLIQUID_WEIGHT_LIMIT = 1_200;
export const DEFAULT_HYPERLIQUID_WEIGHT_PER_MINUTE = 900;

/** Env var that overrides (prepends to) the RPC endpoints of each EVM network. */
export const RPC_OVERRIDE_ENV: Readonly<Partial<Record<NetworkKey, string>>> = Object.freeze({
  "elysium-testnet": "ELYSIUM_TESTNET_RPC_URL",
  "elysium-mainnet": "ELYSIUM_MAINNET_RPC_URL",
  "hyperevm-testnet": "HYPEREVM_TESTNET_RPC_URL",
  "hyperevm-mainnet": "HYPEREVM_MAINNET_RPC_URL",
});

export type RuntimeEnv = "development" | "test" | "production";

export interface RateLimitConfig {
  /** Requests per minute per IP on every /v1 route. */
  readonly defaultPerMinute: number;
  /** Extra bucket for expensive routes (aggregations, upstream fan-out). */
  readonly heavyPerMinute: number;
  /** Extra bucket for sign-in and other credential routes. */
  readonly authPerMinute: number;
}

export interface Config {
  readonly env: RuntimeEnv;
  readonly version: string;
  readonly host: string;
  readonly port: number;
  readonly mode: NetworkEnvironment;
  /** Exact browser origins allowed by CORS. */
  readonly webOrigins: readonly string[];
  readonly databaseUrl: string | null;
  readonly sessionSecret: string | null;
  /** Owner wallets with the admin role (ELYIA_ADMIN_ADDRESSES, lowercase). */
  readonly adminAddresses: readonly string[];
  /** Keeper key encryption secret (ELYIA_KEEPER_SECRET); keeper mode is refused without it. */
  readonly keeperSecret: string | null;
  /** Extra SIWE domains (host[:port]) besides the web origins' hosts. */
  readonly siweDomains: readonly string[];
  /** Exact origins allowed to call POST /v1/mcp from a browser (empty: any https origin). */
  readonly mcpAllowedOrigins: readonly string[];
  readonly telegram: {
    readonly botToken: string | null;
    readonly webhookSecret: string | null;
    readonly botUsername: string | null;
    /** Public https URL of POST /telegram/webhook (production webhook mode). */
    readonly webhookUrl: string | null;
  };
  readonly agent: {
    readonly anthropicApiKey: string | null;
    /** ELYIA_AGENT_MODEL; the agent runs on the model only when this and the API key are set. */
    readonly model: string | null;
    /** ELYIA_AGENT_SERVER_FALLBACK=1 sends the server-side refusal fallback (only for models that accept it). */
    readonly serverFallback: boolean;
  };
  readonly hyperdexerApiKey: string | null;
  /** The Herd (NFT collection + WL). Owner inputs: null / empty = not configured (never invented). */
  readonly herd: {
    /** HERD_X_PROFILE_URL: the X profile applicants follow. */
    readonly xProfileUrl: string | null;
    /** HERD_ENGAGEMENT_POST_URLS: X post URLs for the engagement task (comma-separated). */
    readonly engagementPostUrls: readonly string[];
    /** HERD_TREASURY_ADDRESS: where withdraw() and royalties may go besides the owner. */
    readonly treasury: string | null;
    /** HERD_MARKETPLACE_URL: the collection page on Kalos (shown once the owner sets it). */
    readonly marketplaceUrl: string | null;
    /** HERD_MAINNET_LAUNCH: ISO date of the mainnet mint (shown as planned, not promised). */
    readonly mainnetLaunch: string | null;
    /** HERD_ART_DIR: the art generator's output folder (metadata/<id>.json, images/<id>.png). */
    readonly artDir: string | null;
    /** HERD_PUBLIC_BASE_URL: public https origin of this API for metadata image links (else the request's host). */
    readonly publicBaseUrl: string | null;
    /** X_API_BEARER (optional): enables the x-api verifier; without it X tasks are reviewed manually. */
    readonly xApiBearer: string | null;
  };
  readonly hyperliquid: {
    /** REST weight this process may spend per minute per HyperCore network. */
    readonly weightPerMinute: number;
  };
  /** Core networks with RPC overrides prepended to `rpcUrls`. */
  readonly networks: Readonly<Record<NetworkKey, Network>>;
  /** Networks whose RPC list was extended from the environment. */
  readonly rpcOverrides: Readonly<Partial<Record<NetworkKey, readonly string[]>>>;
  readonly logLevel: LogLevel;
  /** Express `trust proxy` hop count (0 = use the socket address). */
  readonly trustProxy: number;
  readonly rateLimits: RateLimitConfig;
  readonly build: { readonly commit: string | null };
}

export class ConfigError extends Error {
  constructor(readonly issues: readonly string[]) {
    super(`Invalid environment:\n${issues.map((issue) => `  - ${issue}`).join("\n")}`);
    this.name = "ConfigError";
  }
}

const require = createRequire(import.meta.url);

function packageVersion(): string {
  try {
    // src/ (tsx) and dist/ (node) are both one level below apps/api.
    const pkg = require("../package.json") as { version?: unknown };
    return typeof pkg.version === "string" ? pkg.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/** "" and whitespace-only values count as unset (common in .env files). */
const optionalString = z.preprocess((value) => (typeof value === "string" && value.trim() === "" ? undefined : value), z.string().trim().optional());

function intInRange(min: number, max: number, fallback: number) {
  return z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z.coerce.number().int().min(min).max(max).default(fallback),
  );
}

function isLoopbackHttp(url: URL): boolean {
  return url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]");
}

/** One exact origin: https (or loopback http outside production), no path, query or credentials. */
export function parseOrigin(raw: string, production: boolean): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.username || url.password || url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) return null;
  if (url.protocol !== "https:" && !(isLoopbackHttp(url) && !production)) return null;
  // `raw` may carry a trailing slash; the origin never does.
  return url.origin;
}

/** An RPC endpoint: absolute http(s) URL without credentials in the userinfo part. */
export function parseRpcUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password || url.hash) return null;
  return raw.trim();
}

/** Comparison key for an RPC URL (`https://x` and `https://x/` are the same endpoint). */
function rpcKey(url: string): string {
  try {
    return new URL(url).href;
  } catch {
    return url;
  }
}

function dedupeUrls(urls: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const url of urls) {
    const key = rpcKey(url);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(url);
  }
  return out;
}

const COMMIT_PATTERN = /^[0-9a-f]{7,64}$/u;

const EnvSchema = z.object({
  NODE_ENV: z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z.enum(["development", "test", "production"]).default("development"),
  ),
  HOST: optionalString,
  PORT: intInRange(0, 65_535, DEFAULT_PORT),
  ELYIA_MODE: z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z.enum(["testnet", "mainnet"]).default("testnet"),
  ),
  ELYIA_WEB_ORIGIN: optionalString,
  ELYIA_DATABASE_URL: optionalString,
  ELYIA_SESSION_SECRET: optionalString,
  ELYIA_ADMIN_ADDRESSES: optionalString,
  ELYIA_KEEPER_SECRET: optionalString,
  ELYIA_SIWE_DOMAINS: optionalString,
  ELYIA_MCP_ALLOWED_ORIGINS: optionalString,
  TELEGRAM_WEBHOOK_URL: optionalString,
  TELEGRAM_BOT_TOKEN: optionalString,
  TELEGRAM_WEBHOOK_SECRET: optionalString,
  TELEGRAM_BOT_USERNAME: optionalString,
  ANTHROPIC_API_KEY: optionalString,
  ELYIA_AGENT_MODEL: optionalString,
  ELYIA_AGENT_SERVER_FALLBACK: optionalString,
  ELYSIUM_TESTNET_RPC_URL: optionalString,
  ELYSIUM_MAINNET_RPC_URL: optionalString,
  HYPEREVM_TESTNET_RPC_URL: optionalString,
  HYPEREVM_MAINNET_RPC_URL: optionalString,
  HYPERDEXER_API_KEY: optionalString,
  HERD_X_PROFILE_URL: optionalString,
  HERD_ENGAGEMENT_POST_URLS: optionalString,
  HERD_TREASURY_ADDRESS: optionalString,
  HERD_MARKETPLACE_URL: optionalString,
  HERD_MAINNET_LAUNCH: optionalString,
  HERD_ART_DIR: optionalString,
  HERD_PUBLIC_BASE_URL: optionalString,
  X_API_BEARER: optionalString,
  ELYIA_LOG_LEVEL: z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z.enum(LOG_LEVELS).optional(),
  ),
  ELYIA_TRUST_PROXY: z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z.coerce.number().int().min(0).max(3).optional(),
  ),
  ELYIA_HL_WEIGHT_PER_MIN: intInRange(60, HYPERLIQUID_WEIGHT_LIMIT, DEFAULT_HYPERLIQUID_WEIGHT_PER_MINUTE),
  ELYIA_RATE_LIMIT_DEFAULT: intInRange(1, 100_000, 600),
  ELYIA_RATE_LIMIT_HEAVY: intInRange(1, 100_000, 60),
  ELYIA_RATE_LIMIT_AUTH: intInRange(1, 100_000, 20),
  ELYIA_BUILD_COMMIT: optionalString,
  RENDER_GIT_COMMIT: optionalString,
});

type ParsedEnv = z.infer<typeof EnvSchema>;

function splitList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function withRpcOverrides(overrides: Partial<Record<NetworkKey, readonly string[]>>): Readonly<Record<NetworkKey, Network>> {
  const out = {} as Record<NetworkKey, Network>;
  for (const [key, network] of Object.entries(NETWORKS) as Array<[NetworkKey, Network]>) {
    const extra = overrides[key];
    if (network.vm === "evm" && extra && extra.length > 0) {
      const rpcUrls = dedupeUrls([...extra, ...network.rpcUrls]);
      out[key] = Object.freeze({ ...network, rpcUrls }) satisfies EvmNetwork;
    } else {
      out[key] = network;
    }
  }
  return Object.freeze(out);
}

function commitOf(env: ParsedEnv): string | null {
  for (const raw of [env.RENDER_GIT_COMMIT, env.ELYIA_BUILD_COMMIT]) {
    const value = raw?.toLowerCase();
    if (value && COMMIT_PATTERN.test(value)) return value;
  }
  return null;
}

export function loadConfig(source: Readonly<Record<string, string | undefined>> = process.env): Config {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    throw new ConfigError(parsed.error.issues.map((issue) => `${issue.path.join(".") || "env"}: ${issue.message}`));
  }
  const env = parsed.data;
  const production = env.NODE_ENV === "production";
  const issues: string[] = [];

  const webOrigins = new Set<string>(production ? [] : DEV_WEB_ORIGINS);
  for (const raw of splitList(env.ELYIA_WEB_ORIGIN)) {
    const origin = parseOrigin(raw, production);
    if (origin) webOrigins.add(origin);
    else issues.push(`ELYIA_WEB_ORIGIN: "${raw.slice(0, 80)}" is not an exact https origin${production ? "" : " (or http://localhost)"}`);
  }

  const rpcOverrides: Partial<Record<NetworkKey, readonly string[]>> = {};
  for (const [key, name] of Object.entries(RPC_OVERRIDE_ENV) as Array<[NetworkKey, string]>) {
    const urls: string[] = [];
    for (const raw of splitList(source[name])) {
      const url = parseRpcUrl(raw);
      // The value may contain an API key: name the variable, never the value.
      if (url) urls.push(url);
      else issues.push(`${name}: entries must be absolute http(s) URLs without credentials`);
    }
    if (urls.length > 0) rpcOverrides[key] = Object.freeze(dedupeUrls(urls));
  }

  if (env.ELYIA_DATABASE_URL && !/^postgres(?:ql)?:\/\//u.test(env.ELYIA_DATABASE_URL)) {
    issues.push("ELYIA_DATABASE_URL: must be a postgres:// or postgresql:// URL");
  }
  if (env.ELYIA_SESSION_SECRET && env.ELYIA_SESSION_SECRET.length < 32) {
    issues.push("ELYIA_SESSION_SECRET: must be at least 32 characters");
  }
  if (env.TELEGRAM_WEBHOOK_SECRET && !/^[A-Za-z0-9_-]{16,256}$/u.test(env.TELEGRAM_WEBHOOK_SECRET)) {
    // Telegram accepts 1-256 of A-Z, a-z, 0-9, _ and -; Elyia requires at least 16 for strength.
    issues.push("TELEGRAM_WEBHOOK_SECRET: must be 16-256 characters of A-Z, a-z, 0-9, _ or -");
  }
  const adminAddresses: string[] = [];
  for (const raw of splitList(env.ELYIA_ADMIN_ADDRESSES)) {
    if (/^0x[0-9a-fA-F]{40}$/u.test(raw)) adminAddresses.push(raw.toLowerCase());
    else issues.push("ELYIA_ADMIN_ADDRESSES: entries must be 0x-prefixed 20-byte addresses");
  }
  if (env.ELYIA_KEEPER_SECRET && env.ELYIA_KEEPER_SECRET.length < 32) {
    issues.push("ELYIA_KEEPER_SECRET: must be at least 32 characters");
  }
  const siweDomains: string[] = [];
  for (const raw of splitList(env.ELYIA_SIWE_DOMAINS)) {
    if (/^[a-z0-9.-]+(?::\d{1,5})?$/iu.test(raw)) siweDomains.push(raw.toLowerCase());
    else issues.push(`ELYIA_SIWE_DOMAINS: "${raw.slice(0, 80)}" is not a host[:port]`);
  }
  const mcpAllowedOrigins: string[] = [];
  for (const raw of splitList(env.ELYIA_MCP_ALLOWED_ORIGINS)) {
    const origin = parseOrigin(raw, production);
    if (origin) mcpAllowedOrigins.push(origin);
    else issues.push(`ELYIA_MCP_ALLOWED_ORIGINS: "${raw.slice(0, 80)}" is not an exact origin`);
  }
  if (env.TELEGRAM_WEBHOOK_URL && !/^https:\/\/[^\s]+$/u.test(env.TELEGRAM_WEBHOOK_URL)) {
    issues.push("TELEGRAM_WEBHOOK_URL: must be an https URL");
  }
  const httpsUrl = (name: string, raw: string | undefined): string | null => {
    if (!raw) return null;
    try {
      const url = new URL(raw);
      if (url.protocol === "https:" && !url.username && !url.password) return url.toString();
    } catch {
      // reported below
    }
    issues.push(`${name}: must be an https URL`);
    return null;
  };
  const xUrl = (name: string, raw: string | undefined): string | null => {
    const url = httpsUrl(name, raw);
    if (url && !/^https:\/\/(?:www\.)?(?:x|twitter)\.com\//iu.test(url)) {
      issues.push(`${name}: must be an x.com (or twitter.com) URL`);
      return null;
    }
    return url;
  };
  const herdProfile = xUrl("HERD_X_PROFILE_URL", env.HERD_X_PROFILE_URL);
  const herdPosts = splitList(env.HERD_ENGAGEMENT_POST_URLS).map((raw) => xUrl("HERD_ENGAGEMENT_POST_URLS", raw)).filter((url): url is string => url !== null);
  if (env.HERD_TREASURY_ADDRESS && !/^0x[0-9a-fA-F]{40}$/u.test(env.HERD_TREASURY_ADDRESS)) issues.push("HERD_TREASURY_ADDRESS: must be a 0x-prefixed 20-byte address");
  const herdMarketplace = httpsUrl("HERD_MARKETPLACE_URL", env.HERD_MARKETPLACE_URL);
  if (env.HERD_MAINNET_LAUNCH && Number.isNaN(Date.parse(env.HERD_MAINNET_LAUNCH))) issues.push("HERD_MAINNET_LAUNCH: must be an ISO 8601 date");
  let herdPublicBase: string | null = null;
  if (env.HERD_PUBLIC_BASE_URL) {
    herdPublicBase = parseOrigin(env.HERD_PUBLIC_BASE_URL, production);
    if (!herdPublicBase) issues.push("HERD_PUBLIC_BASE_URL: must be an exact https origin");
  }
  if (issues.length > 0) throw new ConfigError(issues);

  const config: Config = {
    env: env.NODE_ENV,
    version: packageVersion(),
    host: env.HOST ?? "0.0.0.0",
    port: env.PORT,
    mode: env.ELYIA_MODE,
    webOrigins: Object.freeze([...webOrigins]),
    databaseUrl: env.ELYIA_DATABASE_URL ?? null,
    sessionSecret: env.ELYIA_SESSION_SECRET ?? null,
    adminAddresses: Object.freeze([...new Set(adminAddresses)]),
    keeperSecret: env.ELYIA_KEEPER_SECRET ?? null,
    siweDomains: Object.freeze(siweDomains),
    mcpAllowedOrigins: Object.freeze(mcpAllowedOrigins),
    telegram: Object.freeze({
      botToken: env.TELEGRAM_BOT_TOKEN ?? null,
      webhookSecret: env.TELEGRAM_WEBHOOK_SECRET ?? null,
      botUsername: env.TELEGRAM_BOT_USERNAME?.replace(/^@/u, "") ?? null,
      webhookUrl: env.TELEGRAM_WEBHOOK_URL ?? null,
    }),
    agent: Object.freeze({
      anthropicApiKey: env.ANTHROPIC_API_KEY ?? null,
      model: env.ELYIA_AGENT_MODEL ?? null,
      serverFallback: env.ELYIA_AGENT_SERVER_FALLBACK === "1" || env.ELYIA_AGENT_SERVER_FALLBACK === "true",
    }),
    hyperdexerApiKey: env.HYPERDEXER_API_KEY ?? null,
    herd: Object.freeze({
      xProfileUrl: herdProfile,
      engagementPostUrls: Object.freeze(herdPosts),
      treasury: env.HERD_TREASURY_ADDRESS?.toLowerCase() ?? null,
      marketplaceUrl: herdMarketplace,
      mainnetLaunch: env.HERD_MAINNET_LAUNCH ? new Date(env.HERD_MAINNET_LAUNCH).toISOString() : null,
      artDir: env.HERD_ART_DIR ?? null,
      publicBaseUrl: herdPublicBase,
      xApiBearer: env.X_API_BEARER ?? null,
    }),
    hyperliquid: Object.freeze({ weightPerMinute: env.ELYIA_HL_WEIGHT_PER_MIN }),
    networks: withRpcOverrides(rpcOverrides),
    rpcOverrides: Object.freeze(rpcOverrides),
    logLevel: env.ELYIA_LOG_LEVEL ?? (env.NODE_ENV === "test" ? "warn" : env.NODE_ENV === "production" ? "info" : "debug"),
    trustProxy: env.ELYIA_TRUST_PROXY ?? (production ? 1 : 0),
    rateLimits: Object.freeze({
      defaultPerMinute: env.ELYIA_RATE_LIMIT_DEFAULT,
      heavyPerMinute: env.ELYIA_RATE_LIMIT_HEAVY,
      authPerMinute: env.ELYIA_RATE_LIMIT_AUTH,
    }),
    build: Object.freeze({ commit: commitOf(env) }),
  };
  return Object.freeze(config);
}

/** The Elysium network of the configured mode (the default for pulse routes). */
export function elysiumNetworkFor(mode: NetworkEnvironment): NetworkKey {
  return mode === "testnet" ? "elysium-testnet" : "elysium-mainnet";
}

/** The HyperCore network of the configured mode. */
export function hypercoreNetworkFor(mode: NetworkEnvironment): NetworkKey {
  return mode === "testnet" ? "hypercore-testnet" : "hypercore-mainnet";
}

/**
 * Secrets production must have before it serves anything: sessions are
 * HMAC-signed with ELYIA_SESSION_SECRET (an ephemeral secret would sign
 * every user out on each restart and differ between replicas).
 */
export function productionIssues(config: Config): string[] {
  if (config.env !== "production") return [];
  const issues: string[] = [];
  if (!config.sessionSecret) issues.push("ELYIA_SESSION_SECRET: required in production (sessions are HMAC-signed with it)");
  return issues;
}
