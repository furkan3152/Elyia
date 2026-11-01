import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { keccak256, toHex, type Hex } from "viem";
import { drawWinners, entrantsHash, raffleSeed, sortEntrants } from "../raffle.js";

const entrants = Array.from({ length: 40 }, (_, index) => ({ wallet: `0x${(index + 1).toString(16).padStart(40, "0")}`, weight: 1 + (index % 5) }));
const BLOCK: Hex = `0x${"ab".repeat(32)}`;

describe("herd raffle: determinism", () => {
  it("same block, same entrants, same id: same winners in the same order", () => {
    const hash = entrantsHash(entrants);
    const seed = raffleSeed(BLOCK, hash, "rfl_test");
    const first = drawWinners(entrants, seed, 10);
    const second = drawWinners([...entrants].reverse(), raffleSeed(BLOCK, entrantsHash([...entrants].reverse()), "rfl_test"), 10);
    assert.deepEqual(first, second);
    assert.equal(new Set(first).size, 10, "no wallet wins twice");
  });

  it("the entrants hash ignores order and case but not weights", () => {
    const upper = entrants.map((entrant) => ({ ...entrant, wallet: entrant.wallet.toUpperCase().replace("0X", "0x") }));
    assert.equal(entrantsHash(upper), entrantsHash([...entrants].reverse()));
    assert.notEqual(entrantsHash(entrants.map((entrant, index) => (index === 0 ? { ...entrant, weight: 4.2 } : entrant))), entrantsHash(entrants));
  });

  it("another block hash or raffle id gives another draw", () => {
    const hash = entrantsHash(entrants);
    const a = drawWinners(entrants, raffleSeed(BLOCK, hash, "rfl_a"), 10);
    const b = drawWinners(entrants, raffleSeed(`0x${"cd".repeat(32)}`, hash, "rfl_a"), 10);
    const c = drawWinners(entrants, raffleSeed(BLOCK, hash, "rfl_b"), 10);
    assert.notDeepEqual(a, b);
    assert.notDeepEqual(a, c);
  });

  it("drops zero weights and caps winners at the pool", () => {
    const pool = [...entrants.slice(0, 3), { wallet: `0x${"9".repeat(40)}`, weight: 0 }];
    assert.equal(sortEntrants(pool).length, 3);
    assert.equal(drawWinners(pool, raffleSeed(BLOCK, entrantsHash(pool), "x"), 10).length, 3);
  });

  it("heavier weights win more often (5× vs 1×)", () => {
    const pool = [
      { wallet: `0x${"1".repeat(40)}`, weight: 5 },
      { wallet: `0x${"2".repeat(40)}`, weight: 1 },
    ];
    let heavy = 0;
    for (let round = 0; round < 600; round += 1) {
      const [winner] = drawWinners(pool, keccak256(toHex(`round-${round}`)), 1);
      if (winner === pool[0]!.wallet) heavy += 1;
    }
    // Expected 500 of 600 (5/6); a wide band keeps the test stable.
    assert.ok(heavy > 440 && heavy < 560, `heavy won ${heavy} of 600`);
  });
});
