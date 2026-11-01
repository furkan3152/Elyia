/**
 * Merkle allowlists, OpenZeppelin-compatible end to end:
 *
 * - leaves use OpenZeppelin's StandardMerkleTree encoding (what ElyHerd
 *   verifies): keccak256(bytes.concat(keccak256(abi.encode(...values))))
 *     WL / snapshot: (address)
 *     collab:        (address, bytes32 partnerTag)
 * - pairs hash sorted (MerkleProof's commutative keccak256);
 * - the tree is StandardMerkleTree's layout: hashed leaves sorted ascending,
 *   a complete binary tree in one array (leaves at the end, reversed), so a
 *   root here equals `StandardMerkleTree.of(values, types).root` and every
 *   proof verifies with `MerkleProof.verify`.
 */
import { concat, encodeAbiParameters, keccak256, stringToHex, type Hex } from "viem";

export const LEAF_ENCODING = Object.freeze({
  address: "keccak256(bytes.concat(keccak256(abi.encode(address))))",
  collab: "keccak256(bytes.concat(keccak256(abi.encode(address, bytes32 partnerTag))))",
});

/** StandardMerkleTree leaf of `values` encoded as `types`. */
export function standardLeaf(types: readonly string[], values: readonly unknown[]): Hex {
  return keccak256(keccak256(encodeAbiParameters(types.map((type) => ({ type })), values as never)));
}

export function addressLeaf(address: string): Hex {
  return standardLeaf(["address"], [address.toLowerCase()]);
}

export function collabLeaf(address: string, tagHex: Hex): Hex {
  return standardLeaf(["address", "bytes32"], [address.toLowerCase(), tagHex]);
}

/** A partner tag as bytes32: the UTF-8 tag, right-padded ("kalos" -> 0x6b616c6f73…00). Tags are 1-31 bytes. */
export function partnerTagHex(tag: string): Hex {
  return stringToHex(tag, { size: 32 });
}

function compare(a: Hex, b: Hex): number {
  const x = BigInt(a);
  const y = BigInt(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

export function hashPair(a: Hex, b: Hex): Hex {
  return compare(a, b) <= 0 ? keccak256(concat([a, b])) : keccak256(concat([b, a]));
}

export interface MerkleTree {
  readonly root: Hex;
  /** The whole tree, StandardMerkleTree layout (index 0 = root). */
  readonly nodes: readonly Hex[];
  /** Sorted leaves; leaf i sits at nodes[nodes.length - 1 - i]. */
  readonly leaves: readonly Hex[];
}

export const EMPTY_ROOT: Hex = `0x${"0".repeat(64)}`;

export function buildTree(input: readonly Hex[]): MerkleTree {
  const leaves = [...new Set(input.map((leaf) => leaf.toLowerCase() as Hex))].sort(compare);
  if (leaves.length === 0) return { root: EMPTY_ROOT, nodes: [], leaves };
  const nodes = new Array<Hex>(2 * leaves.length - 1);
  for (const [index, leaf] of leaves.entries()) nodes[nodes.length - 1 - index] = leaf;
  for (let index = nodes.length - 1 - leaves.length; index >= 0; index -= 1) nodes[index] = hashPair(nodes[2 * index + 1]!, nodes[2 * index + 2]!);
  return { root: nodes[0]!, nodes, leaves };
}

/** The proof of `leaf`, or null when the leaf is not in the tree. */
export function proofOf(tree: MerkleTree, leaf: Hex): Hex[] | null {
  const position = tree.leaves.indexOf(leaf.toLowerCase() as Hex);
  if (position < 0) return null;
  const proof: Hex[] = [];
  let index = tree.nodes.length - 1 - position;
  while (index > 0) {
    proof.push(tree.nodes[index % 2 === 1 ? index + 1 : index - 1]!);
    index = Math.floor((index - 1) / 2);
  }
  return proof;
}

/** MerkleProof.verify, in TypeScript. */
export function verifyProof(proof: readonly Hex[], root: Hex, leaf: Hex): boolean {
  let computed = leaf.toLowerCase() as Hex;
  for (const node of proof) computed = hashPair(computed, node);
  return computed === root.toLowerCase();
}

export function rootOfAddresses(addresses: readonly string[]): Hex {
  return buildTree(addresses.map(addressLeaf)).root;
}
