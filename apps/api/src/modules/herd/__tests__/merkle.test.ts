import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { concat, encodeAbiParameters, keccak256, type Hex } from "viem";
import { addressLeaf, buildTree, collabLeaf, EMPTY_ROOT, hashPair, partnerTagHex, proofOf, rootOfAddresses, standardLeaf, verifyProof } from "../merkle.js";

const A1 = "0x0000000000000000000000000000000000000001";
const A2 = "0x0000000000000000000000000000000000000002";
const A3 = "0x0000000000000000000000000000000000000003";

describe("herd merkle: known vectors", () => {
  it("matches OpenZeppelin StandardMerkleTree's published example root", () => {
    // @openzeppelin/merkle-tree README: StandardMerkleTree.of(values, ["address", "uint256"]).root
    const values = [
      ["0x1111111111111111111111111111111111111111", 5000000000000000000n],
      ["0x2222222222222222222222222222222222222222", 2500000000000000000n],
    ];
    const tree = buildTree(values.map((value) => standardLeaf(["address", "uint256"], value)));
    assert.equal(tree.root, "0xd4dee0beab2d53f2cc83e567171bd2820e49898130a22622b10ead383e90bd77");
  });

  it("hashes leaves the way ElyHerd verifies them (double keccak of abi.encode)", () => {
    assert.equal(addressLeaf(A1), keccak256(keccak256(encodeAbiParameters([{ type: "address" }], [A1]))));
    assert.equal(addressLeaf(A1), "0xb5d9d894133a730aa651ef62d26b0ffa846233c74177a591a4a896adfda97d22");
  });

  it("hashes pairs sorted, like OpenZeppelin's commutative keccak", () => {
    const a = addressLeaf(A1);
    const b = addressLeaf(A2);
    const low = BigInt(a) < BigInt(b) ? a : b;
    const high = low === a ? b : a;
    assert.equal(hashPair(a, b), keccak256(concat([low, high])));
    assert.equal(hashPair(b, a), hashPair(a, b));
  });

  it("builds fixed roots for fixed sets (two and three leaves)", () => {
    const [x, y, z] = [A1, A2, A3].map(addressLeaf).sort((p, q) => (BigInt(p) < BigInt(q) ? -1 : 1)) as [Hex, Hex, Hex];
    assert.equal(rootOfAddresses([A1, A2]), hashPair(addressLeaf(A1), addressLeaf(A2)));
    // StandardMerkleTree layout for three sorted leaves x < y < z: nodes [root, H(y, x), z, y, x].
    assert.equal(rootOfAddresses([A3, A1, A2]), hashPair(hashPair(y, x), z));
    assert.equal(rootOfAddresses([A1, A2, A3]), "0x6115218373392d12cc18a3d50ad2a53a2c99b391060070dfc0ebbbbe158ec944");
    assert.equal(rootOfAddresses([A1, A2]), "0xe685571b7e25a4a0391fb8daa09dc8d3fbb3382504525f89a2334fbbf8f8e92c");
  });

  it("is order- and case-insensitive and dedupes", () => {
    assert.equal(rootOfAddresses([A3, A2, A1, A1]), rootOfAddresses([A1, A2, A3]));
    assert.equal(rootOfAddresses(["0x5B38Da6a701c568545dCfcB03FcB875f56beddC4"]), addressLeaf("0x5b38da6a701c568545dcfcb03fcb875f56beddc4"), "one leaf: the root is the leaf");
    assert.equal(buildTree([]).root, EMPTY_ROOT);
  });
});

describe("herd merkle: proofs", () => {
  it("proves every member for sizes 1..33 and refuses outsiders", () => {
    for (let size = 1; size <= 33; size += 1) {
      const addresses = Array.from({ length: size }, (_, index) => `0x${(index + 1).toString(16).padStart(40, "0")}`);
      const tree = buildTree(addresses.map(addressLeaf));
      for (const address of addresses) {
        const proof = proofOf(tree, addressLeaf(address));
        assert.ok(proof, `proof for ${address} in ${size}`);
        assert.ok(verifyProof(proof, tree.root, addressLeaf(address)), `verifies ${address} in ${size}`);
        assert.ok(proof.length <= Math.ceil(Math.log2(size)) + 1, "proof is about the tree height");
      }
      const outsider = addressLeaf("0x00000000000000000000000000000000000000ff");
      assert.equal(proofOf(tree, outsider), null);
      if (size > 1) assert.equal(verifyProof(proofOf(tree, addressLeaf(addresses[0]!))!, tree.root, outsider), false);
    }
  });

  it("binds collab leaves to their partner tag", () => {
    const tag = partnerTagHex("kalos");
    assert.equal(tag, "0x6b616c6f73000000000000000000000000000000000000000000000000000000");
    assert.equal(collabLeaf(A1, tag), keccak256(keccak256(encodeAbiParameters([{ type: "address" }, { type: "bytes32" }], [A1, tag]))));
    const tree = buildTree([collabLeaf(A1, tag), collabLeaf(A2, partnerTagHex("other"))]);
    const proof = proofOf(tree, collabLeaf(A1, tag))!;
    assert.ok(verifyProof(proof, tree.root, collabLeaf(A1, tag)));
    assert.equal(verifyProof(proof, tree.root, collabLeaf(A1, partnerTagHex("other"))), false);
  });
});
