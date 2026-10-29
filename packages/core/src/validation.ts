/**
 * Request validation shared by the API (authoritative) and clients (early
 * feedback): intent requests and structured actions. Returns every issue at
 * once so a form can mark all bad fields.
 */
import { decimalProblem } from "./amounts.js";
import { parseAccountId } from "./caip.js";
import { NETWORKS, isNetworkKey, type NetworkEnvironment } from "./networks.js";
import { getProtocol } from "./protocols.js";
import { STEP_KINDS, type IntentActionSpec, type IntentRequest } from "./intent.js";

export interface ValidationIssue {
  readonly path: string;
  readonly message: string;
}

export type ValidationResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly issues: readonly ValidationIssue[] };

export const INTENT_LIMITS = Object.freeze({
  textLength: 1_000,
  actions: 12,
  accounts: 6,
  metadataEntries: 16,
  metadataValueLength: 256,
  clientReferenceLength: 128,
  minMaxSeconds: 10,
  maxMaxSeconds: 1_209_600,
});

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const CONTROL = /[\p{Cc}\p{Cf}]/u;

function decimal(value: unknown, path: string, issues: ValidationIssue[], options: { readonly allowMax?: boolean; readonly positive?: boolean } = {}): void {
  if (value === undefined) return;
  if (options.allowMax && value === "max") return;
  if (typeof value !== "string") {
    issues.push({ path, message: "Must be a decimal string." });
    return;
  }
  const problem = decimalProblem(value);
  if (problem) issues.push({ path, message: problem.message });
  else if (options.positive !== false && /^0(?:\.0+)?$/u.test(value)) issues.push({ path, message: "Must be more than zero." });
}

/** Validates one structured action. */
export function validateActionSpec(action: unknown, path: string, environment: NetworkEnvironment, index: number): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(action)) return [{ path, message: "An action is an object." }];
  const spec = action as Partial<IntentActionSpec> & Record<string, unknown>;
  if (typeof spec.kind !== "string" || !(STEP_KINDS as readonly string[]).includes(spec.kind)) issues.push({ path: `${path}.kind`, message: "Unknown action kind." });
  if (!isNetworkKey(spec.network)) issues.push({ path: `${path}.network`, message: "Unknown network." });
  else if (NETWORKS[spec.network].environment !== environment) issues.push({ path: `${path}.network`, message: `This intent runs on ${environment}; ${spec.network} is not.` });
  if (spec.toNetwork !== undefined) {
    if (!isNetworkKey(spec.toNetwork)) issues.push({ path: `${path}.toNetwork`, message: "Unknown network." });
    else if (NETWORKS[spec.toNetwork].environment !== environment) issues.push({ path: `${path}.toNetwork`, message: "Testnet and mainnet capital never mix." });
  }
  decimal(spec.amount, `${path}.amount`, issues, { allowMax: true });
  decimal(spec.size, `${path}.size`, issues);
  decimal(spec.price, `${path}.price`, issues);
  decimal(spec.takeProfit, `${path}.takeProfit`, issues);
  decimal(spec.stopLoss, `${path}.stopLoss`, issues);
  if (spec.protocol !== undefined && (typeof spec.protocol !== "string" || !getProtocol(spec.protocol))) issues.push({ path: `${path}.protocol`, message: "Unknown protocol." });
  if (spec.side !== undefined && !["buy", "sell", "long", "short"].includes(String(spec.side))) issues.push({ path: `${path}.side`, message: "Side is buy, sell, long or short." });
  if (spec.tif !== undefined && !["Gtc", "Ioc", "Alo"].includes(String(spec.tif))) issues.push({ path: `${path}.tif`, message: "Time in force is Gtc, Ioc or Alo." });
  if (spec.leverage !== undefined) {
    const leverage = spec.leverage as { value?: unknown; mode?: unknown };
    if (!isRecord(leverage) || typeof leverage.value !== "number" || !Number.isInteger(leverage.value) || leverage.value < 1 || leverage.value > 100) {
      issues.push({ path: `${path}.leverage`, message: "Leverage is a whole number from 1 to 100 (1.5x is not allowed on HyperCore)." });
    } else if (leverage.mode !== undefined && leverage.mode !== "cross" && leverage.mode !== "isolated") issues.push({ path: `${path}.leverage.mode`, message: "cross or isolated." });
  }
  if (spec.minutes !== undefined && (typeof spec.minutes !== "number" || !Number.isInteger(spec.minutes) || spec.minutes < 5 || spec.minutes > 1_440)) {
    issues.push({ path: `${path}.minutes`, message: "A TWAP runs 5 to 1440 minutes." });
  }
  if (spec.after !== undefined) {
    if (!Array.isArray(spec.after) || spec.after.some((entry) => typeof entry !== "number" || !Number.isInteger(entry) || entry < 0 || entry >= index)) {
      issues.push({ path: `${path}.after`, message: "after lists indexes of earlier actions." });
    }
  }
  if ((spec.kind === "order" || spec.kind === "twap") && (spec.market === undefined || spec.size === undefined || spec.side === undefined)) {
    issues.push({ path, message: "Orders need a market, a side and a size." });
  }
  if (spec.recipient !== undefined && typeof spec.recipient !== "string") issues.push({ path: `${path}.recipient`, message: "Recipient is an address or CAIP-10 account." });
  return issues;
}

/** Validates `POST /v1/intents` bodies. */
export function validateIntentRequest(input: unknown): ValidationResult<IntentRequest> {
  const issues: ValidationIssue[] = [];
  if (!isRecord(input)) return { ok: false, issues: [{ path: "", message: "The body is a JSON object." }] };
  const allowed = ["text", "actions", "accounts", "environment", "constraints", "metadata", "clientReference"];
  for (const key of Object.keys(input)) if (!allowed.includes(key)) issues.push({ path: key, message: `Unknown field. Allowed: ${allowed.join(", ")}.` });
  const environment = input.environment === undefined ? "testnet" : input.environment;
  if (environment !== "testnet" && environment !== "mainnet") issues.push({ path: "environment", message: "testnet or mainnet." });
  const env: NetworkEnvironment = environment === "mainnet" ? "mainnet" : "testnet";
  const hasText = typeof input.text === "string" && input.text.trim().length > 0;
  if (input.text !== undefined) {
    if (typeof input.text !== "string" || input.text.length > INTENT_LIMITS.textLength) issues.push({ path: "text", message: `Text of at most ${INTENT_LIMITS.textLength} characters.` });
    else if (CONTROL.test(input.text.replace(/[\n\t]/gu, ""))) issues.push({ path: "text", message: "Text contains control characters." });
  }
  const hasActions = Array.isArray(input.actions) && input.actions.length > 0;
  if (input.actions !== undefined) {
    if (!Array.isArray(input.actions) || input.actions.length > INTENT_LIMITS.actions) issues.push({ path: "actions", message: `At most ${INTENT_LIMITS.actions} actions.` });
    else input.actions.forEach((action, index) => issues.push(...validateActionSpec(action, `actions[${index}]`, env, index)));
  }
  if (!hasText && !hasActions) issues.push({ path: "text", message: "Say what you want, or send structured actions." });
  if (!Array.isArray(input.accounts) || input.accounts.length === 0 || input.accounts.length > INTENT_LIMITS.accounts) {
    issues.push({ path: "accounts", message: `Between 1 and ${INTENT_LIMITS.accounts} CAIP-10 accounts.` });
  } else {
    input.accounts.forEach((account, index) => {
      const parsed = parseAccountId(account);
      if (!parsed) issues.push({ path: `accounts[${index}]`, message: "Not a CAIP-10 account (eip155:99801:0x… or hypercore:testnet:0x…)." });
      else if (parsed.network.environment !== env) issues.push({ path: `accounts[${index}]`, message: `This account is on ${parsed.network.environment}; the intent runs on ${env}.` });
    });
  }
  if (input.constraints !== undefined) {
    const constraints = input.constraints;
    if (!isRecord(constraints)) issues.push({ path: "constraints", message: "Must be an object." });
    else {
      const slippage = constraints.maxSlippageBps;
      if (slippage !== undefined && (typeof slippage !== "number" || !Number.isInteger(slippage) || slippage < 1 || slippage > 1_000)) issues.push({ path: "constraints.maxSlippageBps", message: "1 to 1000 basis points." });
      const seconds = constraints.maxSeconds;
      if (seconds !== undefined && (typeof seconds !== "number" || !Number.isInteger(seconds) || seconds < INTENT_LIMITS.minMaxSeconds || seconds > INTENT_LIMITS.maxMaxSeconds)) {
        issues.push({ path: "constraints.maxSeconds", message: `${INTENT_LIMITS.minMaxSeconds} to ${INTENT_LIMITS.maxMaxSeconds} seconds.` });
      }
      const deadline = constraints.deadline;
      if (deadline !== undefined && (typeof deadline !== "number" || !Number.isInteger(deadline) || deadline <= 0)) issues.push({ path: "constraints.deadline", message: "Unix seconds." });
      if (constraints.maxFeeUsd !== undefined && (typeof constraints.maxFeeUsd !== "string" || !/^\d{1,9}(?:\.\d{1,2})?$/u.test(constraints.maxFeeUsd))) issues.push({ path: "constraints.maxFeeUsd", message: "USD decimal string." });
      for (const key of ["preferProtocols", "avoidProtocols"] as const) {
        const list = constraints[key];
        if (list !== undefined && (!Array.isArray(list) || list.some((id) => typeof id !== "string" || !getProtocol(id)))) issues.push({ path: `constraints.${key}`, message: "A list of protocol ids." });
      }
    }
  }
  if (input.metadata !== undefined) {
    if (!isRecord(input.metadata) || Object.keys(input.metadata).length > INTENT_LIMITS.metadataEntries || Object.values(input.metadata).some((value) => typeof value !== "string" || value.length > INTENT_LIMITS.metadataValueLength)) {
      issues.push({ path: "metadata", message: `At most ${INTENT_LIMITS.metadataEntries} string entries of ${INTENT_LIMITS.metadataValueLength} characters.` });
    }
  }
  if (input.clientReference !== undefined && (typeof input.clientReference !== "string" || !/^[A-Za-z0-9_.:-]{1,128}$/u.test(input.clientReference))) {
    issues.push({ path: "clientReference", message: "1-128 characters from A-Z a-z 0-9 _ . : -" });
  }
  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, value: { ...(input as unknown as IntentRequest), environment: env } };
}
