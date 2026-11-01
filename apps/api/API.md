# Elyia API reference

Every route the API serves, with its parameters, the response type in
`@elyia/core` (import paths below) and an example. Base URL in the examples:
`http://localhost:3001` (set `PORT`). All routes but `GET /health` live under
`/v1`.

## Conventions

- **Errors** use one envelope: `{ "error": { "code", "message", "details", "requestId" } }`
  with the HTTP status of the code (400 `INVALID_REQUEST`, 404 `NOT_FOUND`,
  422 `INTENT_CLARIFY`, 429 `RATE_LIMITED` / `TOO_MANY_STREAMS`, 503
  `NETWORK_UNAVAILABLE` ...). Every query, body and path parameter is
  validated (zod): an unknown filter value is a 400, never an empty list.
- **Request id**: send `x-request-id` to correlate; it is echoed back.
- **Rate limits** per IP: `default` 600/min on every route, `heavy` 60/min on
  routes marked *heavy* (they fan out upstream), `auth` 20/min.
- **Caching**: shared data carries `Cache-Control: public, max-age=N`
  (noted per route); everything else is `no-store`.
- **SSE** streams send `retry: 3000`, a comment heartbeat every 15 s, close
  after 30 min, and honour `Last-Event-ID` where noted. Open streams are
  limited per IP.
- **Prices**: USD values are HyperCore *mainnet* `allMids`, labelled
  `reference` (`priceSource: "reference:hypercore-mainnet-mids"`). Testnet
  pool prices are fake and never shown as USD.
- **Networks** are core keys: `elysium-testnet`, `elysium-mainnet`,
  `hyperevm-testnet`, `hyperevm-mainnet`, `hypercore-testnet`,
  `hypercore-mainnet`. Defaults follow `ELYIA_MODE` (testnet).
- The server never signs or sends a transaction with a user's wallet key (it
  holds none). Intents return unsigned payloads; Shield and the smoke tools
  only simulate. The one exception is opt-in Keeper mode: a trade-only
  HyperCore agent key the owner approves, capped, expiring and revocable,
  that only places reduce-only orders.

Type paths: `core` = `@elyia/core`, `api/x` = `@elyia/core/api/x`.

---

## System

### `GET /health`
Liveness probe outside `/v1`. Response: `{ status: "ok", service, version }`.
```sh
curl -s localhost:3001/health
```

### `GET /v1/health`
Dependencies (RPC endpoints and HyperCore info of the mode, the store), cached
15 s; 503 only when every dependency is down. Also `registry`: the protocol
registry size and the ids the running engine executes.
Response (inline): `{ status: "ok"|"degraded"|"down", service, version, mode, build, time, uptimeSeconds, checkedAt, dependencies: { store, networks[] }, pulse, hyperliquidWs, registry: { protocols, executable, executableIds[] }, features: { database, sessions, telegram, agent } }`.
```sh
curl -s localhost:3001/v1/health
```

### `GET /v1/networks?environment=testnet|mainnet`
The core network registry (`core` `Network`) with live probes. Cache 5 s.
Response (inline): `{ mode, networks: (Network & { enabled, rpcConfigured, live: { reachable, head, latencyMs, checkedAt, note? } | null })[] }`.
```sh
curl -s "localhost:3001/v1/networks?environment=testnet"
```

### `GET /v1/tokens?network=`
Verified tokens (`core` `TokenDescriptor`) of one network, or of every network of the mode. Cache 60 s.
Response (inline): `{ network: NetworkKey|null, mode, count, tokens: TokenDescriptor[] }`.
```sh
curl -s "localhost:3001/v1/tokens?network=elysium-testnet"
```

### `GET /v1/elysium/pulse?network=`
Live Elysium chain health from the block poller. Response: `core` `Pulse`. 503 `PULSE_UNAVAILABLE` while warming up.
```sh
curl -s localhost:3001/v1/elysium/pulse
```

### `GET /v1/elysium/blocks/stream?network=` (SSE)
Events `block` (`core` `PulseBlock`, `id:` = block number; `Last-Event-ID` replays) and `pulse` (`Pulse`, about once per second).
```sh
curl -sN localhost:3001/v1/elysium/blocks/stream
```

---

## Discovery (`api/discovery`)

### `GET /v1/protocols`
The protocol registry as this server runs it: core rows with `executable`
taken from the engine's adapters (`activeProtocolIds` -> `withExecutable`).
Cache 60 s.

| query | values |
|---|---|
| `network` | a network key: rows with a deployment there |
| `environment` | `testnet` / `mainnet` |
| `kind` | exact kind (`dex`, `launchpad`, `nft`, `game` ...) |
| `category` | kind or coarse category (`launchpad` also matches NFT rows) |
| `status` | `live-mainnet`, `live-testnet`, `announced-mainnet`, `unknown`, `deprecated` |
| `executable` | `true` / `false` |
| `tag` | a registry tag (`prelaunch-mainnet`, `lookalike-tokens` ...) |
| `q` | 2-64 chars, every word must match id, name, description, tags, contract roles or addresses |
| `view` | `full` (default, `ProtocolDescriptor`) or `summary` (`ProtocolSummary`) |

Response: `ProtocolListResponse` (`count`, `protocols`, `counts.byKind`, `counts.byStatus` of the filtered rows, `total`, `executableIds`).
```sh
curl -s "localhost:3001/v1/protocols?network=hyperevm-testnet&kind=dex&executable=true&view=summary"
curl -s "localhost:3001/v1/protocols?q=kalos"
```

### `GET /v1/protocols/live?network=` (heavy)
Per protocol on one EVM network (default: the mode's Elysium): bytecode
presence of every registry contract (batched EXTCODESIZE, one deployless
`eth_call` per 150 addresses) and recent activity (address-filtered
`eth_getLogs` over the network's log window: 2,000 blocks on Elysium, 50 on
HyperEVM). Cached 10 min, concurrent callers share one check. `recentLogs` /
`active` are `null` when the logs could not be read. Response: `ProtocolLiveResponse`.
```sh
curl -s "localhost:3001/v1/protocols/live?network=elysium-testnet"
```

### `GET /v1/protocols/:id`
One registry row. 404 for an unknown id. Response: `ProtocolDetailResponse`.
```sh
curl -s localhost:3001/v1/protocols/hyperswap-v3
```

### `GET /v1/addresses/:address/protocols?network=`
Registry contracts at an address (any case) and, when it is one, the flagged
look-alike / suspicious token. Response: `AddressLookupResponse`.
```sh
curl -s localhost:3001/v1/addresses/0x752f6816bc514e1eeff852b2eadcd96f6c0f9f3f/protocols
```

### `GET /v1/tokens/flagged?network=`
Look-alike and suspicious tokens (never routable). Cache 300 s. Response: `FlaggedTokenListResponse`.
```sh
curl -s "localhost:3001/v1/tokens/flagged?network=elysium-testnet"
```

### `GET /v1/discovery/launches?network=&protocol=&kind=&limit=`
The launch radar: new V2 pairs, V3 / Algebra pools, V4 pools and launch tokens
from the factories and launchpads of the verified registry (58 sources on
Elysium testnet). Scans one address-filtered `eth_getLogs` per window (at most
2,000 blocks), backfills the last 3 windows, then follows the head every 30 s;
dedupes by event and by token; launchpad events count only when an indexed
address answers as an ERC-20. `kind`: `v2-pair`, `v3-pool`, `v4-pool`,
`launchpad-event`; `limit` 1-300 (default 50). Newest first. The radar starts
with the server (mode's Elysium) or on the first request. Cache 5 s.
Response: `LaunchesResponse`.
```sh
curl -s "localhost:3001/v1/discovery/launches?limit=10"
```

### `GET /v1/discovery/launches/stream` (SSE)
Same filters. Sends `status` (the radar status), replays up to `limit`
(default 20) buffered launches oldest first, then follows. Event `launch`
(`LaunchView`, `id:` = launch id; `Last-Event-ID` resumes after it). Names
in `LAUNCH_STREAM_EVENTS`. 503 when the network has no RPC.
```sh
curl -sN "localhost:3001/v1/discovery/launches/stream?limit=5"
```

### `GET /v1/discovery/shield/:token?network=` (heavy)
What can be proven about a token: registry (verified list, `FLAGGED_TOKENS`
look-alikes, name imitation, registry contracts at the address), bytecode
(present, EIP-1167 clone, EIP-1967 / beacon proxy with implementation and
admin, privileged selectors such as mint / pause / blacklist / fees /
upgrades in the code it runs), `owner()` and ERC-20 metadata; for unverified,
unflagged tokens a dry-run buy through the first executable engine venue that
plans it and the sell back, run together in one `eth_simulateV1` from a dummy
account funded by state overrides (buy / sell tax from the logs, a reverting
sell is a possible honeypot). Nothing is signed or broadcast. Verdict:
`verified`, `flagged`, `danger`, `caution`, `no-red-flags` or `unknown`,
never "safe". Cached 5 min per token. 503 when the network has no RPC.
Response: `ShieldReport`.
```sh
curl -s "localhost:3001/v1/discovery/shield/0xD089Ff84573e35626AAe2Cc92d1acFc4B3E225E1?network=elysium-testnet"
```

### `GET /v1/elysium/stats?network=`
Ecosystem figures, each a `StatFigure { value, basis: measured|estimate|registry, source }`:
chain (head, block time, tx/s, gas from the pulse; blocks and tx per day as
estimates), ecosystem (registry counts on that network, by kind), activity
(the last live check, the launch radar). `null` where nothing measured it.
Elysium networks only. Cache 15 s. Response: `ElysiumStatsResponse`.
```sh
curl -s localhost:3001/v1/elysium/stats
```

---

## Markets: HyperCore (`api/markets`)

`network` = `hypercore-testnet` / `hypercore-mainnet` (or `testnet` / `mainnet`), default the mode's.

| route | query | response |
|---|---|---|
| `GET /v1/markets` (heavy) | `network`, `type=perp\|spot\|all`, `dex=all\|<HIP-3 dex>`, `q`, `limit` 1-2000 | `MarketsResponse` |
| `GET /v1/markets/:coin` | `network`; coin as HyperCore names it (`BTC`, `xyz:TSLA`, `@1035`, `PURR/USDC`) | `MarketDetailResponse` |
| `GET /v1/markets/:coin/book` | `network`, `nSigFigs` 2-5, `mantissa` 1/2/5, `depth` 1-20 | `BookResponse` |
| `GET /v1/markets/:coin/trades` | `network`, `limit` 1-200 | `TradesResponse` |
| `GET /v1/markets/:coin/candles` (heavy) | `network`, `interval`, `from`, `to` (ms), `limit` 1-1500 | `CandlesResponse` |
| `GET /v1/markets/stream` (SSE) | `network`, `coins` (1-8, comma list), `channels` (`mids,trades,book`) | events in `MARKET_STREAM_EVENTS`: `ready`, `mids`, `trades`, `book`, `dropped`, `error` |
| `GET /v1/funding` (heavy) | `network`, `coins` (up to 50) | `FundingResponse` |
| `GET /v1/prices` | `symbols` (up to 50) | `PricesResponse` (reference prices, mainnet mids) |
| `GET /v1/vaults` (heavy) | `network`, `limit` 1-500, `includeClosed` | `VaultsResponse` |
| `GET /v1/whales` (heavy) | `network`, `coin` (required), `bucketPct` 0.25-20, `minNotionalUsd`, `limit` 1-100 | `WhalesResponse` |

```sh
curl -s "localhost:3001/v1/markets?type=perp&limit=20"
curl -s "localhost:3001/v1/markets/BTC/book?depth=10"
curl -s "localhost:3001/v1/markets/HYPE/candles?interval=1h&limit=100"
curl -sN "localhost:3001/v1/markets/stream?coins=BTC,HYPE&channels=mids,trades"
curl -s "localhost:3001/v1/prices?symbols=HYPE,BTC"
curl -s "localhost:3001/v1/whales?coin=HYPE"
```

---

## Portfolio (`api/portfolio`)

`mode` = `testnet` / `mainnet` (default the server's). `:address` is a 0x address.

| route | query | response |
|---|---|---|
| `GET /v1/portfolio/:address` (heavy) | `mode` | `PortfolioSnapshot` (HyperCore perps / spot / vaults / staking + HyperEVM + Elysium balances, reference-valued, exposure, liquidation distances) |
| `GET /v1/portfolio/:address/history` (heavy) | `mode`, `days` 1-90 (default 30) | `PortfolioHistory` |
| `GET /v1/portfolio/:address/stream` (SSE) | `mode` | events in `PORTFOLIO_STREAM_EVENTS`: `snapshot` (`PortfolioStreamSnapshot`, `id:` = seq), `unchanged`, `error` |

```sh
curl -s localhost:3001/v1/portfolio/0x5e9ee1089755c3435139848e47e6635505d5a13a
curl -sN localhost:3001/v1/portfolio/0x5e9ee1089755c3435139848e47e6635505d5a13a/stream
```

---

## Language (`api/language`)

### `POST /v1/intents/parse`
Reads an English or Turkish sentence into goals, questions and chips; never
plans or signs. Body: `{ text, locale?: "en"|"tr", answers?: { question, option? | text? }[], thread?, account?: 0x…, context?: { balances?, positions?, timezone?, telegramLinked? } }`.
Response: `ParseIntentResponse`. Once `ready`, `thread` carries every answer
of the conversation (signed, bound to the same words) and `plan`
(`LanguagePlanInput`) says what POST /v1/intents takes: `{ text, thread }`
(the planner re-reads the words with those answers to the same goals) or
`goals` (the reading itself). `plan` is null while questions are open and
for readings that are not one-off moves (Agent rules, questions). Clients
never re-plan the canonical sentence. A named venue warns
`VENUE_NOT_EXECUTABLE` only when the running engine does not execute it
(the same set as `executableIds` of GET /v1/protocols).
```sh
curl -s -X POST localhost:3001/v1/intents/parse -H 'content-type: application/json' -d '{"text":"swap 10 HYPE to USDC on Elysium"}'
```

### `GET /v1/language/examples?locale=en|tr`
Example sentences for the UI. Response: `LanguageExamplesResponse`.
```sh
curl -s "localhost:3001/v1/language/examples?locale=tr"
```

---

## Intents and venues (`api/intents`)

### `POST /v1/intents?dryRun=true|false` (heavy)
Plans an intent (venue auction, Rule Book gate) and stores it unless dry-run.
Body: exactly one of `text` (+ `thread`), `actions` (`IntentActionSpec[]`,
1-12) or `goals` (`GoalItem[]`); `accounts` (1-6 CAIP-10, e.g.
`eip155:99801:0x…`); optional `mode`, `constraints` (`maxSlippageBps`,
`deadline`, `maxFeeUsd`, `maxSeconds`, `preferProtocols`, `avoidProtocols`),
`signer` (`agent` / `keeper`), `agent`, `dryRun`, `metadata`,
`clientReference` (idempotency). 201 when stored, 200 for dry runs and
replays. Response: `CreateIntentResponse` (`intent`, `journey`, `policy`:
`PolicySummary`, `quotes`: `VenueQuoteView[]`).

Tokens without a reference price (KALOS, stKALOS, launch tokens): on testnet
they plan within the Rule Book's `unpriced` cap (default 1,000 tokens per
token per intent) and carry `policy.unpriced[]` notes, an `Unpriced: …`
intent warning and an `unpriced:` quote note; USD totals count them as $0. On
mainnet they are always refused (`POLICY_DENIED`, rule `assets.unpriced`).
```sh
curl -s -X POST "localhost:3001/v1/intents?dryRun=true" -H 'content-type: application/json' \
  -d '{"accounts":["eip155:99801:0x5e9ee1089755c3435139848e47e6635505d5a13a"],"actions":[{"kind":"swap","network":"elysium-testnet","from":"KALOS","to":"WHYPE","amount":"10","protocol":"kalos-v3"}]}'
```

### `GET /v1/intents/:id`
The graph (`core` `IntentGraph`), progress re-derived for in-flight steps. `:id` = `int_` + 32 hex.
```sh
curl -s localhost:3001/v1/intents/int_0123456789abcdef0123456789abcdef
```

### `GET /v1/intents/:id/journey`
"Where is my money": `core` `Journey`.

### `POST /v1/intents/:id/steps/:sid/prepare` (heavy)
Unsigned requests + quote binding for one step. Body: `{ signatureChainId?, agent?: 0x…, confirmed?: boolean }` (`confirmed` answers Rule Book confirmations). Response: `PrepareStepResponse` (`payload`: `StepExecutionPayload`, `policy`, `warnings`).
```sh
curl -s -X POST localhost:3001/v1/intents/int_…/steps/s1/prepare -H 'content-type: application/json' -d '{"confirmed":true}'
```

### `POST /v1/intents/:id/steps/:sid/submit` (heavy)
References only, one per prepared request: `{ references: ["0x<txhash>" | "hc:cloid:<user>:<cloid>" | "hc:nonce:<signer>:<nonce>"] }`; verified from receipts / logs / the info API. Response: `SubmitStepResponse`.

### `POST /v1/intents/:id/stop`
Stops every unstarted step. Response: `StopIntentResponse`.

### `GET /v1/intents/:id/stream` (SSE)
`IntentStreamEvent`s: `intent.snapshot`, `intent.created`, `intent.status_changed`, `intent.step_updated` (`Last-Event-ID` resumes).

### `GET /v1/venues?network=&environment=&kind=&status=`
Every venue the engine executes (pins shared with the adapters) and the
read-only registry venues. `kind`: `dex`, `bridge`, `link`, `trading`,
`transfer`, `wrap`, `staking`, `vault`, `lending`, `names`, `launchpad`,
`aggregator`, `perps`; `status`: `live`, `read-only`, `unavailable`. A
protocol the engine executes is never listed read-only. Cache 60 s.
Swap venues carry `probe` (`VenueProbe`): a pair the venue holds liquidity
for, to quote it with (Kalos V3 / Dex Da Costa HYPE/USDC, PerpMe
HYPE/PERPME, HexSwap HYPE/HEX, HyperSwap V3 HYPE/USDC with `liquid: false`:
its testnet pools read empty on 2026-11-01).
Response: `VenuesResponse` (`venues`, `priceSource`, `executableProtocols`).
```sh
curl -s "localhost:3001/v1/venues?network=elysium-testnet&status=live"
```

---

## Sessions and roles (`api/ops`)

Wallet sessions are SIWE (EIP-4361) sign-ins answered with an HMAC-SHA256
token (`es1.<payload>.<mac>`, 24 h) sent back as the **`Elyia-Session`**
header (never cookies). Roles: `user` (any session), `developer` (the
address registered a developer profile), `admin` (the address is in
`ELYIA_ADMIN_ADDRESSES`); developer and admin are re-checked on every
request. 401 `UNAUTHORIZED` without a valid session, 403 `FORBIDDEN` without
the role, 503 `SESSIONS_NOT_CONFIGURED` when production has no
`ELYIA_SESSION_SECRET` (production refuses to boot without it; development
uses an ephemeral secret and warns). Signing in moves no funds.

| route | body / query | response |
|---|---|---|
| `POST /v1/auth/siwe/nonce` (auth) | `{ address?, chainId? }` | `SiweNonceResponse` (nonce, 10 min TTL, domain, uri, chainIds, a ready `message` when address + chainId are sent) |
| `POST /v1/auth/siwe/verify` (auth) | `{ message, signature }` | `SessionResponse`. Checks domain (web origins' hosts + `ELYIA_SIWE_DOMAINS`), URI, chain id (Elyia's EVM chains, 1, 42161), issuedAt / expiration / notBefore, single-use nonce (`SIWE_NONCE` on replay), EOA signature or ERC-1271/6492 through the chain's RPC. Errors: `SIWE_INVALID`, `SIWE_DOMAIN`, `SIWE_CHAIN`, `SIWE_EXPIRED`, `SIWE_STALE`, `SIWE_SIGNATURE` (401). |
| `GET /v1/auth/session` | session | `SessionView` |
| `POST /v1/auth/logout` | session | `{ revoked: true }` (the session id is refused until expiry) |
| `POST /v1/auth/telegram` (auth) | `{ initData }` | `SessionResponse` for a linked Telegram user (HMAC `WebAppData` check, `auth_date` at most 1 day old). `TELEGRAM_INIT_DATA_INVALID` 401, `TELEGRAM_NOT_LINKED` 403, `TELEGRAM_NOT_CONFIGURED` 503. |
| `POST /v1/telegram/link-code` (auth) | session | `LinkCodeResponse` (single-use code, 10 min, `t.me/<bot>?start=<code>` deep link) |
| `GET /v1/telegram/status` | optional session | `TelegramStatusResponse` (`configured`, `mode`: webhook / polling / off, `linked`) |

```sh
curl -s -X POST localhost:3001/v1/auth/siwe/nonce -H 'content-type: application/json' -d '{"address":"0x…","chainId":99801}'
curl -s localhost:3001/v1/auth/session -H "Elyia-Session: $TOKEN"
```

---

## Developer platform (`api/developers`)

API keys are `ely_` + 40 base62 characters, sent as `Authorization: Bearer
ely_…` (or `Elyia-Key`). Only SHA-256 is stored; the plain key is shown
once. Requests without a key stay public (per-IP limits). With a key, the
gate (mounted before every module) authenticates (401 for unknown / revoked
keys or two different keys), checks the route's **scope** (403 `KEY_SCOPE`)
and meters the key (429 `QUOTA_EXCEEDED` with `Retry-After`):

| scope | routes | metered as |
|---|---|---|
| `read` | every GET | `requests` |
| `plan` | `POST /intents`, `POST /intents/parse` | `requests` + `plans` (POST /intents) |
| `execute-prepare` | `POST /intents/:id/steps/:sid/prepare|submit`, `/stop` | `requests` + `prepares` (prepare) |
| `webhooks` | `/developers/webhooks*` | `requests` |

Default quotas per key: 300 requests/min, 50,000 requests, 5,000 plans and
2,000 prepares per UTC day (`DEFAULT_KEY_QUOTAS`, caps in `MAX_KEY_QUOTAS`).
Keys and keyless requests can plan and prepare unsigned payloads only:
nothing on the platform signs or moves funds.

| route | auth | response |
|---|---|---|
| `POST /v1/developers/register` | session | `DeveloperProfile` (201 new, 200 existing) |
| `GET /v1/developers/me` | developer or key | `{ profile, fee, widget }` |
| `GET /v1/developers/keys` | developer session | `ApiKeyListResponse` |
| `POST /v1/developers/keys` (auth) | developer session | `CreateKeyResponse` (`plainKey` once). Body `{ name, scopes?, quotas? }`; at most 10 active keys. |
| `POST /v1/developers/keys/:id/rotate` (auth) | developer session | `CreateKeyResponse`; the previous secret keeps working 24 h |
| `DELETE /v1/developers/keys/:id` | developer session | `{ key }`, revoked at once |
| `GET /v1/developers/usage?days=1..30` | developer or key | `UsageResponse` (per key per day: requests, plans, prepares) |
| `GET/POST /v1/developers/webhooks` | developer or key `webhooks` | `WebhookListResponse` / `CreateWebhookResponse` (`secret` `whsec_…` once). Body `{ url, events, networks? }`. |
| `PATCH/DELETE /v1/developers/webhooks/:id` | same | `{ enabled?, events? }` |
| `POST /v1/developers/webhooks/:id/test` (auth) | same | `{ delivery }` (one signed `webhook.test`) |
| `GET /v1/developers/webhooks/:id/deliveries` | same | `WebhookDeliveriesResponse` (7 days) |
| `GET/PUT /v1/developers/fees` | developer (PUT: session) | `IntegratorFeeConfig` (0-50 bps, recipient required above 0; EN/TR disclosure for route cards) |
| `GET/PUT /v1/developers/widget` | developer (PUT: session) | `WidgetConfig` (allowed origins, theme, networks, fee) |
| `GET /v1/widget/:developerId` | public, cache 60 s | `WidgetConfig` |

**Webhooks**: events `intent.step.settled`, `intent.failed` (intents
created with the developer's key), `alert.fired` (alerts of the developer's
wallet), `launch.new` (the launch radar, per network). Public HTTPS only
(SSRF guard at registration and at connect time), POST JSON, 5 s timeout,
redirects not followed, retries after 1 s / 5 s / 25 s / 125 s, paused after
20 consecutive failures, at least once. Headers: `Elyia-Signature:
t=<unix>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>`, `Elyia-Event-Id`,
`Elyia-Event-Type`, `Elyia-Webhook-Id`, `Elyia-Delivery-Attempt`. Verify with
`@elyia/sdk` `verifyWebhook` (5 min tolerance).

```sh
curl -s -X POST localhost:3001/v1/developers/keys -H "Elyia-Session: $TOKEN" -H 'content-type: application/json' -d '{"name":"server","scopes":["read","plan"]}'
curl -s "localhost:3001/v1/developers/usage?days=7" -H "Authorization: Bearer $ELYIA_KEY"
```

### `POST /v1/mcp` (heavy)
MCP server, stateless Streamable HTTP (`@modelcontextprotocol/server`
2.3.1, JSON responses, one JSON-RPC message per request; batches 400).
Tools (all read-only): `get_networks`, `get_markets`, `get_market`,
`get_portfolio`, `get_protocols`, `get_venues`, `plan_intent` (dry run, route
card), `get_intent`, `shield`, and `create_signing_link` (an Elyia web URL
`/app?intent=…`; it never signs). Origin rule: no Origin is fine; `null` or
malformed origins 403 `MCP_ORIGIN_FORBIDDEN`; plain HTTP only from localhost
outside production; `ELYIA_MCP_ALLOWED_ORIGINS` narrows browser origins.
An API key, when sent, is metered like any request.
```sh
curl -s -X POST localhost:3001/v1/mcp -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

---

## Elyia contracts and admin (`api/admin`)

The owner deploys Elyia's contracts (ElyiaRouter, ElyAccountFactory,
ElyOrders; artifacts exported by `packages/contracts` into
`@elyia/core/contracts`) from **his own wallet**; the server never deploys.

| route | auth | response |
|---|---|---|
| `GET /v1/config/contracts?network=` | public, cache 30 s | `ContractsConfigResponse` (recorded addresses per network, artifact versions) |
| `GET /v1/config/flags` | public | `FeatureFlagsResponse` |
| `GET /v1/admin/deploy-plan?network=` | admin | `DeployPlanResponse`: creation transactions in manifest order with constructor args filled (`$OWNER` = the admin's wallet, `$ElyiaRouter` = the recorded router) for the web admin panel to send from the wallet |
| `POST /v1/admin/deployments` (auth) | admin | `RecordDeploymentResponse`. Body `{ network, contract, txHash, address? }`. Recorded only when the receipt succeeded, the created address matches, the deployer is an admin, the creation input starts with the artifact's creation code and the on-chain runtime code equals the artifact's (immutables and metadata masked); else 422 `DEPLOYMENT_REJECTED` with `details.checks`. 503 `CONTRACTS_NOT_EXPORTED` without artifacts. |
| `GET /v1/admin/deployments?network=` | admin | `{ deployments }` |
| `GET /v1/admin/router?network=` | admin | `RouterSettingsResponse`: every zero-argument view of the router ABI read live (owner, pendingOwner, protocolFeeBps, feeRecipient, paused, caps), `source: "chain"`, `recorded: true`. With no router recorded on the network: `recorded: false`, `source: "artifact-defaults"`, only the artifact's constants in `reads`, set-later state (owner, recipients, zero addresses) listed in `unset`, and a `note` saying no router is recorded |
| `GET /v1/admin/telegram` | admin | `AdminTelegramStatusResponse`: `configured`, `mode`, `running`, `flag`, `webhookUrlSet`, `linkedWallets`, `lastError`, `note` ("not configured · no bot token" …). Never the token or chat ids |
| `GET/PUT /v1/admin/flags` | admin | `FeatureFlagsResponse` (`elyiaRouterVenue`, `agentLlm`, `keeper`, `telegram`, `webhooks`, `mcp`, `alerts`) |
| `GET /v1/admin/system` | admin | `SystemDashboardResponse`: health, today's key usage, queues and workers (alerts, tracker, automations, keepers, webhooks), agent mode |

**Router venue (`elyia-router`).** With the ElyiaRouter artifact loaded the
engine adds an `elyia-router` swap venue on Elysium testnet: single and
50/50 split routes across Kalos V3 (each fee tier with liquidity) and Dex Da
Costa, WHYPE / venue-wrapper hops for native HYPE, `minAmountOut` and the
deadline on the total, optional integrator fee (`params.integrator`,
`params.integratorFeeBps`, capped by the router). Quotes are eth_simulateV1
runs of the real `swap`: before deployment against the artifact's runtime
code at a virtual address (state override `code`) with the venue allowlist
written into `venueKind` (`stateDiff`; the slot is found by probing). Until a
deployment is recorded the venue only quotes when named (`protocol:
"elyia-router"`) and refuses `prepare` (`ROUTE_UNAVAILABLE`); once recorded it
runs in every auction next to the direct venues and prepares real
transactions to the recorded address. Settlement is proven from the router's
`Swap` event.
```sh
curl -s -X POST "localhost:3001/v1/intents?dryRun=true" -H 'content-type: application/json' \
  -d '{"accounts":["eip155:99801:0x5e9ee1089755c3435139848e47e6635505d5a13a"],"actions":[{"kind":"swap","network":"elysium-testnet","from":"HYPE","to":"USDC","amount":"1","protocol":"elyia-router"}]}'
```

---

## Ely, the agent (`api/agent`)

Ely runs on Claude (`@anthropic-ai/sdk`, model `ELYIA_AGENT_MODEL`, required
with the key; optional server-side refusal fallback, streaming tool use) when
`ANTHROPIC_API_KEY` is set and the `agentLlm` flag is on; otherwise (or when
the model fails) the deterministic planner answers with the same tools and
events. **Every write is a proposal the user signs**; the model has no tool
that signs, sends or withdraws.

| route | auth | response |
|---|---|---|
| `POST /v1/agent/chat` (heavy, SSE) | optional session | events `thread`, `token`, `tool_call`, `tool_result`, `proposal`, `route_card`, `note`, `clarify`, `done`, `error`. Body `{ message, address?, threadId?, locale?, clarify? }` (`address` required without a session; anonymous chats are read-only and not stored). A turn that ends asking sends `clarify` (`ChatClarifyEvent`: `threadId`, `sentence`, the reader's signed `thread`, `questions` with `options`) before `done`; answer by sending the same `sentence` as `message` with `clarify: { thread, answers: [{ question, option \| text }] }`. Chained actions use `after: [index]` with `amount: "max"` (and `params.portionBps` for a share). |
| `GET /v1/agent/threads`, `GET/DELETE /v1/agent/threads/:id` | session | threads per owner (60 messages kept) |
| `GET/PUT /v1/agent/memory` | session | `AgentMemory` (goals, risk profile, target mix, gas floor, dust threshold, locale) |
| `GET /v1/agent/insights/:address` (heavy) | public | `InsightsResponse`: rebalance, auto-protect, liquidation-guard, funding-harvest (paper on testnet), idle-cash, what-if shocks, gas-top-up, dust-sweep, explain-pnl; each with its numbers and draft actions |
| `POST /v1/agent/insights/:address/:insightId/propose` | session (= address) | `Proposal` |
| `GET/POST /v1/agent/proposals`, `GET /v1/agent/proposals/:id` | session | `Proposal` (dry-run route card, 15 min expiry) |
| `POST /v1/agent/proposals/:id/decision` | session | `ProposalDecisionResponse`. `{ decision: approve|reject, via?: wallet|keeper }`; wallet approval stores ONE intent linked to the proposal (approving again returns the same intent and next step) and returns the first step to prepare and sign; the intent's final status marks the proposal `executed` (completed) or `failed` (failed, expired, stopped, cancelled) |
| `GET /v1/agent/automations`, `POST`, `PATCH/DELETE /:id` | session | automations (`auto-protect`, `liquidation-guard`, `idle-sweep`, `gas-top-up`, `dust-sweep`, `rebalance`, `funding-harvest-paper`): each run turns new findings into proposals (deduped per cooldown) |
| `GET /v1/agent/skills` | public | automation catalog and insight kinds |
| `GET /v1/agent/feed` | session | `FeedResponse` |
| `POST /v1/agent/keeper/prepare` (auth) | session | `KeeperPrepareResponse`: a fresh key's **address only** plus what the owner signs (HyperCore `approveAgent` typed data named `elyia-keeper valid_until <ms>`, at most 30 days; or the ElyAccount `setAgentPolicy` transaction: router swaps only, HYPE caps, expiry) |
| `POST /v1/agent/keeper/activate` (auth) | session | verifies `extraAgents` (or `ElyAccount.agent()`), then `KeeperStatusResponse` |
| `GET /v1/agent/keeper` | session | `KeeperStatusResponse` (state, limits, spent today, audit log) |
| `POST /v1/agent/keeper/revoke` (auth) | session | deletes the key material at once; `KeeperRevokeResponse` with the on-chain revoke to sign |
| `POST /v1/agent/kill` | session | `{ on }`: pauses the keeper and every automation |

Keeper mode is opt-in and bounded: keys are AES-256-GCM sealed with a key
derived (HKDF-SHA256) from `ELYIA_KEEPER_SECRET` (503
`KEEPER_NOT_CONFIGURED` without it), never logged or returned; the keeper
only signs HyperCore L1 trading actions of proposals that are reduce-only
orders (protective stops, reduces), inside a per-order and a daily USD cap
and an optional coin allowlist, before its expiry, with the kill switch off.
Every step is in the audit log and emitted to Telegram.
```sh
curl -sN -X POST localhost:3001/v1/agent/chat -H 'content-type: application/json' -d '{"message":"what is my HYPE exposure?","address":"0x5e9ee1089755c3435139848e47e6635505d5a13a"}'
curl -s localhost:3001/v1/agent/insights/0x5e9ee1089755c3435139848e47e6635505d5a13a
```

---

## Tracking, watchlists, alerts, Telegram (`api/ops`)

| route | auth | response |
|---|---|---|
| `POST /v1/track` (heavy) | public | `TrackView` (201). `{ network, reference, label? }`: an EVM tx hash (receipt, status, every log's emitter labelled from the registry) or `hc:cloid:<user>:<cloid>` (order status). Re-checked with backoff (5 s doubling to 5 min) for 24 h. |
| `GET /v1/track/:id`, `GET /v1/track/:id/stream` (SSE) | public | `TrackView`; events `track.snapshot`, `track.updated` |
| `GET/POST /v1/watch`, `DELETE /v1/watch/:address` | session | `WatchListResponse` (50 addresses) |
| `GET/POST /v1/alerts`, `PATCH/DELETE /v1/alerts/:id` | session | `AlertListResponse` / `AlertView`. Kinds `price-above|below` (USD), `funding-above|below` (%/h), `liquidation-distance-below` (%), `intent-step` |
| `GET /v1/alerts/feed` | session | `AlertFeedResponse` |

The evaluator runs every 30 s inside the HyperCore weight budget (one
`allMids`, one `metaAndAssetCtxs` only for funding alerts, one
`clearinghouseState` per watched account, skipped under a 200-weight
reserve), with a cooldown per alert (default 15 min). Firings go to the feed,
the linked Telegram chat and the owner's developer webhooks.

Telegram (grammY): long polling in development, `POST /telegram/webhook`
(secret token checked) in production when `TELEGRAM_WEBHOOK_SECRET` is set
(`setWebhook` with `TELEGRAM_WEBHOOK_URL`); off without
`TELEGRAM_BOT_TOKEN`. Commands `/start <code>`, `/help`, `/portfolio`,
`/positions`, `/alerts`, `/price <coin>`, `/agent <question>`, `/link`
(EN/TR by the user's language), 1 message/s per chat and 25/s overall.

---

## Environment (new)

| variable | purpose |
|---|---|
| `ELYIA_SESSION_SECRET` | ≥ 32 chars; signs sessions, seals webhook secrets. Required in production. |
| `ELYIA_ADMIN_ADDRESSES` | comma list of owner wallets with the admin role |
| `ELYIA_KEEPER_SECRET` | ≥ 32 chars; keeper key encryption. Keeper mode is off without it. |
| `ELYIA_SIWE_DOMAINS` | extra SIWE domains (host[:port]) besides the web origins |
| `ELYIA_MCP_ALLOWED_ORIGINS` | exact browser origins allowed on `/v1/mcp` (empty: any https) |
| `ANTHROPIC_API_KEY`, `ELYIA_AGENT_MODEL`, `ELYIA_AGENT_SERVER_FALLBACK` | Ely on Claude (key and model both required); deterministic otherwise |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_WEBHOOK_URL` | the bot |

Store collections (Postgres `elyia_docs` / `elyia_counters` when
`ELYIA_DATABASE_URL` is set, created on first use): see
`apps/api/src/modules/ops/docs.ts` `PLATFORM_COLLECTIONS`; counters
`dev_usage`, `dev_rate`.
