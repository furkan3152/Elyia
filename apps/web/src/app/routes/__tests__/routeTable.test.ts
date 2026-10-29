import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildPath, compilePattern, matchPattern, normalizePathname } from "../matchPath";
import { documentTitle, matchRoute, robotsFor, routeHref, ROUTES } from "../routeTable";

describe("matchPattern", () => {
  it("matches literals exactly and rejects extra segments", () => {
    const pattern = compilePattern("/app/swap");
    assert.deepEqual(matchPattern(pattern, "/app/swap"), {});
    assert.equal(matchPattern(pattern, "/app/swap/x"), null);
    assert.equal(matchPattern(pattern, "/app/Swap"), null);
  });

  it("captures required, optional and decoded parameters", () => {
    const optional = compilePattern("/app/trade/:market?");
    assert.deepEqual(matchPattern(optional, "/app/trade"), { market: undefined });
    assert.deepEqual(matchPattern(optional, "/app/trade/ETH"), { market: "ETH" });
    assert.deepEqual(matchPattern(optional, "/app/trade/xyz%3ATSLA"), { market: "xyz:TSLA" });
    const required = compilePattern("/r/:id");
    assert.equal(matchPattern(required, "/r"), null);
  });

  it("never matches a malformed escape", () => {
    assert.equal(matchPattern(compilePattern("/app/trade/:market?"), "/app/trade/%E0%A4%A"), null);
  });

  it("rest segments match zero or more parts", () => {
    const rest = compilePattern("/tg/*");
    assert.deepEqual(matchPattern(rest, "/tg"), { "*": "" });
    assert.deepEqual(matchPattern(rest, "/tg/positions/ETH"), { "*": "positions/ETH" });
  });

  it("rejects invalid patterns", () => {
    assert.throws(() => compilePattern("app"));
    assert.throws(() => compilePattern("/a/*/b"));
    assert.throws(() => compilePattern("/a/:x?/b"));
  });
});

describe("buildPath and routeHref", () => {
  it("fills parameters and drops a missing optional one", () => {
    assert.equal(buildPath("/app/trade/:market?", { market: "ETH" }), "/app/trade/ETH");
    assert.equal(buildPath("/app/trade/:market?"), "/app/trade");
    assert.equal(routeHref("portfolio", { address: "0xabc" }), "/app/portfolio/0xabc");
    assert.equal(routeHref("deck"), "/app");
    assert.equal(routeHref("trade", { market: "xyz:TSLA" }), "/app/trade/xyz%3ATSLA");
  });

  it("throws on a missing required parameter", () => {
    assert.throws(() => buildPath("/r/:id"), /Missing route parameter/u);
  });
});

describe("matchRoute", () => {
  it("routes every path to its page", () => {
    const cases: ReadonlyArray<readonly [string, keyof typeof ROUTES]> = [
      ["/", "landing"],
      ["/elysium", "elysium"],
      ["/developers", "developers"],
      ["/app", "deck"],
      ["/app/trade", "trade"],
      ["/app/trade/HYPE", "trade"],
      ["/app/swap", "swap"],
      ["/app/earn", "earn"],
      ["/app/bridge", "bridge"],
      ["/app/portfolio", "portfolio"],
      ["/app/portfolio/0x1234", "portfolio"],
      ["/app/track", "track"],
      ["/app/track/0xdeadbeef", "track"],
      ["/app/agent", "agent"],
      ["/app/discover", "discover"],
      ["/app/alerts", "alerts"],
      ["/app/settings", "settings"],
      ["/tg", "miniapp"],
      ["/tg/approve/7", "miniapp"],
    ];
    for (const [path, id] of cases) assert.equal(matchRoute(path).route.id, id, path);
  });

  it("gives params and normalises trailing slashes", () => {
    const match = matchRoute("/app/trade/ETH/");
    assert.equal(match.route.id, "trade");
    assert.equal(match.params.market, "ETH");
    assert.equal(normalizePathname("/app/"), "/app");
    assert.equal(normalizePathname("/"), "/");
  });

  it("sends unknown deck paths to the in-shell 404 and the rest to the site 404", () => {
    assert.equal(matchRoute("/app/nope").route.id, "appNotFound");
    assert.equal(matchRoute("/app/nope").route.kind, "app");
    assert.equal(matchRoute("/nope").route.id, "notFound");
    assert.equal(matchRoute("/app/trade/ETH/extra").route.id, "appNotFound");
  });

  it("serves the kit only with the dev flag", () => {
    assert.equal(matchRoute("/kit").route.id, "notFound");
    assert.equal(matchRoute("/kit", { dev: true }).route.id, "kit");
  });

  it("keeps marketing routes in the site layout and the deck in the app layout", () => {
    for (const route of Object.values(ROUTES)) {
      if (route.pattern.startsWith("/app")) assert.equal(route.kind, "app", route.id);
    }
    assert.equal(ROUTES.landing.kind, "site");
    assert.equal(ROUTES.elysium.kind, "site");
  });

  it("titles and robots", () => {
    assert.equal(documentTitle(ROUTES.landing), "Elyia — your money, surveyed like a mountain");
    assert.equal(documentTitle(ROUTES.trade), "Trade · Elyia");
    assert.equal(robotsFor(ROUTES.portfolio), "noindex,nofollow");
    assert.equal(robotsFor(ROUTES.elysium), "index,follow");
  });
});
