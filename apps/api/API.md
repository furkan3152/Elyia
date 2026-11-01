# Elyia API reference

Every route the API serves today, with its parameters, the response type in
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
- The server never signs or sends a transaction. Intents return unsigned
  payloads; Shield and the smoke tools only simulate.

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
Response: `ParseIntentResponse`.
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
Response: `VenuesResponse` (`venues`, `priceSource`, `executableProtocols`).
```sh
curl -s "localhost:3001/v1/venues?network=elysium-testnet&status=live"
```

---

## Not served yet

Modules registered without routes: `ops` (sessions, tracking, watchlists,
alerts, Telegram) and `agent` (chat, automations, proposals, Keeper, MCP).
Their planned surface is in the master spec §5.
