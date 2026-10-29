import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MANUAL, probes, snippets, surveyCounts } from "../manual";

describe("field manual", () => {
  it("probes only parameter-free GETs", () => {
    const list = probes();
    assert.ok(list.length >= 5);
    for (const path of list) {
      assert.ok(path.startsWith("/v1/"));
      assert.ok(!path.includes(":"), path);
    }
  });

  it("counts every endpoint once", () => {
    const counts = surveyCounts();
    const total = MANUAL.reduce((sum, group) => sum + group.endpoints.length, 0);
    assert.equal(counts.open + counts.partial + counts.surveying, total);
    assert.ok(counts.surveying > 0, "unserved routes are labelled, not hidden");
  });

  it("prints snippets against the configured API base, MCP config as valid JSON", () => {
    const cards = snippets("https://api.example.test/");
    for (const card of cards) for (const code of Object.values(card.code)) assert.ok(!code!.includes("example.test//"));
    const mcp = cards.find((card) => card.id === "mcp");
    const config = JSON.parse(mcp!.code.json!) as { mcpServers: { elyia: { url: string } } };
    assert.equal(config.mcpServers.elyia.url, "https://api.example.test/v1/mcp");
  });
});
