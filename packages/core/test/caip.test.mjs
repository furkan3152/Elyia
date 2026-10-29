import assert from "node:assert/strict";
import { test } from "node:test";
import {
  accountOn,
  erc20AssetId,
  evmChecksumState,
  formatAccountId,
  isAccountId,
  keccak256Hex,
  marginAssetId,
  nativeAssetId,
  normalizeAssetId,
  parseAccountId,
  parseAssetId,
  perpAssetId,
  sameAccount,
  sameAddress,
  sameAsset,
  sameOwner,
  spotAssetId,
  toChecksumAddress,
} from "../dist/index.js";

const LOWER = "0x5e9ee1089755c3435139848e47e6635505d5a13a";

test("keccak-256 and EIP-55 match Ethereum", () => {
  assert.equal(keccak256Hex(""), "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470");
  assert.equal(keccak256Hex("transfer(address,uint256)").slice(0, 10), "0xa9059cbb");
  assert.equal(toChecksumAddress("0xcd57f65c2b0e5881cfc2e609f7cd53b746e1f234"), "0xCD57F65c2B0e5881CFC2E609F7CD53b746E1F234");
  assert.equal(evmChecksumState("0xCD57F65c2B0e5881CFC2E609F7CD53b746E1F234"), "valid");
  assert.equal(evmChecksumState(LOWER), "uncased");
  assert.equal(evmChecksumState("0xCD57F65c2B0e5881CFC2E609F7CD53b746E1F235"), "invalid");
  assert.equal(evmChecksumState("0x1234"), "invalid");
});

test("CAIP-10 accounts for eip155 and hypercore, split at the last colon", () => {
  const elysium = formatAccountId("elysium-testnet", LOWER);
  const core = formatAccountId("hypercore-testnet", LOWER);
  assert.equal(elysium, `eip155:99801:${LOWER}`);
  assert.equal(core, `hypercore:testnet:${LOWER}`);
  assert.equal(parseAccountId(core)?.network.key, "hypercore-testnet");
  assert.equal(parseAccountId(core)?.namespace, "hypercore");
  assert.equal(parseAccountId(`eip155:1:${LOWER}`), null, "unknown chains are refused");
  assert.equal(parseAccountId(`hypercore:devnet:${LOWER}`), null);
  assert.equal(parseAccountId("eip155:99801:0x1234"), null);
  assert.equal(isAccountId(elysium), true);
  assert.throws(() => formatAccountId("elysium-testnet", "0xnope"));
});

test("checksum-insensitive comparisons", () => {
  const checksummed = toChecksumAddress(LOWER);
  assert.equal(sameAddress(LOWER, checksummed), true);
  assert.equal(sameAccount(`eip155:99801:${LOWER}`, `eip155:99801:${checksummed}`), true);
  assert.equal(sameAccount(`eip155:99801:${LOWER}`, `eip155:998:${LOWER}`), false, "same chain only");
});

test("sameOwner: one 0x address is one owner across Elysium, HyperEVM and HyperCore, both directions", () => {
  const ely = `eip155:99801:${LOWER}`;
  const core = `hypercore:testnet:${toChecksumAddress(LOWER)}`;
  assert.equal(sameOwner(ely, core), true);
  assert.equal(sameOwner(core, ely), true);
  assert.equal(sameOwner(`eip155:998:${LOWER}`, LOWER), true);
  assert.equal(sameOwner(ely, "eip155:99801:0x1719884eb866cb12b2287399b15f7db5e7d775ea"), false);
  assert.equal(sameOwner(ely, "garbage"), false);
  assert.equal(accountOn(ely, "hypercore-testnet"), `hypercore:testnet:${LOWER}`);
});

test("CAIP-19 asset ids per namespace", () => {
  assert.equal(nativeAssetId("elysium-testnet"), "eip155:99801/slip44:60");
  assert.equal(erc20AssetId("hyperevm-testnet", "0x2B3370eE501B4a559b57D449569354196457D8Ab"), "eip155:998/erc20:0x2B3370eE501B4a559b57D449569354196457D8Ab");
  assert.equal(spotAssetId("testnet", 1105), "hypercore:testnet/spot:1105");
  assert.equal(perpAssetId("hypercore-mainnet", "BTC"), "hypercore:mainnet/perp:BTC");
  assert.equal(perpAssetId("testnet", "xyz:TSLA"), "hypercore:testnet/perp:xyz%3ATSLA");
  assert.equal(marginAssetId("testnet"), "hypercore:testnet/margin:usdc");
  assert.throws(() => nativeAssetId("hypercore-testnet"), /not an EVM network/u);
  assert.throws(() => spotAssetId("elysium-testnet", 1), /not a HyperCore network/u);

  assert.equal(parseAssetId("hypercore:testnet/perp:xyz%3ATSLA")?.reference, "xyz:TSLA");
  assert.equal(parseAssetId("eip155:99801/slip44:60")?.isNative, true);
  assert.equal(parseAssetId("eip155:99801/slip44:501"), null, "HYPE uses the EVM-native slip44 60");
  assert.equal(parseAssetId("hypercore:testnet/erc20:0x2B3370eE501B4a559b57D449569354196457D8Ab"), null, "no erc20 on HyperCore");
  assert.equal(parseAssetId("eip155:998/spot:1"), null, "no spot on EVM");
  assert.equal(parseAssetId("hypercore:testnet/margin:usdt"), null);
  assert.equal(parseAssetId("hypercore:testnet/spot:01"), null);
  assert.equal(sameAsset("eip155:998/erc20:0x2B3370eE501B4a559b57D449569354196457D8Ab", "eip155:998/erc20:0x2b3370ee501b4a559b57d449569354196457d8ab"), true);
  assert.equal(normalizeAssetId("eip155:998/erc20:0x2B3370eE501B4a559b57D449569354196457D8Ab"), "eip155:998/erc20:0x2b3370ee501b4a559b57d449569354196457d8ab");
});
