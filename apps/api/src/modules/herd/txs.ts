/**
 * Admin-prepared transactions: calldata for the owner's wallet to sign.
 * The server never signs or sends. Each prepare checks the function is an
 * owner function in the ABI, coerces the arguments to the ABI's types,
 * applies the spec's guards (allocations ≤ supply, royalty ≤ 10%, withdraw
 * only to the owner or the treasury, …), simulates it from the owner's
 * address with eth_call, and writes the audit log.
 */
import { NETWORKS, getEvmNetwork, type NetworkKey } from "@elyia/core";
import { HERD_PHASES, type HerdPreparedTx } from "@elyia/core/api/herd";
import { encodeFunctionData, isAddress, type AbiFunction, type AbiParameter, type Address, type Hex } from "viem";
import type { AppContext } from "../../context.js";
import { ElyiaHttpError } from "../../http/errors.js";
import { abiFunction, herdAbi, HERD_BUCKETS, HERD_OWNER_FUNCTIONS } from "./abi.js";
import { collectionView, forgetHerdView, herdRecord, readHerd } from "./chain.js";
import { latestBuild } from "./lists.js";
import { audit } from "./state.js";

function bad(message: string): ElyiaHttpError {
  return new ElyiaHttpError("INVALID_REQUEST", 400, message);
}

/** One argument to its ABI type (strings from JSON; numbers as decimal strings). */
export function coerce(param: AbiParameter, value: unknown): unknown {
  const type = param.type;
  const name = param.name || type;
  if (type.endsWith("[]")) {
    if (!Array.isArray(value)) throw bad(`${name}: expected an array.`);
    return value.map((item) => coerce({ ...param, type: type.slice(0, -2) } as AbiParameter, item));
  }
  if (/^u?int\d*$/u.test(type)) {
    const text = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
    if (!/^-?\d{1,78}$/u.test(text)) throw bad(`${name}: expected an integer.`);
    const big = BigInt(text);
    if (type.startsWith("uint") && big < 0n) throw bad(`${name}: must not be negative.`);
    const bits = Number(type.replace(/^u?int/u, "") || 256);
    if (type.startsWith("uint") && big >= 1n << BigInt(bits)) throw bad(`${name}: too large for ${type}.`);
    return big;
  }
  if (type === "address") {
    if (typeof value !== "string" || !isAddress(value, { strict: false })) throw bad(`${name}: expected an address.`);
    return value.toLowerCase();
  }
  if (type === "bool") {
    if (typeof value !== "boolean") throw bad(`${name}: expected true or false.`);
    return value;
  }
  if (type === "string") {
    if (typeof value !== "string" || value.length > 512) throw bad(`${name}: expected a string (512 characters at most).`);
    return value;
  }
  if (/^bytes\d+$/u.test(type)) {
    const size = Number(type.slice(5));
    if (typeof value !== "string" || !new RegExp(`^0x[0-9a-fA-F]{${size * 2}}$`, "u").test(value)) throw bad(`${name}: expected ${type} hex.`);
    return value.toLowerCase();
  }
  if (type === "bytes") {
    if (typeof value !== "string" || !/^0x(?:[0-9a-fA-F]{2})*$/u.test(value)) throw bad(`${name}: expected hex bytes.`);
    return value;
  }
  throw bad(`${name}: the type ${type} is not supported here.`);
}

function show(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(show).join(", ")}]`;
  return typeof value === "bigint" ? value.toString() : String(value);
}

export interface PrepareInput {
  readonly network: NetworkKey;
  readonly functionName: string;
  readonly args: readonly unknown[];
  readonly by: string;
}

export async function prepareTx(ctx: AppContext, input: PrepareInput): Promise<HerdPreparedTx> {
  forgetHerdView(ctx);
  const record = await herdRecord(ctx, input.network);
  if (!record) throw new ElyiaHttpError("NOT_DEPLOYED", 409, `ElyHerd is not recorded on ${NETWORKS[input.network].name}. Deploy it first.`);
  if (!(HERD_OWNER_FUNCTIONS as readonly string[]).includes(input.functionName)) throw new ElyiaHttpError("NOT_ALLOWED", 400, `${input.functionName} is not an owner function the console prepares.`);
  const { abi, source } = await herdAbi();
  const fn = abiFunction(abi, input.functionName, input.args.length) ?? abiFunction(abi, input.functionName);
  if (!fn) throw new ElyiaHttpError("NOT_IN_ABI", 400, `${input.functionName} is not in the ElyHerd ABI (${source}).`);
  if (fn.inputs.length !== input.args.length) throw bad(`${input.functionName} takes ${fn.inputs.length} argument(s): ${fn.inputs.map((param) => `${param.type} ${param.name ?? ""}`.trim()).join(", ")}.`);
  const args = fn.inputs.map((param, index) => coerce(param, input.args[index]));
  const warnings = await guards(ctx, input.network, record.address, fn, args);
  const data = encodeFunctionData({ abi: [fn], functionName: fn.name, args: args as never }) as Hex;
  const summary = `${fn.name}(${args.map(show).join(", ")}) on ${record.address} · ${NETWORKS[input.network].name}`;
  // Simulate as the admin would send it (from the contract owner when readable).
  let owner: string | null;
  try {
    owner = String(await readHerd(ctx, input.network, record.address, "owner")).toLowerCase();
  } catch {
    owner = null;
  }
  if (owner && owner !== input.by.toLowerCase()) warnings.push(`Your session wallet is not the contract owner (${owner}); only the owner's wallet can send this.`);
  let simulation: HerdPreparedTx["simulation"] = null;
  if (ctx.chains.isAvailable(input.network)) {
    try {
      await ctx.chains.client(input.network).call({ account: (owner ?? input.by) as Address, to: record.address as Address, data });
      simulation = { ok: true, error: null };
    } catch (error) {
      const message = error instanceof Error ? (error as { shortMessage?: string }).shortMessage ?? error.message : String(error);
      simulation = { ok: false, error: message.split("\n")[0]!.slice(0, 240) };
      warnings.push(`eth_call says this would revert now: ${simulation.error}`);
    }
  }
  await audit(ctx, input.by, "tx.prepare", summary);
  return { network: input.network, chainId: getEvmNetwork(input.network).chainId, to: record.address, data, value: "0", functionName: fn.name, args: args.map(show), summary, warnings, abiSource: source, simulation };
}

/** Mirrors ElyHerd's own checks so a doomed transaction is caught before the wallet opens. */
async function guards(ctx: AppContext, network: NetworkKey, _address: string, fn: AbiFunction, args: readonly unknown[]): Promise<string[]> {
  const warnings: string[] = [];
  const view = await collectionView(ctx, network);
  const state = view.admin;
  const phase = view.phase ? HERD_PHASES.indexOf(view.phase) : 0;
  const allocations = view.allocations;
  const minted = view.totalSupply ?? 0;
  switch (fn.name) {
    case "setAllocations": {
      const [team, wl, collab, pub] = args as bigint[];
      if (view.phase && view.phase !== "closed") throw bad("Allocations lock once a phase opened. Move unminted supply with rollover instead.");
      const sum = team! + wl! + collab! + pub! + BigInt(allocations?.burned ?? 0);
      if (sum > BigInt(view.maxSupply)) throw bad(`Allocations sum to ${sum}, more than the supply of ${view.maxSupply}.`);
      if (allocations && team! < BigInt(allocations.teamMinted)) throw bad(`The team already minted ${allocations.teamMinted}.`);
      break;
    }
    case "rollover": {
      const [from, to] = [Number(args[0]), Number(args[1])];
      const name = (index: number) => HERD_BUCKETS[index] ?? `#${index}`;
      const ended = view.phase === "ended";
      const ok =
        ((from === 1 && to === 2) || (from === 2 && to === 1)) ? !ended
        : (from === 1 || from === 2) && (to === 3 || to === 4) ? phase >= 2
        : from === 3 && (to === 0 || to === 4) ? ended
        : from === 0 && to === 4 ? ended
        : false;
      if (!ok) throw bad(`Rollover ${name(from)} → ${name(to)} is not allowed now. WL ↔ collab: before ENDED. WL/collab → public or burn: from PUBLIC on. Public → team or burn, team → burn: once ENDED.`);
      if (allocations) {
        const left = [allocations.team - allocations.teamMinted, allocations.wl - allocations.wlMinted, allocations.collab - allocations.collabMinted, allocations.public - allocations.publicMinted][from];
        if (left !== undefined && (args[2] as bigint) > BigInt(left)) throw bad(`Only ${left} unminted in ${name(from)}.`);
      }
      if (to === 4) warnings.push("Burning removes that supply forever (maxMintable goes down).");
      break;
    }
    case "setPhase": {
      const next = Number(args[0]);
      if (next >= HERD_PHASES.length) throw bad(`Phase must be 0-${HERD_PHASES.length - 1} (${HERD_PHASES.join(", ")}).`);
      if (next <= phase) throw bad(`Phases only move forward (now ${view.phase ?? "closed"}).`);
      if ((HERD_PHASES[next] === "wl" || HERD_PHASES[next] === "public") && !view.reveal.provenanceHash) throw bad("Set the provenance hash first: opening a mint phase needs it.");
      if (HERD_PHASES[next] === "wl" && !view.merkleRoots.wl && !view.merkleRoots.collab) warnings.push("No WL or collab Merkle root is on chain: nobody could mint in the WL phase.");
      const window = view.timeline.find((entry) => entry.phase === HERD_PHASES[next]);
      if ((HERD_PHASES[next] === "wl" || HERD_PHASES[next] === "public") && (!window?.start || !window.end)) warnings.push(`The ${HERD_PHASES[next]} window is not set: nobody can mint until setPhaseConfig opens it.`);
      if (HERD_PHASES[next] === "public" && phase === 1) warnings.push("WL leftovers stay in the WL/collab buckets: roll them into public with rollover if you want them sold.");
      break;
    }
    case "setPhaseConfig": {
      const [p, start, end, mode, , usd] = args as [bigint, bigint, bigint, bigint, bigint, bigint];
      if (p !== 1n && p !== 2n) throw bad("Only the WL (1) and PUBLIC (2) phases have a window and a price.");
      if (end <= start) throw bad("The window must end after it starts.");
      if (mode === 1n && usd === 0n) throw bad("A USD price needs priceUsd6 > 0.");
      if (mode === 1n && !state?.oracle?.pool && (state?.oracle?.fallbackStale ?? true)) warnings.push("USD mode with no TWAP pool and no fresh fallback price: the mint would fail closed.");
      if (end < BigInt(Math.floor(ctx.clock.now() / 1000))) warnings.push("This window is already over.");
      break;
    }
    case "setMerkleRoot": {
      const list = Number(args[0]) === 1 ? "collab" : "wl";
      const build = await latestBuild(ctx, network, list);
      if (!build) warnings.push(`No ${list} list was built here; make sure this root is the one you mean.`);
      else if (build.root !== String(args[1])) warnings.push(`This root differs from the latest ${list} build (${build.root}).`);
      break;
    }
    case "setCollabCap":
      if ((args[1] as bigint) > BigInt(view.maxSupply)) throw bad("A partner cap cannot exceed the supply.");
      break;
    case "teamMint": {
      const qty = args[1] as bigint;
      if (!view.reveal.provenanceHash) throw bad("Set the provenance hash first: team mints need it.");
      if (qty === 0n) throw bad("Mint at least one.");
      const team = allocations ? BigInt(allocations.team - allocations.teamMinted) : null;
      if (team !== null && qty > team) throw bad(`Only ${team} team tokens are left.`);
      if (qty > 50n) warnings.push("Large batches cost a lot of gas: mint the team reserve in batches of 50 or fewer.");
      break;
    }
    case "setOracle": {
      const [pool, twap, deviation] = args as [string, bigint, bigint];
      if (!/^0x0{40}$/u.test(pool) && (twap < 60n || twap > 86_400n)) throw bad("The TWAP window is 60 s to 1 day.");
      if (!/^0x0{40}$/u.test(pool) && (deviation === 0n || deviation > 5_000n)) throw bad("Max deviation is 1-5000 bps.");
      warnings.push("Check the pool's observation cardinality: grow it (growOracleCardinality) to cover the TWAP window, or the TWAP fails closed.");
      break;
    }
    case "growOracleCardinality":
      if (!state?.oracle?.pool) throw bad("Set the oracle pool first.");
      break;
    case "setFallbackPrice": {
      const [price, staleness] = args as [bigint, bigint];
      if (price !== 0n && (staleness === 0n || staleness > 604_800n)) throw bad("Staleness is 1 s to 7 days.");
      break;
    }
    case "setProvenanceHash":
      if (minted > 0 || state?.revealCommitBlock) throw bad("The provenance hash locks at the first mint (or reveal commit).");
      if (/^0x0{64}$/u.test(String(args[0]))) throw bad("The provenance hash cannot be zero.");
      break;
    case "setPlaceholderURI":
    case "setBaseURI":
      if (view.reveal.frozen) throw bad("Metadata is frozen: the URIs can no longer change.");
      if (fn.name === "setBaseURI" && !/\/$/u.test(String(args[0]))) warnings.push("baseURI usually ends with a slash (tokenURI = baseURI + id).");
      break;
    case "commitReveal":
      if (view.reveal.revealed) throw bad("Already revealed.");
      if (!view.reveal.provenanceHash) throw bad("Set the provenance hash first.");
      if (view.phase !== "ended" && !view.soldOut) throw bad("Reveal commits only once the mint is over (ENDED or sold out), so nobody can time a mint for traits.");
      break;
    case "reveal":
      if (view.reveal.revealed) throw bad("Already revealed.");
      if (!state?.revealCommitBlock) throw bad("Commit the reveal first.");
      if (!state.baseURI) throw bad("Set baseURI first: revealed tokens point to baseURI + id.");
      warnings.push(`The seed is block ${state.revealCommitBlock}'s hash: reveal after it and within 256 blocks, or the commit expires and must be redone.`);
      break;
    case "freezeMetadata":
      if (!view.reveal.revealed) throw bad("Freeze only after the reveal.");
      if (view.reveal.frozen) throw bad("Already frozen.");
      warnings.push("Freezing is permanent: baseURI can never change again. Check a few tokens' metadata first.");
      break;
    case "setRoyalty": {
      if ((args[1] as bigint) > 1_000n) throw bad("Royalties are capped at 10% (1000 bps).");
      const treasury = state?.treasury ?? ctx.config.herd.treasury;
      if (treasury && String(args[0]) !== treasury) warnings.push(`The receiver is not the treasury (${treasury}).`);
      break;
    }
    case "withdraw": {
      const to = String(args[0]);
      const allowed = [state?.owner, state?.treasury].filter((value): value is string => Boolean(value));
      if (allowed.length > 0 && !allowed.includes(to)) throw bad(`Withdrawals go only to the owner or the treasury (${allowed.join(", ")}).`);
      if (state?.balanceWei === "0") warnings.push("The contract holds nothing to withdraw right now.");
      break;
    }
    case "setEoaOnly":
      if (args[0] === false) warnings.push("Contracts (smart accounts, farms) could then mint publicly. 1 per wallet still holds.");
      break;
    case "transferOwnership":
      warnings.push("Two-step: the new owner must call acceptOwnership from their wallet.");
      break;
    default:
      break;
  }
  return warnings;
}
