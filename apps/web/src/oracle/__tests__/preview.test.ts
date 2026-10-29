import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { toneForToken } from "../chipTone";
import { intentHref, matchCommand, previewChips, previewTokens } from "../preview";

describe("Oracle preview", () => {
  it("colours the words of a trade by role", () => {
    const chips = previewChips("long ETH 5x with 200 USDC, stop at -3%");
    assert.deepEqual(
      chips.map((chip) => [chip.text, chip.kind]),
      [
        ["long", "verb"],
        ["ETH", "asset"],
        ["5x", "leverage"],
        ["200", "amount"],
        ["USDC,", "asset"],
        ["stop", "trigger"],
        ["-3%", "trigger"],
      ],
    );
    assert.equal(toneForToken({ text: "short", kind: "verb" }), "rose");
    assert.equal(toneForToken({ text: "long", kind: "verb" }), "mint");
  });

  it("keeps whitespace tokens so the sentence can be rebuilt", () => {
    const sentence = "bridge 20 HYPE to Elysium";
    assert.equal(previewTokens(sentence).map((token) => token.text).join(""), sentence);
    assert.deepEqual(previewChips(sentence).map((chip) => chip.kind), ["verb", "amount", "asset", "network"]);
  });

  it("marks schedules and quantity words", () => {
    assert.deepEqual(previewChips("every day buy 10 HYPE").map((chip) => chip.kind), ["schedule", "schedule", "verb", "amount", "asset"]);
    assert.equal(previewChips("swap half to USDC")[1]?.kind, "amount");
    assert.equal(toneForToken({ text: "every", kind: "schedule" }), "gold");
  });

  it("recognises lower-case well-known assets", () => {
    assert.equal(previewChips("buy hype").at(-1)?.kind, "asset");
    assert.equal(previewChips("buy khype").at(-1)?.kind, "asset");
  });
});

describe("Oracle commands", () => {
  it("routes navigation commands without planning", () => {
    assert.deepEqual(matchCommand("go trade ETH"), { href: "/app/trade/ETH", label: "Open the ETH terminal" });
    assert.equal(matchCommand("go to alerts")?.href, "/app/alerts");
    assert.equal(matchCommand("open pulse")?.href, "/elysium");
    assert.equal(matchCommand("open portfolio of 0xCD57F65c2B0e5881CFC2E609F7CD53b746E1F234")?.href, "/app/portfolio/0xCD57F65c2B0e5881CFC2E609F7CD53b746E1F234");
    assert.equal(matchCommand(`track 0x${"a".repeat(64)}`)?.href, `/app/track/0x${"a".repeat(64)}`);
  });

  it("leaves intents to the planner", () => {
    assert.equal(matchCommand("swap 10 HYPE to USDC"), null);
    assert.equal(matchCommand("swap"), null, "a bare verb is an intent, not navigation");
    assert.equal(matchCommand("go swap")?.href, "/app/swap");
    assert.equal(matchCommand("portfolio 0x12"), null);
    assert.equal(matchCommand(""), null);
  });

  it("hands intents to the deck, trimmed and encoded", () => {
    assert.equal(intentHref("  every day buy 10 HYPE "), "/app?intent=every%20day%20buy%2010%20HYPE");
    assert.equal(decodeURIComponent(intentHref("x".repeat(900)).split("=")[1]!).length, 500);
  });
});
