/**
 * The Herd on the web, pure (node tests load this file): what the mint card
 * says and does in every case, the phase timeline, HYPE formatting, the WL
 * steps, the share-on-X intent, and admin input helpers. Nothing here holds a
 * key or sends anything: the wallet signs every mint.
 */
import type { HerdConfigResponse, HerdMeResponse, HerdPhase, HerdProofResponse, HerdQuote, HerdTask, HerdUsageScore } from "@elyia/core/api/herd";

/* ------------------------------------------------------------- numbers */

/** Wei (decimal string) -> "1 HYPE", "0.0213 HYPE", "<0.0001 HYPE". */
export function formatHype(wei: string | bigint | null | undefined, symbol = "HYPE"): string {
  if (wei === null || wei === undefined || wei === "") return "—";
  const value = typeof wei === "bigint" ? wei : BigInt(wei);
  if (value === 0n) return `0 ${symbol}`;
  const whole = value / 10n ** 18n;
  const fraction = value % 10n ** 18n;
  if (whole === 0n && fraction < 10n ** 14n) return `<0.0001 ${symbol}`;
  const decimals = fraction.toString().padStart(18, "0").slice(0, 4).replace(/0+$/u, "");
  return `${whole.toLocaleString("en-US")}${decimals ? `.${decimals}` : ""} ${symbol}`;
}

/** "1.5" HYPE -> wei. Returns null for anything that is not a plain decimal. */
export function parseHype(input: string): bigint | null {
  const text = input.trim();
  if (!/^\d{1,12}(?:\.\d{1,18})?$/u.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  return BigInt(whole!) * 10n ** 18n + BigInt(fraction.padEnd(18, "0"));
}

/** USD with 6 decimals -> "$2.00". */
export function formatUsd6(value: string | null | undefined): string {
  if (!value || value === "0") return "—";
  return `$${(Number(value) / 1e6).toFixed(2)}`;
}

/** USD-pegged quotes may move between quote and inclusion: send 1% over, the contract refunds the excess in the same tx. */
export const USD_SLIPPAGE_BPS = 100n;

export function valueToSend(quote: HerdQuote): bigint | null {
  if (!quote.wei) return null;
  const wei = BigInt(quote.wei);
  return quote.source === "fixed" ? wei : wei + (wei * USD_SLIPPAGE_BPS) / 10_000n;
}

/* ------------------------------------------------------------- phases */

export const PHASE_LABEL: Readonly<Record<HerdPhase, string>> = { closed: "Closed", wl: "WL + collab", public: "Public", ended: "Ended" };
export const PHASE_INDEX: Readonly<Record<HerdPhase, number>> = { closed: 0, wl: 1, public: 2, ended: 3 };

export interface TimelineStop {
  readonly phase: HerdPhase;
  readonly label: string;
  readonly state: "done" | "now" | "next";
  readonly start: string | null;
  readonly end: string | null;
  readonly price: string | null;
}

export function timeline(config: HerdConfigResponse | null | undefined): TimelineStop[] {
  const current = config?.phase ? PHASE_INDEX[config.phase] : config?.source === "chain" ? 0 : -1;
  return (["closed", "wl", "public", "ended"] as const).map((phase) => {
    const window = config?.timeline.find((entry) => entry.phase === phase) ?? null;
    const index = PHASE_INDEX[phase];
    const quote = config?.quotes.find((entry) => entry.phase === phase) ?? null;
    return {
      phase,
      label: PHASE_LABEL[phase],
      state: index < current ? "done" : index === current ? "now" : "next",
      start: window?.start ?? null,
      end: window?.end ?? null,
      price: window ? (window.priceMode === "usd" ? `${formatUsd6(window.priceUsd6)} in HYPE` : formatHype(window.priceWei)) : quote?.wei ? formatHype(quote.wei) : null,
    };
  });
}

/** "2d 4h", "3h 12m", "45s". */
export function countdown(toIso: string | null, now: number): string | null {
  if (!toIso) return null;
  const ms = Date.parse(toIso) - now;
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3_600);
  const m = Math.floor((s % 3_600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

/* ---------------------------------------------------------- the mint */

export type MintStatus =
  | "loading"
  | "not-deployed"
  | "unavailable"
  | "sold-out"
  | "paused"
  | "closed"
  | "upcoming"
  | "window-over"
  | "ended"
  | "bucket-full"
  | "oracle-down"
  | "connect"
  | "wrong-network"
  | "checking"
  | "already-minted"
  | "not-listed"
  | "proof-pending"
  | "insufficient-funds"
  | "ready";

export interface MintAction {
  readonly functionName: "mintPublic" | "mintAllowlist" | "mintCollab";
  readonly args: readonly unknown[];
  readonly value: bigint;
}

export interface MintCardState {
  readonly status: MintStatus;
  readonly phase: HerdPhase | null;
  readonly title: string;
  readonly detail: string;
  readonly action: MintAction | null;
  /** The quote shown (wei), when there is one. */
  readonly quote: HerdQuote | null;
  /** A countdown target (ISO), when the card waits for a time. */
  readonly until: string | null;
  readonly tone: "up" | "acc" | "warn" | "dn" | "mute";
}

export interface MintInput {
  readonly config: HerdConfigResponse | null | undefined;
  readonly wallet: string | null;
  readonly walletChainId: number | null;
  /** The token this wallet minted (mintedBy), 0 / null when none; undefined while loading. */
  readonly mintedId: number | null | undefined;
  readonly proof: HerdProofResponse | null | undefined;
  readonly balanceWei: bigint | null;
  readonly now: number;
}

function card(status: MintStatus, tone: MintCardState["tone"], title: string, detail: string, extra: Partial<MintCardState> = {}): MintCardState {
  return { status, phase: null, action: null, quote: null, until: null, tone, title, detail, ...extra };
}

/**
 * Every case of the mint card, in order: deployment, supply, pause, phase and
 * window, bucket, oracle, wallet, network, 1 per wallet, allowlist, funds.
 */
export function mintCard(input: MintInput): MintCardState {
  const { config, wallet, now } = input;
  if (!config) return card("loading", "mute", "Reading the collection…", "Live supply and phase come from the contract.");
  if (config.source === "not-deployed") return card("not-deployed", "mute", "Not deployed yet", `${config.testnet ? "The testnet collection" : "The collection"} is not on chain yet. Planned: ${config.maxSupply.toLocaleString("en-US")} goats, 1 per wallet. Join the WL meanwhile.`);
  if (config.source === "chain-error" || config.totalSupply === null) return card("unavailable", "warn", "Can't read the contract", config.note ?? "The network did not answer. Try again in a moment.");
  const phase = config.phase;
  const base = { phase };
  if (config.soldOut) return card("sold-out", "acc", "Sold out", `All ${config.maxSupply.toLocaleString("en-US")} goats are minted.${config.links.marketplace ? " Trade them on Kalos." : ""}`, base);
  if (config.paused) return card("paused", "dn", "Mint paused", "The owner paused the mint (an emergency stop). Nothing can be minted until it resumes. Funds and tokens are safe.", base);
  if (phase === "ended") return card("ended", "mute", "The mint has ended", "No more mints. Unsold supply is the owner's to roll into the team reserve or burn, on chain.", base);
  const window = config.timeline.find((entry) => entry.phase === phase) ?? null;
  if (phase === "closed" || !phase) {
    const wl = config.timeline.find((entry) => entry.phase === "wl");
    return card(wl?.start && Date.parse(wl.start) > now ? "upcoming" : "closed", "mute", "Mint not open yet", wl?.start ? `The WL phase is scheduled for ${new Date(wl.start).toUTCString().slice(5, 22)} UTC.` : "The phases are not scheduled yet. Apply for the WL meanwhile.", { ...base, until: wl?.start ?? null });
  }
  if (!window?.start || !window.end) return card("closed", "mute", `${PHASE_LABEL[phase]} phase: no window yet`, "The owner has not set this phase's window. Nothing can be minted until it opens.", base);
  // The contract's isOpen (chain time) wins over this device's clock.
  const chainOpen = phase === "wl" || phase === "public" ? config.open?.[phase] : null;
  if (chainOpen !== true && Date.parse(window.start) > now) return card("upcoming", "acc", `${PHASE_LABEL[phase]} opens soon`, `Opens ${new Date(window.start).toUTCString().slice(5, 22)} UTC.`, { ...base, until: window.start });
  if (chainOpen !== true && Date.parse(window.end) <= now) return card("window-over", "mute", `${PHASE_LABEL[phase]} window is over`, phase === "wl" ? "The WL window closed. Leftover WL supply rolls into the public phase when the owner moves it on chain." : "The public window closed. The owner ends the mint next.", base);
  const quote = config.quotes.find((entry) => entry.phase === phase) ?? null;
  const allocations = config.allocations;
  if (allocations && phase === "public" && allocations.publicMinted >= allocations.public) return card("bucket-full", "acc", "Public allocation minted out", "Every public goat is minted. The owner may roll unused supply in; watch this space.", { ...base, quote });
  if (allocations && phase === "wl" && allocations.wlMinted >= allocations.wl && allocations.collabMinted >= allocations.collab) return card("bucket-full", "acc", "WL allocation minted out", "Every WL and collab goat is minted. Unused supply rolls into public when that phase opens.", { ...base, quote });
  if (!quote?.wei) return card("oracle-down", "warn", "Price unavailable", quote?.note ?? "The price oracle is down, so the mint fails closed until it recovers. Nobody can overpay or underpay.", { ...base, quote });
  if (!wallet) return card("connect", "acc", "Connect your wallet", `1 per wallet. ${PHASE_LABEL[phase]} price ${formatHype(quote.wei)}.`, { ...base, quote, until: window.end });
  if (input.walletChainId !== null && input.walletChainId !== config.chainId) return card("wrong-network", "warn", "Wrong network", `Your wallet is on chain ${input.walletChainId}. The Herd mints on ${config.testnet ? "Elysium testnet" : "Elysium"} (${config.chainId}); switch to continue.`, { ...base, quote });
  if (input.mintedId === undefined) return card("checking", "mute", "Checking your wallet…", "Reading mintedBy from the contract.", { ...base, quote });
  if (input.mintedId) return card("already-minted", "up", "You already minted", `This wallet minted ${input.mintedId > 0 ? `Ely #${input.mintedId}` : "its goat"}. 1 per wallet across every phase, enforced on chain.`, { ...base, quote });
  const value = valueToSend(quote)!;
  let action: MintAction;
  if (phase === "wl") {
    const proof = input.proof;
    if (proof === undefined) return card("checking", "mute", "Looking up your WL spot…", "Fetching your Merkle proof.", { ...base, quote });
    if (!proof?.list) return card("not-listed", "mute", "Not on the WL", "This wallet is not on the WL or a partner list. The public phase opens to everyone after this one.", { ...base, quote, until: window.end });
    if (proof.rootOnChain === false) return card("proof-pending", "warn", "Your spot is not published yet", "You are approved, but the WL root on chain is not the current list yet. The owner publishes it; check back shortly.", { ...base, quote });
    action = proof.list === "collab" ? { functionName: "mintCollab", args: [proof.partnerTagHex, proof.proof], value } : { functionName: "mintAllowlist", args: [proof.proof], value };
  } else {
    action = { functionName: "mintPublic", args: [], value };
  }
  if (input.balanceWei !== null && input.balanceWei < value) return card("insufficient-funds", "warn", "Not enough HYPE", `Minting needs ${formatHype(value)} plus gas; this wallet holds ${formatHype(input.balanceWei)}.`, { ...base, quote });
  const listNote = action.functionName === "mintCollab" ? ` via your partner list (${input.proof?.partnerTag ?? "collab"})` : action.functionName === "mintAllowlist" ? " with your WL proof" : "";
  return card("ready", "up", "Mint 1 Ely", `${formatHype(quote.wei)}${quote.source === "fixed" ? "" : " (USD-pegged: you send 1% extra, refunded in the same tx)"}${listNote}. Your wallet signs; 1 per wallet.`, { ...base, quote, action, until: window.end });
}

/** Contract revert names -> plain words for the mint card. */
export function mintError(message: string): string {
  const known: ReadonlyArray<readonly [RegExp, string]> = [
    [/AlreadyMinted/u, "This wallet already minted one (1 per wallet)."],
    [/WrongPhase/u, "The phase changed: refresh and try again."],
    [/PhaseNotOpen/u, "The phase window is not open right now."],
    [/InvalidProof/u, "The WL proof does not match the root on chain. The list may have changed: refresh."],
    [/AllocationExhausted/u, "That allocation just minted out."],
    [/CollabCapReached/u, "Your partner's allocation is used up."],
    [/UnknownPartner/u, "Your partner list has no allocation on chain yet."],
    [/InsufficientPayment/u, "The price moved: refresh the quote and try again."],
    [/OracleUnavailable|OracleDeviation/u, "The price oracle is unavailable: the mint fails closed for now."],
    [/EnforcedPause|paused/iu, "The mint is paused."],
    [/ContractMinter/u, "Public mints must come from a wallet, not a contract."],
    [/reject|denied|cancel/iu, "You rejected it in your wallet. Nothing was sent."],
    [/insufficient funds/iu, "Not enough HYPE for the price plus gas."],
  ];
  return known.find(([pattern]) => pattern.test(message))?.[1] ?? message.split("\n")[0]!.slice(0, 200);
}

/* ------------------------------------------------------------- the WL */

export type WlStep = "connect" | "sign-in" | "tasks" | "card" | "submit" | "status";
export const WL_STEPS: readonly { readonly id: WlStep; readonly label: string }[] = [
  { id: "connect", label: "Connect" },
  { id: "sign-in", label: "Sign in" },
  { id: "tasks", label: "Tasks" },
  { id: "card", label: "Share card" },
  { id: "submit", label: "Submit" },
  { id: "status", label: "Status" },
];

/** Steps the applicant can open now. */
export function reachableSteps(input: { readonly connected: boolean; readonly signedIn: boolean; readonly me: HerdMeResponse | null | undefined }): WlStep[] {
  if (!input.connected) return ["connect"];
  if (!input.signedIn) return ["connect", "sign-in"];
  const steps: WlStep[] = ["connect", "sign-in"];
  const canEdit = !input.me?.application || input.me.canApply;
  if (canEdit) steps.push("tasks", "card", "submit");
  if (input.me?.application) steps.push("status");
  return steps;
}

/** The step shown: the one asked for when reachable, else the furthest reachable. */
export function wlStep(input: { readonly connected: boolean; readonly signedIn: boolean; readonly me: HerdMeResponse | null | undefined; readonly wanted: WlStep | null }): WlStep {
  const steps = reachableSteps(input);
  if (input.wanted && steps.includes(input.wanted)) return input.wanted;
  if (input.me?.application) return "status";
  return steps.includes("tasks") ? "tasks" : steps[steps.length - 1]!;
}

/** Client-side evidence check (the server checks again). */
export function evidenceProblem(task: HerdTask, value: string, handle: string | null): string | null {
  if (task.evidence === "none" || task.evidence === "x-handle") return handle ? null : "Enter your X handle above.";
  const text = value.trim();
  if (!text) return task.required ? "Required." : null;
  if (task.evidence === "tweet-url") {
    const match = /^https:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})\/status(?:es)?\/(\d{5,25})/iu.exec(text);
    if (!match) return "Paste the link to your post (https://x.com/<you>/status/…).";
    if (handle && match[1]!.toLowerCase() !== handle) return `That post is by @${match[1]}, not @${handle}.`;
  }
  if (task.evidence === "post-url" && !/^https:\/\/\S+$/u.test(text)) return "Paste an https link.";
  return null;
}

/** X's web intent with the card text and links (no API, no login: the applicant posts it themselves). */
export function shareIntent(input: { readonly handle: string | null; readonly referral: string | null; readonly pageUrl: string; readonly score: number | null; readonly testnet: boolean }): string {
  const text = [`I applied for The Herd${input.testnet ? " (testnet)" : ""} WL on Elyia: the Ely goats are coming to Elysium.`, input.score !== null ? `My usage score: ${input.score}/100.` : null].filter(Boolean).join(" ");
  const url = new URL(input.pageUrl);
  if (input.referral) url.searchParams.set("ref", input.referral);
  return `https://x.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url.toString())}`;
}

/** The score's components with the most points left first: how to raise your chance. */
export function raiseTips(score: HerdUsageScore | null | undefined): { readonly label: string; readonly left: number; readonly tip: string }[] {
  if (!score) return [];
  return score.components
    .filter((component) => component.tip && component.max > component.points)
    .map((component) => ({ label: component.label, left: Math.round((component.max - component.points) * 10) / 10, tip: component.tip! }))
    .sort((a, b) => b.left - a.left);
}

export const STATUS_WORDS: Readonly<Record<string, { readonly label: string; readonly tone: "up" | "acc" | "warn" | "dn" | "mute"; readonly detail: string }>> = {
  pending: { label: "Pending", tone: "acc", detail: "In the queue. The team reviews tasks and runs a usage-weighted raffle; a higher score raises your chance." },
  approved: { label: "Approved", tone: "up", detail: "You are on the WL. Mint in the WL phase with your proof (fetched for you on /herd)." },
  waitlist: { label: "Waitlist", tone: "warn", detail: "On the waitlist: if spots free up, the next draw includes you. Keep using Elyia to raise your score." },
  rejected: { label: "Rejected", tone: "dn", detail: "Not approved this time." },
};

/* ------------------------------------------------------------- admin */

/** Wallet list input (comma, space or newline separated) -> unique lowercase addresses, plus the bad entries. */
export function parseWalletList(input: string): { readonly wallets: readonly string[]; readonly invalid: readonly string[] } {
  const entries = input.split(/[\s,;]+/u).map((entry) => entry.trim()).filter(Boolean);
  const wallets = new Set<string>();
  const invalid: string[] = [];
  for (const entry of entries) {
    if (/^0x[0-9a-fA-F]{40}$/u.test(entry)) wallets.add(entry.toLowerCase());
    else invalid.push(entry);
  }
  return { wallets: [...wallets].sort(), invalid };
}

/** "2026-11-09T18:00" (datetime-local, read as UTC) -> unix seconds, or null. */
export function unixSeconds(local: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/u.test(local)) return null;
  const ms = Date.parse(`${local}:00Z`);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

export function toLocalInput(iso: string | null): string {
  return iso ? iso.slice(0, 16) : "";
}

/** The four allocations must fit the supply (with what was burned). */
export function allocationProblem(values: { readonly team: number; readonly wl: number; readonly collab: number; readonly public: number }, maxSupply: number, burned = 0): string | null {
  const parts = [values.team, values.wl, values.collab, values.public];
  if (parts.some((value) => !Number.isInteger(value) || value < 0 || value > 65_535)) return "Each allocation is a whole number.";
  const sum = parts.reduce((total, value) => total + value, 0) + burned;
  return sum > maxSupply ? `They sum to ${sum}, over the ${maxSupply} supply.` : null;
}

/** Tag rules of the API (1-31 of a-z, 0-9, -). */
export function partnerTagProblem(tag: string): string | null {
  return /^[a-z0-9][a-z0-9-]{0,30}$/u.test(tag) ? null : "Tags are 1-31 of a-z, 0-9 and -.";
}

/** A CSV cell is never a spreadsheet formula. */
export function csvSafe(value: string): string {
  return /^[=+\-@]/u.test(value) ? `'${value}` : value;
}

/** "0x5e9e…a13a". */
export function short(value: string | null | undefined): string {
  if (!value) return "—";
  return value.length > 14 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
}

/** Withdraw destinations: the treasury and the owner, listed once each (one entry when they are the same wallet). */
export function withdrawOptions(treasury: string | null | undefined, owner: string | null | undefined): readonly (readonly [string, string])[] {
  const out: (readonly [string, string])[] = [];
  const same = Boolean(treasury && owner && treasury.toLowerCase() === owner.toLowerCase());
  if (treasury) out.push([treasury, same ? `Treasury = owner ${short(treasury)}` : `Treasury ${short(treasury)}`]);
  if (owner && !same) out.push([owner, `Owner ${short(owner)}`]);
  return out;
}
