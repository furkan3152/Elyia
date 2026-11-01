/**
 * The `elyia-router` venue: swaps through Elyia's own ElyiaRouter
 * (packages/contracts), which splits one swap across Elysium venues in a
 * single transaction (Kalos V3 SwapRouter v1, Dex Da Costa V2, with WHYPE /
 * the venue's own wrapped native for HYPE in and out), with `minAmountOut`
 * and a deadline enforced on the total and an optional integrator fee.
 *
 * Quotes are eth_simulateV1 runs of the real `swap` call:
 * - when the router is recorded for the network (admin deployment
 *   registry), against the deployed contract;
 * - before deployment, against the artifact's runtime code placed at a
 *   virtual address with a state override (`code`), and the venue allowlist
 *   written into `venueKind` with `stateDiff`. The mapping's slot is found by
 *   probing (`venueKind(addr)` with each candidate slot), never assumed.
 *   Pre-deployment the venue is explicit-only (name `elyia-router`) and its
 *   plans cannot be prepared: there is nothing to sign against yet.
 *
 * The planner tries every single leg (each Kalos fee tier with liquidity,
 * Dex Da Costa) and a 50/50 split of the two best legs, and keeps the best
 * simulated output. It runs in the auction next to the direct venues.
 */
import { applySlippage, explorerAddressUrl, NETWORKS, type NetworkKey, type StepAmount } from "@elyia/core";
import { decodeEventLog, decodeFunctionResult, encodeFunctionData, keccak256, numberToHex, pad, parseAbi, type Address, type Hex } from "viem";
import { V2_FACTORY_ABI, V3_FACTORY_ABI, V3_POOL_ABI } from "../abis.js";
import { amountOf, assetOfAmount, formatAmount, sameResolved, stepAddress, type ResolvedAsset } from "../assets.js";
import type { EngineDeps } from "../deps.js";
import { engineError } from "../errors.js";
import type { SimulatedCall } from "../ports/evm.js";
import { evidence, type AdapterAction, type AdapterRoute, type PlannedStep, type PrepareContext, type PreparedPayload, type ProtocolAdapter, type VerifyContext } from "../types.js";
import { lowestPreparedFloor, verifyEvmReceipts, eventsOf } from "../verify.js";
import { DEX_DA_COSTA, KALOS_V3, type V2Venue, type V3Venue } from "../venues.js";
import { approvalFor, approveCall, assertBalance, balanceMappingSlot, deadlineFor, evmRequest, feesUsd, MAX_DEX_SLIPPAGE_BPS, mappingSlot, tokenTrustWarnings } from "./evmCommon.js";

export const ELYIA_ROUTER_PROTOCOL = "elyia-router";
const ZERO: Address = "0x0000000000000000000000000000000000000000";
/** Where the artifact's runtime code is placed for pre-deployment simulations (no contract lives there). */
export const VIRTUAL_ROUTER: Address = "0x00000000000000000000000000000000e1e1a000";
const SIM_ACCOUNT: Address = "0x00000000000000000000000000000000e1e1a5e1";
const GAS_ROUTER_SWAP = 260_000n;

/** The router's swap ABI (IElyiaRouter). Checked against the exported artifact's selectors before use. */
export const ELYIA_ROUTER_ABI = parseAbi([
  "struct Hop { uint8 kind; address venue; address tokenIn; address tokenOut; uint24 fee; }",
  "struct Route { uint256 amountIn; Hop[] hops; }",
  "struct SwapParams { address tokenIn; address tokenOut; uint256 amountIn; uint256 minAmountOut; address recipient; uint256 deadline; address integrator; uint16 integratorFeeBps; Route[] routes; }",
  "function swap(SwapParams params) payable returns (uint256 amountOut)",
  "function venueKind(address venue) view returns (uint8)",
  "function integratorMaxFeeBps(address integrator) view returns (uint16)",
  "function paused() view returns (bool)",
  "event Swap(address indexed sender, address indexed recipient, address indexed tokenIn, address tokenOut, uint256 amountIn, uint256 amountOut, uint256 protocolFee, address integrator, uint256 integratorFee)",
]);

/** IElyiaRouter.VenueKind / HopKind values. */
export const VENUE_KIND = Object.freeze({ NONE: 0, WRAPPER: 1, V2_ROUTER: 2, V3_ROUTER_V1: 3, V3_ROUTER_02: 4, VAULT: 5 });
export const HOP_KIND = Object.freeze({ WRAP: 0, UNWRAP: 1, V2: 2, V3_V1: 3, V3_02: 4 });

export interface RouterHop {
  readonly kind: number;
  readonly venue: Address;
  readonly tokenIn: Address;
  readonly tokenOut: Address;
  readonly fee: number;
}

export interface RouterRoute {
  readonly amountIn: bigint;
  readonly hops: readonly RouterHop[];
}

/* ------------------------------------------------- deployment registry */

export interface RouterDeployment {
  readonly address: Address;
  readonly artifactVersion: string;
}

export interface RouterArtifact {
  readonly deployedBytecode: Hex;
  readonly version: string;
}

const deployments = new Map<NetworkKey, RouterDeployment>();
let artifact: RouterArtifact | null = null;

/** Called by the admin module when a verified ElyiaRouter deployment is recorded (or loaded at boot). */
export function setElyiaRouterDeployment(network: NetworkKey, deployment: RouterDeployment | null): void {
  if (deployment) deployments.set(network, { address: deployment.address.toLowerCase() as Address, artifactVersion: deployment.artifactVersion });
  else deployments.delete(network);
}

export function elyiaRouterDeployment(network: NetworkKey): RouterDeployment | null {
  return deployments.get(network) ?? null;
}

/** The exported artifact's runtime code (packages/core/src/contracts), enabling pre-deployment simulation. */
export function setElyiaRouterArtifact(next: RouterArtifact | null): void {
  artifact = next;
  slotCache.clear();
}

export function elyiaRouterArtifact(): RouterArtifact | null {
  return artifact;
}

/* -------------------------------------------------------------- venues */

interface Leg {
  readonly label: string;
  readonly hops: readonly RouterHop[];
  /** Venues (and their kinds) the leg needs allowlisted. */
  readonly venues: ReadonlyArray<readonly [Address, number]>;
  /** A holder of the input token (balance-slot discovery for ERC-20 inputs). */
  readonly holder: Address | null;
}

function lower(address: string): Address {
  return address.toLowerCase() as Address;
}

function canonicalWrapped(network: NetworkKey): Address | null {
  const entry = NETWORKS[network];
  return entry.vm === "evm" && entry.contracts.wrappedNative ? lower(entry.contracts.wrappedNative) : null;
}

/** Wraps / unwraps around a token-to-token hop for native HYPE ends. */
function withNativeEnds(input: ResolvedAsset, output: ResolvedAsset, wrapper: Address, middle: Omit<RouterHop, "tokenIn" | "tokenOut"> & { readonly tokenIn?: Address; readonly tokenOut?: Address }): RouterHop[] {
  const tokenIn = input.native ? wrapper : lower(input.address as string);
  const tokenOut = output.native ? wrapper : lower(output.address as string);
  const hops: RouterHop[] = [];
  if (input.native) hops.push({ kind: HOP_KIND.WRAP, venue: wrapper, tokenIn: ZERO, tokenOut: wrapper, fee: 0 });
  hops.push({ kind: middle.kind, venue: middle.venue, tokenIn, tokenOut, fee: middle.fee });
  if (output.native) hops.push({ kind: HOP_KIND.UNWRAP, venue: wrapper, tokenIn: wrapper, tokenOut: ZERO, fee: 0 });
  return hops;
}

async function v3Legs(deps: EngineDeps, venue: V3Venue, input: ResolvedAsset, output: ResolvedAsset): Promise<Leg[]> {
  const a = input.native ? lower(venue.wrappedNative) : lower(input.address as string);
  const b = output.native ? lower(venue.wrappedNative) : lower(output.address as string);
  const legs: Leg[] = [];
  for (const fee of venue.feeTiers) {
    const pool = lower(await deps.evm.read(venue.network, { address: venue.factory, abi: V3_FACTORY_ABI, functionName: "getPool", args: [a, b, fee] }));
    if (pool === ZERO) continue;
    const [factory, liquidity] = await Promise.all([
      deps.evm.read(venue.network, { address: pool, abi: V3_POOL_ABI, functionName: "factory" }),
      deps.evm.read(venue.network, { address: pool, abi: V3_POOL_ABI, functionName: "liquidity" }),
    ]);
    if (lower(factory) !== lower(venue.factory) || liquidity === 0n) continue;
    const kind = venue.dialect === "router01" ? HOP_KIND.V3_V1 : HOP_KIND.V3_02;
    const venueKind = venue.dialect === "router01" ? VENUE_KIND.V3_ROUTER_V1 : VENUE_KIND.V3_ROUTER_02;
    legs.push({
      label: `${venue.label} ${fee / 10_000}%`,
      hops: withNativeEnds(input, output, lower(venue.wrappedNative), { kind, venue: lower(venue.router), fee }),
      venues: [[lower(venue.router), venueKind], ...(input.native || output.native ? ([[lower(venue.wrappedNative), VENUE_KIND.WRAPPER]] as const) : [])],
      holder: pool,
    });
  }
  return legs;
}

async function v2Legs(deps: EngineDeps, venue: V2Venue, input: ResolvedAsset, output: ResolvedAsset): Promise<Leg[]> {
  const a = input.native ? lower(venue.wrappedNative) : lower(input.address as string);
  const b = output.native ? lower(venue.wrappedNative) : lower(output.address as string);
  const pair = lower(await deps.evm.read(venue.network, { address: venue.factory, abi: V2_FACTORY_ABI, functionName: "getPair", args: [a, b] }));
  if (pair === ZERO) return [];
  return [
    {
      label: venue.label,
      hops: withNativeEnds(input, output, lower(venue.wrappedNative), { kind: HOP_KIND.V2, venue: lower(venue.router), fee: 0 }),
      venues: [[lower(venue.router), VENUE_KIND.V2_ROUTER], ...(input.native || output.native ? ([[lower(venue.wrappedNative), VENUE_KIND.WRAPPER]] as const) : [])],
      holder: pair,
    },
  ];
}

/** Venues the router routes through, per network (verified, non-explicit-only pins). */
export const ROUTER_LEG_VENUES: Readonly<Partial<Record<NetworkKey, { readonly v3: readonly V3Venue[]; readonly v2: readonly V2Venue[] }>>> = Object.freeze({
  "elysium-testnet": { v3: [KALOS_V3], v2: [DEX_DA_COSTA] },
});

/** The constructor allowlist for a network (deploy plan): every venue and wrapper the legs use. */
export function routerAllowlist(network: NetworkKey): Array<{ readonly venue: Address; readonly kind: number; readonly label: string }> {
  const pins = ROUTER_LEG_VENUES[network];
  if (!pins) return [];
  const out = new Map<string, { venue: Address; kind: number; label: string }>();
  const wrapped = canonicalWrapped(network);
  if (wrapped) out.set(wrapped, { venue: wrapped, kind: VENUE_KIND.WRAPPER, label: "WHYPE" });
  for (const venue of pins.v3) {
    out.set(lower(venue.router), { venue: lower(venue.router), kind: venue.dialect === "router01" ? VENUE_KIND.V3_ROUTER_V1 : VENUE_KIND.V3_ROUTER_02, label: venue.label });
    out.set(lower(venue.wrappedNative), { venue: lower(venue.wrappedNative), kind: VENUE_KIND.WRAPPER, label: `${venue.label} wrapped HYPE` });
  }
  for (const venue of pins.v2) {
    out.set(lower(venue.router), { venue: lower(venue.router), kind: VENUE_KIND.V2_ROUTER, label: venue.label });
    out.set(lower(venue.wrappedNative), { venue: lower(venue.wrappedNative), kind: VENUE_KIND.WRAPPER, label: `${venue.label} wrapped HYPE` });
  }
  return [...out.values()];
}

/* ---------------------------------------------- pre-deployment overrides */

const slotCache = new Map<string, bigint | null>();
const CANDIDATE_SLOTS = Array.from({ length: 12 }, (_, index) => BigInt(index));

/**
 * The storage slot of a mapping(address => T) behind a zero-arg-free view
 * (`venueKind(addr)`), found by writing a marker into each candidate slot and
 * calling the view against the artifact's code. Cached per network + view.
 */
export async function probeMappingSlot(deps: EngineDeps, network: NetworkKey, code: Hex, view: "venueKind" | "integratorMaxFeeBps"): Promise<bigint | null> {
  const key = `${network}:${view}:${keccak256(code).slice(0, 18)}`;
  if (slotCache.has(key)) return slotCache.get(key) ?? null;
  const probe: Address = "0x00000000000000000000000000000000000beef1";
  const marker = view === "venueKind" ? 3n : 7n;
  for (const slot of CANDIDATE_SLOTS) {
    const data = encodeFunctionData({ abi: ELYIA_ROUTER_ABI, functionName: view, args: [probe] });
    const result = await deps.evm.call(network, { to: VIRTUAL_ROUTER, data, code: { [VIRTUAL_ROUTER]: code }, storage: { [VIRTUAL_ROUTER]: { [mappingSlot(probe, slot)]: pad(numberToHex(marker), { size: 32 }) } } });
    if (!result.ok) continue;
    const value = BigInt(decodeFunctionResult({ abi: ELYIA_ROUTER_ABI, functionName: view, data: result.data }) as number);
    if (value === marker) {
      slotCache.set(key, slot);
      return slot;
    }
  }
  slotCache.set(key, null);
  return null;
}

/* ---------------------------------------------------------- simulation */

interface Target {
  readonly address: Address;
  readonly deployed: boolean;
  readonly code: Hex | null;
}

function targetFor(network: NetworkKey): Target | null {
  const deployment = deployments.get(network);
  if (deployment) return { address: deployment.address, deployed: true, code: null };
  if (artifact) return { address: VIRTUAL_ROUTER, deployed: false, code: artifact.deployedBytecode };
  return null;
}

export function swapCalldata(params: {
  readonly tokenIn: Address;
  readonly tokenOut: Address;
  readonly amountIn: bigint;
  readonly minAmountOut: bigint;
  readonly recipient: Address;
  readonly deadline: bigint;
  readonly integrator: Address;
  readonly integratorFeeBps: number;
  readonly routes: readonly RouterRoute[];
}): Hex {
  return encodeFunctionData({
    abi: ELYIA_ROUTER_ABI,
    functionName: "swap",
    args: [{ ...params, routes: params.routes.map((route) => ({ amountIn: route.amountIn, hops: route.hops.map((hop) => ({ ...hop })) })) }],
  });
}

interface SimulationInput {
  readonly network: NetworkKey;
  readonly target: Target;
  readonly input: ResolvedAsset;
  readonly output: ResolvedAsset;
  readonly amount: bigint;
  readonly routes: readonly RouterRoute[];
  readonly venues: ReadonlyArray<readonly [Address, number]>;
  readonly holder: Address | null;
  readonly integrator: { readonly address: Address; readonly bps: number } | null;
}

async function simulateSwap(deps: EngineDeps, sim: SimulationInput): Promise<bigint | null> {
  const storage: Record<string, Record<Hex, Hex>> = {};
  const code: Record<string, Hex> = {};
  if (!sim.target.deployed && sim.target.code) {
    code[sim.target.address] = sim.target.code;
    const venueSlot = await probeMappingSlot(deps, sim.network, sim.target.code, "venueKind");
    if (venueSlot === null) return null;
    const slots: Record<Hex, Hex> = {};
    for (const [venue, kind] of sim.venues) slots[mappingSlot(venue, venueSlot)] = pad(numberToHex(kind), { size: 32 });
    if (sim.integrator) {
      const feeSlot = await probeMappingSlot(deps, sim.network, sim.target.code, "integratorMaxFeeBps");
      if (feeSlot !== null) slots[mappingSlot(sim.integrator.address, feeSlot)] = pad(numberToHex(sim.integrator.bps), { size: 32 });
    }
    storage[sim.target.address] = slots;
  }
  const tokenIn = sim.input.native ? ZERO : lower(sim.input.address as string);
  if (!sim.input.native) {
    if (!sim.holder) return null;
    const slot = await balanceMappingSlot(deps, sim.network, tokenIn, sim.holder).catch(() => null);
    if (slot === null) return null;
    storage[tokenIn] = { ...(storage[tokenIn] ?? {}), [mappingSlot(SIM_ACCOUNT, slot)]: pad(numberToHex(sim.amount), { size: 32 }) };
  }
  const data = swapCalldata({
    tokenIn,
    tokenOut: sim.output.native ? ZERO : lower(sim.output.address as string),
    amountIn: sim.amount,
    minAmountOut: 0n,
    recipient: SIM_ACCOUNT,
    deadline: BigInt(Math.floor(deps.clock.now() / 1000) + 600),
    integrator: sim.integrator?.address ?? ZERO,
    integratorFeeBps: sim.integrator?.bps ?? 0,
    routes: sim.routes,
  });
  const calls = [
    ...(sim.input.native ? [] : [{ from: SIM_ACCOUNT, to: tokenIn, data: approveCall(sim.target.address, sim.amount) }]),
    { from: SIM_ACCOUNT, to: sim.target.address, data, ...(sim.input.native ? { value: sim.amount } : {}) },
  ];
  let simulated: SimulatedCall[] | null;
  try {
    simulated = await deps.evm.simulate(sim.network, { calls, balances: { [SIM_ACCOUNT]: (sim.input.native ? sim.amount : 0n) + 10n ** 21n }, storage, code });
  } catch {
    return null;
  }
  const last = simulated?.at(-1);
  if (!simulated || !last || simulated.some((call) => call.status !== "success")) return null;
  return decodeFunctionResult({ abi: ELYIA_ROUTER_ABI, functionName: "swap", data: last.returnData }) as bigint;
}

/* --------------------------------------------------------------- plan */

interface BestRoute {
  readonly routes: readonly RouterRoute[];
  readonly venues: ReadonlyArray<readonly [Address, number]>;
  readonly holder: Address | null;
  readonly out: bigint;
  readonly label: string;
}

function split(amount: bigint, legs: readonly Leg[]): RouterRoute[] {
  const first = amount / 2n;
  return [
    { amountIn: first, hops: (legs[0] as Leg).hops },
    { amountIn: amount - first, hops: (legs[1] as Leg).hops },
  ];
}

export async function bestRoute(deps: EngineDeps, network: NetworkKey, target: Target, input: ResolvedAsset, output: ResolvedAsset, amount: bigint, integrator: SimulationInput["integrator"]): Promise<BestRoute> {
  const pins = ROUTER_LEG_VENUES[network];
  if (!pins) throw engineError("ROUTE_UNSUPPORTED", "ElyiaRouter routes only on Elysium.");
  const legs = [
    ...(await Promise.all(pins.v3.map((venue) => v3Legs(deps, venue, input, output).catch(() => [])))).flat(),
    ...(await Promise.all(pins.v2.map((venue) => v2Legs(deps, venue, input, output).catch(() => [])))).flat(),
  ];
  if (legs.length === 0) throw engineError("ROUTE_UNAVAILABLE", `ElyiaRouter found no ${input.symbol}/${output.symbol} pool on its venues.`);
  const scored: Array<{ leg: Leg; out: bigint }> = [];
  for (const leg of legs) {
    const out = await simulateSwap(deps, { network, target, input, output, amount, routes: [{ amountIn: amount, hops: leg.hops }], venues: leg.venues, holder: leg.holder, integrator });
    if (out !== null && out > 0n) scored.push({ leg, out });
  }
  scored.sort((a, b) => (b.out > a.out ? 1 : b.out < a.out ? -1 : 0));
  const top = scored[0];
  if (!top) throw engineError("ROUTE_UNAVAILABLE", `ElyiaRouter could not simulate ${formatAmount(amount, input.decimals, input.symbol)} to ${output.symbol} (${target.deployed ? "deployed router" : "pre-deployment code override"}).`);
  let best: BestRoute = { routes: [{ amountIn: amount, hops: top.leg.hops }], venues: top.leg.venues, holder: top.leg.holder, out: top.out, label: top.leg.label };
  const second = scored.find((entry) => entry.leg.hops[input.native ? 1 : 0]?.venue !== top.leg.hops[input.native ? 1 : 0]?.venue || entry.leg.hops.some((hop, index) => hop.fee !== top.leg.hops[index]?.fee));
  if (second && second !== top && amount >= 2n) {
    const legsPair = [top.leg, second.leg];
    const venues = [...new Map([...top.leg.venues, ...second.leg.venues].map((entry) => [entry[0], entry])).values()];
    const routes = split(amount, legsPair);
    const out = await simulateSwap(deps, { network, target, input, output, amount, routes, venues, holder: top.leg.holder ?? second.leg.holder, integrator });
    if (out !== null && out > best.out) best = { routes, venues, holder: top.leg.holder ?? second.leg.holder, out, label: `split 50/50: ${top.leg.label} + ${second.leg.label}` };
  }
  return best;
}

/* ------------------------------------------------------------ encoding */

function decodeRoutes(encoded: string, total: bigint): RouterRoute[] {
  // The planner stores the route set; prepare re-scales each leg to the executed amount.
  const decoded = JSON.parse(Buffer.from(encoded.slice(2), "hex").toString("utf8")) as Array<{ share: string; hops: RouterHop[] }>;
  const shares = decoded.map((entry) => BigInt(entry.share));
  const sum = shares.reduce((a, b) => a + b, 0n);
  let assigned = 0n;
  return decoded.map((entry, index) => {
    const amountIn = index === decoded.length - 1 ? total - assigned : (total * (shares[index] as bigint)) / (sum === 0n ? 1n : sum);
    assigned += amountIn;
    return { amountIn, hops: entry.hops };
  });
}

function storeRoutes(routes: readonly RouterRoute[]): string {
  const json = JSON.stringify(routes.map((route) => ({ share: route.amountIn.toString(), hops: route.hops })));
  return `0x${Buffer.from(json, "utf8").toString("hex")}`;
}

/* ------------------------------------------------------------- adapter */

function integratorOf(action: AdapterAction): SimulationInput["integrator"] {
  const address = action.params.integrator;
  const bps = Number(action.params.integratorFeeBps ?? 0);
  if (typeof address !== "string" || !/^0x[0-9a-fA-F]{40}$/u.test(address) || !Number.isInteger(bps) || bps <= 0) return null;
  return { address: lower(address), bps: Math.min(bps, 50) };
}

export function createElyiaRouterAdapter(deps: EngineDeps): ProtocolAdapter {
  const network: NetworkKey = "elysium-testnet";
  const supports = (route: AdapterRoute): boolean => {
    if (route.kind !== "swap" || !ROUTER_LEG_VENUES[route.network] || route.destinationNetwork !== route.network) return false;
    const { input, output } = route;
    if (!input || !output || sameResolved(input, output) || !targetFor(route.network)) return false;
    if ((!input.native && !input.address) || (!output.native && !output.address)) return false;
    const wrapped = canonicalWrapped(route.network);
    if ((input.native && output.address && lower(output.address) === wrapped) || (output.native && input.address && lower(input.address) === wrapped)) return false;
    return input.verified !== false && output.verified !== false;
  };

  const adapter: ProtocolAdapter = {
    id: ELYIA_ROUTER_PROTOCOL,
    protocols: [ELYIA_ROUTER_PROTOCOL],
    label: "ElyiaRouter",
    supports,
    async plan(action) {
      const target = targetFor(action.network);
      if (!target) throw engineError("ROUTE_UNAVAILABLE", "ElyiaRouter is neither deployed nor available as an artifact on this server.");
      const input = action.input as ResolvedAsset;
      const output = action.output as ResolvedAsset;
      if (action.amount <= 0n) throw engineError("AMOUNT_TOO_SMALL", "The swap amount is zero.");
      const trust = tokenTrustWarnings([input, output]);
      const integrator = integratorOf(action);
      const best = await bestRoute(deps, action.network, target, input, output, action.amount, integrator);
      const slippageBps = Math.max(1, Math.min(action.slippageBps, MAX_DEX_SLIPPAGE_BPS));
      const minimum = applySlippage(best.out, slippageBps);
      const account = lower(action.account.address);
      const approval = input.native || action.funded || !target.deployed ? null : await approvalFor(deps, action.network, { token: lower(input.address as string), symbol: input.symbol, owner: account, spender: target.address, spenderLabel: "ElyiaRouter", amount: action.amount, bestEffort: true });
      const needsApproval = !input.native && (action.funded || approval !== null || !target.deployed);
      const warnings = [
        ...(NETWORKS[action.network].environment === "testnet" ? [`${NETWORKS[action.network].name} pool prices are test prices; USD values use HyperCore mainnet reference mids.`] : []),
        ...(target.deployed ? [] : ["ElyiaRouter is not deployed on this network yet: this quote is an eth_simulateV1 run of its code (state override). It cannot be signed until the owner deploys it."]),
        ...(integrator ? [`Includes a ${(integrator.bps / 100).toFixed(2)}% integrator fee to ${integrator.address}.`] : []),
        `Route: ${best.label}.`,
        ...trust,
      ];
      return {
        protocol: ELYIA_ROUTER_PROTOCOL,
        kind: "swap",
        title: `Swap ${formatAmount(action.amount, input.decimals, input.symbol)} to ${output.symbol} through ElyiaRouter (${best.routes.length > 1 ? "split" : "single"} route)`,
        mode: "wallet",
        inputs: [amountOf(input, action.amount)],
        outputs: [amountOf(output, best.out, { minimum })],
        feesUsd: await feesUsd(deps, action.network, GAS_ROUTER_SWAP + (needsApproval ? 60_000n : 0n)),
        estimatedSeconds: 2,
        settlement: { kind: "same-network", mechanism: "receipt" },
        warnings,
        route: {
          variant: best.routes.length > 1 ? "router:split" : "router:single",
          slippageBps,
          plannedInput: action.amount.toString(),
          plannedMinimum: minimum.toString(),
          params: {
            venue: ELYIA_ROUTER_PROTOCOL,
            router: target.address,
            deployed: target.deployed,
            routes: storeRoutes(best.routes),
            holder: best.holder ?? "",
            label: best.label,
            ...(integrator ? { integrator: integrator.address, integratorFeeBps: integrator.bps } : {}),
          },
        },
        requestCount: needsApproval ? 2 : 1,
        floor: "onchain",
      } satisfies PlannedStep;
    },
    async prepare(context: PrepareContext): Promise<PreparedPayload> {
      const { step } = context;
      const params = step.route?.params ?? {};
      const deployment = deployments.get(step.network);
      if (!deployment || params.deployed !== true || lower(String(params.router)) !== deployment.address) {
        throw engineError("ROUTE_UNAVAILABLE", "ElyiaRouter is not deployed on this network (the plan was a pre-deployment simulation). Plan again once the owner has deployed it.");
      }
      const inputAmount = step.inputs[0];
      const outputAmount = step.outputs[0];
      if (!inputAmount || !outputAmount || typeof params.routes !== "string") throw engineError("STEP_INVALID", "The router step lost its recorded route.");
      const input = assetOfAmount(inputAmount);
      const output = assetOfAmount(outputAmount);
      const account = stepAddress(step);
      await assertBalance(deps, input, account, context.amount);
      const routes = decodeRoutes(params.routes, context.amount);
      const integrator = typeof params.integrator === "string" ? { address: lower(params.integrator), bps: Number(params.integratorFeeBps ?? 0) } : null;
      const target: Target = { address: deployment.address, deployed: true, code: null };
      const venues: Array<readonly [Address, number]> = [];
      const out = await simulateSwap(deps, { network: step.network, target, input, output, amount: context.amount, routes, venues, holder: typeof params.holder === "string" && params.holder ? lower(params.holder) : null, integrator });
      if (out === null) throw engineError("ROUTE_UNAVAILABLE", "The recorded ElyiaRouter route no longer simulates. Plan again.");
      const minimum = applySlippage(out, step.route?.slippageBps ?? 50);
      const tokenIn = input.native ? ZERO : lower(input.address as string);
      const data = swapCalldata({
        tokenIn,
        tokenOut: output.native ? ZERO : lower(output.address as string),
        amountIn: context.amount,
        minAmountOut: minimum,
        recipient: account,
        deadline: deadlineFor(context.expiresAt),
        integrator: integrator?.address ?? ZERO,
        integratorFeeBps: integrator?.bps ?? 0,
        routes,
      });
      const approval = input.native ? null : await approvalFor(deps, step.network, { token: tokenIn, symbol: input.symbol, owner: account, spender: deployment.address, spenderLabel: "ElyiaRouter", amount: context.amount });
      return {
        requests: [
          ...(approval ? [approval] : []),
          evmRequest(step.network, account, deployment.address, data, input.native ? context.amount : 0n, `Swap ${formatAmount(context.amount, input.decimals, input.symbol)} for at least ${formatAmount(minimum, output.decimals, output.symbol)} through ElyiaRouter`),
        ],
        inputs: [amountOf(input, context.amount)],
        outputs: [amountOf(output, out, { minimum })],
        warnings: [],
      };
    },
    async verify(context: VerifyContext) {
      const { step } = context;
      const router = lower(String(step.route?.params?.router ?? ""));
      const output = step.outputs[0] as StepAmount;
      const account = stepAddress(step);
      const { result } = await verifyEvmReceipts(deps.evm, context, (receipts) => {
        const logs = receipts.flatMap((receipt) => receipt.logs);
        const swaps = eventsOf(logs, { address: router, abi: ELYIA_ROUTER_ABI, eventName: "Swap" }).filter((entry) => String(entry.args.recipient).toLowerCase() === account);
        const swap = swaps.at(-1);
        if (!swap) return { failure: { code: "OUTCOME_NOT_PROVEN", message: `No Swap event from ElyiaRouter ${router} to the account.` } };
        const credit = BigInt(swap.args.amountOut as bigint);
        const floor = lowestPreparedFloor(step) ?? 0n;
        if (credit < floor) return { failure: { code: "OUTCOME_NOT_PROVEN", message: `ElyiaRouter delivered ${credit}, below the guaranteed ${floor}.` } };
        return {
          actualOutputs: [{ ...output, expected: credit.toString(), minimum: credit.toString() }],
          evidence: [evidence("settlement", step.network, context.now, `ElyiaRouter Swap event; ${formatAmount(credit, output.decimals, output.symbol)} to the account.`, { url: explorerAddressUrl(step.network, router) })],
        };
      });
      return result;
    },
  };
  // Pre-deployment the router quotes only when named; once deployed it competes in every auction.
  return Object.defineProperty(adapter, "explicitOnly", { get: () => !deployments.has(network), enumerable: true });
}

/** Decodes the router's Swap event (tests, tracking). */
export function decodeRouterSwap(log: { readonly topics: readonly Hex[]; readonly data: Hex }) {
  return decodeEventLog({ abi: ELYIA_ROUTER_ABI, topics: log.topics as [Hex, ...Hex[]], data: log.data, eventName: "Swap" });
}

