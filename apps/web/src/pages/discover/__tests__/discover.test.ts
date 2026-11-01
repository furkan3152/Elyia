import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { assessToken, tokensFor } from "@elyia/core/assets";
import type { SpotMetaAndAssetCtxs } from "@elyia/core/hypercore/info";
import { PROTOCOLS } from "@elyia/core/protocols";
import { encodeAbiParameters } from "viem";

import { BOARD_STATUSES, boardCategories, boardKinds, boardSigns, EMPTY_FILTER, filterBoard, signNetworks, statusOf } from "../board";
import { firstAscents, radarBlips } from "../radar";
import { factsFrom, shieldCalls, shieldFromApi, shieldReport } from "../shield";

const word = (value: bigint) => encodeAbiParameters([{ type: "uint256" }], [value]);
const text = (value: string) => encodeAbiParameters([{ type: "string" }], [value]);
const address = (value: string) => encodeAbiParameters([{ type: "address" }], [value as `0x${string}`]);
const ZERO_WORD = `0x${"0".repeat(64)}`;

describe("shield", () => {
  const usdc = tokensFor("elysium-testnet").find((token) => token.symbol === "USDC")!;

  it("asks for code, the proxy slot and five calls", () => {
    assert.equal(shieldCalls(usdc.address!).length, 7);
  });

  it("opens a verified token and keeps an unlisted one at caution", () => {
    const answers = ["0x6080604052", ZERO_WORD, text("USDC"), text("USDC"), word(6n), word(1_000_000_000n), null];
    const facts = factsFrom(answers);
    assert.equal(facts.symbol, "USDC");
    assert.equal(facts.decimals, 6);
    assert.equal(facts.implementation, null);
    assert.equal(facts.owner, null);
    const verified = shieldReport(facts, assessToken({ network: "elysium-testnet", address: usdc.address!, symbol: "USDC" }));
    assert.equal(verified.condition, "open");
    const stranger = shieldReport({ ...facts, symbol: "ZZZ", name: "Zed" }, assessToken({ network: "elysium-testnet", address: "0x1111111111111111111111111111111111111111", symbol: "ZZZ" }));
    assert.equal(stranger.condition, "caution");
    assert.ok(stranger.score < 70);
  });

  it("closes look-alikes, empty addresses and upgradeable owned strangers stay below open", () => {
    const facts = factsFrom(["0x60", `0x${"0".repeat(24)}${"ab".repeat(20)}`, text("USD Coin"), text("USDC"), word(6n), word(5n), address("0x2222222222222222222222222222222222222222")]);
    assert.equal(facts.implementation, `0x${"ab".repeat(20)}`);
    assert.equal(facts.owner, "0x2222222222222222222222222222222222222222");
    const lookalike = shieldReport(facts, assessToken({ network: "elysium-testnet", address: "0x3333333333333333333333333333333333333333", symbol: "USDC" }));
    assert.equal(lookalike.condition, "closed");
    const empty = shieldReport(factsFrom(["0x", null, null, null, null, null, null]), { status: "unverified", warning: "" });
    assert.equal(empty.condition, "closed");
    assert.equal(empty.score, 0);
  });
});

describe("first ascents radar", () => {
  const data = [
    {
      tokens: [
        { name: "USDC", index: 0, szDecimals: 8, weiDecimals: 8, tokenId: "0x00", isCanonical: true, evmContract: null, fullName: null },
        { name: "PURR", index: 1, szDecimals: 0, weiDecimals: 5, tokenId: "0x01", isCanonical: true, evmContract: null, fullName: null },
        { name: "NEW", index: 9, szDecimals: 0, weiDecimals: 5, tokenId: "0x09", isCanonical: false, evmContract: { address: "0x1", evm_extra_wei_decimals: 0 }, fullName: "New One" },
        { name: "ORPHAN", index: 10, szDecimals: 0, weiDecimals: 5, tokenId: "0x0a", isCanonical: false, evmContract: null, fullName: null },
      ],
      universe: [
        { name: "PURR/USDC", tokens: [1, 0], index: 0, isCanonical: true },
        { name: "@7", tokens: [9, 0], index: 7, isCanonical: false },
      ],
    },
    [
      { coin: "PURR/USDC", prevDayPx: "0.2", markPx: "0.22", midPx: "0.22", dayNtlVlm: "50000", circulatingSupply: "1", totalSupply: "1", dayBaseVlm: "1" },
      { coin: "@7", prevDayPx: "0", markPx: "0", midPx: null, dayNtlVlm: "0", circulatingSupply: "1", totalSupply: "1", dayBaseVlm: "0" },
    ],
  ] as unknown as SpotMetaAndAssetCtxs;

  it("lists the newest tokens with a USDC book, newest first", () => {
    const ascents = firstAscents(data);
    assert.deepEqual(ascents.map((ascent) => ascent.name), ["NEW", "PURR"]);
    assert.equal(ascents[0]!.condition, "closed");
    assert.equal(ascents[0]!.evmLinked, true);
    assert.equal(ascents[1]!.condition, "caution");
    assert.ok(Math.abs(ascents[1]!.change! - 0.1) < 1e-9);
  });

  it("puts the freshest nearest the centre", () => {
    const blips = radarBlips(firstAscents(data));
    assert.ok(blips[0]!.r < blips[1]!.r);
    assert.ok(blips.every((blip) => blip.r > 0 && blip.r < 1));
  });
});

describe("trail board", () => {
  const signs = boardSigns(PROTOCOLS);

  it("files every protocol and only suggests routes where Elyia executes", () => {
    assert.equal(signs.length, PROTOCOLS.length);
    for (const sign of signs) if (sign.sentence) assert.ok(sign.executable, sign.id);
  });

  it("filters by altitude, routability and text", () => {
    const summit = filterBoard(signs, { ...EMPTY_FILTER, altitude: "summit" });
    assert.ok(summit.length > 0 && summit.every((sign) => sign.altitude === "summit"));
    assert.ok(filterBoard(signs, { ...EMPTY_FILTER, routable: true }).every((sign) => sign.executable));
    assert.ok(filterBoard(signs, { ...EMPTY_FILTER, query: "kinetiq" }).some((sign) => sign.id === "kinetiq"));
    const all = filterBoard(signs, EMPTY_FILTER);
    assert.equal(all[0]!.altitude, "summit");
    assert.equal(boardCategories(signs).reduce((sum, entry) => sum + entry.count, 0), signs.length);
  });
});

describe("trail board: kinds, statuses, networks", () => {
  const signs = boardSigns(PROTOCOLS);
  it("covers every registry row with its census kind and a board status", () => {
    assert.equal(signs.length, PROTOCOLS.length);
    assert.equal(boardKinds(signs).reduce((sum, entry) => sum + entry.count, 0), signs.length);
    assert.ok(signs.some((sign) => sign.kind === "game"));
    assert.ok(signs.every((sign) => BOARD_STATUSES.includes(sign.status)));
  });
  it("filters by kind, status, network and executable", () => {
    const games = filterBoard(signs, { ...EMPTY_FILTER, kind: "game" });
    assert.ok(games.length > 0 && games.every((sign) => sign.kind === "game"));
    const prelaunch = filterBoard(signs, { ...EMPTY_FILTER, status: "prelaunch-mainnet" });
    assert.ok(prelaunch.every((sign) => sign.status === "prelaunch-mainnet"));
    const core = filterBoard(signs, { ...EMPTY_FILTER, network: "hypercore", routable: true });
    assert.ok(core.length > 0 && core.every((sign) => sign.executable && signNetworks(sign).includes("hypercore")));
  });
  it("splits announced and pre-launch mainnet rows", () => {
    assert.equal(statusOf({ status: "announced-mainnet", mainnetPrelaunch: true, tags: [] }), "prelaunch-mainnet");
    assert.equal(statusOf({ status: "announced-mainnet", tags: [] }), "announced");
    assert.equal(statusOf({ status: "live-testnet", mainnetPrelaunch: true, tags: [] }), "live-testnet");
    assert.equal(statusOf({ status: "deprecated", tags: ["prelaunch-mainnet"] }), "deprecated");
  });
});

describe("shield: the API report under the look-alike list", () => {
  const api = {
    network: "elysium-testnet",
    token: { address: "0xfAF33d5c9244eBA93E7Ee811583E580b4614867e", symbol: "WHYPE", name: "Wrapped HYPE", decimals: 18, totalSupply: "10" },
    verdict: "no-red-flags",
    summary: "every check ran",
    registry: { verified: false, flagged: null, protocols: [], warning: null },
    bytecode: { bytes: 2041, proxy: null, privileged: [] },
    owner: { address: null, renounced: null },
    simulation: null,
    checks: [{ id: "bytecode", status: "pass", title: "Bytecode", detail: "2041 bytes" }],
    checkedAt: "2026-11-01T00:00:00Z",
    cacheSeconds: 60,
    disclaimer: "",
  } as const;
  it("a known look-alike reads CLOSED whatever the API said", () => {
    const trust = assessToken({ network: "elysium-testnet", address: api.token.address, symbol: "WHYPE" });
    const report = shieldFromApi(api as never, trust);
    assert.equal(report.condition, "closed");
    assert.equal(report.checks[0]!.result, "fail");
  });
  it("otherwise the API verdict stands", () => {
    const trust = assessToken({ network: "elysium-testnet", address: "0x0000000000000000000000000000000000000001" });
    assert.equal(shieldFromApi(api as never, trust).condition, "open");
  });
});
