import assert from "node:assert/strict";
import { test } from "node:test";
import {
  FLAGGED_TOKENS,
  HYPE_SYSTEM_ADDRESS,
  NETWORKS,
  TOKENS,
  assessToken,
  flaggedToken,
  flaggedTokensFor,
  resolveToken,
  validateFlaggedTokens,
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

test("Elysium mainnet tokens are L1-anchored canonical pairs of HyperEVM mainnet tokens", () => {
  const expected = {
    WHYPE: ["0xbA876237B0F021A6c6D852d6c26E107997cC5E81", "0x5555555555555555555555555555555555555555", 18],
    USDC: ["0xb47c4C8F73F009CC0C0d3f92B388d13E293F0B65", "0xb88339CB7199b77E23DB6E890353E22632Ba630f", 6],
    kHYPE: ["0x248888D396A546A69A188f3Deb476964e581E9d0", "0xfD739d4e423301CE9385c1fb8850539D657C296D", 18],
    KNTQ: ["0xe45a355d9e9cAd2aD85F2d03E3eE3102A036acF0", "0x000000000000780555bD0BCA3791f89f9542c2d6", 18],
    USDH: ["0x87E904A076fb98eEd283AE3e3410507ce95A9326", "0x111111a1a0667d36bD57c0A9f569b98057111111", 6],
    UBTC: ["0xE9C29585EAe4B9a55b02a9605AEa892B40d972E8", "0x9FDBdA0A5e284c32744D2f17Ee5c74B284993463", 8],
    UETH: ["0x7A66A75fe41Bc26867C17fe1bc7D1C076EBd4eCd", "0xBe6727B535545C67d5cAa73dEa54865B92CF7907", 18],
  };
  assert.equal(tokensFor("elysium-mainnet").length, 1 + Object.keys(expected).length);
  for (const [symbol, [l2, l1, decimals]] of Object.entries(expected)) {
    const token = findToken("elysium-mainnet", symbol);
    assert.equal(token?.address, l2, symbol);
    assert.equal(token?.decimals, decimals, symbol);
    assert.match(token?.evidence ?? "", /L1-anchored/u, symbol);
    assert.equal(counterpartToken(token)?.address, l1, `${symbol} counterpart`);
    assert.equal(counterpartToken(token)?.network, "hyperevm-mainnet");
  }
  assert.equal(NETWORKS["elysium-mainnet"].contracts.wrappedNative, findToken("elysium-mainnet", "WHYPE")?.address);
  assert.equal(counterpartToken(nativeToken("elysium-mainnet"))?.network, "hyperevm-mainnet");
  assert.equal(findToken("elysium-mainnet", "USDT0"), null, "USD₮0 is not bridged to 99901 yet");
});

test("Elysium testnet extras: UETH and kmHYPE bridged, test stables tagged non-canonical", () => {
  const ueth = findToken("elysium-testnet", "UETH");
  assert.equal(ueth?.address, "0x3EF0cdeF58ddc22E46E6b22A214F0402D317EB7b");
  assert.equal(counterpartToken(ueth)?.coreToken?.index, 1242);
  assert.equal(findToken("elysium-testnet", "kmHYPE")?.decimals, 18);
  for (const symbol of ["tUSDC", "Oxy-USDC", "PLUMBUSD"]) {
    const token = findToken("elysium-testnet", symbol);
    assert.ok(token?.tags.includes("non-canonical") && token.tags.includes("test"), symbol);
    assert.equal(token?.group, undefined, `${symbol} is never priced as USDC`);
  }
  assert.equal(findToken("elysium-testnet", "USDC")?.address, "0x7D29d8047B905000459c0E80c34a26CeedcB47b2", "canonical USDC still wins");
});

/* ---------------------------------------- flagged tokens (census 2026-10-31) */

const CANONICAL_WHYPE = "0xCD57F65c2B0e5881CFC2E609F7CD53b746E1F234";

test("flagged tokens: 59 census look-alikes and impersonations, none a registry token", () => {
  assert.equal(FLAGGED_TOKENS.length, 59);
  assert.deepEqual(validateFlaggedTokens(FLAGGED_TOKENS), []);
  const whype = FLAGGED_TOKENS.filter((row) => row.network === "elysium-testnet" && row.imitatesSymbol === "WHYPE");
  assert.equal(whype.length, 17, "every non-canonical wrapped native the census named");
  assert.ok(whype.every((row) => row.address !== CANONICAL_WHYPE));
  assert.equal(flaggedTokensFor("elysium-mainnet").length, 1, "Supercolony's own WHYPE");
  assert.equal(flaggedTokensFor("hyperevm-testnet").length, 6, "Elypact mocks at the same address on 998");
  for (const row of FLAGGED_TOKENS) {
    assert.ok(row.tags.includes("lookalike") || row.tags.includes("suspicious"), row.address);
    assert.equal(toChecksumAddress(row.address), row.address);
    assert.match(row.evidence, /eth_getCode \d+ B/u);
    assert.equal(tokenByAddress(row.network, row.address), null, `${row.address} must never resolve as a registry token`);
  }
  // The validator refuses a flagged registry token, an unknown imitation and missing tags.
  const usdc = findToken("elysium-testnet", "USDC");
  const sample = FLAGGED_TOKENS.find((row) => row.imitatesSymbol === "USDC");
  assert.ok(validateFlaggedTokens([{ ...sample, address: usdc.address }]).some((issue) => /registry token/u.test(issue.message)));
  assert.ok(validateFlaggedTokens([{ ...sample, imitatesSymbol: "NOPE" }]).some((issue) => /not a registry token/u.test(issue.message)));
  assert.ok(validateFlaggedTokens([{ ...sample, tags: ["mock"] }]).some((issue) => /lookalike or suspicious/u.test(issue.message)));
  assert.ok(validateFlaggedTokens([sample, sample]).some((issue) => /twice/u.test(issue.message)));
});

test("assessToken warns by address for flagged tokens", () => {
  const kalosWhype = assessToken({ network: "elysium-testnet", address: "0x41051f27c609db70af05b7128f15155dc8e49ac7" });
  assert.equal(kalosWhype.status, "lookalike", "flagged even with no symbol given");
  assert.equal(kalosWhype.lookalikeOf.address, CANONICAL_WHYPE);
  assert.equal(kalosWhype.flagged?.protocol, "kalos-v3");
  assert.match(kalosWhype.warning, /never routes/u);
  const elara = assessToken({ network: "elysium-testnet", address: "0x1Fa390BE3732E758cd4Ffb2B18234803320c7a8c", symbol: "kHYPE" });
  assert.equal(elara.status, "lookalike");
  assert.equal(elara.lookalikeOf.address, "0xe26Eb188447eA470cBfdC6f770183e77345554dc");
  assert.ok(elara.flagged.tags.includes("suspicious"));
  const franklin = assessToken({ network: "elysium-testnet", address: "0xd7988a624b03d2b1d3567359af57f03464953237", symbol: "YLDEX" });
  assert.equal(franklin.status, "unverified", "nothing in the registry to be a look-alike of");
  assert.ok(franklin.flagged?.tags.includes("impersonation"));
  assert.match(franklin.warning, /Franklin/u);
  const bayc = flaggedToken("elysium-testnet", "0xecb6091a66d9dcf7a288d7c8a030a5cedb13fcf6");
  assert.equal(bayc?.standard, "erc721");
  assert.equal(bayc?.protocol, "kalos-marketplace");
  const supercolony = assessToken({ network: "elysium-mainnet", address: "0xaeb7ede82165bb12ea5c0c80ce8c0a0d05bce6af" });
  assert.equal(supercolony.status, "lookalike");
  assert.equal(supercolony.lookalikeOf.address, "0xbA876237B0F021A6c6D852d6c26E107997cC5E81");
  // Per network: the Elypact mock is flagged on both chains, against each chain's own canonical token.
  assert.equal(assessToken({ network: "hyperevm-testnet", address: "0x4B71068Ae625373ACe4B9D38AAbD102463AB7650" }).lookalikeOf?.address, "0x2B3370eE501B4a559b57D449569354196457D8Ab");
  assert.equal(flaggedToken("hyperevm-mainnet", "0x4B71068Ae625373ACe4B9D38AAbD102463AB7650"), null);
});

test("resolveToken: findToken with warnings; flagged addresses never resolve", () => {
  const whype = resolveToken("elysium-testnet", "WHYPE");
  assert.equal(whype.token?.address, CANONICAL_WHYPE);
  assert.match(whype.warning, /17 known look-alikes of WHYPE/u);
  assert.equal(resolveToken("elysium-testnet", CANONICAL_WHYPE).warning, null, "an exact canonical address needs no warning");
  const fake = resolveToken("elysium-testnet", "0x757a34dd7b411546c6dd8f510b52e4381102f9b0");
  assert.equal(fake.token, null);
  assert.equal(fake.flagged?.protocol, "perpme");
  assert.match(fake.warning, /look-alike/u);
  assert.equal(findToken("elysium-testnet", "0x757a34dd7b411546c6dd8f510b52e4381102f9b0"), null);
  assert.deepEqual(resolveToken("elysium-testnet", "MOON"), { token: null, flagged: null, warning: null });
  assert.equal(resolveToken("elysium-testnet", "KNTQ").token?.address, "0x9856148d9CAcf40F12BCAA9357ca016Ba5B0ED19");
});

test("protocol tokens the census found in use: KALOS and stKALOS", () => {
  const kalos = findToken("elysium-testnet", "KALOS");
  assert.equal(kalos?.address, "0x8a2201953AF29e8BE7700bcB53dA3ce5caD18726");
  assert.ok(kalos.tags.includes("protocol-token"));
  assert.equal(kalos.group, undefined, "never priced as anything else");
  assert.equal(findToken("elysium-testnet", "stKALOS")?.decimals, 24);
  assert.equal(assessToken({ network: "elysium-testnet", address: kalos.address }).status, "verified");
});
