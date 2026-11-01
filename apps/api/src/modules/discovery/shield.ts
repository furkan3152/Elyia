/**
 * Shield: what can be proven about a token before anyone trades it.
 *
 *   registry   Elyia's verified list, the flagged look-alikes / suspicious
 *              tokens (FLAGGED_TOKENS) and registry contracts at the address
 *   bytecode   code present; EIP-1167 clones and EIP-1967 proxies (their
 *              implementation and admin); privileged selectors (mint, pause,
 *              blacklist, fees, upgrades) in the code the token runs
 *   owner      owner(): renounced or not
 *   buy, sell  a dry-run plan through an executable engine venue, its
 *              unsigned requests run with eth_simulateV1 from a dummy
 *              account funded by state overrides: buy, approve, sell in one
 *              simulated block. Nothing is signed or broadcast.
 *
 * Never "safe": the best verdict without registry evidence is
 * `no-red-flags`, and only when every check ran. Reports are cached
 * SHIELD_CACHE_MS per token; concurrent requests share one inspection.
 */
import {
  assessToken,
  erc20AssetId,
  flaggedToken,
  formatAccountId,
  fromBaseUnits,
  getEvmNetwork,
  getToken,
  NETWORKS,
  protocolsTouching,
  type AccountId,
  type IntentActionSpec,
  type IntentGraph,
  type IntentStep,
  type NetworkKey,
} from "@elyia/core";
import type { AddressTouch, ShieldCheck, ShieldReport, ShieldSimulation, ShieldVerdict } from "@elyia/core/api/discovery";
import type { Address, Hex } from "viem";
import type { Clock } from "../../clock.js";
import type { Engine } from "../../engine/index.js";
import type { SimulatedCall } from "../../engine/ports/evm.js";
import { SIGNAL_V4, V2_VENUES, V3_VENUES } from "../../engine/venues.js";
import type { Logger } from "../../log.js";
import type { DiscoveryRpc } from "./rpc.js";

export const SHIELD_CACHE_MS = 5 * 60_000;
/** The dummy account simulations run from (never a real key). */
export const SHIELD_ACCOUNT = "0x00000000000000000000000000000000005e1d00" as Address;
export const SHIELD_FUNDS = 10n ** 21n;
/** HYPE spent by the simulated buy. */
export const SHIELD_BUY_HYPE = "0.01";
/** Buy or sell losses above this (bps) against the quote read as a transfer tax. */
export const TAX_WARN_BPS = 500;
export const TAX_FAIL_BPS = 2_000;

const EIP1967_IMPLEMENTATION = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc" as Hex;
const EIP1967_ADMIN = "0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103" as Hex;
const EIP1967_BEACON = "0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50" as Hex;
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const OWNER_SELECTOR = "0x8da5cb5b" as Hex;
const IMPLEMENTATION_SELECTOR = "0x5c60da1b" as Hex;

/** Selectors whose presence gives someone power over holders. */
export const PRIVILEGED_SELECTORS: Readonly<Record<string, string>> = Object.freeze({
  "40c10f19": "mint(address,uint256)",
  a0712d68: "mint(uint256)",
  "8456cb59": "pause()",
  f9f92be4: "blacklist(address)",
  "44337ea1": "addToBlacklist(address)",
  "0ecb93c0": "addBlackList(address)",
  "69fe0e2d": "setFee(uint256)",
  c0246668: "excludeFromFee(address,bool)",
  ec28438a: "setMaxTxAmount(uint256)",
  "3659cfe6": "upgradeTo(address)",
  "4f1ef286": "upgradeToAndCall(address,bytes)",
  "9dc29fac": "burn(address,uint256)",
});

export const SHIELD_DISCLAIMER = "Shield reports what it could check on chain right now. It is not an audit, and no verdict means a token is safe.";

function wordToAddress(word: Hex | null): string | null {
  if (!word || word.length < 66) return null;
  const address = `0x${word.slice(-40).toLowerCase()}`;
  return /^0x0{40}$/u.test(address) ? null : address;
}

/** Selectors pushed by PUSH4 in the bytecode. */
export function privilegedIn(code: Hex): string[] {
  const hex = code.toLowerCase();
  return Object.entries(PRIVILEGED_SELECTORS)
    .filter(([selector]) => hex.includes(`63${selector}`))
    .map(([, signature]) => signature);
}

/** EIP-1167 minimal proxy target, or null. */
export function cloneTarget(code: Hex): string | null {
  const match = /^0x363d3d373d3d3d363d73([0-9a-f]{40})5af43d82803e903d91602b57fd5bf3$/iu.exec(code);
  return match ? `0x${(match[1] as string).toLowerCase()}` : null;
}

function bps(expected: bigint, actual: bigint): number {
  if (expected <= 0n) return 0;
  const loss = expected - actual;
  return loss <= 0n ? 0 : Number((loss * 10_000n) / expected);
}

/** Sum (or, with `largest`, the largest single amount) of `token` Transfer logs matching the filter. */
function transferred(calls: readonly SimulatedCall[], token: string, filter: { readonly from?: string; readonly to?: string; readonly largest?: boolean }): bigint {
  let total = 0n;
  for (const call of calls) {
    for (const log of call.logs) {
      if (log.address.toLowerCase() !== token || log.topics[0] !== TRANSFER_TOPIC) continue;
      const from = `0x${(log.topics[1] ?? "").slice(26)}`.toLowerCase();
      const to = `0x${(log.topics[2] ?? "").slice(26)}`.toLowerCase();
      if (filter.from && from !== filter.from) continue;
      if (filter.to && to !== filter.to) continue;
      const amount = BigInt(log.data === "0x" ? 0 : log.data);
      total = filter.largest ? (amount > total ? amount : total) : total + amount;
    }
  }
  return total;
}

export interface ShieldOptions {
  readonly rpc: DiscoveryRpc;
  readonly clock: Clock;
  readonly log: Logger;
  /** The engine used for dry-run plans (its EVM port funds SHIELD_ACCOUNT on reads). */
  readonly engine: () => Engine;
  readonly cacheMs?: number;
}

interface Inspection {
  readonly checks: ShieldCheck[];
  readonly simulation: ShieldSimulation | null;
}

export class Shield {
  private readonly cache = new Map<string, { readonly at: number; readonly report: ShieldReport }>();
  private readonly inflight = new Map<string, Promise<ShieldReport>>();

  constructor(private readonly options: ShieldOptions) {}

  inspect(network: NetworkKey, address: string): Promise<ShieldReport> {
    const key = `${network}:${address.toLowerCase()}`;
    const cached = this.cache.get(key);
    if (cached && this.options.clock.now() - cached.at < (this.options.cacheMs ?? SHIELD_CACHE_MS)) return Promise.resolve(cached.report);
    let running = this.inflight.get(key);
    if (!running) {
      running = this.run(network, address.toLowerCase())
        .then((report) => {
          if (this.cache.size > 2_000) this.cache.delete(this.cache.keys().next().value as string);
          this.cache.set(key, { at: this.options.clock.now(), report });
          return report;
        })
        .finally(() => this.inflight.delete(key));
      this.inflight.set(key, running);
    }
    return running;
  }

  private async run(network: NetworkKey, address: string): Promise<ShieldReport> {
    const { rpc } = this.options;
    const checks: ShieldCheck[] = [];
    const check = (entry: ShieldCheck) => checks.push(entry);
    const name = NETWORKS[network].name;

    const listed = getToken(erc20AssetId(network, address));
    const flagged = flaggedToken(network, address);
    const touches: AddressTouch[] = protocolsTouching(address, network).map((touch) => ({ protocolId: touch.protocol.id, protocolName: touch.protocol.name, network: touch.network, deploymentStatus: touch.deploymentStatus, contract: touch.contract }));

    const code = await rpc.getCode(network, address).catch(() => null);
    const bytes = code === null ? null : (code.length - 2) / 2;
    const meta = bytes ? await rpc.tokenMetadata(network, address).catch(() => ({ name: null, symbol: null, decimals: null, totalSupply: null })) : { name: null, symbol: null, decimals: null, totalSupply: null };
    const trust = assessToken({ network, address, ...(meta.symbol ? { symbol: meta.symbol } : {}), ...(meta.name ? { name: meta.name } : {}) });
    const warning = trust.status === "verified" ? null : trust.warning;

    check(listed
      ? { id: "registry", status: "pass", title: "In Elyia's verified token list", detail: `${listed.symbol} on ${name} (${listed.evidence ?? "registry"}).` }
      : { id: "registry", status: "warn", title: "Not in Elyia's verified token list", detail: `Unverified on ${name}: anyone can deploy a token with any name.` });
    if (flagged) check({ id: "lookalike", status: "fail", title: flagged.tags.includes("lookalike") ? "Known look-alike" : "Known suspicious token", detail: `${flagged.reason} (${flagged.evidence}).` });
    else if (trust.status === "lookalike") check({ id: "lookalike", status: "fail", title: "Calls itself like a verified token", detail: trust.warning });
    else check({ id: "lookalike", status: "pass", title: "Not a known look-alike", detail: listed ? "The verified address itself." : "Its name and symbol do not imitate a verified token, and it is not on the flagged list." });

    if (bytes === null) check({ id: "bytecode", status: "skipped", title: "Bytecode not read", detail: `${name} did not answer eth_getCode.` });
    else if (bytes === 0) check({ id: "bytecode", status: "fail", title: "No contract at this address", detail: "eth_getCode returned no bytecode: it is a wallet or nothing." });
    else check({ id: "bytecode", status: "pass", title: "Contract bytecode present", detail: `${bytes} bytes.` });

    let proxy: ShieldReport["bytecode"]["proxy"] = null;
    let runningCode = code;
    if (code && bytes) {
      const clone = cloneTarget(code);
      if (clone) proxy = { kind: "eip1167", implementation: clone, admin: null };
      else {
        const [implementation, admin, beacon] = await Promise.all([EIP1967_IMPLEMENTATION, EIP1967_ADMIN, EIP1967_BEACON].map((slot) => rpc.getStorageAt(network, address, slot).catch(() => null)));
        const implementationAddress = wordToAddress(implementation ?? null);
        const beaconAddress = wordToAddress(beacon ?? null);
        if (implementationAddress) proxy = { kind: "eip1967", implementation: implementationAddress, admin: wordToAddress(admin ?? null) };
        else if (beaconAddress) {
          const fromBeacon = await rpc.call(network, { to: beaconAddress, data: IMPLEMENTATION_SELECTOR });
          proxy = { kind: "eip1967-beacon", implementation: wordToAddress(fromBeacon), admin: beaconAddress };
        }
      }
      if (proxy?.implementation) runningCode = await rpc.getCode(network, proxy.implementation).catch(() => code);
    }
    if (proxy) {
      check({
        id: "proxy",
        status: proxy.kind === "eip1167" ? "pass" : "warn",
        title: proxy.kind === "eip1167" ? "Minimal clone (not upgradeable)" : "Upgradeable proxy",
        detail: proxy.kind === "eip1167"
          ? `Runs the fixed code of ${proxy.implementation}.`
          : `Runs ${proxy.implementation ?? "an unreadable implementation"}${proxy.admin ? `; ${proxy.admin} can change it` : ""}: the rules can change after you buy.`,
      });
    } else if (bytes) check({ id: "proxy", status: "pass", title: "Not a proxy", detail: "No EIP-1167 clone code and empty EIP-1967 slots." });

    const privileged = runningCode ? privilegedIn(runningCode) : [];
    const ownerWord = bytes ? await rpc.call(network, { to: address, data: OWNER_SELECTOR }) : null;
    const ownerAddress = ownerWord && ownerWord.length >= 66 ? wordToAddress(ownerWord) : null;
    const renounced = ownerWord && ownerWord.length >= 66 ? ownerAddress === null : null;
    if (renounced === null) check({ id: "owner", status: bytes ? "pass" : "skipped", title: bytes ? "No owner() getter" : "Owner not read", detail: bytes ? "The token exposes no owner (control may still sit elsewhere, e.g. roles)." : "No contract." });
    else if (renounced) check({ id: "owner", status: "pass", title: "Ownership renounced", detail: "owner() is the zero address." });
    else check({ id: "owner", status: "warn", title: "Has an owner", detail: `owner() = ${ownerAddress}.` });
    if (privileged.length === 0) check({ id: "privileges", status: bytes ? "pass" : "skipped", title: "No privileged selectors found", detail: bytes ? "No mint, pause, blacklist, fee or upgrade function selector in the code it runs." : "No contract." });
    else check({ id: "privileges", status: renounced === true && !privileged.some((entry) => entry.startsWith("upgrade")) ? "warn" : "fail", title: "Privileged functions present", detail: `${privileged.join(", ")}${renounced === true ? " (owner renounced, but roles may remain)" : ""}.` });

    if (bytes) {
      check(meta.symbol !== null && meta.decimals !== null
        ? { id: "metadata", status: "pass", title: "Answers as an ERC-20", detail: `${meta.symbol}${meta.name ? ` (${meta.name})` : ""}, ${meta.decimals} decimals${meta.totalSupply !== null ? `, supply ${fromBaseUnits(meta.totalSupply, meta.decimals)}` : ""}.` }
        : { id: "metadata", status: "fail", title: "Does not answer as an ERC-20", detail: "symbol() or decimals() is missing." });
    }

    const inspection: Inspection = flagged || listed || !bytes || meta.decimals === null
      ? { checks, simulation: null }
      : await this.simulate(network, address, meta.decimals, checks);
    if (!inspection.simulation && !checks.some((entry) => entry.id === "buy")) {
      check({ id: "buy", status: "skipped", title: "Buy not simulated", detail: listed ? "Verified token: no simulation needed." : flagged ? "Flagged token: Elyia never routes it." : "Not a token Elyia can route." });
      check({ id: "sell", status: "skipped", title: "Sell not simulated", detail: "See the buy check." });
    }

    const verdict = this.verdictOf(checks, { listed: listed !== null, flagged: flagged !== null || trust.status === "lookalike" });
    return {
      network,
      token: { address, symbol: meta.symbol ?? listed?.symbol ?? flagged?.symbol ?? null, name: meta.name ?? listed?.name ?? flagged?.name ?? null, decimals: meta.decimals ?? listed?.decimals ?? null, totalSupply: meta.totalSupply === null ? null : meta.totalSupply.toString() },
      verdict,
      summary: SUMMARY[verdict],
      registry: { verified: listed !== null, flagged, protocols: touches, warning },
      bytecode: { bytes, proxy, privileged },
      owner: { address: ownerAddress, renounced },
      simulation: inspection.simulation,
      checks,
      checkedAt: new Date(this.options.clock.now()).toISOString(),
      cacheSeconds: Math.round((this.options.cacheMs ?? SHIELD_CACHE_MS) / 1000),
      disclaimer: SHIELD_DISCLAIMER,
    };
  }

  private verdictOf(checks: readonly ShieldCheck[], facts: { readonly listed: boolean; readonly flagged: boolean }): ShieldVerdict {
    if (facts.flagged) return "flagged";
    if (facts.listed) return "verified";
    if (checks.some((entry) => entry.status === "fail")) return "danger";
    if (checks.some((entry) => entry.id === "buy" && entry.status === "skipped") || checks.some((entry) => entry.id === "sell" && entry.status === "skipped")) {
      return checks.some((entry) => entry.status === "warn") ? "caution" : "unknown";
    }
    // Registry "not verified" is always a warn; anything else that warns makes it caution.
    if (checks.some((entry) => entry.status === "warn" && entry.id !== "registry")) return "caution";
    return "no-red-flags";
  }

  /** Buy then sell through the first engine venue that plans it, in one eth_simulateV1. */
  private async simulate(network: NetworkKey, token: string, decimals: number, checks: ShieldCheck[]): Promise<Inspection> {
    const engine = this.options.engine();
    const venues = [...V3_VENUES, ...V2_VENUES, SIGNAL_V4].filter((venue) => venue.network === network).map((venue) => venue.id);
    const account = formatAccountId(network, SHIELD_ACCOUNT) as AccountId;
    const environment = NETWORKS[network].environment;
    const plan = (action: IntentActionSpec) => engine.service.create({ actions: [action], accounts: [account], environment, signer: "agent", dryRun: true, source: "structured" });
    const prepare = async (graph: IntentGraph, step: IntentStep) => {
      const now = engine.deps.clock.now();
      return engine.registry.forStep(step).prepare({ graph, step, amount: BigInt(step.route?.plannedInput ?? step.inputs[0]?.expected ?? "0"), now, expiresAt: Math.floor(now / 1000) + 120, signatureChainId: getEvmNetwork(network).chainId });
    };
    const failures: string[] = [];
    for (const venue of venues) {
      let buyGraph: IntentGraph;
      try {
        buyGraph = (await plan({ kind: "swap", network, from: "HYPE", to: token, amount: SHIELD_BUY_HYPE, protocol: venue })).intent;
      } catch (error) {
        failures.push(`${venue}: ${(error as { code?: string }).code ?? "error"}`);
        continue;
      }
      const buyStep = buyGraph.steps[0] as IntentStep;
      const quoted = BigInt(buyStep.outputs[0]?.expected ?? "0");
      const minimum = BigInt(buyStep.outputs[0]?.minimum ?? "0");
      let buyRequests;
      try {
        buyRequests = (await prepare(buyGraph, buyStep)).requests as readonly { from: string; to: string; data: Hex; value: string }[];
      } catch (error) {
        failures.push(`${venue}: prepare ${(error as { code?: string }).code ?? "error"}`);
        continue;
      }
      let sellRequests: readonly { from: string; to: string; data: Hex; value: string }[] = [];
      let sellError: string | null = null;
      if (venue === SIGNAL_V4.id) sellError = "Signal routes are buy-only in Elyia: the sell is not simulated.";
      else {
        try {
          const sellGraph = (await plan({ kind: "swap", network, from: token, to: "HYPE", amount: fromBaseUnits(minimum, decimals), protocol: venue })).intent;
          const sellStep = sellGraph.steps[0] as IntentStep;
          sellRequests = (await prepare(sellGraph, sellStep)).requests as typeof sellRequests;
        } catch (error) {
          sellError = `The venue would not plan the sell back (${(error as { code?: string }).code ?? "error"}: ${(error as Error).message.slice(0, 120)}).`;
        }
      }
      const calls = [...buyRequests, ...sellRequests].map((request) => ({ from: SHIELD_ACCOUNT, to: request.to as Address, data: request.data, value: BigInt(request.value) }));
      const simulated = await engine.deps.evm.simulate(network, { calls, balances: { [SHIELD_ACCOUNT]: SHIELD_FUNDS } }).catch(() => null);
      if (!simulated) {
        checks.push({ id: "route", status: "pass", title: `Routable on ${venue}`, detail: `A dry-run plan quotes ${fromBaseUnits(quoted, decimals)} for ${SHIELD_BUY_HYPE} HYPE.` });
        checks.push({ id: "buy", status: "skipped", title: "Buy not simulated", detail: `${NETWORKS[network].name}'s RPC offers no eth_simulateV1.` });
        checks.push({ id: "sell", status: "skipped", title: "Sell not simulated", detail: "See the buy check." });
        return { checks, simulation: null };
      }
      const buyCalls = simulated.slice(0, buyRequests.length);
      const sellCalls = simulated.slice(buyRequests.length);
      const buyOk = buyCalls.length > 0 && buyCalls.every((call) => call.status === "success");
      const received = buyOk ? transferred(buyCalls, token, { to: SHIELD_ACCOUNT.toLowerCase() }) : null;
      const buyTax = received === null ? null : bps(quoted, received);
      const sellOk = sellRequests.length > 0 && sellCalls.length === sellRequests.length && sellCalls.every((call) => call.status === "success");
      // A fee-on-transfer token splits the sell: the largest piece is what reached the pool.
      const sent = sellOk ? transferred(sellCalls, token, { from: SHIELD_ACCOUNT.toLowerCase(), largest: true }) : null;
      const sellFailure = sellCalls.find((call) => call.status !== "success");
      const sellTax = sellOk && sent !== null && sent > 0n ? bps(minimum, sent) : null;
      checks.push({ id: "route", status: "pass", title: `Routable on ${venue}`, detail: `A dry-run plan quotes ${fromBaseUnits(quoted, decimals)} for ${SHIELD_BUY_HYPE} HYPE (testnet pool prices are fake).` });
      checks.push(!buyOk
        ? { id: "buy", status: "fail", title: "The simulated buy reverts", detail: buyCalls.find((call) => call.status !== "success")?.error ?? "Reverted." }
        : buyTax !== null && buyTax >= TAX_FAIL_BPS
          ? { id: "buy", status: "fail", title: "Heavy buy tax", detail: `Received ${(buyTax / 100).toFixed(2)}% less than quoted.` }
          : buyTax !== null && buyTax >= TAX_WARN_BPS
            ? { id: "buy", status: "warn", title: "Buy tax", detail: `Received ${(buyTax / 100).toFixed(2)}% less than quoted.` }
            : { id: "buy", status: "pass", title: "The simulated buy works", detail: `Received ${fromBaseUnits(received ?? 0n, decimals)} as quoted.` });
      if (sellError) checks.push({ id: "sell", status: venue === SIGNAL_V4.id ? "skipped" : "fail", title: venue === SIGNAL_V4.id ? "Sell not simulated" : "No way to sell back", detail: sellError });
      else if (!buyOk) checks.push({ id: "sell", status: "skipped", title: "Sell not simulated", detail: "The buy failed first." });
      else if (!sellOk) checks.push({ id: "sell", status: "fail", title: "The simulated sell reverts (possible honeypot)", detail: sellFailure?.error ?? "Reverted after a successful buy." });
      else if (sellTax !== null && sellTax >= TAX_FAIL_BPS) checks.push({ id: "sell", status: "fail", title: "Heavy sell tax", detail: `${(sellTax / 100).toFixed(2)}% of the tokens sold never reached the pool.` });
      else if (sellTax !== null && sellTax >= TAX_WARN_BPS) checks.push({ id: "sell", status: "warn", title: "Sell tax", detail: `${(sellTax / 100).toFixed(2)}% of the tokens sold never reached the pool.` });
      else checks.push({ id: "sell", status: "pass", title: "The simulated sell works", detail: `Sold ${fromBaseUnits(minimum, decimals)} back to HYPE in the same simulated block.` });
      return {
        checks,
        simulation: {
          venue,
          method: "eth_simulateV1",
          buy: { ok: buyOk, amountIn: SHIELD_BUY_HYPE, inSymbol: "HYPE", quoted: quoted.toString(), received: received === null ? null : received.toString(), taxBps: buyTax, gasUsed: buyCalls.reduce((sum, call) => sum + call.gasUsed, 0n).toString(), ...(buyOk ? {} : { error: buyCalls.find((call) => call.status !== "success")?.error ?? "reverted" }) },
          sell: sellRequests.length === 0
            ? null
            : { ok: sellOk, amountIn: minimum.toString(), delivered: sent === null ? null : sent.toString(), taxBps: sellTax, gasUsed: sellCalls.reduce((sum, call) => sum + call.gasUsed, 0n).toString(), ...(sellOk ? {} : { error: sellFailure?.error ?? "reverted" }) },
        },
      };
    }
    checks.push({ id: "route", status: "warn", title: "No executable venue quotes it", detail: venues.length === 0 ? `Elyia executes no swap venue on ${NETWORKS[network].name}.` : `Tried ${failures.join("; ").slice(0, 300)}.` });
    checks.push({ id: "buy", status: "skipped", title: "Buy not simulated", detail: "No route." });
    checks.push({ id: "sell", status: "skipped", title: "Sell not simulated", detail: "No route." });
    return { checks, simulation: null };
  }
}

const SUMMARY: Readonly<Record<ShieldVerdict, string>> = Object.freeze({
  verified: "In Elyia's verified token list.",
  flagged: "A known look-alike or suspicious token: Elyia never routes it.",
  danger: "At least one check failed: do not trade it.",
  caution: "Nothing failed, but some checks warn or could not run: trade small and check the details.",
  "no-red-flags": "Every check ran and none failed. That is evidence, not a guarantee.",
  unknown: "Too little could be checked to say anything.",
});
