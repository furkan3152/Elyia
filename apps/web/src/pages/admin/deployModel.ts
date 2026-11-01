/**
 * The owner console's deploy rules, pure (node tests load this file):
 * the five camps state machine, constructor arguments from the manifest,
 * the predicted CREATE address, and the bytecode check. The wallet signs;
 * nothing here holds or sends a key.
 */
import { getContractAddress, type Address } from "viem";

export const DEPLOYABLE = ["ElyiaRouter", "ElyAccountFactory", "ElyOrders", "ElyHerd"] as const;
/** The platform contracts (manifest `order`); ElyHerd is a standalone collection (manifest `collections`). */
export const PLATFORM_DEPLOYABLE = ["ElyiaRouter", "ElyAccountFactory", "ElyOrders"] as const;
export type Deployable = (typeof DEPLOYABLE)[number];

export type AdminNetwork = "elysium-testnet" | "hyperevm-testnet" | "elysium-mainnet";

export interface NetworkOption {
  readonly key: AdminNetwork;
  readonly chainId: number;
  readonly label: string;
  /** Offered for deploys. Mainnet waits until the manifest and the API say it is ready. */
  readonly enabled: boolean;
  readonly note: string;
}

export const NETWORK_OPTIONS: readonly NetworkOption[] = [
  { key: "elysium-testnet", chainId: 99801, label: "Elysium testnet · 99801", enabled: true, note: "Manifest + server plan" },
  { key: "hyperevm-testnet", chainId: 998, label: "HyperEVM testnet · 998", enabled: true, note: "Server plan only (the manifest is for 99801)" },
  { key: "elysium-mainnet", chainId: 99901, label: "Elysium mainnet · 99901 · Nov 9", enabled: false, note: "Disabled: no mainnet venue list in the manifest yet" },
];

/* ------------------------------------------------------------ the camps */

export const CAMPS = [
  { id: "preview", title: "Preview", detail: "args, gas, predicted address", stamp: "Ready" },
  { id: "sign", title: "Wallet signature", detail: "you sign in your wallet", stamp: "Signed" },
  { id: "receipt", title: "Receipt", detail: "mined, status 1", stamp: "Mined" },
  { id: "bytecode", title: "Bytecode verified", detail: "matches the artifact", stamp: "Match" },
  { id: "record", title: "Recorded", detail: "live in /config/contracts", stamp: "Recorded" },
] as const;
export type CampId = (typeof CAMPS)[number]["id"];

export interface DeployPreview {
  readonly contract: Deployable;
  readonly network: AdminNetwork;
  readonly chainId: number;
  readonly from: string;
  readonly nonce: number;
  readonly predicted: string;
  readonly data: `0x${string}`;
  readonly gas: bigint | null;
  readonly gasPriceWei: bigint | null;
  readonly args: readonly { readonly name: string; readonly value: string }[];
  /** eth_call of the creation code: returned runtime size in bytes, or null when the call failed. */
  readonly simulatedSize: number | null;
  readonly simulationError: string | null;
  /** The server's plan builds the same creation data (null: no server plan to compare). */
  readonly matchesServerPlan: boolean | null;
}

export interface DeployReceipt {
  readonly hash: string;
  readonly blockNumber: string;
  readonly address: string;
  readonly gasUsed: string;
}

export type CodeCheck = { readonly verdict: "exact" | "immutables"; readonly differing: number } | { readonly verdict: "mismatch"; readonly reason: string };

export type DeployState =
  | { readonly phase: "idle" }
  | { readonly phase: "previewing" }
  | { readonly phase: "ready"; readonly preview: DeployPreview }
  | { readonly phase: "signing"; readonly preview: DeployPreview }
  | { readonly phase: "pending"; readonly preview: DeployPreview; readonly hash: string }
  | { readonly phase: "verifying"; readonly preview: DeployPreview; readonly receipt: DeployReceipt }
  | { readonly phase: "recording"; readonly preview: DeployPreview; readonly receipt: DeployReceipt; readonly code: CodeCheck }
  | { readonly phase: "done"; readonly preview: DeployPreview; readonly receipt: DeployReceipt; readonly code: CodeCheck; readonly recordedAt: string }
  | { readonly phase: "failed"; readonly camp: CampId; readonly error: string; readonly previous: DeployState };

export type DeployEvent =
  | { readonly type: "preview" }
  | { readonly type: "previewed"; readonly preview: DeployPreview }
  | { readonly type: "sign" }
  | { readonly type: "sent"; readonly hash: string }
  | { readonly type: "mined"; readonly receipt: DeployReceipt }
  | { readonly type: "checked"; readonly code: CodeCheck }
  | { readonly type: "recorded"; readonly at: string }
  | { readonly type: "fail"; readonly error: string }
  | { readonly type: "reset" };

/** The camp a failure in `phase` belongs to. */
export function campOfPhase(phase: DeployState["phase"]): CampId {
  switch (phase) {
    case "idle":
    case "previewing":
    case "ready":
      return "preview";
    case "signing":
      return "sign";
    case "pending":
      return "receipt";
    case "verifying":
      return "bytecode";
    default:
      return "record";
  }
}

/** The deploy state machine. Events out of order are ignored (the state stays as it is). */
export function deployReducer(state: DeployState, event: DeployEvent): DeployState {
  if (event.type === "reset") return { phase: "idle" };
  if (event.type === "fail") return state.phase === "failed" ? state : { phase: "failed", camp: campOfPhase(state.phase), error: event.error, previous: state };
  switch (state.phase) {
    case "idle":
    case "failed":
      if (event.type === "preview") return { phase: "previewing" };
      if (event.type === "sign" && state.phase === "failed" && "preview" in state.previous) return { phase: "signing", preview: state.previous.preview };
      return state;
    case "previewing":
      return event.type === "previewed" ? { phase: "ready", preview: event.preview } : state;
    case "ready":
      if (event.type === "sign") return { phase: "signing", preview: state.preview };
      if (event.type === "preview") return { phase: "previewing" };
      return state;
    case "signing":
      return event.type === "sent" ? { phase: "pending", preview: state.preview, hash: event.hash } : state;
    case "pending":
      return event.type === "mined" ? { phase: "verifying", preview: state.preview, receipt: event.receipt } : state;
    case "verifying":
      if (event.type !== "checked") return state;
      if (event.code.verdict === "mismatch") return { phase: "failed", camp: "bytecode", error: event.code.reason, previous: state };
      return { phase: "recording", preview: state.preview, receipt: state.receipt, code: event.code };
    case "recording":
      return event.type === "recorded" ? { phase: "done", preview: state.preview, receipt: state.receipt, code: state.code, recordedAt: event.at } : state;
    case "done":
      return state;
  }
}

/** Camps settled so far (0-5): each stamp thumps only when the chain or the server proved it. */
export function campsDone(state: DeployState): number {
  switch (state.phase) {
    case "ready":
    case "signing":
      return 1;
    case "pending":
      return 2;
    case "verifying":
      return 3;
    case "recording":
      return 4;
    case "done":
      return 5;
    case "failed":
      return campsDone(state.previous);
    default:
      return 0;
  }
}

export type ContractStamp = "Not deployed" | "Deploying" | "Deployed" | "Verified";

/** The contract card's stamp while (or after) a deploy runs. */
export function stampOf(state: DeployState, recordedAddress: string | null): ContractStamp {
  if (state.phase === "done") return "Verified";
  if (state.phase === "verifying" || state.phase === "recording") return "Deployed";
  if (state.phase === "signing" || state.phase === "pending") return "Deploying";
  return recordedAddress ? "Verified" : "Not deployed";
}

/** What the wallet mock says in each phase. */
export function walletPhase(state: DeployState): "preview" | "request" | "pending" | "confirmed" | "failed" {
  switch (state.phase) {
    case "signing":
      return "request";
    case "pending":
      return "pending";
    case "verifying":
    case "recording":
    case "done":
      return "confirmed";
    case "failed":
      return "failed";
    default:
      return "preview";
  }
}

/* -------------------------------------------------- constructor arguments */

export interface ManifestArg {
  readonly name: string;
  readonly type: string;
  readonly value: unknown;
}

export type ResolvedArgs = { readonly ok: true; readonly values: readonly unknown[]; readonly shown: readonly { readonly name: string; readonly value: string }[] } | { readonly ok: false; readonly missing: readonly string[] };

/**
 * Resolves the manifest's placeholders: `$OWNER` is the connected wallet,
 * `$<Contract>` the recorded address of an earlier step (from
 * /v1/config/contracts). Never invents a value: anything unknown is missing.
 */
export function resolveArgs(args: readonly ManifestArg[], owner: string | null, deployed: Readonly<Partial<Record<string, string>>>, params: Readonly<Partial<Record<string, string>>> = {}): ResolvedArgs {
  const values: unknown[] = [];
  const shown: { name: string; value: string }[] = [];
  const missing: string[] = [];
  for (const arg of args) {
    let value: unknown = arg.value;
    if (value === "$OWNER") value = owner;
    else if (typeof value === "string" && value.startsWith("$PARAM.")) {
      const param = params[value.slice(7)]?.trim();
      value = param && /^0x[0-9a-fA-F]{40}$/u.test(param) ? param : null;
      if (value === null) {
        missing.push(`${String(arg.value).slice(7)} (enter it below)`);
        continue;
      }
    } else if (typeof value === "string" && value.startsWith("$")) value = deployed[value.slice(1)] ?? null;
    if (value === null || value === undefined) {
      missing.push(arg.value === "$OWNER" ? "your wallet address" : `${String(arg.value).slice(1)} address (deploy and record it first)`);
      continue;
    }
    values.push(value);
    shown.push({ name: arg.name, value: Array.isArray(value) ? `${value.length} items` : String(value) });
  }
  return missing.length > 0 ? { ok: false, missing } : { ok: true, values, shown };
}

/** `$PARAM.<name>` inputs a manifest step needs (the admin enters them; never guessed). */
export function paramNames(args: readonly ManifestArg[]): string[] {
  return args.flatMap((arg) => (typeof arg.value === "string" && arg.value.startsWith("$PARAM.") ? [arg.value.slice(7)] : []));
}

/** The address a CREATE from `from` at `nonce` lands on. */
export function predictAddress(from: string, nonce: number): string {
  return getContractAddress({ from: from as Address, nonce: BigInt(nonce) });
}

/* ----------------------------------------------------------- bytecode */

function strip0x(hex: string): string {
  return (hex.startsWith("0x") ? hex.slice(2) : hex).toLowerCase();
}

/** Runtime code without the trailing CBOR metadata (its length is the last two bytes). */
export function stripMetadata(hex: string): string {
  const code = strip0x(hex);
  if (code.length < 4) return code;
  const length = Number.parseInt(code.slice(-4), 16);
  const total = (length + 2) * 2;
  return Number.isFinite(length) && total <= code.length && length > 0 && length < 256 ? code.slice(0, code.length - total) : code;
}

/**
 * On-chain runtime code against the artifact's (immutables zero-filled):
 * equal except metadata -> exact; differing only where the artifact has zero
 * bytes -> immutables; anything else -> mismatch.
 */
export function compareRuntimeCode(onchain: string | null | undefined, artifact: string): CodeCheck {
  if (!onchain || strip0x(onchain).length === 0) return { verdict: "mismatch", reason: "No code at the address." };
  const a = stripMetadata(onchain);
  const b = stripMetadata(artifact);
  if (a.length !== b.length) return { verdict: "mismatch", reason: `Code size differs: ${a.length / 2} bytes on chain, ${b.length / 2} in the artifact.` };
  let differing = 0;
  for (let i = 0; i < a.length; i += 2) {
    const x = a.slice(i, i + 2);
    const y = b.slice(i, i + 2);
    if (x === y) continue;
    if (y !== "00") return { verdict: "mismatch", reason: `Byte ${i / 2} differs outside an immutable slot.` };
    differing += 1;
  }
  return differing === 0 ? { verdict: "exact", differing: 0 } : { verdict: "immutables", differing };
}

/** "0x5E1d…A9c2". */
export function shortHex(value: string | null | undefined, head = 4, tail = 4): string {
  if (!value) return "—";
  return value.length <= head + tail + 2 ? value : `${value.slice(0, head + 2)}…${value.slice(-tail)}`;
}

/** Init code size: "23.4 KB". */
export function codeSize(hex: string): string {
  return `${(strip0x(hex).length / 2 / 1024).toFixed(1)} KB`;
}

/** Wei -> "0.0031" (native units, 4 significant decimals). */
export function formatNative(wei: bigint): string {
  const whole = Number(wei) / 1e18;
  if (whole === 0) return "0";
  if (whole < 0.0001) return "<0.0001";
  return whole.toFixed(4);
}
