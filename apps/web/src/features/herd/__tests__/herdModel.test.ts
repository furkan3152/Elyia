import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { HerdConfigResponse, HerdMeResponse, HerdProofResponse } from "@elyia/core/api/herd";
import { allocationProblem, countdown, evidenceProblem, formatHype, mintCard, mintError, parseHype, parseWalletList, raiseTips, shareIntent, timeline, unixSeconds, valueToSend, wlStep, type MintInput } from "../herdModel";

const NOW = Date.parse("2026-11-10T12:00:00Z");
const WALLET = "0x00000000000000000000000000000000000000a1";

function config(patch: Partial<HerdConfigResponse> = {}): HerdConfigResponse {
  return {
    network: "elysium-testnet",
    chainId: 99801,
    testnet: true,
    source: "chain",
    address: "0x00000000000000000000000000000000000e1e00",
    note: null,
    name: "The Herd",
    symbol: "HERD",
    maxSupply: 3333,
    totalSupply: 100,
    remaining: 3233,
    soldOut: false,
    phase: "public",
    paused: false,
    allocations: { team: 111, wl: 1611, collab: 0, public: 1611, teamMinted: 0, wlMinted: 50, collabMinted: 0, publicMinted: 50, burned: 0 },
    defaults: { team: 111, public: 1611, wlAndCollab: 1611 },
    timeline: [
      { phase: "wl", start: "2026-11-09T00:00:00.000Z", end: "2026-11-10T00:00:00.000Z", priceMode: "fixed", priceWei: "1000000000000000000", priceUsd6: "0" },
      { phase: "public", start: "2026-11-10T00:00:00.000Z", end: "2026-11-12T00:00:00.000Z", priceMode: "fixed", priceWei: "1000000000000000000", priceUsd6: "0" },
    ],
    quotes: [
      { phase: "wl", wei: "1000000000000000000", source: "fixed", note: null },
      { phase: "public", wei: "1000000000000000000", source: "fixed", note: null },
    ],
    merkleRoots: { wl: `0x${"1".repeat(64)}`, collab: null },
    reveal: { revealed: false, provenanceHash: `0x${"2".repeat(64)}`, frozen: false },
    admin: null,
    open: { wl: false, public: true },
    royalty: { receiver: null, bps: 500 },
    perWallet: 1,
    deployments: [],
    links: { xProfile: null, engagementPosts: [], marketplace: null, treasury: null, mainnetLaunch: null, xApi: false },
    generatedAt: "2026-11-10T12:00:00.000Z",
    ...patch,
  };
}

const proof: HerdProofResponse = { wallet: WALLET, list: "wl", partnerTag: null, partnerTagHex: null, proof: [`0x${"3".repeat(64)}`], root: `0x${"1".repeat(64)}`, rootOnChain: true, note: null };

function input(patch: Partial<MintInput> = {}): MintInput {
  return { config: config(), wallet: WALLET, walletChainId: 99801, mintedId: 0, proof, balanceWei: 5n * 10n ** 18n, now: NOW, ...patch };
}

describe("herd mint card: every case", () => {
  it("public phase, eligible: mintPublic for the exact fixed price", () => {
    const state = mintCard(input());
    assert.equal(state.status, "ready");
    assert.deepEqual(state.action, { functionName: "mintPublic", args: [], value: 10n ** 18n });
  });

  it("a WL wallet may still mint in public if it has not minted", () => {
    assert.equal(mintCard(input({ proof })).action?.functionName, "mintPublic");
  });

  it("WL phase: allowlist with the proof, collab with the tag, others wait", () => {
    const wl = config({ phase: "wl", timeline: config().timeline.map((window) => (window.phase === "wl" ? { ...window, end: "2026-11-11T00:00:00.000Z" } : window)) });
    assert.equal(mintCard(input({ config: wl })).action?.functionName, "mintAllowlist");
    const collab = { ...proof, list: "collab" as const, partnerTag: "kalos", partnerTagHex: `0x${"6b".padEnd(64, "0")}` };
    assert.deepEqual(mintCard(input({ config: wl, proof: collab })).action?.args, [collab.partnerTagHex, collab.proof]);
    assert.equal(mintCard(input({ config: wl, proof: { ...proof, list: null, proof: [] } })).status, "not-listed");
    assert.equal(mintCard(input({ config: wl, proof: { ...proof, rootOnChain: false } })).status, "proof-pending");
    assert.equal(mintCard(input({ config: wl, proof: undefined })).status, "checking");
  });

  it("sold out, paused, ended, not deployed, unreadable", () => {
    assert.equal(mintCard(input({ config: config({ soldOut: true, totalSupply: 3333 }) })).status, "sold-out");
    assert.equal(mintCard(input({ config: config({ paused: true }) })).status, "paused");
    assert.equal(mintCard(input({ config: config({ phase: "ended" }) })).status, "ended");
    assert.equal(mintCard(input({ config: config({ source: "not-deployed", totalSupply: null }) })).status, "not-deployed");
    assert.equal(mintCard(input({ config: config({ source: "chain-error", totalSupply: null }) })).status, "unavailable");
    assert.equal(mintCard(input({ config: null })).status, "loading");
  });

  it("a phase ended with leftovers, or not open yet", () => {
    const over = config({ phase: "wl", open: { wl: false, public: false } });
    assert.equal(mintCard(input({ config: over })).status, "window-over");
    const later = config({ timeline: config().timeline.map((window) => (window.phase === "public" ? { ...window, start: "2026-11-11T00:00:00.000Z" } : window)) });
    const upcoming = mintCard(input({ config: { ...later, open: { wl: false, public: false } } }));
    assert.equal(upcoming.status, "upcoming");
    assert.equal(upcoming.until, "2026-11-11T00:00:00.000Z");
    assert.equal(mintCard(input({ config: config({ phase: "closed" }) })).status, "closed");
    // The chain says the window is open: this device's clock does not block the mint.
    assert.equal(mintCard(input({ config: { ...later, open: { wl: false, public: true } } })).status, "ready");
    assert.equal(mintCard(input({ config: config({ allocations: { ...config().allocations!, publicMinted: 1611 } }) })).status, "bucket-full");
  });

  it("oracle down fails closed; USD quotes send 1% extra (refunded)", () => {
    const down = config({ quotes: [{ phase: "public", wei: null, source: "unavailable", note: "oracle down" }] });
    assert.equal(mintCard(input({ config: down })).status, "oracle-down");
    assert.equal(valueToSend({ phase: "public", wei: "1000000", source: "twap", note: null }), 1_010_000n);
    assert.equal(valueToSend({ phase: "public", wei: "1000000", source: "fixed", note: null }), 1_000_000n);
  });

  it("wallet cases: connect, wrong network, already minted, checking, funds", () => {
    assert.equal(mintCard(input({ wallet: null })).status, "connect");
    assert.equal(mintCard(input({ walletChainId: 1 })).status, "wrong-network");
    const minted = mintCard(input({ mintedId: 42 }));
    assert.equal(minted.status, "already-minted");
    assert.match(minted.detail, /#42/u);
    assert.equal(mintCard(input({ mintedId: undefined })).status, "checking");
    assert.equal(mintCard(input({ balanceWei: 10n ** 17n })).status, "insufficient-funds");
  });

  it("explains contract reverts in words", () => {
    assert.match(mintError("execution reverted: AlreadyMinted()"), /1 per wallet/u);
    assert.match(mintError("User rejected the request."), /rejected/u);
    assert.match(mintError("EnforcedPause()"), /paused/u);
  });
});

describe("herd model helpers", () => {
  it("formats and parses HYPE", () => {
    assert.equal(formatHype("1000000000000000000"), "1 HYPE");
    assert.equal(formatHype("21300000000000000"), "0.0213 HYPE");
    assert.equal(formatHype("1"), "<0.0001 HYPE");
    assert.equal(formatHype(null), "—");
    assert.equal(parseHype("1.5"), 1_500_000_000_000_000_000n);
    assert.equal(parseHype("abc"), null);
  });

  it("builds the timeline and countdowns", () => {
    const stops = timeline(config());
    assert.deepEqual(stops.map((stop) => stop.state), ["done", "done", "now", "next"]);
    assert.equal(stops[2]!.price, "1 HYPE");
    assert.equal(countdown("2026-11-12T13:30:00.000Z", NOW), "2d 1h");
    assert.equal(countdown("2026-11-10T11:00:00.000Z", NOW), null);
  });

  it("walks the WL steps", () => {
    const me = (patch: Partial<HerdMeResponse>): HerdMeResponse => ({ wallet: WALLET, application: null, score: { score: 0, weight: 1, components: [], computedAt: "", formula: "" }, canApply: true, reason: null, reapplyLeft: 1, onList: null, pendingMove: null, ...patch });
    assert.equal(wlStep({ connected: false, signedIn: false, me: null, wanted: "tasks" }), "connect");
    assert.equal(wlStep({ connected: true, signedIn: false, me: null, wanted: null }), "sign-in");
    assert.equal(wlStep({ connected: true, signedIn: true, me: me({}), wanted: null }), "tasks");
    assert.equal(wlStep({ connected: true, signedIn: true, me: me({}), wanted: "card" }), "card");
    const applied = me({ application: { status: "approved" } as never, canApply: false });
    assert.equal(wlStep({ connected: true, signedIn: true, me: applied, wanted: "tasks" }), "status");
  });

  it("checks evidence like the server", () => {
    const task = { id: "t", kind: "share-card", label: "Share", description: null, url: null, required: true, points: 4, verification: "manual", evidence: "tweet-url", active: true, order: 1, updatedAt: "" } as const;
    assert.equal(evidenceProblem(task, "https://x.com/ely_one/status/1850000000000000001", "ely_one"), null);
    assert.match(evidenceProblem(task, "https://x.com/someone/status/1850000000000000001", "ely_one") ?? "", /not @ely_one/u);
    assert.equal(evidenceProblem(task, "", "ely_one"), "Required.");
  });

  it("makes an X intent link with the referral", () => {
    const url = new URL(shareIntent({ handle: "ely_one", referral: "1a2b3c4d", pageUrl: "https://app.example/herd/wl", score: 42, testnet: true }));
    assert.equal(url.host, "x.com");
    assert.match(url.searchParams.get("text") ?? "", /testnet/u);
    assert.equal(new URL(url.searchParams.get("url")!).searchParams.get("ref"), "1a2b3c4d");
  });

  it("orders raise-your-chance tips by points left", () => {
    const tips = raiseTips({ score: 10, weight: 1.4, computedAt: "", formula: "", components: [
      { key: "a", label: "A", measure: "", points: 5, max: 10, tip: "do a" },
      { key: "b", label: "B", measure: "", points: 0, max: 15, tip: "do b" },
      { key: "c", label: "C", measure: "", points: 5, max: 5, tip: null },
    ] });
    assert.deepEqual(tips.map((tip) => tip.label), ["B", "A"]);
  });

  it("validates admin inputs", () => {
    const list = parseWalletList("0x00000000000000000000000000000000000000A1, nope\n0x00000000000000000000000000000000000000a1");
    assert.deepEqual(list.wallets, [WALLET]);
    assert.deepEqual(list.invalid, ["nope"]);
    assert.equal(unixSeconds("2026-11-09T18:00"), Date.parse("2026-11-09T18:00:00Z") / 1000);
    assert.equal(allocationProblem({ team: 111, wl: 1611, collab: 0, public: 1611 }, 3333), null);
    assert.match(allocationProblem({ team: 111, wl: 1611, collab: 100, public: 1611 }, 3333) ?? "", /3433/u);
  });
});
