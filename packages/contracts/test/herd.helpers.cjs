// Helpers for the ElyHerd tests: an OpenZeppelin-compatible Merkle tree (StandardMerkleTree leaf
// encoding, sorted-pair hashing as in MerkleProof) and the shared enums.
const { ethers } = require("hardhat");

const coder = ethers.AbiCoder.defaultAbiCoder();
const Phase = { CLOSED: 0, WL: 1, PUBLIC: 2, ENDED: 3 };
const PriceMode = { FIXED: 0, USD: 1 };
const PriceSource = { FIXED: 0, TWAP: 1, FALLBACK: 2 };
const ListId = { WL: 0, COLLAB: 1 };
const Bucket = { TEAM: 0, WL: 1, COLLAB: 2, PUBLIC: 3, BURN: 4 };

/** keccak256(bytes.concat(keccak256(abi.encode(...values)))) — the StandardMerkleTree leaf. */
function leaf(types, values) {
  return ethers.keccak256(ethers.keccak256(coder.encode(types, values)));
}
const wlLeaf = (account) => leaf(["address"], [account]);
const collabLeaf = (account, tag) => leaf(["address", "bytes32"], [account, tag]);

function hashPair(a, b) {
  return BigInt(a) < BigInt(b) ? ethers.keccak256(ethers.concat([a, b])) : ethers.keccak256(ethers.concat([b, a]));
}

/** Binary Merkle tree over `leaves` (odd nodes are promoted). Returns root and a proof getter. */
function merkle(leaves) {
  if (leaves.length === 0) return { root: ethers.ZeroHash, proof: () => [] };
  const layers = [leaves.slice()];
  while (layers[layers.length - 1].length > 1) {
    const cur = layers[layers.length - 1];
    const next = [];
    for (let i = 0; i < cur.length; i += 2) next.push(i + 1 < cur.length ? hashPair(cur[i], cur[i + 1]) : cur[i]);
    layers.push(next);
  }
  const proof = (lf) => {
    let idx = leaves.indexOf(lf);
    if (idx < 0) throw new Error("leaf not in tree");
    const out = [];
    for (let l = 0; l < layers.length - 1; l++) {
      const sib = idx ^ 1;
      if (sib < layers[l].length) out.push(layers[l][sib]);
      idx >>= 1;
    }
    return out;
  };
  return { root: layers[layers.length - 1][0], proof };
}

const tag = (s) => ethers.encodeBytes32String(s);

/** Off-chain reference of ElyHerd's USD -> wei at a tick (float, for tolerance checks). */
function usdToWeiRef(usd6, usdDecimals, tick, usdIsToken0) {
  const usdRaw = Number(usd6) * 10 ** (usdDecimals - 6);
  const p = Math.pow(1.0001, tick); // token1 per token0 (raw)
  return usdIsToken0 ? usdRaw * p : usdRaw / p;
}

module.exports = { Phase, PriceMode, PriceSource, ListId, Bucket, wlLeaf, collabLeaf, merkle, tag, usdToWeiRef };
