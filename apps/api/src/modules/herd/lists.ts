/**
 * Allowlists: the WL list (approved applications), collab partner lists
 * (wallets per partner tag, each with a cap), the testnet → mainnet
 * snapshot (WL-approved + collab + testnet minters), Merkle builds and
 * proofs. A build is stored with its leaves, so proofs always match the
 * root that was built; `rootOnChain` says whether the admin published it.
 */
import type { NetworkKey } from "@elyia/core";
import type { HerdListId, HerdMerkleBuild, HerdPartner, HerdProofResponse, HerdSnapshot, HerdSnapshotEntry } from "@elyia/core/api/herd";
import type { Hex } from "viem";
import type { AppContext } from "../../context.js";
import { ElyiaHttpError } from "../../http/errors.js";
import { docs, PLATFORM_COLLECTIONS } from "../ops/docs.js";
import { approvedWallets } from "./applications.js";
import { collectionView } from "./chain.js";
import { allTokens } from "./indexer.js";
import { addressLeaf, buildTree, collabLeaf, LEAF_ENCODING, partnerTagHex, proofOf } from "./merkle.js";
import { audit } from "./state.js";

interface BuildDoc extends HerdMerkleBuild {
  /** wl/snapshot: addresses; collab: "address:tag". */
  readonly members: readonly string[];
}

const builds = (ctx: AppContext) => docs<BuildDoc>(ctx, PLATFORM_COLLECTIONS.herdMerkle);
const partners = (ctx: AppContext) => docs<HerdPartner>(ctx, PLATFORM_COLLECTIONS.herdPartners);

/* ----------------------------------------------------------- partners */

export async function listPartners(ctx: AppContext): Promise<HerdPartner[]> {
  return (await partners(ctx).list({ limit: 500 })).map((row) => row.value);
}

export async function putPartner(ctx: AppContext, by: string, tag: string, input: { readonly name: string; readonly cap: number; readonly wallets: readonly string[] }): Promise<HerdPartner> {
  const wallets = [...new Set(input.wallets.map((wallet) => wallet.toLowerCase()))].sort();
  const partner: HerdPartner = { tag, tagHex: partnerTagHex(tag), name: input.name, cap: input.cap, wallets, updatedAt: new Date(ctx.clock.now()).toISOString() };
  await partners(ctx).put(tag, partner);
  await audit(ctx, by, "partner.put", `${tag} "${input.name}" cap ${input.cap}, ${wallets.length} wallet(s)${wallets.length > input.cap ? " (more wallets than the cap: the cap still limits mints on chain)" : ""}`);
  return partner;
}

export async function deletePartner(ctx: AppContext, by: string, tag: string): Promise<boolean> {
  const removed = await partners(ctx).delete(tag);
  if (removed) await audit(ctx, by, "partner.delete", tag);
  return removed;
}

/* ----------------------------------------------------------- snapshot */

export async function snapshotEntries(ctx: AppContext, network: NetworkKey): Promise<HerdSnapshotEntry[]> {
  const reasons = new Map<string, Set<HerdSnapshotEntry["reasons"][number]>>();
  const add = (address: string, reason: HerdSnapshotEntry["reasons"][number]) => {
    const key = address.toLowerCase();
    const set = reasons.get(key) ?? new Set();
    set.add(reason);
    reasons.set(key, set);
  };
  for (const wallet of await approvedWallets(ctx)) add(wallet, "wl-approved");
  for (const partner of await listPartners(ctx)) for (const wallet of partner.wallets) add(wallet, "collab");
  // Testnet minters (team reserve mints excluded: they go to team wallets).
  for (const token of await allTokens(ctx, network)) if (token.minter && token.bucket !== "team") add(token.minter, "minted");
  return [...reasons.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([address, set]) => ({ address, reasons: [...set].sort() }));
}

export async function snapshot(ctx: AppContext, network: NetworkKey): Promise<HerdSnapshot> {
  const entries = await snapshotEntries(ctx, network);
  return { network, generatedAt: new Date(ctx.clock.now()).toISOString(), count: entries.length, root: buildTree(entries.map((entry) => addressLeaf(entry.address))).root, leafEncoding: LEAF_ENCODING.address, entries };
}

/* ------------------------------------------------------------- builds */

async function membersOf(ctx: AppContext, network: NetworkKey, list: HerdListId): Promise<string[]> {
  if (list === "wl") return approvedWallets(ctx);
  if (list === "collab") return (await listPartners(ctx)).flatMap((partner) => partner.wallets.map((wallet) => `${wallet}:${partner.tag}`)).sort();
  return (await snapshotEntries(ctx, network)).map((entry) => entry.address);
}

function leafOf(list: HerdListId, member: string): Hex {
  if (list === "collab") {
    const [address, tag] = member.split(":");
    return collabLeaf(address!, partnerTagHex(tag!));
  }
  return addressLeaf(member);
}

function chainRoot(view: Awaited<ReturnType<typeof collectionView>>, list: HerdListId): string | null {
  if (view.source !== "chain") return null;
  return list === "wl" ? view.merkleRoots.wl : list === "collab" ? view.merkleRoots.collab : null;
}

export async function buildList(ctx: AppContext, by: string, network: NetworkKey, list: HerdListId): Promise<HerdMerkleBuild> {
  const members = await membersOf(ctx, network, list);
  const tree = buildTree(members.map((member) => leafOf(list, member)));
  const view = await collectionView(ctx, network);
  const doc: BuildDoc = { list, network, root: tree.root, count: members.length, leafEncoding: list === "collab" ? LEAF_ENCODING.collab : LEAF_ENCODING.address, builtAt: new Date(ctx.clock.now()).toISOString(), builtBy: by, onChainRoot: chainRoot(view, list), members };
  await builds(ctx).put(`${network}:${list}`, doc);
  await audit(ctx, by, `merkle.build`, `${list} on ${network}: ${members.length} leaves, root ${tree.root}`);
  const { members: _members, ...rest } = doc;
  return rest;
}

export async function latestBuild(ctx: AppContext, network: NetworkKey, list: HerdListId): Promise<BuildDoc | null> {
  return (await builds(ctx).get(`${network}:${list}`))?.value ?? null;
}

export async function buildsOf(ctx: AppContext, network: NetworkKey): Promise<HerdMerkleBuild[]> {
  const view = await collectionView(ctx, network);
  const out: HerdMerkleBuild[] = [];
  for (const list of ["wl", "collab", "snapshot"] as const) {
    const doc = await latestBuild(ctx, network, list);
    if (doc) {
      const { members: _members, ...rest } = doc;
      out.push({ ...rest, onChainRoot: chainRoot(view, list) });
    }
  }
  return out;
}

/** Export: every member with its proof against the stored build. */
export async function exportBuild(ctx: AppContext, network: NetworkKey, list: HerdListId): Promise<{ build: HerdMerkleBuild; entries: { member: string; leaf: string; proof: string[] }[] }> {
  const doc = await latestBuild(ctx, network, list);
  if (!doc) throw new ElyiaHttpError("NOT_FOUND", 404, `No ${list} build yet: build the list first.`);
  const tree = buildTree(doc.members.map((member) => leafOf(list, member)));
  const { members, ...build } = doc;
  return { build, entries: members.map((member) => ({ member, leaf: leafOf(list, member), proof: proofOf(tree, leafOf(list, member)) ?? [] })) };
}

/* ------------------------------------------------------------- proofs */

export async function proofFor(ctx: AppContext, network: NetworkKey, wallet: string): Promise<HerdProofResponse> {
  const who = wallet.toLowerCase();
  const view = await collectionView(ctx, network);
  const empty = (note: string): HerdProofResponse => ({ wallet: who, list: null, partnerTag: null, partnerTagHex: null, proof: [], root: null, rootOnChain: null, note });
  const wl = await latestBuild(ctx, network, "wl");
  if (wl?.members.includes(who)) {
    const tree = buildTree(wl.members.map((member) => leafOf("wl", member)));
    const onChain = chainRoot(view, "wl");
    return { wallet: who, list: "wl", partnerTag: null, partnerTagHex: null, proof: proofOf(tree, addressLeaf(who)) ?? [], root: tree.root, rootOnChain: onChain === null ? null : onChain === tree.root, note: onChain !== null && onChain !== tree.root ? "Approved, but the WL root on chain is not this list yet. The admin publishes it before the WL phase." : null };
  }
  const collab = await latestBuild(ctx, network, "collab");
  const member = collab?.members.find((entry) => entry.startsWith(`${who}:`));
  if (collab && member) {
    const tag = member.split(":")[1]!;
    const tree = buildTree(collab.members.map((entry) => leafOf("collab", entry)));
    const onChain = chainRoot(view, "collab");
    return { wallet: who, list: "collab", partnerTag: tag, partnerTagHex: partnerTagHex(tag), proof: proofOf(tree, leafOf("collab", member)) ?? [], root: tree.root, rootOnChain: onChain === null ? null : onChain === tree.root, note: onChain !== null && onChain !== tree.root ? "On a partner list, but that root is not on chain yet." : null };
  }
  const approved = (await approvedWallets(ctx)).includes(who);
  return empty(approved ? "Approved: the WL list is being built. Check back before the WL phase." : "This wallet is not on the WL or a partner list. Public mint is open to everyone.");
}
