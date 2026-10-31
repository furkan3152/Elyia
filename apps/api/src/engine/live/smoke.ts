/**
 * Live, read-only engine smoke against the public testnet RPCs. NEVER
 * broadcasts: every prepared request is run with eth_simulateV1 from a dummy
 * address funded by state overrides (native balance, and the ERC-20 balance
 * slot discovered on-chain), and the simulated logs are fed back through the
 * service's submit path as synthetic receipts, so verification runs on real
 * contract output.
 *
 *   cd apps/api && npx tsx src/engine/live/smoke.ts [scenario ...]
 *
 * Output: one block per scenario (plan, quotes, prepared calls, simulation
 * result, verification verdict).
 */
import { formatAccountId, getEvmNetwork, type AccountId, type EvmTransactionRequest, type IntentActionSpec, type NetworkKey } from "@elyia/core";
import { keccak256, numberToHex, pad, toHex, type Abi, type Address, type ContractFunctionArgs, type ContractFunctionName, type DecodeFunctionResultReturnType, type Hex } from "viem";
import { loadConfig } from "../../config.js";
import { closeContext, createContext } from "../../context.js";
import { balanceMappingSlot, mappingSlot } from "../adapters/evmCommon.js";
import { createEngine } from "../index.js";
import { ChainsEvmPort, type CallRequest, type EvmPort, type SimulatedCall, type SimulationRequest, type TxObservation } from "../ports/evm.js";

const DUMMY = "0x00000000000000000000000000000000000e1a1a" as Address;
const FUNDED_NATIVE = 10n ** 21n;
const FUNDED_TOKEN = 10n ** 30n;

/** Token -> an address known to hold it (balance-slot discovery reference). */
const HOLDERS: Readonly<Record<string, Address>> = {
  "elysium-testnet:0x7d29d8047b905000459c0e80c34a26ceedcb47b2": "0x591aa2ec4275135c640d07f9eaa35cdad52ab05c", // USDC: Kalos WHYPE/USDC pool
  "elysium-testnet:0xcd57f65c2b0e5881cfc2e609f7cd53b746e1f234": "0x591aa2ec4275135c640d07f9eaa35cdad52ab05c", // WHYPE: same pool
  "elysium-testnet:0x8a2201953af29e8be7700bcb53da3ce5cad18726": "0xa7531d7be19f29b991d97eaa17b034715a835e35", // KALOS: the stKALOS vault
  "hyperevm-testnet:0x2b3370ee501b4a559b57d449569354196457d8ab": "0x792487ef5e423104bec94e8c58e814e5e0450cea", // USDC (998): L1 standard gateway escrow
  "elysium-testnet:0xa7531d7be19f29b991d97eaa17b034715a835e35": "0x0000000000000000000000000000000000000000", // stKALOS: filled from a recent Deposit event at run time
};

/**
 * The real port, except that the dummy holds plenty of every asset (reads),
 * simulations fund it, and synthetic receipts built from simulations are
 * observable (submit / verify on simulated logs).
 */
class FundedPort implements EvmPort {
  readonly receipts = new Map<string, Extract<TxObservation, { state: "landed" }>>();
  constructor(private readonly base: EvmPort) {}
  observeTransaction(network: NetworkKey, hash: Hex): Promise<TxObservation> {
    const landed = this.receipts.get(hash.toLowerCase());
    return landed ? Promise.resolve(landed) : this.base.observeTransaction(network, hash);
  }
  call(network: NetworkKey, request: CallRequest) {
    return this.base.call(network, request.from?.toLowerCase() === DUMMY ? { ...request, balances: { ...(request.balances ?? {}), [DUMMY]: FUNDED_NATIVE } } : request);
  }
  read<const abi extends Abi, name extends ContractFunctionName<abi, "pure" | "view">>(
    network: NetworkKey,
    request: { readonly address: Address; readonly abi: abi; readonly functionName: name; readonly args?: ContractFunctionArgs<abi, "pure" | "view", name> },
  ): Promise<DecodeFunctionResultReturnType<abi, name>> {
    const args = (request.args ?? []) as readonly unknown[];
    if (request.functionName === "balanceOf" && String(args[0]).toLowerCase() === DUMMY) return Promise.resolve(FUNDED_TOKEN as DecodeFunctionResultReturnType<abi, name>);
    return this.base.read(network, request);
  }
  estimateGas(network: NetworkKey, request: CallRequest & { readonly from: Address }) {
    return this.base.estimateGas(network, request);
  }
  simulate(network: NetworkKey, request: SimulationRequest) {
    return this.base.simulate(network, request);
  }
  getBalance(network: NetworkKey, address: Address, block?: bigint) {
    return address.toLowerCase() === DUMMY ? Promise.resolve(FUNDED_NATIVE) : this.base.getBalance(network, address, block);
  }
  getBlock(network: NetworkKey, block: bigint | "latest" | Hex) {
    return this.base.getBlock(network, block);
  }
  getLogs(network: NetworkKey, filter: Parameters<EvmPort["getLogs"]>[1]) {
    return this.base.getLogs(network, filter);
  }
  gasPrice(network: NetworkKey) {
    return this.base.gasPrice(network);
  }
  getStorageAt(network: NetworkKey, address: Address, slot: Hex) {
    return this.base.getStorageAt(network, address, slot);
  }
  getCode(network: NetworkKey, address: Address) {
    return this.base.getCode(network, address);
  }
}

interface Scenario {
  readonly name: string;
  readonly home: NetworkKey;
  readonly actions: readonly IntentActionSpec[];
  /** ERC-20 the dummy must hold in the simulation. */
  readonly token?: { readonly network: NetworkKey; readonly address: Address };
  /** The scenario proves a refusal: planning must fail with this code. */
  readonly expectError?: string;
}

const SCENARIOS: readonly Scenario[] = [
  { name: "kalos-hype-usdc", home: "elysium-testnet", actions: [{ kind: "swap", network: "elysium-testnet", from: "HYPE", to: "USDC", amount: "0.01", protocol: "kalos-v3" }] },
  { name: "kalos-usdc-hype", home: "elysium-testnet", actions: [{ kind: "swap", network: "elysium-testnet", from: "USDC", to: "HYPE", amount: "5", protocol: "kalos-v3" }], token: { network: "elysium-testnet", address: "0x7d29d8047b905000459c0e80c34a26ceedcb47b2" } },
  { name: "auction-hype-usdc", home: "elysium-testnet", actions: [{ kind: "swap", network: "elysium-testnet", from: "HYPE", to: "USDC", amount: "0.01" }] },
  { name: "ddc-usdc-hype", home: "elysium-testnet", actions: [{ kind: "swap", network: "elysium-testnet", from: "USDC", to: "HYPE", amount: "5", protocol: "dex-da-costa" }], token: { network: "elysium-testnet", address: "0x7d29d8047b905000459c0e80c34a26ceedcb47b2" } },
  { name: "kalos-usdc-whype", home: "elysium-testnet", actions: [{ kind: "swap", network: "elysium-testnet", from: "USDC", to: "WHYPE", amount: "5", protocol: "kalos-v3" }], token: { network: "elysium-testnet", address: "0x7d29d8047b905000459c0e80c34a26ceedcb47b2" } },
  { name: "ddc-hype-usdc", home: "elysium-testnet", actions: [{ kind: "swap", network: "elysium-testnet", from: "HYPE", to: "USDC", amount: "0.01", protocol: "dex-da-costa" }] },
  { name: "perpme-hype-perpme", home: "elysium-testnet", actions: [{ kind: "swap", network: "elysium-testnet", from: "HYPE", to: "0xD089Ff84573e35626AAe2Cc92d1acFc4B3E225E1", amount: "0.01", protocol: "perpme" }] },
  { name: "signal-buy", home: "elysium-testnet", actions: [{ kind: "swap", network: "elysium-testnet", from: "HYPE", to: "0x8aa6F0835805Ca99f370634415d502ec5c603Baf", amount: "0.01", protocol: "signal" }] },
  { name: "hexswap-hype-hex", home: "elysium-testnet", actions: [{ kind: "swap", network: "elysium-testnet", from: "HYPE", to: "0x26aA352bD4324AA507C924AF9EdD65B2c7BDC1c2", amount: "0.01", protocol: "hexswap" }] },
  { name: "wrap-elysium", home: "elysium-testnet", actions: [{ kind: "swap", network: "elysium-testnet", from: "HYPE", to: "WHYPE", amount: "0.5" }] },
  { name: "unwrap-elysium", home: "elysium-testnet", actions: [{ kind: "swap", network: "elysium-testnet", from: "WHYPE", to: "HYPE", amount: "0.5" }], token: { network: "elysium-testnet", address: "0xcd57f65c2b0e5881cfc2e609f7cd53b746e1f234" } },
  { name: "wrap-hyperevm", home: "hyperevm-testnet", actions: [{ kind: "swap", network: "hyperevm-testnet", from: "HYPE", to: "WHYPE", amount: "0.5" }] },
  { name: "send-bona-ely", home: "elysium-testnet", actions: [{ kind: "transfer", network: "elysium-testnet", from: "HYPE", amount: "0.5", recipient: "bona.ely" }] },
  { name: "send-usdc", home: "elysium-testnet", actions: [{ kind: "transfer", network: "elysium-testnet", from: "USDC", amount: "1", recipient: "0xe49d0d8cf01ea366d804cc84738a768f0b8b175e" }], token: { network: "elysium-testnet", address: "0x7d29d8047b905000459c0e80c34a26ceedcb47b2" } },
  { name: "deposit-eth", home: "hyperevm-testnet", actions: [{ kind: "bridge", network: "hyperevm-testnet", toNetwork: "elysium-testnet", from: "HYPE", amount: "0.2" }] },
  { name: "deposit-usdc", home: "hyperevm-testnet", actions: [{ kind: "bridge", network: "hyperevm-testnet", toNetwork: "elysium-testnet", from: "USDC", amount: "2" }], token: { network: "hyperevm-testnet", address: "0x2b3370ee501b4a559b57d449569354196457d8ab" } },
  { name: "withdraw-eth", home: "elysium-testnet", actions: [{ kind: "bridge", network: "elysium-testnet", toNetwork: "hyperevm-testnet", from: "HYPE", amount: "0.2" }] },
  { name: "withdraw-usdc", home: "elysium-testnet", actions: [{ kind: "bridge", network: "elysium-testnet", toNetwork: "hyperevm-testnet", from: "USDC", amount: "2" }], token: { network: "elysium-testnet", address: "0x7d29d8047b905000459c0e80c34a26ceedcb47b2" } },
  { name: "kinetiq-stake", home: "hyperevm-testnet", actions: [{ kind: "stake", network: "hyperevm-testnet", from: "HYPE", amount: "0.2" }] },
  { name: "hyperswap-hype-usdc", home: "hyperevm-testnet", actions: [{ kind: "swap", network: "hyperevm-testnet", from: "HYPE", to: "USDC", amount: "0.05", protocol: "hyperswap-v3" }] },
  { name: "link-hype-core", home: "hyperevm-testnet", actions: [{ kind: "link", network: "hyperevm-testnet", toNetwork: "hypercore-testnet", from: "HYPE", amount: "0.2" }] },
  { name: "link-usdc-core", home: "hyperevm-testnet", actions: [{ kind: "link", network: "hyperevm-testnet", toNetwork: "hypercore-testnet", from: "USDC", amount: "2" }], token: { network: "hyperevm-testnet", address: "0x2b3370ee501b4a559b57d449569354196457d8ab" } },
  { name: "stkalos-deposit", home: "elysium-testnet", actions: [{ kind: "deposit", network: "elysium-testnet", from: "KALOS", amount: "10", protocol: "kalos-stkalos" }], token: { network: "elysium-testnet", address: "0x8a2201953af29e8be7700bcb53da3ce5cad18726" } },
  { name: "cheshire-usdc-deposit", home: "elysium-testnet", actions: [{ kind: "deposit", network: "elysium-testnet", from: "USDC", amount: "1", protocol: "cheshire" }], token: { network: "elysium-testnet", address: "0x7d29d8047b905000459c0e80c34a26ceedcb47b2" } },
  { name: "elyra-lend-usdc", home: "elysium-testnet", actions: [{ kind: "deposit", network: "elysium-testnet", from: "USDC", amount: "0.02", protocol: "elyra-lending" }], token: { network: "elysium-testnet", address: "0x7d29d8047b905000459c0e80c34a26ceedcb47b2" } },
  { name: "elyra-lend-usdc-capped", home: "elysium-testnet", actions: [{ kind: "deposit", network: "elysium-testnet", from: "USDC", amount: "5", protocol: "elyra-lending" }], token: { network: "elysium-testnet", address: "0x7d29d8047b905000459c0e80c34a26ceedcb47b2" }, expectError: "ROUTE_UNAVAILABLE" },
  { name: "elyra-lend-whype", home: "elysium-testnet", actions: [{ kind: "deposit", network: "elysium-testnet", from: "WHYPE", amount: "0.1", protocol: "elyra-lending" }], token: { network: "elysium-testnet", address: "0xcd57f65c2b0e5881cfc2e609f7cd53b746e1f234" } },
  { name: "stkalos-redeem", home: "elysium-testnet", actions: [{ kind: "withdraw", network: "elysium-testnet", amount: "1000", protocol: "kalos-stkalos" }], token: { network: "elysium-testnet", address: "0xa7531d7be19f29b991d97eaa17b034715a835e35" } },
  { name: "lookalike-usdt-refused", home: "elysium-testnet", actions: [{ kind: "swap", network: "elysium-testnet", from: "HYPE", to: "0xF04e426488A8679D6888ec9FB4922a98Dd2c17b0", amount: "0.01", protocol: "hexswap" }], expectError: "TOKEN_LOOKALIKE" },
  { name: "unregistered-name-refused", home: "elysium-testnet", actions: [{ kind: "transfer", network: "elysium-testnet", from: "HYPE", amount: "0.1", recipient: "nobody-xyz-123.ely" }], expectError: "NAME_UNRESOLVED" },
];

async function rpc(url: string, method: string, params: readonly unknown[]): Promise<{ readonly result?: unknown; readonly error?: { readonly message?: string } }> {
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  return (await response.json()) as { readonly result?: unknown; readonly error?: { readonly message?: string } };
}

const APPROVE = "0x095ea7b3";
/** ERC-20 Transfer(address indexed from, address indexed to, uint256 value). */
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef" as Hex;
const ALLOWANCE = "0xdd62ed3e";

/** Storage key of allowance[owner][spender] for a mapping at `slot`. */
function allowanceKey(owner: Address, spender: Address, slot: bigint): Hex {
  return keccak256(`0x${spender.slice(2).toLowerCase().padStart(64, "0")}${mappingSlot(owner, slot).slice(2)}` as Hex);
}

/** eth_call of each request in order; an approve becomes an allowance override (slot found and checked on-chain) for the calls after it. */
async function callWithOverrides(url: string, requests: readonly EvmTransactionRequest[], storage: Record<string, Record<Hex, Hex>>, token?: { readonly address: Address }): Promise<string[]> {
  const out: string[] = [];
  const state: Record<string, { balance?: Hex; stateDiff?: Record<Hex, Hex> }> = { [DUMMY]: { balance: toHex(FUNDED_NATIVE) } };
  for (const [address, slots] of Object.entries(storage)) state[address] = { stateDiff: { ...slots } };
  for (const request of requests) {
    if (request.data.startsWith(APPROVE) && token && request.to.toLowerCase() === token.address.toLowerCase()) {
      const spender = `0x${request.data.slice(34, 74)}` as Address;
      let applied = false;
      for (const slot of [1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n, 9n, 10n, 52n, 53n]) {
        const key = allowanceKey(DUMMY, spender, slot);
        const trial = { ...state, [token.address]: { stateDiff: { ...(state[token.address]?.stateDiff ?? {}), [key]: pad(numberToHex(10n ** 27n), { size: 32 }) } } };
        const check = await rpc(url, "eth_call", [{ to: token.address, data: `${ALLOWANCE}${DUMMY.slice(2).padStart(64, "0")}${spender.slice(2).padStart(64, "0")}` }, "latest", trial]);
        if (typeof check.result === "string" && BigInt(check.result) === 10n ** 27n) {
          Object.assign(state, trial);
          applied = true;
          out.push(`approve ${spender} -> allowance override (slot ${slot})`);
          break;
        }
      }
      if (!applied) out.push("revert: allowance slot not found");
      continue;
    }
    const result = await rpc(url, "eth_call", [{ from: request.from, to: request.to, data: request.data, value: toHex(BigInt(request.value)) }, "latest", state]);
    out.push(result.error ? `revert ${result.error.message ?? ""}` : `ok return=${String(result.result).slice(0, 130)}`);
  }
  return out;
}

const fmt = (value: unknown) => JSON.stringify(value, (_, v: unknown) => (typeof v === "bigint" ? v.toString() : v));

async function main(): Promise<void> {
  const only = new Set(process.argv.slice(2));
  const config = loadConfig({ ...process.env, LOG_LEVEL: process.env.LOG_LEVEL ?? "error" });
  const ctx = createContext(config);
  const base = new ChainsEvmPort(ctx.chains, ctx.clock);
  const funded = new FundedPort(base);
  const engine = createEngine(ctx, { deps: { evm: funded } });
  const { service, deps, registry } = engine;
  let failures = 0;
  for (const scenario of SCENARIOS) {
    if (only.size > 0 && !only.has(scenario.name)) continue;
    process.stdout.write(`\n== ${scenario.name}\n`);
    try {
      const accounts = [formatAccountId(scenario.home, DUMMY) as AccountId];
      let viaService = true;
      const create = (dryRun: boolean) => service.create({ actions: scenario.actions, accounts, environment: "testnet", signer: "agent", dryRun, source: "structured" });
      let created: Awaited<ReturnType<typeof create>>;
      try {
        created = await create(false);
      } catch (error) {
        const code = (error as { code?: string }).code ?? "";
        if (scenario.expectError && code === scenario.expectError) {
          process.stdout.write(`refused as expected: ${code} ${(error as Error).message}\n`);
          continue;
        }
        if (!code.startsWith("POLICY")) throw error;
        // The Rule Book refused at plan (fail closed: an unpriced test token): dry-run the plan and prepare through the adapter to still prove the calldata.
        process.stdout.write(`plan: Rule Book refused (${code}: ${(error as Error).message}); proving the adapter payload directly\n`);
        created = await create(true);
        viaService = false;
      }
      if (scenario.expectError) throw new Error(`expected ${scenario.expectError}, planning succeeded`);
      const step = created.intent.steps[0];
      if (!step) throw new Error("no step");
      process.stdout.write(`plan: ${created.intent.steps.map((entry) => `${entry.id} ${entry.kind}/${entry.protocol} on ${entry.network}: ${entry.title}`).join(" | ")}\n`);
      process.stdout.write(`policy: ${created.policy.decision} notional=${created.policy.notionalUsd} ${created.policy.reasons.map((reason) => reason.rule).join(",")}\n`);
      for (const quote of created.quotes) process.stdout.write(`quote: ${quote.protocol} expected=${quote.expected} min=${quote.minimum} ${quote.symbol} winner=${quote.winner}${quote.excluded ? ` excluded=${quote.excluded}` : ""}${quote.referenceDeviationBps !== undefined ? ` refDev=${quote.referenceDeviationBps}bps refUsd=${quote.referenceUsd}` : ""}\n`);
      let requests: readonly EvmTransactionRequest[];
      if (viaService) {
        const prepared = await service.prepare(created.intent.id, step.id, { confirmed: true });
        requests = prepared.payload.requests as readonly EvmTransactionRequest[];
      } else {
        const now = deps.clock.now();
        const payload = await registry.forStep(step).prepare({ graph: created.intent, step, amount: BigInt(step.inputs[0]?.expected ?? "0"), now, expiresAt: Math.floor(now / 1000) + 120, signatureChainId: 99801 });
        requests = payload.requests as readonly EvmTransactionRequest[];
      }
      for (const request of requests) process.stdout.write(`request: to=${request.to} value=${request.value} data=${request.data.slice(0, 10)}…(${(request.data.length - 2) / 2} bytes) — ${request.description}\n`);
      const network = requests[0]?.network as NetworkKey;
      const storage: Record<string, Record<Hex, Hex>> = {};
      if (scenario.token) {
        let holder = HOLDERS[`${scenario.token.network}:${scenario.token.address}`] as Address;
        if (/^0x0{40}$/u.test(holder)) {
          // A recent share Transfer names an account that holds shares.
          const head = (await base.getBlock(scenario.token.network, "latest"))?.number ?? 0n;
          for (let window = 0n; window < 10n && /^0x0{40}$/u.test(holder); window += 1n) {
            const logs = await base.getLogs(scenario.token.network, { address: scenario.token.address, topics: [TRANSFER_TOPIC], fromBlock: head - (window + 1n) * 1_500n, toBlock: head - window * 1_500n });
            const owner = logs.map((log) => log.topics[2]).find((topic) => topic !== undefined && !/^0x0{64}$/u.test(topic));
            if (owner) holder = `0x${owner.slice(26)}` as Address;
          }
        }
        const slot = await balanceMappingSlot(deps, scenario.token.network, scenario.token.address, holder);
        if (slot === null) throw new Error("balance slot not found");
        storage[scenario.token.address] = { [mappingSlot(DUMMY, slot)]: pad(numberToHex(10n ** 27n), { size: 32 }) };
      }
      const simulated: SimulatedCall[] | null = await base.simulate(network, {
        calls: requests.map((request) => ({ from: request.from as Address, to: request.to as Address, data: request.data as Hex, value: BigInt(request.value) })),
        balances: { [DUMMY]: FUNDED_NATIVE },
        ...(Object.keys(storage).length > 0 ? { storage } : {}),
      });
      if (!simulated) {
        // HyperEVM's RPC has no eth_simulateV1: eth_call each request with state overrides (approvals applied as allowance overrides).
        const url = (config.networks[network] as { readonly rpcUrls?: readonly string[] }).rpcUrls?.[0] as string;
        const results = await callWithOverrides(url, requests, storage, scenario.token);
        results.forEach((result, index) => process.stdout.write(`eth_call ${index + 1}: ${result}\n`));
        if (results.some((result) => result.startsWith("revert"))) failures += 1;
        continue;
      }
      simulated.forEach((call, index) => {
        process.stdout.write(`simulate ${index + 1}: ${call.status} gas=${call.gasUsed} logs=${call.logs.length}${call.error ? ` error=${call.error}` : ""}\n`);
        if (process.env.SMOKE_LOGS) for (const log of call.logs) process.stdout.write(`  log ${log.address} ${log.topics.join(",")} ${log.data.slice(0, 66)}\n`);
      });
      if (simulated.some((call) => call.status !== "success")) {
        failures += 1;
        continue;
      }
      if (!viaService) continue;
      // Synthetic receipts from the simulation -> submit -> the adapter's verification on the simulated logs.
      const latest = await base.getBlock(network, "latest");
      const chainId = getEvmNetwork(network).chainId;
      const hashes = requests.map((request, index) => keccak256(toHex(`${created.intent.id}:${index}:${request.data}`)));
      requests.forEach((request, index) => {
        const call = simulated[index] as SimulatedCall;
        funded.receipts.set(hashes[index] as string, {
          state: "landed", hash: hashes[index] as Hex, status: "success", from: DUMMY, to: request.to as Address, input: request.data as Hex, value: BigInt(request.value), chainId, nonce: index, type: "0x2",
          blockNumber: latest?.number ?? 1n, blockTimestamp: Math.floor(deps.clock.now() / 1000), logs: call.logs.map((log, logIndex) => ({ ...log, transactionHash: hashes[index] as Hex, blockNumber: latest?.number ?? 1n, logIndex })),
        });
      });
      const submitted = await service.submit(created.intent.id, step.id, hashes);
      process.stdout.write(`verify: ${submitted.verification} -> step ${submitted.step.status}${submitted.step.failure ? ` (${submitted.step.failure.code}: ${submitted.step.failure.message})` : ""}${submitted.step.actualOutputs ? ` actual=${fmt(submitted.step.actualOutputs.map((amount) => `${amount.expected} ${amount.symbol}`))}` : ""}\n`);
      for (const item of submitted.step.evidence.slice(-2)) process.stdout.write(`evidence: ${item.kind} ${item.detail}\n`);
      if (submitted.verification === "failed") failures += 1;
    } catch (error) {
      failures += 1;
      process.stdout.write(`ERROR ${(error as { code?: string }).code ?? ""} ${(error as Error).message}\n`);
    }
  }
  await closeContext(ctx);
  process.stdout.write(`\n${failures === 0 ? "all scenarios simulated" : `${failures} scenario(s) failed`}\n`);
  process.exitCode = failures === 0 ? 0 : 1;
}

void main();
