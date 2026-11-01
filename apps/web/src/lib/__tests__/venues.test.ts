import assert from "node:assert/strict";
import { test } from "node:test";

import type { VenueView } from "@elyia/core/api/intents";

import { swapVenues } from "../venueModel";

const venue = (patch: Partial<VenueView>): VenueView => ({ id: "x", label: "X", kind: "dex", network: "elysium-testnet", environment: "testnet", status: "live", actions: ["swap"], explicitOnly: false, contracts: [], notes: [], ...patch });

test("venues: live swap venues per layer, the spot book on the Floor", () => {
  const out = swapVenues(
    [
      venue({ id: "kalos-v3", label: "Kalos V3", notes: ["Uniswap V3 style. Second sentence.", "Testnet pool prices are fake."] }),
      venue({ id: "perpme", label: "PerpMe V3", explicitOnly: true }),
      venue({ id: "hyperswap-v3", network: "hyperevm-testnet" }),
      venue({ id: "hypercore-spot", kind: "trading", network: "hypercore-testnet", actions: ["order"] }),
      venue({ id: "nest", network: "elysium-mainnet", environment: "mainnet", status: "unavailable" }),
      venue({ id: "kinetiq", kind: "staking", actions: ["stake"], network: "hyperevm-testnet" }),
      venue({ id: "enso", kind: "aggregator", status: "read-only" }),
    ],
    "testnet",
  );
  assert.deepEqual(out.summit.map((item) => item.id), ["kalos-v3", "perpme"]);
  assert.deepEqual(out.ridge.map((item) => item.id), ["hyperswap-v3"]);
  assert.deepEqual(out.floor.map((item) => item.id), ["hypercore-spot"]);
  assert.equal(out.summit[0]!.note, "Uniswap V3 style.");
  assert.equal(out.summit[1]!.explicitOnly, true);
});
