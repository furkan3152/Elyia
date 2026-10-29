/**
 * The Rule Book (`elyia.rulebook/v1`): a user's hard limits, enforced in
 * code before anything is prepared or signed: by the API at plan and
 * prepare, by the browser guard before every agent-key signature, and by the
 * server before every Keeper-mode action. It is the Elysium Agent's leash:
 * the AI may propose anything, the Rule Book decides.
 *
 * A small typed JSON document: allowlists, denylists, enums, decimal-string
 * USD limits and a timetable. No expressions, regexes or code. This module
 * validates and normalises documents, computes the canonical form and its
 * `sha256:` hash, reports which edits loosen a book, and ships the defaults.
 * Evaluation lives in policyEvaluate.ts. Pure: no I/O.
 */
import { normalizeAssetId, parseAccountId, parseAssetId, isEvmAddress } from "./caip.js";
import { canonicalDigest, type Sha256Digest } from "./canonical.js";
import { TOKENS, findToken, type TokenGroup } from "./assets.js";
import { isNetworkKey, type NetworkEnvironment, type NetworkKey } from "./networks.js";
import { getProtocol } from "./protocols.js";
import { STEP_KINDS, type StepKind } from "./intent.js";
import { AGENT_SIGNABLE_ACTIONS, type L1ActionType } from "./hypercore/actions.js";

export const RULE_BOOK_SCHEMA = "elyia.rulebook/v1" as const;

/** USD amounts in rule books: decimal strings with at most 2 decimals, never floats. */
export const RULE_USD_PATTERN = /^\d{1,12}(?:\.\d{1,2})?$/u;

export const RULE_BOOK_LIMITS = Object.freeze({
  documentBytes: 16_384,
  labelLength: 64,
  listEntries: 100,
  maxSteps: 12,
  maxSlippageBps: 1_000,
  minSeconds: 10,
  maxSeconds: 1_209_600,
  maxLeverage: 100,
  maxOpenOrders: 1_000,
  windows: 14,
});

export type RuleBookMode = "live" | "dry-run" | "paused";
/** How automations may execute: wallet proposals, the in-browser agent key, or the opt-in server Keeper. */
export type AgentMode = "propose" | "browser" | "keeper";
export type RecipientMode = "own" | "allowlist" | "any";
export type ConfirmTrigger = "external-recipient" | "cross-network" | "agent-proposal" | "unlisted-asset";
export type Weekday = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

export const RULE_BOOK_MODES: readonly RuleBookMode[] = Object.freeze(["live", "dry-run", "paused"]);
export const AGENT_MODES: readonly AgentMode[] = Object.freeze(["propose", "browser", "keeper"]);
export const RECIPIENT_MODES: readonly RecipientMode[] = Object.freeze(["own", "allowlist", "any"]);
export const CONFIRM_TRIGGERS: readonly ConfirmTrigger[] = Object.freeze(["external-recipient", "cross-network", "agent-proposal", "unlisted-asset"]);
export const WEEKDAYS: readonly Weekday[] = Object.freeze(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);
export const ASSET_GROUPS: readonly TokenGroup[] = Object.freeze(["HYPE", "USDC", "USDT", "USDH", "BTC", "ETH"]);

export interface ScheduleWindow {
  readonly days: readonly Weekday[];
  /** "HH:MM", inclusive. */
  readonly from: string;
  /** "HH:MM" or "24:00", exclusive. */
  readonly to: string;
}

export interface TradingRules {
  /** Book coins or display names ("BTC", "HYPE/USDC"); case-insensitive. */
  readonly markets?: { readonly allow?: readonly string[]; readonly deny?: readonly string[] };
  /** Per order: size x price. */
  readonly maxNotionalUsd?: string;
  /** Open position notional after the order. */
  readonly maxOpenNotionalUsd?: string;
  readonly maxLeverage?: number;
  /** De-risk only: every order must be reduce-only. */
  readonly reduceOnly?: boolean;
  readonly maxOpenOrders?: number;
  /** Rolling 24 h traded notional (risk-increasing orders). */
  readonly dailyVolumeUsd?: string;
  /** Once realized losses over 24 h reach this, only reduce-only orders pass. */
  readonly dailyLossUsd?: string;
  /** TP/SL trigger orders allowed (default true). */
  readonly triggers?: boolean;
  /** TWAP orders allowed (default true). */
  readonly twap?: boolean;
  /** IOC "market" orders: worst price at most this far from mid. */
  readonly maxSlippageBps?: number;
}

export interface RuleBook {
  readonly schema: typeof RULE_BOOK_SCHEMA;
  readonly label?: string;
  /** paused is the kill switch: nothing new runs, except de-risking (reduce-only orders, cancels). */
  readonly mode?: RuleBookMode;
  readonly networks?: { readonly allow?: readonly NetworkKey[]; readonly environments?: readonly NetworkEnvironment[] };
  readonly kinds?: { readonly allow?: readonly StepKind[] };
  readonly protocols?: { readonly allow?: readonly string[]; readonly deny?: readonly string[] };
  /** `allow` entries: `SYMBOL`, `SYMBOL@network`, `group:USDC`, or a CAIP-19 id. */
  readonly assets?: { readonly allow?: readonly string[]; readonly unlisted?: "deny" | "allow" };
  /** Patterns: CAIP-10, or `*:0x…` for the same address on every network. Deny always wins. */
  readonly recipients?: { readonly mode?: RecipientMode; readonly allow?: readonly string[]; readonly deny?: readonly string[] };
  readonly limits?: { readonly maxSteps?: number; readonly maxSlippageBps?: number; readonly maxFeeUsd?: string; readonly maxSeconds?: number };
  readonly caps?: { readonly perStepUsd?: string; readonly perIntentUsd?: string; readonly dailyUsd?: string; readonly weeklyUsd?: string };
  readonly trading?: TradingRules;
  /** L1 action types an agent key may sign, and the execution modes automations may use. */
  readonly agent?: { readonly actions?: readonly L1ActionType[]; readonly modes?: readonly AgentMode[] };
  readonly confirm?: { readonly aboveUsd?: string; readonly leverageAbove?: number; readonly when?: readonly ConfirmTrigger[] };
  readonly schedule?: { readonly timezone: string; readonly windows: readonly ScheduleWindow[] };
}

export interface RuleBookIssue {
  readonly path: string;
  readonly message: string;
}

export type RuleBookValidation =
  | { readonly ok: true; readonly value: RuleBook; readonly issues: readonly [] }
  | { readonly ok: false; readonly value: null; readonly issues: readonly RuleBookIssue[] };

/* -------------------------------------------------------------- helpers */

/** USD decimal string -> integer micro-dollars. */
export function usdMicros(value: string): bigint {
  if (!RULE_USD_PATTERN.test(value)) throw new Error(`Invalid USD amount: ${value}`);
  const [whole = "0", fraction = ""] = value.split(".");
  return BigInt(whole) * 1_000_000n + BigInt((fraction + "000000").slice(0, 6));
}

/** Integer micro-dollars -> decimal string with 2 decimals, rounded up (conservative). */
export function formatUsdMicros(micros: bigint): string {
  const negative = micros < 0n;
  const absolute = negative ? -micros : micros;
  const cents = (absolute + 9_999n) / 10_000n;
  const text = `${cents / 100n}.${(cents % 100n).toString().padStart(2, "0")}`;
  return negative ? `-${text}` : text;
}

/** Minutes of "HH:MM" ("24:00" = 1440), or null. */
export function timeMinutes(value: string): number | null {
  if (value === "24:00") return 1_440;
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(value)) return null;
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
}

let supportedZones: Set<string> | null = null;

/** IANA zones the runtime can format (fails closed when Intl cannot read the zone). */
export function isSupportedTimeZone(zone: unknown): zone is string {
  if (typeof zone !== "string" || zone.length === 0 || zone.length > 64) return false;
  if (zone === "UTC" || zone === "Etc/UTC") return true;
  if (supportedZones === null) {
    const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
    supportedZones = new Set(typeof intl.supportedValuesOf === "function" ? intl.supportedValuesOf("timeZone") : []);
  }
  if (supportedZones.size > 0 && supportedZones.has(zone)) return true;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Normalises a recipient / account pattern: an exact CAIP-10 account
 * (`eip155:99801:0x…`) or `*:0x…` (that address on every network, i.e. the
 * same owner). Addresses are lower-cased. Null when invalid.
 */
export function normalizeAccountPattern(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 160) return null;
  if (value.startsWith("*:")) {
    const address = value.slice(2);
    return isEvmAddress(address) ? `*:${address.toLowerCase()}` : null;
  }
  const parsed = parseAccountId(value);
  return parsed ? `${parsed.network.caip2}:${parsed.address.toLowerCase()}` : null;
}

/** True when an account (CAIP-10 or bare address) matches a pattern. */
export function accountMatchesPattern(account: string, pattern: string): boolean {
  const normalized = normalizeAccountPattern(pattern);
  if (!normalized) return false;
  const parsed = parseAccountId(account);
  const address = parsed ? parsed.address.toLowerCase() : isEvmAddress(account) ? account.toLowerCase() : null;
  if (!address) return false;
  if (normalized.startsWith("*:")) return normalized.slice(2) === address;
  return parsed !== null && normalized === `${parsed.network.caip2}:${address}`;
}

/** Canonical spelling of an asset entry (`USDC`, `USDC@elysium-testnet`, `group:HYPE`, CAIP-19); null when unknown. */
export function normalizeAssetEntry(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 160) return null;
  if (value.toLowerCase().startsWith("group:")) {
    const group = value.slice(6).toUpperCase();
    return (ASSET_GROUPS as readonly string[]).includes(group) ? `group:${group}` : null;
  }
  if (value.includes("/")) return parseAssetId(value) ? normalizeAssetId(value) : null;
  const at = value.lastIndexOf("@");
  if (at > 0) {
    const network = value.slice(at + 1);
    if (!isNetworkKey(network)) return null;
    const token = findToken(network, value.slice(0, at));
    return token ? `${token.symbol}@${network}` : null;
  }
  const wanted = value.toUpperCase();
  const token = TOKENS.find((candidate) => candidate.symbol.toUpperCase() === wanted);
  return token ? token.symbol : null;
}

/** Canonical market spelling for rules: upper-case coin or pair ("btc" -> "BTC", "hype/usdc" -> "HYPE/USDC", "@1035"). */
export function normalizeMarketEntry(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (/^@\d{1,6}$/u.test(text)) return text;
  if (/^[A-Za-z0-9]{1,24}(?:\/[A-Za-z0-9]{1,24})?$/u.test(text)) return text.toUpperCase();
  if (/^[a-z0-9]{1,16}:[A-Za-z0-9]{1,24}$/u.test(text)) return `${text.split(":")[0]}:${(text.split(":")[1] ?? "").toUpperCase()}`;
  return null;
}

/* ----------------------------------------------------------- validation */

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const NON_PRINTABLE = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}]/u;

class Collector {
  readonly issues: RuleBookIssue[] = [];
  add(path: string, message: string): void {
    this.issues.push({ path, message });
  }
  keys(value: Record<string, unknown>, allowed: readonly string[], path: string): void {
    for (const key of Object.keys(value)) if (!allowed.includes(key)) this.add(path ? `${path}.${key}` : key, `Unknown field. Allowed: ${allowed.join(", ")}.`);
  }
  section(input: Record<string, unknown>, key: string, allowed: readonly string[]): Record<string, unknown> | undefined {
    const value = input[key];
    if (value === undefined) return undefined;
    if (!isRecord(value)) {
      this.add(key, "Must be an object.");
      return undefined;
    }
    this.keys(value, allowed, key);
    return value;
  }
  list<T extends string>(value: unknown, path: string, normalize: (entry: unknown) => T | null, what: string, max: number = RULE_BOOK_LIMITS.listEntries): T[] | undefined {
    if (value === undefined) return undefined;
    if (!Array.isArray(value) || value.length > max) {
      this.add(path, `Must be a list of at most ${max} ${what}.`);
      return undefined;
    }
    const out: T[] = [];
    value.forEach((entry, index) => {
      const normalized = normalize(entry);
      if (normalized === null) this.add(`${path}[${index}]`, `Unknown or malformed ${what.replace(/s$/u, "")}.`);
      else if (!out.includes(normalized)) out.push(normalized);
    });
    return out.sort();
  }
  integer(value: unknown, path: string, min: number, max: number): number | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) {
      this.add(path, `Must be an integer between ${min} and ${max}.`);
      return undefined;
    }
    return value;
  }
  usd(value: unknown, path: string): string | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== "string" || !RULE_USD_PATTERN.test(value)) {
      this.add(path, "Must be a USD decimal string with at most 2 decimals, e.g. \"1500\" or \"12.50\".");
      return undefined;
    }
    const [whole = "0", fraction = ""] = value.split(".");
    const trimmed = fraction.replace(/0+$/u, "");
    return `${BigInt(whole).toString()}${trimmed ? `.${trimmed}` : ""}`;
  }
  bool(value: unknown, path: string): boolean | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== "boolean") {
      this.add(path, "Must be true or false.");
      return undefined;
    }
    return value;
  }
}

const enumOf = <T extends string>(values: readonly T[]) => (entry: unknown): T | null =>
  typeof entry === "string" && (values as readonly string[]).includes(entry) ? (entry as T) : null;

function compact<T extends Record<string, unknown>>(value: T): T | undefined {
  const entries = Object.entries(value).filter(([, entry]) => entry !== undefined);
  return entries.length > 0 ? (Object.fromEntries(entries) as T) : undefined;
}

/**
 * Validates and normalises a rule book: shape, enums, ranges, decimal USD
 * strings, unknown fields, registry identifiers. `value` is the normalised
 * document (lists de-duplicated and sorted, addresses lower-cased), ready to
 * store and hash.
 */
export function validateRuleBook(input: unknown): RuleBookValidation {
  const c = new Collector();
  if (!isRecord(input)) return { ok: false, value: null, issues: [{ path: "", message: "A rule book is a JSON object." }] };
  c.keys(input, ["schema", "label", "mode", "networks", "kinds", "protocols", "assets", "recipients", "limits", "caps", "trading", "agent", "confirm", "schedule"], "");
  if (input.schema !== RULE_BOOK_SCHEMA) c.add("schema", `Must be "${RULE_BOOK_SCHEMA}".`);
  let label: string | undefined;
  if (input.label !== undefined) {
    if (typeof input.label !== "string" || input.label.length > RULE_BOOK_LIMITS.labelLength || NON_PRINTABLE.test(input.label)) c.add("label", "At most 64 printable characters.");
    else label = input.label.trim();
  }
  const mode = input.mode === undefined ? undefined : enumOf(RULE_BOOK_MODES)(input.mode) ?? (c.add("mode", "live, dry-run or paused."), undefined);

  const networksIn = c.section(input, "networks", ["allow", "environments"]);
  const networks = networksIn && compact({
    allow: c.list(networksIn.allow, "networks.allow", (entry) => (isNetworkKey(entry) ? entry : null), "networks"),
    environments: c.list(networksIn.environments, "networks.environments", enumOf<NetworkEnvironment>(["testnet", "mainnet"]), "environments"),
  });
  const kindsIn = c.section(input, "kinds", ["allow"]);
  const kinds = kindsIn && compact({ allow: c.list(kindsIn.allow, "kinds.allow", enumOf<StepKind>(STEP_KINDS), "step kinds") });
  const protocolsIn = c.section(input, "protocols", ["allow", "deny"]);
  const protocolId = (entry: unknown) => (typeof entry === "string" && getProtocol(entry) ? entry : null);
  const protocols = protocolsIn && compact({
    allow: c.list(protocolsIn.allow, "protocols.allow", protocolId, "protocols"),
    deny: c.list(protocolsIn.deny, "protocols.deny", protocolId, "protocols"),
  });
  const assetsIn = c.section(input, "assets", ["allow", "unlisted"]);
  const assets = assetsIn && compact({
    allow: c.list(assetsIn.allow, "assets.allow", normalizeAssetEntry, "assets"),
    unlisted: assetsIn.unlisted === undefined ? undefined : enumOf<"deny" | "allow">(["deny", "allow"])(assetsIn.unlisted) ?? (c.add("assets.unlisted", "deny or allow."), undefined),
  });
  const recipientsIn = c.section(input, "recipients", ["mode", "allow", "deny"]);
  const recipients = recipientsIn && compact({
    mode: recipientsIn.mode === undefined ? undefined : enumOf(RECIPIENT_MODES)(recipientsIn.mode) ?? (c.add("recipients.mode", "own, allowlist or any."), undefined),
    allow: c.list(recipientsIn.allow, "recipients.allow", normalizeAccountPattern, "accounts"),
    deny: c.list(recipientsIn.deny, "recipients.deny", normalizeAccountPattern, "accounts"),
  });
  if (recipients?.mode === "allowlist" && (recipients.allow ?? []).length === 0) c.add("recipients.allow", "An allowlist needs at least one account.");
  const limitsIn = c.section(input, "limits", ["maxSteps", "maxSlippageBps", "maxFeeUsd", "maxSeconds"]);
  const limits = limitsIn && compact({
    maxSteps: c.integer(limitsIn.maxSteps, "limits.maxSteps", 1, RULE_BOOK_LIMITS.maxSteps),
    maxSlippageBps: c.integer(limitsIn.maxSlippageBps, "limits.maxSlippageBps", 1, RULE_BOOK_LIMITS.maxSlippageBps),
    maxFeeUsd: c.usd(limitsIn.maxFeeUsd, "limits.maxFeeUsd"),
    maxSeconds: c.integer(limitsIn.maxSeconds, "limits.maxSeconds", RULE_BOOK_LIMITS.minSeconds, RULE_BOOK_LIMITS.maxSeconds),
  });
  const capsIn = c.section(input, "caps", ["perStepUsd", "perIntentUsd", "dailyUsd", "weeklyUsd"]);
  const caps = capsIn && compact({
    perStepUsd: c.usd(capsIn.perStepUsd, "caps.perStepUsd"),
    perIntentUsd: c.usd(capsIn.perIntentUsd, "caps.perIntentUsd"),
    dailyUsd: c.usd(capsIn.dailyUsd, "caps.dailyUsd"),
    weeklyUsd: c.usd(capsIn.weeklyUsd, "caps.weeklyUsd"),
  });
  const tradingIn = c.section(input, "trading", ["markets", "maxNotionalUsd", "maxOpenNotionalUsd", "maxLeverage", "reduceOnly", "maxOpenOrders", "dailyVolumeUsd", "dailyLossUsd", "triggers", "twap", "maxSlippageBps"]);
  let trading: TradingRules | undefined;
  if (tradingIn) {
    let markets: TradingRules["markets"];
    if (tradingIn.markets !== undefined) {
      if (!isRecord(tradingIn.markets)) c.add("trading.markets", "Must be an object.");
      else {
        c.keys(tradingIn.markets, ["allow", "deny"], "trading.markets");
        markets = compact({
          allow: c.list(tradingIn.markets.allow, "trading.markets.allow", normalizeMarketEntry, "markets"),
          deny: c.list(tradingIn.markets.deny, "trading.markets.deny", normalizeMarketEntry, "markets"),
        });
      }
    }
    trading = compact({
      markets,
      maxNotionalUsd: c.usd(tradingIn.maxNotionalUsd, "trading.maxNotionalUsd"),
      maxOpenNotionalUsd: c.usd(tradingIn.maxOpenNotionalUsd, "trading.maxOpenNotionalUsd"),
      maxLeverage: c.integer(tradingIn.maxLeverage, "trading.maxLeverage", 1, RULE_BOOK_LIMITS.maxLeverage),
      reduceOnly: c.bool(tradingIn.reduceOnly, "trading.reduceOnly"),
      maxOpenOrders: c.integer(tradingIn.maxOpenOrders, "trading.maxOpenOrders", 0, RULE_BOOK_LIMITS.maxOpenOrders),
      dailyVolumeUsd: c.usd(tradingIn.dailyVolumeUsd, "trading.dailyVolumeUsd"),
      dailyLossUsd: c.usd(tradingIn.dailyLossUsd, "trading.dailyLossUsd"),
      triggers: c.bool(tradingIn.triggers, "trading.triggers"),
      twap: c.bool(tradingIn.twap, "trading.twap"),
      maxSlippageBps: c.integer(tradingIn.maxSlippageBps, "trading.maxSlippageBps", 1, RULE_BOOK_LIMITS.maxSlippageBps),
    });
  }
  const agentIn = c.section(input, "agent", ["actions", "modes"]);
  const agent = agentIn && compact({
    actions: c.list(agentIn.actions, "agent.actions", enumOf<L1ActionType>(AGENT_SIGNABLE_ACTIONS), "agent actions"),
    modes: c.list(agentIn.modes, "agent.modes", enumOf(AGENT_MODES), "agent modes"),
  });
  const confirmIn = c.section(input, "confirm", ["aboveUsd", "leverageAbove", "when"]);
  const confirm = confirmIn && compact({
    aboveUsd: c.usd(confirmIn.aboveUsd, "confirm.aboveUsd"),
    leverageAbove: c.integer(confirmIn.leverageAbove, "confirm.leverageAbove", 1, RULE_BOOK_LIMITS.maxLeverage),
    when: c.list(confirmIn.when, "confirm.when", enumOf(CONFIRM_TRIGGERS), "confirmation triggers"),
  });
  let schedule: RuleBook["schedule"];
  const scheduleIn = c.section(input, "schedule", ["timezone", "windows"]);
  if (scheduleIn) {
    if (!isSupportedTimeZone(scheduleIn.timezone)) c.add("schedule.timezone", "Must be an IANA time zone such as Europe/Berlin or UTC.");
    const windows: ScheduleWindow[] = [];
    if (!Array.isArray(scheduleIn.windows) || scheduleIn.windows.length === 0 || scheduleIn.windows.length > RULE_BOOK_LIMITS.windows) {
      c.add("schedule.windows", `Must be a list of 1-${RULE_BOOK_LIMITS.windows} windows.`);
    } else {
      scheduleIn.windows.forEach((window, index) => {
        const path = `schedule.windows[${index}]`;
        if (!isRecord(window)) return c.add(path, "Must be an object.");
        c.keys(window, ["days", "from", "to"], path);
        const days = c.list(window.days, `${path}.days`, enumOf(WEEKDAYS), "days", 7);
        const from = typeof window.from === "string" ? timeMinutes(window.from) : null;
        const to = typeof window.to === "string" ? timeMinutes(window.to) : null;
        if (from === null || from === 1_440) c.add(`${path}.from`, "Must be HH:MM.");
        if (to === null) c.add(`${path}.to`, "Must be HH:MM or 24:00.");
        if (from !== null && to !== null && to <= from) c.add(path, "to must be after from (split windows that cross midnight).");
        if (days && days.length > 0 && from !== null && to !== null && to > from) {
          windows.push({ days: [...days].sort((a, b) => WEEKDAYS.indexOf(a) - WEEKDAYS.indexOf(b)), from: window.from as string, to: window.to as string });
        } else if (days && days.length === 0) c.add(`${path}.days`, "At least one day.");
      });
    }
    if (typeof scheduleIn.timezone === "string") schedule = { timezone: scheduleIn.timezone, windows };
  }

  if (c.issues.length > 0) return { ok: false, value: null, issues: c.issues };
  const value = Object.fromEntries(
    Object.entries({ schema: RULE_BOOK_SCHEMA, label, mode, networks, kinds, protocols, assets, recipients, limits, caps, trading, agent, confirm, schedule }).filter(([, entry]) => entry !== undefined),
  ) as unknown as RuleBook;
  if (new TextEncoder().encode(JSON.stringify(value)).length > RULE_BOOK_LIMITS.documentBytes) {
    return { ok: false, value: null, issues: [{ path: "", message: "The rule book is larger than 16 KB." }] };
  }
  return { ok: true, value, issues: [] };
}

/** `sha256:` of the canonical JSON of a (validated) rule book: what clients pin. */
export function ruleBookHash(book: RuleBook): Sha256Digest {
  return canonicalDigest(book);
}

/* ------------------------------------------------------------ loosening */

const RECIPIENT_ORDER: Readonly<Record<RecipientMode, number>> = { own: 0, allowlist: 1, any: 2 };
const MODE_ORDER: Readonly<Record<RuleBookMode, number>> = { paused: 0, "dry-run": 1, live: 2 };

function looserNumber(previous: number | undefined, next: number | undefined): boolean {
  return previous !== undefined && (next === undefined || next > previous);
}
function looserUsd(previous: string | undefined, next: string | undefined): boolean {
  return previous !== undefined && (next === undefined || usdMicros(next) > usdMicros(previous));
}
function looserAllow(previous: readonly string[] | undefined, next: readonly string[] | undefined): boolean {
  return previous !== undefined && (next === undefined || next.some((entry) => !previous.includes(entry)));
}
function looserDeny(previous: readonly string[] | undefined, next: readonly string[] | undefined): boolean {
  return (previous ?? []).some((entry) => !(next ?? []).includes(entry));
}

/**
 * Rule paths an edit loosens. Clients that pinned a rule book hash require a
 * fresh local confirmation before signing under a looser one; tightening
 * takes effect at once.
 */
export function loosenedRules(previous: RuleBook, next: RuleBook): string[] {
  const out: string[] = [];
  const flag = (condition: boolean, path: string) => condition && out.push(path);
  flag(MODE_ORDER[next.mode ?? "live"] > MODE_ORDER[previous.mode ?? "live"], "mode");
  flag(looserAllow(previous.networks?.allow, next.networks?.allow), "networks.allow");
  flag(looserAllow(previous.networks?.environments, next.networks?.environments), "networks.environments");
  flag(looserAllow(previous.kinds?.allow, next.kinds?.allow), "kinds.allow");
  flag(looserAllow(previous.protocols?.allow, next.protocols?.allow), "protocols.allow");
  flag(looserDeny(previous.protocols?.deny, next.protocols?.deny), "protocols.deny");
  flag(looserAllow(previous.assets?.allow, next.assets?.allow), "assets.allow");
  flag(previous.assets?.unlisted === "deny" && next.assets?.unlisted !== "deny", "assets.unlisted");
  flag(RECIPIENT_ORDER[next.recipients?.mode ?? "any"] > RECIPIENT_ORDER[previous.recipients?.mode ?? "any"], "recipients.mode");
  flag(looserAllow(previous.recipients?.allow, next.recipients?.allow) && (next.recipients?.mode ?? "any") === "allowlist", "recipients.allow");
  flag(looserDeny(previous.recipients?.deny, next.recipients?.deny), "recipients.deny");
  for (const key of ["maxSteps", "maxSlippageBps", "maxSeconds"] as const) flag(looserNumber(previous.limits?.[key], next.limits?.[key]), `limits.${key}`);
  flag(looserUsd(previous.limits?.maxFeeUsd, next.limits?.maxFeeUsd), "limits.maxFeeUsd");
  for (const key of ["perStepUsd", "perIntentUsd", "dailyUsd", "weeklyUsd"] as const) flag(looserUsd(previous.caps?.[key], next.caps?.[key]), `caps.${key}`);
  const a = previous.trading;
  const b = next.trading;
  flag(looserAllow(a?.markets?.allow, b?.markets?.allow), "trading.markets.allow");
  flag(looserDeny(a?.markets?.deny, b?.markets?.deny), "trading.markets.deny");
  for (const key of ["maxNotionalUsd", "maxOpenNotionalUsd", "dailyVolumeUsd", "dailyLossUsd"] as const) flag(looserUsd(a?.[key], b?.[key]), `trading.${key}`);
  for (const key of ["maxLeverage", "maxOpenOrders", "maxSlippageBps"] as const) flag(looserNumber(a?.[key], b?.[key]), `trading.${key}`);
  flag(a?.reduceOnly === true && b?.reduceOnly !== true, "trading.reduceOnly");
  flag(a?.triggers === false && b?.triggers !== false, "trading.triggers");
  flag(a?.twap === false && b?.twap !== false, "trading.twap");
  flag(looserAllow(previous.agent?.actions ?? DEFAULT_AGENT_ACTIONS, next.agent?.actions ?? DEFAULT_AGENT_ACTIONS), "agent.actions");
  flag(looserAllow(previous.agent?.modes ?? DEFAULT_AGENT_MODES, next.agent?.modes ?? DEFAULT_AGENT_MODES), "agent.modes");
  flag(looserNumber(previous.confirm?.leverageAbove, next.confirm?.leverageAbove), "confirm.leverageAbove");
  flag(looserUsd(previous.confirm?.aboveUsd, next.confirm?.aboveUsd), "confirm.aboveUsd");
  flag(looserDeny(previous.confirm?.when, next.confirm?.when), "confirm.when");
  flag(previous.schedule !== undefined && JSON.stringify(previous.schedule) !== JSON.stringify(next.schedule), "schedule");
  return out;
}

/* ---------------------------------------------------- defaults, templates */

/** Agent actions when a book does not say: every trading L1 action. */
export const DEFAULT_AGENT_ACTIONS: readonly L1ActionType[] = AGENT_SIGNABLE_ACTIONS;
/** Automations may propose or use the browser key by default; Keeper mode is opt-in. */
export const DEFAULT_AGENT_MODES: readonly AgentMode[] = Object.freeze(["browser", "propose"]);

function frozen(book: RuleBook): RuleBook {
  const result = validateRuleBook(book);
  if (!result.ok) throw new Error(`Invalid built-in rule book: ${result.issues.map((issue) => `${issue.path} ${issue.message}`).join("; ")}`);
  return Object.freeze(result.value);
}

/**
 * Sane testnet defaults: testnet only, sends to other people need a
 * confirmation, leverage capped at 20x with a confirmation above 10x,
 * per-order and daily caps, IOC slippage capped at 3%, Keeper mode off.
 */
export const DEFAULT_RULE_BOOK: RuleBook = frozen({
  schema: RULE_BOOK_SCHEMA,
  label: "Testnet defaults",
  mode: "live",
  networks: { environments: ["testnet"] },
  recipients: { mode: "any" },
  limits: { maxSteps: 12, maxSlippageBps: 300 },
  caps: { perIntentUsd: "25000", dailyUsd: "50000" },
  trading: {
    maxNotionalUsd: "10000",
    maxLeverage: 20,
    maxOpenOrders: 50,
    dailyVolumeUsd: "100000",
    triggers: true,
    twap: true,
    maxSlippageBps: 300,
  },
  agent: { modes: ["browser", "propose"] },
  confirm: { aboveUsd: "2500", leverageAbove: 10, when: ["external-recipient", "unlisted-asset"] },
});

export const RULE_BOOK_TEMPLATES: Readonly<Record<"observer" | "careful" | "scalper", RuleBook>> = Object.freeze({
  /** Plans and quotes only; nothing is prepared or signed. */
  observer: frozen({ schema: RULE_BOOK_SCHEMA, label: "Observer", mode: "dry-run" }),
  /** Small sizes, own accounts only, low leverage, everything above $250 confirmed. */
  careful: frozen({
    schema: RULE_BOOK_SCHEMA,
    label: "Careful",
    recipients: { mode: "own" },
    assets: { unlisted: "deny" },
    caps: { perIntentUsd: "1000", dailyUsd: "2500" },
    trading: { maxNotionalUsd: "500", maxLeverage: 3, maxOpenOrders: 10, dailyVolumeUsd: "5000", dailyLossUsd: "250", twap: true, triggers: true, maxSlippageBps: 100 },
    agent: { modes: ["propose"] },
    confirm: { aboveUsd: "250", leverageAbove: 2, when: ["agent-proposal", "cross-network"] },
  }),
  /** Fast trading on liquid perps through the agent key, bounded per order and per day. */
  scalper: frozen({
    schema: RULE_BOOK_SCHEMA,
    label: "Scalper",
    kinds: { allow: ["order", "cancel", "leverage", "twap", "margin"] },
    recipients: { mode: "own" },
    trading: {
      markets: { allow: ["BTC", "ETH", "HYPE", "SOL"] },
      maxNotionalUsd: "2000",
      maxLeverage: 5,
      maxOpenOrders: 30,
      dailyVolumeUsd: "50000",
      dailyLossUsd: "500",
      maxSlippageBps: 50,
    },
    agent: { modes: ["browser"], actions: ["order", "cancel", "cancelByCloid", "modify", "batchModify", "updateLeverage", "scheduleCancel"] },
  }),
});
