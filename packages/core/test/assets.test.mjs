import assert from "node:assert/strict";
import { test } from "node:test";
import {
  HYPE_SYSTEM_ADDRESS,
  NETWORKS,
  TOKENS,
  assessToken,
  coreSystemAddress,
  counterpartToken,
  findToken,
  foldTokenName,
  getToken,
  isChecksumAddressValid,
  nativeToken,
  parseAssetId,
  tokenByAddress,
  tokenForCoreIndex,
  tokensFor,
  toChecksumAddress,
} from "../dist/index.js";

test("registry integrity: unique ids, checksummed addresses, evidence on every pin", () => {
  const ids = new Set();
  for (const token of TOKENS) {
    assert.ok(!ids.has(token.id), `duplicate ${token.id}`);
    ids.add(token.id);
    assert.equal(parseAssetId(token.id)?.network.key, token.network, token.id);
    assert.ok(Number.isInteger(token.decimals) && token.decimals >= 0 && token.decimals <= 36, token.id);
    assert.ok(token.evidence.length > 10, `${token.id} needs evidence`);
    assert.ok(NETWORKS[token.network].vm === "evm", "tokens live on EVM networks");
    if (token.kind === "native") assert.equal(token.address, null);
    else {
      assert.ok(isChecksumAddressValid(token.address), token.address);
      assert.equal(toChecksumAddress(token.address), token.address, `${token.symbol} stored in EIP-55 form`);
    }
  }
  for (const network of ["elysium-testnet", "hyperevm-testnet", "hyperevm-mainnet", "elysium-mainnet"]) assert.equal(nativeToken(network)?.symbol, "HYPE");
});

test("the Elysium testnet tokens of the address book, with decimals read on-chain", () => {
  const ely = (symbol) => findToken("elysium-testnet", symbol);
  assert.equal(ely("WHYPE")?.address, "0xCD57F65c2B0e5881CFC2E609F7CD53b746E1F234");
  assert.equal(ely("USDC")?.address, "0x7D29d8047B905000459c0E80c34a26CeedcB47b2");
  assert.equal(ely("USDC")?.decimals, 6);
  assert.equal(ely("PURR")?.address, "0x5688c9Ca58435Ee982c16cCBE05eAC6993e32Bdd");
  assert.equal(ely("tKNTQ")?.address, "0x3ac6B0cE3d014215017fA36BB5D2574e5583B82f");
  assert.equal(ely("USDH")?.address, "0x9B2bb045e96C7850aFF0C6107eDc425D6b5A0B51");
  assert.equal(ely("USDH")?.decimals, 6);
  assert.equal(NETWORKS["elysium-testnet"].contracts.wrappedNative, ely("WHYPE")?.address);
  assert.equal(findToken("hyperevm-testnet", "USDC")?.address, "0x2B3370eE501B4a559b57D449569354196457D8Ab");
  assert.equal(findToken("hyperevm-mainnet", "WHYPE")?.address, "0x5555555555555555555555555555555555555555");
});

test("canonical bridge counterparts are symmetric", () => {
  for (const token of TOKENS.filter((candidate) => candidate.bridge)) {
    const other = counterpartToken(token);
    assert.ok(other, `${token.network} ${token.symbol} has a listed counterpart`);
    assert.equal(other.bridge?.route, token.bridge?.route, token.symbol);
    assert.equal(counterpartToken(other), token, `${token.symbol} round-trips`);
    assert.equal(other.decimals, token.decimals, `${token.symbol} keeps its decimals across the bridge`);
  }
  const elyUsdc = findToken("elysium-testnet", "USDC");
  assert.deepEqual(elyUsdc?.bridge, { route: "canonical", counterpart: { network: "hyperevm-testnet", address: "0x2B3370eE501B4a559b57D449569354196457D8Ab" } });
  assert.equal(counterpartToken(nativeToken("elysium-testnet"))?.network, "hyperevm-testnet");
});

test("HyperCore links: EVM decimals = weiDecimals + evmExtraWeiDecimals; system addresses", () => {
  const linked = TOKENS.filter((token) => token.coreToken);
  assert.ok(linked.length >= 8);
  for (const token of linked) {
    const core = token.coreToken;
    assert.equal(core.weiDecimals + core.evmExtraWeiDecimals, token.decimals, `${token.network} ${token.symbol}`);
    assert.match(core.tokenId, /^0x[0-9a-f]{32}$/u);
    assert.ok(NETWORKS[token.network].family === "hyperevm", "only HyperEVM tokens link to HyperCore directly");
  }
  const hype = nativeToken("hyperevm-testnet");
  assert.equal(hype?.coreToken?.index, 1105);
  assert.equal(coreSystemAddress(hype), HYPE_SYSTEM_ADDRESS);
  const purr = findToken("hyperevm-testnet", "PURR");
  assert.equal(coreSystemAddress(purr), "0x2000000000000000000000000000000000000001");
  assert.equal(tokenForCoreIndex("hyperevm-testnet", 1452)?.symbol, "USDH");
  assert.equal(coreSystemAddress(findToken("hyperevm-testnet", "USDC")), null, "testnet USDC 0x2B33 is not the Core-linked contract");
  assert.equal(findToken("elysium-testnet", "PURR")?.coreToken, undefined, "Elysium tokens reach HyperCore through HyperEVM");
});

test("findToken: per network, symbol beats alias, addresses checksum-insensitive", () => {
  assert.equal(findToken("elysium-testnet", "usdc")?.symbol, "USDC");
  assert.equal(findToken("elysium-testnet", "USDT")?.symbol, "USDT0", "alias");
  assert.equal(findToken("elysium-testnet", "USD₮0")?.symbol, "USDT0");
  assert.equal(findToken("elysium-testnet", "0x7d29d8047b905000459c0e80c34a26ceedcb47b2")?.symbol, "USDC");
  assert.equal(findToken("elysium-testnet", "eip155:99801/slip44:60")?.kind, "native");
  assert.equal(findToken("elysium-testnet", "eip155:998/slip44:60"), null, "never across networks");
  assert.equal(findToken("elysium-testnet", "UBTC"), null);
  assert.equal(findToken("hyperevm-mainnet", "UBTC")?.decimals, 8);
  assert.equal(tokenByAddress("elysium-testnet", "0x1234"), null);
  assert.equal(getToken("EIP155:99801/ERC20:0x7D29D8047B905000459C0E80C34A26CEEDCB47B2".toLowerCase())?.symbol, "USDC");
  assert.ok(tokensFor("elysium-testnet").length >= 9);
});

test("look-alikes: only registry addresses are verified", () => {
  const verified = assessToken({ network: "elysium-testnet", address: "0x7d29d8047b905000459c0e80c34a26ceedcb47b2", symbol: "USDC" });
  assert.equal(verified.status, "verified");
  const fake = assessToken({ network: "elysium-testnet", address: "0xcC6252d121Ba670e32Fad87f473201c810bF54d9", symbol: "USDC", name: "Mock USDC" });
  assert.equal(fake.status, "lookalike");
  assert.equal(fake.lookalikeOf.symbol, "USDC");
  assert.match(fake.warning, /0x7D29d8047B905000459c0E80c34a26CeedcB47b2/u);
  // Homoglyphs and lower case fold to the same name.
  assert.equal(assessToken({ network: "elysium-testnet", address: "0x0000000000000000000000000000000000000001", symbol: "USDС" }).status, "lookalike", "Cyrillic С");
  assert.equal(assessToken({ network: "elysium-testnet", address: "0x0000000000000000000000000000000000000001", symbol: "whype" }).status, "lookalike");
  assert.equal(assessToken({ network: "elysium-testnet", address: "0x0000000000000000000000000000000000000001", symbol: "HYPE" }).lookalikeOf?.kind, "native");
  assert.equal(assessToken({ network: "elysium-testnet", address: "0x0000000000000000000000000000000000000001", symbol: "MOON" }).status, "unverified");
  assert.equal(foldTokenName("USD₮0"), foldTokenName("usdt0"));
});
