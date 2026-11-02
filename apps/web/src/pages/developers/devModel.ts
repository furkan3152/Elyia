/**
 * The developer portal's pure rules: key rows, the shown-once reveal, usage
 * meters and ranges, the integrator fee preview, webhook delivery lines and
 * the copy-paste snippets. Node tests load this file.
 */
import type { ApiKeyScope, ApiKeyView, KeyQuotas, UsageDay, UsageResponse, WebhookDelivery } from "@elyia/core/api/developers";

export const ALL_SCOPES: readonly ApiKeyScope[] = ["read", "plan", "execute-prepare", "webhooks"];
const SCOPE_LABEL: Readonly<Record<ApiKeyScope, string>> = { read: "read", plan: "plan", "execute-prepare": "prepare", webhooks: "webhooks" };

/* ----------------------------------------------------------------- keys */

/** `ely_••••x2Pa`: only the last four characters are ever known after creation. */
export function maskedKey(key: Pick<ApiKeyView, "last4">): string {
  return `ely_••••••${key.last4}`;
}

export function scopeChips(scopes: readonly ApiKeyScope[]): string[] {
  if (ALL_SCOPES.every((scope) => scopes.includes(scope))) return [`all ${ALL_SCOPES.length}`];
  return scopes.map((scope) => SCOPE_LABEL[scope] ?? scope);
}

/** Live keys first (newest first), revoked keys last. */
export function sortKeys<K extends Pick<ApiKeyView, "createdAt" | "revokedAt">>(keys: readonly K[]): K[] {
  return [...keys].sort((a, b) => {
    if ((a.revokedAt === null) !== (b.revokedAt === null)) return a.revokedAt === null ? -1 : 1;
    return Date.parse(b.createdAt) - Date.parse(a.createdAt);
  });
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "now", "2 min", "1 h", "Oct 12" (UTC). */
export function relativeTime(iso: string | null, now: number): string {
  if (!iso) return "never";
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return "—";
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 60) return "now";
  if (seconds < 3_600) return `${Math.floor(seconds / 60)} min`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)} h`;
  const date = new Date(at);
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}`;
}

const SCRAMBLE = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz0123456789";

/**
 * The new key "scrambles into place": the prefix up to `fixedPrefix` is
 * fixed, then characters lock from left to right as `progress` goes 0 -> 1;
 * the rest cycle with `tick`. progress >= 1 returns the key itself.
 */
export function scrambleKey(key: string, progress: number, tick: number, fixedPrefix = 4): string {
  if (progress >= 1) return key;
  const locked = fixedPrefix + Math.floor((key.length - fixedPrefix) * Math.max(0, progress));
  let out = key.slice(0, locked);
  for (let i = locked; i < key.length; i += 1) out += SCRAMBLE[(i * 7 + tick) % SCRAMBLE.length];
  return out;
}

/* ---------------------------------------------------------------- usage */

export type UsageRange = "24h" | "7d" | "30d";
export const RANGE_DAYS: Readonly<Record<UsageRange, number>> = { "24h": 1, "7d": 7, "30d": 30 };

export interface MeterRow {
  readonly metric: "requests" | "plans" | "prepares";
  readonly label: string;
  readonly used: number;
  readonly quota: number;
  readonly fraction: number;
  /** Near quota (>= 80 %): drawn in sun and said in words. */
  readonly hot: boolean;
}

const QUOTA_OF: Readonly<Record<MeterRow["metric"], keyof KeyQuotas>> = { requests: "requestsPerDay", plans: "plansPerDay", prepares: "preparesPerDay" };

/** Totals over the newest `days` days of every live key, against the summed daily quotas x days. */
export function usageMeters(usage: Pick<UsageResponse, "keys">, days: number): MeterRow[] {
  const metrics: MeterRow["metric"][] = ["requests", "plans", "prepares"];
  return metrics.map((metric) => {
    let used = 0;
    let quota = 0;
    for (const key of usage.keys) {
      for (const day of key.days.slice(0, days)) used += day[metric];
      quota += key.quotas[QUOTA_OF[metric]] * days;
    }
    const fraction = quota > 0 ? Math.min(1, used / quota) : 0;
    return { metric, label: metric[0]!.toUpperCase() + metric.slice(1), used, quota, fraction, hot: fraction >= 0.8 };
  });
}

/** Plans per day across keys, oldest first (the API lists newest first). */
export function dailySeries(usage: Pick<UsageResponse, "keys">, days: number, metric: MeterRow["metric"] = "plans"): { readonly day: string; readonly value: number }[] {
  const byDay = new Map<string, number>();
  for (const key of usage.keys) for (const day of key.days.slice(0, days)) byDay.set(day.day, (byDay.get(day.day) ?? 0) + day[metric]);
  return [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, value]) => ({ day, value }));
}

/** Bar heights in 4 growth steps: `progress` 0..1 maps to 0, 1/4 .. 1 of each bar. */
export function steppedBarHeight(value: number, max: number, height: number, progress: number): number {
  if (max <= 0 || value <= 0) return 0;
  const step = Math.floor(Math.max(0, Math.min(1, progress)) * 4) / 4;
  if (step === 0) return 0;
  return Math.max(1, Math.round((value / max) * height * step));
}

export function formatCount(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

export function shortDay(day: string): string {
  const at = Date.parse(`${day}T00:00:00Z`);
  if (Number.isNaN(at)) return day;
  const date = new Date(at);
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}`;
}

/* ------------------------------------------------------- integrator fee */

export function clampBps(value: number, max: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(max, Math.round(value)));
}

/** 15 -> "0.15%". */
export function bpsToPercent(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`;
}

/** The line end users read on every route card (mirrors the API's disclosure). */
export function feeDisclosure(bps: number, appName: string | null): string {
  if (bps <= 0) return "No integrator fee.";
  return appName ? `Includes ${bpsToPercent(bps)} to ${appName}` : `This app adds a ${bpsToPercent(bps)} integrator fee, paid on chain through ElyiaRouter.`;
}

/** Fee on a trade of `usd` at `bps` (rounded to cents). */
export function feeOn(usd: number, bps: number): number {
  return Math.round(usd * bps) / 100 / 100;
}

/* -------------------------------------------------------------- webhooks */

export type DeliveryTone = "up" | "warn" | "dn";

/** "200 · 84 ms", "retry 2 · 503", "failed · timeout"; the word carries the state, not only the colour. */
export function deliveryLine(delivery: Pick<WebhookDelivery, "status" | "httpStatus" | "durationMs" | "attempt" | "error">): { readonly text: string; readonly tone: DeliveryTone } {
  if (delivery.status === "delivered") return { text: `${delivery.httpStatus ?? 200} · ${delivery.durationMs ?? "?"} ms`, tone: "up" };
  if (delivery.status === "retrying") return { text: `retry ${delivery.attempt} · ${delivery.httpStatus ?? delivery.error ?? "no answer"}`, tone: "warn" };
  return { text: `failed · ${delivery.httpStatus ?? delivery.error ?? "no answer"}`, tone: "dn" };
}

/** `intent.step.settled` -> `step.settled` (the short chip label). */
export function shortEvent(type: string): string {
  return type.replace(/^intent\.(?=step\.)/u, "");
}

/** Only https receivers (or localhost while developing) are accepted. */
/** Hostnames the API refuses outright: localhost names, loopback, private, link-local and CGNAT literals. */
function isLocalHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/gu, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return true;
  if (host === "::1" || host === "::" || /^f[cd][0-9a-f]{2}:/u.test(host) || /^fe80:/u.test(host)) return true;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/u.exec(host);
  if (!v4) return false;
  const [a, b] = [Number(v4[1]), Number(v4[2])];
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

export function webhookUrlProblem(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return "Enter a full URL, like https://example.com/hooks/elyia.";
  }
  // Mirrors the API's SSRF guard (public HTTPS only, no dev exception), so the form never offers a URL the server refuses.
  if (parsed.protocol !== "https:") return "Webhooks are delivered to https URLs only.";
  if (parsed.username || parsed.password) return "The URL must not carry credentials.";
  if (isLocalHost(parsed.hostname)) return "Use a public address: Elyia never delivers to localhost or private networks.";
  return null;
}

/* ---------------------------------------------------------------- snippets */

/** The quickstart over @elyia/sdk (packages/sdk): plan, prepare, the user's wallet signs, submit, follow. */
export function quickstartSnippet(apiBase: string): string {
  return [
    `import { ElyiaClient } from "@elyia/sdk";`,
    "",
    `const elyia = new ElyiaClient({ baseUrl: "${apiBase}", apiKey: process.env.ELYIA_KEY });`,
    "",
    "// 1. Plan: a priced route through the venue auction and the Rule Book",
    "const plan = await elyia.plan({",
    "  accounts: [`eip155:99801:${address}`],",
    `  actions: [{ kind: "swap", network: "elysium-testnet", from: "HYPE", to: "USDC", amount: "1" }],`,
    "});",
    "",
    "// 2. Prepare a step: unsigned requests, nothing sent",
    "const step = plan.intent.steps[0];",
    "const { payload } = await elyia.prepare(plan.intent.id, step.id);",
    "",
    "// 3. Your user's wallet signs; Elyia never does",
    "const hash = await wallet.sendTransaction(payload.requests[0]);",
    "await elyia.submit(plan.intent.id, step.id, [hash]);",
    "",
    "for await (const event of elyia.journeyStream(plan.intent.id)) console.log(event.type);",
  ].join("\n");
}

export function mcpSnippet(apiBase: string): string {
  return JSON.stringify({ mcpServers: { elyia: { url: `${apiBase}/v1/mcp`, headers: { Authorization: "Bearer ely_…" } } } }, null, 2);
}

export function widgetSnippet(developerId: string | null): string {
  return `<elyia-widget developer="${developerId ?? "dev_…"}" theme="day"></elyia-widget>`;
}

/** Sum of a list of UsageDay rows (for sample data and the totals line). */
export function sumDays(days: readonly UsageDay[]): Omit<UsageDay, "day"> {
  return days.reduce((sum, day) => ({ requests: sum.requests + day.requests, plans: sum.plans + day.plans, prepares: sum.prepares + day.prepares }), { requests: 0, plans: 0, prepares: 0 });
}
