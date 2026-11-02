/**
 * Before a wallet transaction is sent: run it as an `eth_call` from the
 * sender and, when it would revert, stop with the revert reason instead of
 * asking the wallet to broadcast a transaction that only burns gas. A
 * transport failure (the RPC is down) proves nothing and does not block:
 * the wallet still shows its own estimate.
 */
import { decodeErrorResult, type Address, type Hex } from "viem";

interface ErrorLike {
  readonly name?: unknown;
  readonly message?: unknown;
  readonly shortMessage?: unknown;
  readonly details?: unknown;
  readonly reason?: unknown;
  readonly data?: unknown;
  readonly cause?: unknown;
}

function chain(error: unknown): ErrorLike[] {
  const out: ErrorLike[] = [];
  let current: unknown = error;
  while (current && typeof current === "object" && out.length < 8) {
    out.push(current as ErrorLike);
    current = (current as ErrorLike).cause;
  }
  return out;
}

const REVERT_NAMES = new Set(["ExecutionRevertedError", "ContractFunctionRevertedError", "RawContractError", "CallExecutionError"]);
const TRANSPORT_NAMES = new Set(["HttpRequestError", "TimeoutError", "WebSocketRequestError", "ChainDisconnectedError", "UnknownRpcError"]);

/** Decodes Error(string) / Panic(uint256) revert data; null for custom errors or no data. */
function decodedData(data: unknown): string | null {
  const hex = typeof data === "string" ? data : data && typeof data === "object" && typeof (data as { data?: unknown }).data === "string" ? (data as { data: string }).data : null;
  if (!hex || !/^0x[0-9a-fA-F]{8,}$/u.test(hex)) return null;
  try {
    const decoded = decodeErrorResult({ data: hex as Hex, abi: [] });
    const [first] = decoded.args ?? [];
    return decoded.errorName === "Panic" ? `panic ${String(first)}` : first !== undefined ? String(first) : decoded.errorName;
  } catch {
    return `custom error ${hex.slice(0, 10)}`;
  }
}

/**
 * The revert reason of a failed `eth_call`, or null when the failure is not
 * a revert (a transport problem: the call proves nothing).
 */
export function revertReason(error: unknown): string | null {
  const links = chain(error);
  if (links.length === 0) return null;
  if (links.some((link) => typeof link.name === "string" && TRANSPORT_NAMES.has(link.name))) return null;
  const text = links.map((link) => [link.details, link.shortMessage, link.message].filter((part): part is string => typeof part === "string").join(" ")).join(" ");
  const reverted = links.some((link) => typeof link.name === "string" && REVERT_NAMES.has(link.name)) || /revert|invalid opcode|out of gas|insufficient funds/iu.test(text);
  if (!reverted) return null;
  for (const link of links) {
    if (typeof link.reason === "string" && link.reason.trim()) return link.reason.trim();
    const decoded = decodedData(link.data);
    if (decoded) return decoded;
  }
  for (const link of links) {
    if (typeof link.details === "string" && link.details.trim()) return link.details.trim();
  }
  const match = /(?:reverted with reason string ['"]([^'"]+)['"]|execution reverted:?\s*([^\n.]+)|(invalid opcode[^\n.]*)|(insufficient funds[^\n.]*)|(out of gas))/iu.exec(text);
  return (match?.slice(1).find((part) => part && part.trim())?.trim() ?? "execution reverted").slice(0, 200);
}

export interface PreflightClient {
  call(args: { readonly account: Address; readonly to: Address; readonly data: Hex; readonly value: bigint }): Promise<unknown>;
}

/** Throws a plain-language error when the transaction would revert; returns quietly otherwise. */
export async function preflight(client: PreflightClient | null | undefined, tx: { readonly from: Address; readonly to: Address; readonly data: Hex; readonly value: bigint }, where: string): Promise<void> {
  if (!client) return;
  try {
    await client.call({ account: tx.from, to: tx.to, data: tx.data, value: tx.value });
  } catch (error) {
    const reason = revertReason(error);
    if (reason !== null) throw new Error(`This transaction would revert on ${where} (${reason}), so it was not sent. Nothing moved.`, { cause: error });
  }
}
