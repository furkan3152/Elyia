/**
 * The ElyHerd ABI. The exported artifact (packages/contracts →
 * @elyia/core/contracts) wins whenever it exists; until then this copy of
 * packages/contracts/contracts/ElyHerd.sol's external interface is used,
 * labelled `abiSource: "spec"`.
 */
import { parseAbi, type Abi, type AbiFunction } from "viem";
import { contractArtifacts } from "../admin/artifacts.js";

export const HERD_CONTRACT = "ElyHerd" as const;

export const HERD_SPEC_ABI = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function MAX_SUPPLY() view returns (uint256)",
  "function REVEAL_DELAY_BLOCKS() view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function maxMintable() view returns (uint256)",
  "function phase() view returns (uint8)",
  "function phaseConfig(uint8 p) view returns (uint40 start, uint40 end, uint8 priceMode, uint96 priceWei, uint64 priceUsd6)",
  "function isOpen(uint8 p) view returns (bool)",
  "function allocations() view returns (uint256 team, uint256 wl, uint256 collab, uint256 pub, uint256 teamMinted, uint256 wlMinted, uint256 collabMinted_, uint256 pubMinted, uint256 burned)",
  "function collabCap(bytes32 tag) view returns (uint256)",
  "function collabMinted(bytes32 tag) view returns (uint256)",
  "function mintedBy(address account) view returns (uint256)",
  "function quote(uint8 p) view returns (uint256 priceWei)",
  "function quoteWithSource(uint8 p) view returns (uint256 priceWei, uint8 source)",
  "function merkleRoots() view returns (bytes32 wl, bytes32 collab)",
  "function paused() view returns (bool)",
  "function eoaOnly() view returns (bool)",
  "function provenanceHash() view returns (bytes32)",
  "function revealed() view returns (bool)",
  "function metadataFrozen() view returns (bool)",
  "function revealCommitBlock() view returns (uint64)",
  "function revealOffset() view returns (uint16)",
  "function metadataIndexOf(uint256 tokenId) view returns (uint256)",
  "function placeholderURI() view returns (string)",
  "function baseURI() view returns (string)",
  "function contractURI() view returns (string)",
  "function tokenURI(uint256 tokenId) view returns (string)",
  "function treasury() view returns (address)",
  "function oracle() view returns (address pool, uint32 twapSeconds, uint16 maxDeviationBps, bool usdIsToken0, uint8 usdDecimals)",
  "function fallbackPrice() view returns (uint128 usdPerHype6, uint40 updatedAt, uint32 maxStaleness)",
  "function royaltyInfo(uint256 tokenId, uint256 salePrice) view returns (address receiver, uint256 amount)",
  "function balanceOf(address owner) view returns (uint256)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function owner() view returns (address)",
  "function pendingOwner() view returns (address)",
  "function mintPublic() payable returns (uint256 id)",
  "function mintAllowlist(bytes32[] proof) payable returns (uint256 id)",
  "function mintCollab(bytes32 partnerTag, bytes32[] proof) payable returns (uint256 id)",
  "function teamMint(address to, uint256 qty)",
  "function setPhase(uint8 next)",
  "function setPhaseConfig(uint8 p, uint40 start, uint40 end, uint8 priceMode, uint96 priceWei, uint64 priceUsd6)",
  "function setAllocations(uint16 team, uint16 wl, uint16 collab, uint16 pub)",
  "function rollover(uint8 from, uint8 to, uint256 qty)",
  "function setMerkleRoot(uint8 list, bytes32 root)",
  "function setCollabCap(bytes32 partnerTag, uint256 cap)",
  "function setEoaOnly(bool value)",
  "function pause()",
  "function unpause()",
  "function setOracle(address pool, uint32 twapSeconds, uint16 maxDeviationBps)",
  "function growOracleCardinality(uint16 observationCardinalityNext)",
  "function setFallbackPrice(uint256 usdPerHype6, uint32 maxStaleness)",
  "function setProvenanceHash(bytes32 hash)",
  "function setPlaceholderURI(string uri)",
  "function setBaseURI(string uri)",
  "function setContractURI(string uri)",
  "function commitReveal()",
  "function reveal()",
  "function freezeMetadata()",
  "function setTreasury(address newTreasury)",
  "function setRoyalty(address receiver, uint96 bps)",
  "function withdraw(address to)",
  "function transferOwnership(address newOwner)",
  "function acceptOwnership()",
  "event Minted(address indexed to, uint256 indexed id, uint8 indexed phase, uint256 pricePaid)",
  "event TeamMinted(address indexed to, uint256 firstId, uint256 qty)",
  "event CollabMinted(address indexed to, uint256 indexed id, bytes32 indexed partnerTag)",
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
]);

/** Owner functions the admin console may prepare (anything else is refused). */
export const HERD_OWNER_FUNCTIONS = Object.freeze([
  "teamMint",
  "setPhase",
  "setPhaseConfig",
  "setAllocations",
  "rollover",
  "setMerkleRoot",
  "setCollabCap",
  "setEoaOnly",
  "pause",
  "unpause",
  "setOracle",
  "growOracleCardinality",
  "setFallbackPrice",
  "setProvenanceHash",
  "setPlaceholderURI",
  "setBaseURI",
  "setContractURI",
  "commitReveal",
  "reveal",
  "freezeMetadata",
  "setTreasury",
  "setRoyalty",
  "withdraw",
  "transferOwnership",
  "acceptOwnership",
]);

/** Bucket enum of `rollover` (ElyHerd.Bucket). */
export const HERD_BUCKETS = Object.freeze(["team", "wl", "collab", "public", "burn"] as const);

export interface HerdAbi {
  readonly abi: Abi;
  readonly source: "artifact" | "spec";
  readonly version: string | null;
}

export async function herdAbi(): Promise<HerdAbi> {
  const artifact = (await contractArtifacts()).get(HERD_CONTRACT);
  if (artifact && Array.isArray(artifact.abi) && artifact.abi.length > 0) return { abi: artifact.abi as Abi, source: "artifact", version: artifact.version };
  return { abi: HERD_SPEC_ABI as Abi, source: "spec", version: null };
}

export function abiFunction(abi: Abi, name: string, inputs?: number): AbiFunction | null {
  const matches = (abi as readonly { type: string; name?: string; inputs?: readonly unknown[] }[]).filter((entry) => entry.type === "function" && entry.name === name && (inputs === undefined || (entry.inputs?.length ?? 0) === inputs));
  return (matches[0] as AbiFunction | undefined) ?? null;
}

export function hasFunction(abi: Abi, name: string): boolean {
  return abiFunction(abi, name) !== null;
}
