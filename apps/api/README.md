# @elyia/api

The Elyia API: one Express 5 service for Elysium, HyperEVM and HyperCore data, intents,
tracking, alerts, Telegram, the Elysium Agent and MCP. The system, markets and
portfolio modules serve routes; intents, ops, agent and discovery are registered without
routes yet. Feature modules plug in under `src/modules/<name>/`.

## Run

```sh
npm run build -w @elyia/core      # the API imports @elyia/core from its dist
cp apps/api/.env.example apps/api/.env   # optional: everything has a default
npm run dev -w @elyia/api          # tsx watch on http://localhost:3001
```

Other scripts:

| script | what it does |
|---|---|
| `npm run typecheck -w @elyia/api` | `tsc --noEmit` |
| `npm test -w @elyia/api` | `node --test` over `src/**/__tests__/*.test.ts` (via tsx) |
| `npm run build -w @elyia/api` then `npm start -w @elyia/api` | compiled `dist/` |

The Postgres store tests run only when `ELYIA_TEST_DATABASE_URL` points at a throwaway
database. They create tables with a random prefix and drop them afterwards.

## Environment

All variables are optional. See [`.env.example`](./.env.example) for each variable and its default.

| variable | default | purpose |
|---|---|---|
| `PORT`, `HOST` | `3001`, `0.0.0.0` | listen address |
| `ELYIA_MODE` | `testnet` | `testnet` or `mainnet` (pulse default network, health scope) |
| `ELYIA_WEB_ORIGIN` | (none) | extra CORS origins (comma-separated). `http://localhost:5173` and `:5174` are always allowed outside production |
| `ELYIA_DATABASE_URL` | (none) | Postgres. Without it, an in-memory store is used |
| `ELYIA_SESSION_SECRET` | (none) | session signing (at least 32 characters) |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_BOT_USERNAME` | (none) | Telegram bot |
| `ANTHROPIC_API_KEY`, `ELYIA_AGENT_MODEL`, `ELYIA_AGENT_SERVER_FALLBACK` | (none) | Ely on Claude; both the key and the model are needed |
| `ELYSIUM_TESTNET_RPC_URL`, `ELYSIUM_MAINNET_RPC_URL`, `HYPEREVM_TESTNET_RPC_URL`, `HYPEREVM_MAINNET_RPC_URL` | (none) | comma-separated RPC URLs, tried before the registry's public ones |
| `HYPERDEXER_API_KEY` | (none) | Hypedexer indexer |
| `ELYIA_LOG_LEVEL` | `debug` in development, `info` in production | `debug`, `info`, `warn`, `error` or `silent` |
| `ELYIA_TRUST_PROXY` | `0` in development, `1` in production | proxy hops (per-IP limits key on the client address) |
| `ELYIA_HL_WEIGHT_PER_MIN` | `900` | Hyperliquid REST weight per minute per HyperCore network (HL allows about 1200 per IP) |
| `ELYIA_RATE_LIMIT_DEFAULT`, `_HEAVY`, `_AUTH` | `600`, `60`, `20` | requests per minute per IP |

An invalid value stops the boot with the variable's name and the rule it broke. The value
itself is never printed, because it may be a secret.

## Routes (system module)

| route | answer |
|---|---|
| `GET /health` | static liveness. No dependencies and no rate limit (for load balancers) |
| `GET /v1/health` | version, mode, uptime, a check of each RPC endpoint plus Hyperliquid info and the store (cached 15 s), pulse poller status. Answers 503 only when everything in the mode is down |
| `GET /v1/networks[?environment=]` | the core network registry plus `enabled`, `rpcConfigured` and `live` (reachable, head, latency) |
| `GET /v1/protocols[?network=&environment=]` | the core protocol registry (`PROTOCOLS`), or `[]` while core does not export one |
| `GET /v1/tokens[?network=]` | the core token registry (`TOKENS`). Without `network`, the tokens of the mode's networks |
| `GET /v1/elysium/pulse[?network=]` | a `Pulse` (core type). Waits up to 3 s for a warm poller, else 503 `PULSE_UNAVAILABLE` |
| `GET /v1/elysium/blocks/stream[?network=]` | SSE. `event: block` (`id` = block number, data = `PulseBlock`) and `event: pulse` (data = `Pulse`, about 1/s). The last pulse is sent at once on connect. `Last-Event-ID` replays buffered blocks |

`?network=elysium-mainnet` answers 503 `NETWORK_UNAVAILABLE` until `ELYSIUM_MAINNET_RPC_URL`
is set. Elysium mainnet has no public RPC before launch.

## Error contract

Every failure has this shape:

```json
{ "error": { "code": "UPPER_SNAKE", "message": "plain words", "details": { "issues": [] }, "requestId": "…" } }
```

`requestId` is also sent in the `x-request-id` header. An incoming id is echoed when it looks
like an id. 5xx responses never carry provider text, RPC URLs or stacks. Those go to the
log, sanitized. The codes the infrastructure emits are listed in `ERROR_STATUS` in
`src/http/errors.ts`.

## Writing a module

```ts
// src/modules/markets/index.ts
import type { ApiModule } from "../../http/router.js";
import { parseQuery } from "../../http/validate.js";
import { z } from "zod";

export const marketsModule: ApiModule = {
  name: "markets",
  register(router, ctx) {
    router.get("/markets", ctx.limits.heavy, async (req, res) => {
      const { dex } = parseQuery(req, z.object({ dex: z.string().max(32).optional() }));
      const [meta, ctxs] = await ctx.hyperliquid.info("hypercore-testnet").metaAndAssetCtxs(dex);
      res.json({ meta, ctxs });
    });
  },
};
```

Then add it to `MODULES` in `src/modules/index.ts`. The rules:

- Paths are relative to `/v1`. Each module gets its own sub-router, so middleware a module
  adds with `router.use` stays inside that module.
- Throw `ElyiaHttpError(code, status, message, details?)`. Async handlers may simply throw,
  because Express 5 forwards rejections. zod failures from `parseQuery`, `parseBody` and
  `parseParams` become 400 `INVALID_REQUEST` with `details.issues`.
- Rate limits: every route counts against `default`. Add `ctx.limits.heavy` for routes that
  fan out upstream, and `ctx.limits.auth` for sign-in style routes.
- Streams: `openSse(req, res, { slots: ctx.limits.streams })` returns `send(event, data, id?)`,
  `comment`, `onClose` and `close`. It provides retry, a heartbeat every 15 s, a cut for slow
  consumers, and per-IP stream slots. Replay and subscribe in the same synchronous section.
- Events: `ctx.bus.on("elysium.block", …)`. To add your own events, augment `ElyiaEvents` in
  `src/bus.ts` with `declare module`.
- Storage: `ctx.store.collection<T>("name")` provides `get`, `put`, `delete`, `list({ prefix, after, limit })`,
  `compareAndSet(id, expectedVersion | null, value)` and TTLs. `ctx.store.counters("name")`
  provides `increment`, `get` and `reset` with fixed-window TTLs. The same semantics hold in
  memory and in Postgres.
- Upstreams:
  - `ctx.chains` provides viem clients, `getBalances` (one Multicall3 round trip),
    `getBlockHeader` and `getTxReceipt`.
  - `ctx.hyperliquid.info(key)` is the HL `/info` client: cached per type, deduplicated in
    flight, and weight-budgeted.
  - `ctx.hyperliquid.ws(key)` is one shared HL WebSocket with refcounted
    `subscribe(subscription, listener)`.
  - `ctx.pulse` is the Elysium block poller.
- User-influenced outbound URLs (webhooks) must pass `assertPublicUrl` and use
  `guardedLookup` (`src/http/netguard.ts`).

## Layout

```
src/
  index.ts  server.ts  app.ts  config.ts  context.ts  log.ts  bus.ts  clock.ts
  http/         errors, request (ids, access log, sendError), router (module mounting), validate,
                limits (rate limits, SSE slots), sse, cors, netguard (SSRF guard)
  store/        Store interface, MemoryStore, PostgresStore (lazy DDL)
  chains/       evm.ts: viem clients per EVM network
  hyperliquid/  info.ts (REST), ws.ts (shared socket), weights.ts (REST budget), types.ts
  elysium/      rpc.ts (multi-endpoint JSON-RPC), pulseMath.ts, pulse.ts (poller + service)
  health/       dependencies.ts (cached probes)
  modules/      index.ts (MODULES), system/ (health, networks, registry, elysium pulse)
```

## Notes on the Elysium pulse

- Polling normally takes one round trip: a JSON-RPC batch of `eth_blockNumber` plus
  speculative `eth_getBlockByNumber` for the heights expected since the last poll. Batches
  are at most 50 headers. When the poller is further behind than that, it jumps to the head.
- Nitro timestamps have 1 s resolution, so the block time is measured on the server clock
  (`seenAt`) over the last ~60 blocks. tps counts user transactions only: Nitro puts one
  ArbOS internal transaction in every block, and that one is excluded.
- Endpoint failover:
  - A failing endpoint cools down.
  - An endpoint whose head lags ours is skipped.
  - A census every minute marks endpoints far behind the best head as stale. The public
    Hypedexer endpoint has been observed about 8 million blocks behind.
- The poller starts with the first subscriber and stops 30 s after the last one leaves.
  `GET /v1/elysium/pulse` counts as a short-lived subscriber. The last pulse stays readable
  after the poller stops.
