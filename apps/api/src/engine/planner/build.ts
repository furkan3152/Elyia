/**
 * Normalized actions -> IntentGraph (ported from Kletia's planner): every
 * action resolves its assets, gets its amount (exact, a share of the
 * funding parent's planned output, or the wallet balance for `max`), runs
 * the venue auction over the adapters that support it, and expands into
 * steps (one-time setup `before`, the step itself, completing `after`
 * steps such as the HyperEVM claim of a withdrawal). Edges: `funds` from
 * the funding parent, `orders` for sequencing. HyperCore L1 steps get the
 * trade-only agent: an `approveAgent` step is inserted first unless the
 * named agent is already approved.
 */
import {
  accountOn,
  erc20AssetId,
  evmChecksumState,
  tokenByAddress,
  formatAccountId,
  isEvmAddress,
  NETWORKS,
  parseAccountId,
  reserveTooLarge,
  sameAsset,
  toBaseUnitsBig,
  validateIntentGraph,
  INTENT_SPEC_VERSION,
  type AccountId,
  type IntentActionSpec,
  type IntentConstraints,
  type IntentGraph,
  type IntentSource,
  type IntentStep,
  type IntentSummary,
  type NetworkEnvironment,
  type NetworkKey,
  type ParsedAccountId,
  type StepAmount,
  type StepFunding,
} from "@elyia/core";
import type { IntentSigner, VenueQuoteView } from "@elyia/core/api/intents";
import type { Address } from "viem";
import { balanceOf } from "../adapters/evmCommon.js";
import { approvedAgent, WEB_AGENT_NAME } from "../adapters/hypercoreWallet.js";
import { fromToken, resolveAsset, type ResolvedAsset } from "../assets.js";
import { runAuction, type AuctionResult } from "../auction.js";
import type { EngineDeps } from "../deps.js";
import { engineError } from "../errors.js";
import { decimalUnits } from "../hypercore/verify.js";
import type { AdapterAction, AdapterRoute, PlannedStep } from "../types.js";
import type { AdapterRegistry } from "../registry.js";
import { GAS_RESERVE_WEI, normalizeActions, type NormalizedAction } from "./normalize.js";
import { LENDING_VENUES, VAULT_VENUES } from "../venues.js";
import { resolveElyName } from "../names.js";

export const DEFAULT_SLIPPAGE_BPS = 50;
/** Unstarted plans expire after 30 minutes (quotes go stale). */
export const PLAN_TTL_MS = 30 * 60 * 1000;
export const KEEPER_AGENT_NAME = "elyia-keeper";

export interface PlanInput {
  readonly id: string;
  readonly environment: NetworkEnvironment;
  /** The owner's 0x address (lower-case). */
  readonly owner: string;
  readonly accounts: readonly AccountId[];
  readonly actions: readonly IntentActionSpec[];
  readonly constraints?: IntentConstraints;
  readonly signer: IntentSigner;
  readonly agent?: string;
  readonly text?: string;
  readonly source: IntentSource;
  readonly metadata?: Readonly<Record<string, string>>;
}

export interface PlanOutput {
  readonly graph: IntentGraph;
  readonly quotes: readonly VenueQuoteView[];
}

interface Draft {
  readonly id: string;
  readonly network: NetworkKey;
  readonly planned: PlannedStep;
  readonly dependsOn: string[];
  readonly funding?: StepFunding;
}

/** Where an action's assets live and what the adapters see. */
async function routeOf(deps: EngineDeps, action: NormalizedAction): Promise<AdapterRoute> {
  const allowUnverified = action.protocol !== undefined;
  const resolve = (network: NetworkKey, raw: string, margin = false): Promise<ResolvedAsset> =>
    resolveAsset(deps, network, raw, { margin, allowUnverified });
  const core = NETWORKS[action.network].vm === "hypercore";
  let input: ResolvedAsset | null = null;
  let output: ResolvedAsset | null = null;
  switch (action.kind) {
    case "swap":
      input = await resolve(action.network, action.from as string);
      output = await resolve(action.network, action.to as string);
      break;
    case "bridge":
    case "link":
      input = await resolve(action.network, action.from ?? "HYPE");
      break;
    case "transfer": {
      const from = action.from ?? (core ? "USDC" : "HYPE");
      input = await resolve(action.network, from, core && from.toUpperCase() === "USDC" && action.params.spot !== true);
      break;
    }
    case "stake":
      input = await resolve(action.network, action.from ?? "HYPE");
      output = await resolve(action.network, action.to ?? "kHYPE");
      break;
    case "margin":
      if (action.variant !== "isolated-margin") input = await resolve(action.network, "USDC", action.from === "USDC@margin");
      break;
    case "deposit":
    case "withdraw": {
      const pins = venueAssets(action);
      if (!pins) throw engineError("ROUTE_UNSUPPORTED", `${action.protocol ?? "This venue"} takes no deposits on ${NETWORKS[action.network].name}.`);
      // Venue pins name the tokens; a symbol the request gave must agree with them.
      for (const [given, pinned] of [[action.from, pins.input], [action.to, pins.output]] as const) {
        if (!given || !pinned || given.toUpperCase() === pinned.symbol.toUpperCase() || given.toLowerCase() === pinned.address.toLowerCase()) continue;
        const resolved = await resolve(action.network, given).catch(() => null);
        if (!resolved || resolved.address?.toLowerCase() !== pinned.address.toLowerCase()) throw engineError("ROUTE_UNSUPPORTED", `${action.protocol} takes ${pinned.symbol} (${pinned.address}), not ${given}.`);
      }
      input = pins.input && action.params.all !== true ? pinnedAsset(action.network, pins.input) : null;
      output = pins.output ? pinnedAsset(action.network, pins.output) : null;
      break;
    }
    default:
      break;
  }
  return { kind: action.kind, network: action.network, destinationNetwork: action.destination, input, output, ...(action.variant ? { variant: action.variant } : {}) };
}

interface PinnedToken {
  readonly address: string;
  readonly symbol: string;
  readonly decimals: number;
}

/** The tokens a vault or lending venue takes and gives for a deposit / withdraw action (from its pins). */
function venueAssets(action: NormalizedAction): { readonly input: PinnedToken | null; readonly output: PinnedToken | null } | null {
  const vault = VAULT_VENUES.find((venue) => venue.id === action.protocol && venue.network === action.network);
  if (vault) {
    const asset = { address: vault.asset, symbol: vault.assetSymbol, decimals: vault.assetDecimals };
    const share = { address: vault.vault, symbol: vault.shareSymbol, decimals: vault.shareDecimals };
    return action.kind === "deposit" ? { input: asset, output: share } : { input: share, output: asset };
  }
  const lending = LENDING_VENUES.find((venue) => venue.id === action.protocol && venue.network === action.network);
  if (!lending) return null;
  const symbol = (action.kind === "deposit" ? action.from : (action.to ?? action.from))?.toUpperCase();
  const requested = typeof action.params.market === "string" ? action.params.market.toLowerCase() : undefined;
  const market = lending.markets.find((entry) => (requested ? entry.id === requested : symbol ? entry.loanSymbol.toUpperCase() === symbol || entry.loanToken === symbol.toLowerCase() : true));
  if (!market) throw engineError("ROUTE_UNSUPPORTED", `${lending.label} has no pinned ${symbol ?? ""} market. Markets: ${lending.markets.map((entry) => `${entry.loanSymbol} (${entry.id})`).join(", ")}.`);
  const loan = { address: market.loanToken, symbol: market.loanSymbol, decimals: market.loanDecimals };
  return action.kind === "deposit" ? { input: loan, output: null } : { input: loan, output: loan };
}

/** A venue-pinned token: the registry entry when listed, else the pin itself (unverified, no metadata reads). */
function pinnedAsset(network: NetworkKey, pin: PinnedToken): ResolvedAsset {
  const listed = tokenByAddress(network, pin.address);
  if (listed) return fromToken(listed);
  const address = pin.address.toLowerCase() as Address;
  return { network, id: erc20AssetId(network, address), symbol: pin.symbol, decimals: pin.decimals, native: false, address, token: null, verified: false };
}

/** Spendable balance for `max` without a funding parent (EVM native keeps the gas reserve). */
async function walletMax(deps: EngineDeps, asset: ResolvedAsset, owner: string): Promise<bigint> {
  const network = NETWORKS[asset.network];
  if (network.vm === "evm") {
    const balance = await balanceOf(deps, asset, owner as Address);
    if (!asset.native) return balance;
    if (balance <= GAS_RESERVE_WEI) throw engineError("INSUFFICIENT_GAS", `Your ${network.name} wallet holds less than the 0.05 HYPE kept for gas.`);
    return balance - GAS_RESERVE_WEI;
  }
  if (asset.id.endsWith("/margin:usdc") || asset.id.includes("/margin:")) {
    const state = await deps.core.clearinghouseState(asset.network, owner);
    return decimalUnits(state.withdrawable, asset.decimals);
  }
  const spot = await deps.core.spotClearinghouseState(asset.network, owner);
  const held = spot.balances.find((balance) => balance.token === asset.core?.index);
  if (!held) return 0n;
  const free = decimalUnits(held.total, asset.decimals) - decimalUnits(held.hold, asset.decimals);
  return free > 0n ? free : 0n;
}

async function recipientFor(deps: EngineDeps, environment: NetworkEnvironment, action: NormalizedAction, owner: string, warnings: string[]): Promise<ParsedAccountId> {
  const target = action.kind === "bridge" || action.kind === "link" ? action.destination : action.network;
  const raw = action.recipient?.trim();
  if (!raw) return parseAccountId(formatAccountId(target, owner)) as ParsedAccountId;
  const named = await resolveElyName(deps, environment, raw);
  if (named) {
    warnings.push(`${named.name} resolved to ${named.address} through Elysium Names on ${NETWORKS[named.network].name}${named.network === target ? "" : `; the same address receives on ${NETWORKS[target].name}`}. Check it is who you mean.`);
    return parseAccountId(formatAccountId(target, named.address)) as ParsedAccountId;
  }
  if (isEvmAddress(raw)) {
    if (evmChecksumState(raw) === "invalid") throw engineError("ADDRESS_CHECKSUM_INVALID");
    return parseAccountId(formatAccountId(target, raw.toLowerCase())) as ParsedAccountId;
  }
  const parsed = parseAccountId(raw);
  if (!parsed) throw engineError("RECIPIENT_INVALID");
  if (parsed.network.key !== target) throw engineError("RECIPIENT_INVALID", `The recipient must be an account on ${NETWORKS[target].name}.`);
  return parseAccountId(accountOn(parsed.address.toLowerCase(), target)) as ParsedAccountId;
}

function quoteViews(stepId: string, auction: AuctionResult): VenueQuoteView[] {
  const view = (quote: AuctionResult["winner"], winner: boolean, excluded?: VenueQuoteView["excluded"]): VenueQuoteView => {
    const { planned } = quote;
    const output = planned.outputs[0];
    return {
      stepId,
      protocol: planned.protocol,
      expected: output?.expected ?? "0",
      minimum: output?.minimum ?? output?.expected ?? "0",
      symbol: output?.symbol ?? "",
      decimals: output?.decimals ?? 0,
      winner,
      ...(excluded ? { excluded } : {}),
      ...(quote.deviationBps !== null ? { referenceDeviationBps: quote.deviationBps } : {}),
      ...(quote.referenceUsd !== null ? { referenceUsd: quote.referenceUsd } : {}),
    };
  };
  return [
    view(auction.winner, true),
    ...auction.losers.map((quote) => view(quote, false, quote.excluded)),
    ...auction.failures.map((failure) => ({
      stepId,
      protocol: failure.adapter.protocols[0] ?? failure.adapter.id,
      expected: "0",
      minimum: "0",
      symbol: "",
      decimals: 0,
      winner: false,
      excluded: "failed" as const,
      note: failure.error.message.slice(0, 200),
    })),
  ];
}

function addAmounts(list: StepAmount[], amount: StepAmount): void {
  const index = list.findIndex((entry) => sameAsset(entry.asset, amount.asset));
  if (index < 0) {
    list.push({ asset: amount.asset, symbol: amount.symbol, decimals: amount.decimals, expected: amount.expected, ...(amount.minimum !== undefined ? { minimum: amount.minimum } : {}) });
    return;
  }
  const current = list[index] as StepAmount;
  list[index] = {
    ...current,
    expected: (BigInt(current.expected) + BigInt(amount.expected)).toString(),
    ...(current.minimum !== undefined || amount.minimum !== undefined ? { minimum: (BigInt(current.minimum ?? current.expected) + BigInt(amount.minimum ?? amount.expected)).toString() } : {}),
  };
}

function addUsd(a: string, b: string): string {
  const units = (text: string) => toBaseUnitsBig(text.replace(/^(\d+(?:\.\d{1,6})?).*$/u, "$1"), 6);
  const total = units(a) + units(b);
  const whole = total / 1_000_000n;
  const cents = (total % 1_000_000n) / 10_000n;
  return `${whole}.${cents.toString().padStart(2, "0")}`;
}

export function summarize(steps: readonly IntentStep[], title: string, requestCount: (step: IntentStep) => number = () => 1): IntentSummary {
  const funders = new Set(steps.flatMap((step) => (step.funding ? [step.funding.from] : [])));
  const claimed = new Set(steps.filter((step) => step.kind === "claim").flatMap((step) => step.dependsOn));
  const inputs: StepAmount[] = [];
  const outputs: StepAmount[] = [];
  for (const step of steps) {
    if (!step.funding) step.inputs.forEach((amount) => addAmounts(inputs, amount));
    if (!funders.has(step.id) && !claimed.has(step.id)) step.outputs.forEach((amount) => addAmounts(outputs, amount));
  }
  const networks = [...new Set(steps.flatMap((step) => [step.network, ...(step.settlement?.destinationNetwork ? [step.settlement.destinationNetwork] : [])]))];
  // Longest path of estimated seconds (steps run as soon as their parents settle).
  const finish = new Map<string, number>();
  for (const step of steps) {
    const start = Math.max(0, ...step.dependsOn.map((id) => finish.get(id) ?? 0));
    finish.set(step.id, start + (step.estimatedSeconds ?? 0));
  }
  let fees: string | null = "0.00";
  for (const step of steps) {
    if (step.feesUsd === undefined) continue;
    fees = step.feesUsd === null || fees === null ? null : addUsd(fees, step.feesUsd);
  }
  const signatures = { wallet: 0, agent: 0 };
  for (const step of steps) {
    if (step.mode === "wallet") signatures.wallet += requestCount(step);
    else if (step.mode === "agent" || step.mode === "keeper") signatures.agent += requestCount(step);
  }
  return {
    title: title.slice(0, 200),
    networks,
    inputs,
    outputs,
    signatures,
    crossNetwork: steps.some((step) => step.settlement?.kind === "cross-network"),
    estimatedSeconds: Math.max(0, ...finish.values()),
    totalFeesUsd: fees,
  };
}

function toStep(draft: Draft, index: number, owner: string, agent: IntentStep["agent"] | undefined): IntentStep {
  const { planned } = draft;
  const network = draft.network;
  const status = draft.dependsOn.length === 0 ? "ready" : "blocked";
  const route = planned.route;
  return {
    id: draft.id,
    index,
    kind: planned.kind,
    title: planned.title,
    network,
    chain: NETWORKS[network].caip2,
    account: formatAccountId(network, owner),
    protocol: planned.protocol,
    mode: planned.mode,
    inputs: planned.inputs,
    outputs: planned.outputs,
    ...(planned.recipient ? { recipient: planned.recipient.id } : {}),
    dependsOn: draft.dependsOn,
    ...(planned.settlement ? { settlement: planned.settlement } : {}),
    status,
    ...(planned.order ? { order: planned.order } : {}),
    ...(planned.twap ? { twap: planned.twap } : {}),
    ...(planned.cancel ? { cancel: planned.cancel } : {}),
    ...(planned.leverage ? { leverage: planned.leverage } : {}),
    ...(planned.margin ? { margin: planned.margin } : {}),
    ...(planned.agent ? { agent: planned.agent } : (planned.mode === "agent" || planned.mode === "keeper") && agent ? { agent } : {}),
    ...(draft.funding ? { funding: draft.funding } : {}),
    route,
    ...(planned.extraCosts && planned.extraCosts.length > 0 ? { extraCosts: planned.extraCosts } : {}),
    ...(planned.feesUsd !== undefined ? { feesUsd: planned.feesUsd } : {}),
    estimatedSeconds: planned.estimatedSeconds,
    evidence: [],
    ...(planned.warnings.length > 0 ? { warnings: planned.warnings } : {}),
  };
}

export class Planner {
  constructor(
    private readonly deps: EngineDeps,
    private readonly registry: AdapterRegistry,
  ) {}

  async plan(input: PlanInput): Promise<PlanOutput> {
    const { deps } = this;
    const now = deps.clock.now();
    const constraints = input.constraints ?? {};
    if (constraints.deadline !== undefined && constraints.deadline * 1000 <= now) throw engineError("DEADLINE_PASSED");
    const slippageBps = constraints.maxSlippageBps ?? DEFAULT_SLIPPAGE_BPS;
    const normalized = await normalizeActions(deps, input.environment, input.owner, input.actions);
    const warnings = [...normalized.warnings];
    const quotes: VenueQuoteView[] = [];
    const drafts: Draft[] = [];
    const tails: string[] = [];
    const nextId = () => `s${drafts.length + 1}`;
    const agentAddress = input.agent?.toLowerCase();

    for (const [position, action] of normalized.actions.entries()) {
      const route = await routeOf(deps, action);
      const previousTail = position > 0 ? tails[position - 1] : undefined;
      const explicit = action.after?.map((index) => tails[index] as string);
      const fundingParentId = action.amount.t === "previous" ? (explicit?.[0] ?? previousTail) : undefined;
      if (action.amount.t === "previous" && !fundingParentId && route.input === null) throw engineError("INTENT_CLARIFY", "How much? Give an amount.");

      // Amount.
      let amount = 0n;
      let funding: StepFunding | undefined;
      if (action.amount.t === "exact") {
        if (!route.input) throw engineError("INVALID_REQUEST", `${action.kind} actions take no amount; size orders with size or params.notionalUsd.`);
        amount = toBaseUnitsBig(action.amount.value, route.input.decimals);
        if (amount <= 0n) throw engineError("AMOUNT_TOO_SMALL");
      } else if (action.amount.t === "previous" && fundingParentId) {
        const parent = drafts.find((draft) => draft.id === fundingParentId) as Draft;
        const credit = route.input ? parent.planned.outputs.find((output) => sameAsset(output.asset, (route.input as ResolvedAsset).id)) : parent.planned.outputs[0];
        if (!credit) throw engineError("PLAN_INVALID", `"${parent.planned.title}" delivers no ${route.input?.symbol ?? "asset"} for the next step to spend.`);
        const share = (BigInt(credit.expected) * BigInt(action.amount.portionBps)) / 10_000n;
        const nativeEvm = route.input?.native === true && NETWORKS[action.network].vm === "evm";
        const arrivalGas = typeof action.params.arrivalGas === "string" ? toBaseUnitsBig(action.params.arrivalGas, 18) : undefined;
        const reserve = nativeEvm && action.params.keepGas !== false ? (arrivalGas ?? action.gasReserve ?? (action.amount.portionBps === 10_000 ? GAS_RESERVE_WEI : 0n)) : 0n;
        if (reserveTooLarge(reserve, share)) {
          throw engineError("AMOUNT_TOO_SMALL", `Keeping ${Number(reserve) / 1e18} HYPE for gas would take most of the ${Number(share) / 1e18} HYPE that arrives. Use a larger amount.`);
        }
        amount = share - reserve;
        funding = { from: fundingParentId, portionBps: action.amount.portionBps, ...(reserve > 0n ? { gasReserve: reserve.toString() } : {}) };
      } else if (action.amount.t === "previous") {
        // `max` as the first action: the wallet balance.
        amount = await walletMax(deps, route.input as ResolvedAsset, input.owner);
        amount = (amount * BigInt(action.amount.portionBps)) / 10_000n;
        if (amount <= 0n) throw engineError("INSUFFICIENT_BALANCE", `You hold no ${route.input?.symbol} on ${NETWORKS[action.network].name}.`);
      } else if (route.input) {
        throw engineError("INTENT_CLARIFY", `How much ${route.input.symbol}?`);
      }

      const candidates = this.registry.candidates(route, {
        ...(action.protocol ? { requested: action.protocol } : {}),
        ...(constraints.preferProtocols ? { prefer: constraints.preferProtocols } : {}),
        ...(constraints.avoidProtocols ? { avoid: constraints.avoidProtocols } : {}),
      });
      if (candidates.length === 0 && action.protocol) throw engineError("ROUTE_UNSUPPORTED", `${action.protocol} does not do this on ${NETWORKS[action.network].name}.`);
      const adapterAction: AdapterAction = {
        ...route,
        environment: input.environment,
        amount,
        account: parseAccountId(formatAccountId(action.network, input.owner)) as ParsedAccountId,
        recipient: await recipientFor(deps, input.environment, action, input.owner, warnings),
        slippageBps: typeof action.params.slippageBps === "number" ? action.params.slippageBps : slippageBps,
        params: action.params,
        ...(action.trade ? { trade: action.trade } : {}),
        signer: input.signer,
        ...(agentAddress ? { agent: agentAddress } : {}),
        funded: funding !== undefined,
      };
      const auction = await runAuction(deps, candidates, adapterAction, {
        ...(constraints.preferProtocols ? { prefer: constraints.preferProtocols } : {}),
        ...(constraints.maxSeconds !== undefined ? { maxSeconds: constraints.maxSeconds } : {}),
        environment: input.environment,
      });
      const planned: PlannedStep = auction.warnings.length > 0 ? { ...auction.winner.planned, warnings: [...auction.winner.planned.warnings, ...auction.warnings] } : auction.winner.planned;

      // Dependencies of the action's first step.
      const base = new Set<string>(explicit ?? (previousTail ? [previousTail] : []));
      if (fundingParentId) base.add(fundingParentId);
      // One-time setup steps run first, in order; the step itself waits for the last one (and its funding parent).
      let chain = [...base];
      for (const setup of planned.before ?? []) {
        const id = nextId();
        drafts.push({ id, network: setup.network ?? action.network, planned: setup, dependsOn: chain });
        chain = [id];
      }
      const mainId = nextId();
      const mainDeps = [...new Set([...chain, ...(fundingParentId ? [fundingParentId] : [])])];
      drafts.push({ id: mainId, network: planned.network ?? action.network, planned, dependsOn: mainDeps, ...(funding ? { funding } : {}) });
      quotes.push(...quoteViews(mainId, auction));
      let tail = mainId;
      for (const later of planned.after ?? []) {
        const id = nextId();
        drafts.push({ id, network: later.network ?? action.network, planned: later, dependsOn: [tail] });
        tail = id;
      }
      tails.push(tail);
    }

    // The trade-only agent for HyperCore L1 steps.
    const l1 = drafts.filter((draft) => draft.planned.mode === "agent" || draft.planned.mode === "keeper");
    let agentSnapshot: IntentStep["agent"] | undefined;
    if (l1.length > 0) {
      const network = l1[0]?.network as NetworkKey;
      if (input.signer === "keeper") {
        const agents = await deps.core.extraAgents(network, input.owner);
        const keeper = agents.find((entry) => entry.name.startsWith(KEEPER_AGENT_NAME) && entry.validUntil > now + 60 * 60 * 1000);
        if (!keeper) throw engineError("KEEPER_DISABLED", "No approved elyia-keeper key is listed for this account; Keeper mode is off.");
        agentSnapshot = { address: keeper.address.toLowerCase() as `0x${string}`, name: keeper.name, validUntil: keeper.validUntil, scope: "keeper" };
      } else {
        if (!agentAddress) throw engineError("AGENT_KEY_REQUIRED", "These HyperCore steps are signed by your trade-only agent key: send its address as `agent`.");
        const approved = await approvedAgent(deps, network, input.owner, agentAddress, now);
        if (approved) {
          agentSnapshot = { address: agentAddress as `0x${string}`, name: approved.name, validUntil: approved.validUntil, scope: "browser" };
        } else {
          const adapter = this.registry.byId("hypercore-agent");
          const planned = await adapter.plan({
            kind: "agent",
            network,
            destinationNetwork: network,
            input: null,
            output: null,
            environment: input.environment,
            amount: 0n,
            account: parseAccountId(formatAccountId(network, input.owner)) as ParsedAccountId,
            recipient: parseAccountId(formatAccountId(network, input.owner)) as ParsedAccountId,
            slippageBps: 0,
            params: {},
            signer: "agent",
            agent: agentAddress,
            funded: false,
          });
          const id = `s${drafts.length + 1}`;
          drafts.unshift({ id, network, planned, dependsOn: [] });
          for (const draft of l1) draft.dependsOn.push(id);
          agentSnapshot = { address: agentAddress as `0x${string}`, name: WEB_AGENT_NAME, validUntil: planned.agent?.validUntil ?? null, scope: "browser" };
          warnings.push("First, approve Elyia's trade-only key on HyperCore (one wallet signature, 30 days). It can trade but never withdraw.");
        }
      }
    }

    // Renumber in insertion order so ids follow execution order (s1 first).
    const renamed = new Map(drafts.map((draft, index) => [draft.id, `s${index + 1}`]));
    const steps = drafts.map((draft, index) =>
      toStep(
        {
          ...draft,
          id: renamed.get(draft.id) as string,
          dependsOn: draft.dependsOn.map((id) => renamed.get(id) as string),
          ...(draft.funding ? { funding: { ...draft.funding, from: renamed.get(draft.funding.from) as string } } : {}),
        },
        index,
        input.owner,
        agentSnapshot,
      ),
    );
    const renamedQuotes = quotes.map((quote) => ({ ...quote, stepId: renamed.get(quote.stepId) as string }));
    if (steps.length > 12) throw engineError("PLAN_INVALID", "At most 12 steps are planned per intent.");

    const createdAt = new Date(now).toISOString();
    const ttl = now + PLAN_TTL_MS;
    const expires = constraints.deadline !== undefined ? Math.min(ttl, constraints.deadline * 1000) : ttl;
    const edges = steps.flatMap((step) => step.dependsOn.map((from) => ({ from, to: step.id, kind: step.funding?.from === from ? ("funds" as const) : ("orders" as const) })));
    const title = input.text?.trim() || steps.map((step) => step.title).join(", then ");
    const accounts = [...new Set([...input.accounts, ...steps.map((step) => step.account)])] as AccountId[];
    const graph: IntentGraph = {
      spec: INTENT_SPEC_VERSION,
      id: input.id,
      ...(input.text ? { text: input.text } : {}),
      source: input.source,
      environment: input.environment,
      accounts,
      steps,
      edges,
      status: "planned",
      createdAt,
      updatedAt: createdAt,
      expiresAt: new Date(expires).toISOString(),
      summary: summarize(steps, title, (step) => drafts[step.index]?.planned.requestCount ?? 1),
      warnings,
      ...(input.metadata ? { metadata: input.metadata } : {}),
    };
    const issues = validateIntentGraph(graph);
    if (issues.length > 0) throw engineError("PLAN_INVALID", issues[0]?.message, { issues: issues.slice(0, 10) });
    return { graph, quotes: renamedQuotes };
  }
}
