# @elyia/core

The zero-I/O shared spec of Elyia: networks, identities, amounts, the token
and protocol registries, the intent graph and its lifecycle, the Rule Book,
and the HyperCore signing payloads. The API, the web app, the Telegram bot
and the Mini App all import it, so it runs anywhere JavaScript runs: no
`node:` imports, no network access, no secrets. Runtime dependencies are
`@msgpack/msgpack` and `@noble/hashes` only.

```ts
import { findToken, evaluatePolicy, DEFAULT_RULE_BOOK, hypercore } from "@elyia/core";
import { orderAction, orderWireFor } from "@elyia/core/hypercore/actions"; // per-file subpaths work too
```

ESM only (`"type": "module"`). CommonJS callers use `await import("@elyia/core")`.

## Modules

| File | What it holds |
|---|---|
| `networks.ts` | The six networks (Elysium 99801 / 99901, HyperEVM 998 / 999, HyperCore testnet / mainnet), pinned bridge contracts, system addresses, `resolveNetwork` (keys, CAIP-2, chain ids, aliases per environment), `signatureChainIdHex`, explorer links. |
| `pulse.ts` | Wire types of the live Elysium block pulse. |
| `canonical.ts` | `canonicalJson` (sorted keys, `undefined` dropped, bigint as string, non-finite refused) and `sha256:` digests. Every cross-process hash goes through it. |
| `caip.ts` | CAIP-2/10/19 for `eip155` and `hypercore`: `formatAccountId` / `parseAccountId` (`hypercore:testnet:0x…` splits at the last colon), EIP-55, `sameAccount`, **`sameOwner`** (one 0x address on Elysium, HyperEVM and HyperCore is one owner), asset ids `slip44:60`, `erc20:<addr>`, `spot:<index>`, `perp:<COIN>`, `margin:usdc`. |
| `amounts.ts` | Decimal string <-> bigint base units. Strict parsing with reasons (refuses `1,5`, `1e3`, `+1`, `.5`), exact scaling, HyperCore `weiDecimals` <-> EVM decimals with dust refusal, slippage that rounds in the user's favour, `formatUnitsTrim`, `compact`. |
| `assets.ts` | Verified token registry per EVM network with bridge counterparts and HyperCore links, every pin read back on-chain (see each entry's `evidence`). `findToken` (address, symbol, alias), `counterpartToken`, `coreSystemAddress`, and `assessToken`: anything outside the registry is unverified, and a stranger reusing a registry name (homoglyphs folded) is flagged as a look-alike. |
| `protocols.ts` + `protocolData.ts` | The protocol registry: category, deployments per network with a status (`live`, `testnet-live`, `announced`, `coming`, `unverified`), contracts, evidence, the verbs Elyia executes. Rows are plain data in `protocolData.ts`, validated at load. Helpers: `protocolsFor`, `executableProtocols`, `capableProtocols`, `countByCategory`, `withExecutable` (what a running API really executes). |
| `intent.ts` | `elyia.intent/v1`: `IntentGraph`, `IntentStep` (kinds `approve … automation`, statuses `blocked … stopped`), order / TWAP / cancel / leverage / agent snapshots, `TransactionRequest` = EVM tx, HyperCore user-signed (EIP-712) or HyperCore L1 action (agent or Keeper key), `IntentRequest`. |
| `binding.ts` | Quote bindings: security views of each request (EVM from/to/data/value/chain; user-signed typed message; L1 connection id, nonce, expiry, vault, agent) hashed to `sha256:`; `l1RequestConsistent` and `userSignedRequestConsistent` engine guards. |
| `references.ts` | What clients submit instead of anything signed: EVM tx hashes, `hc:cloid:<user>:<cloid>`, `hc:nonce:<signer>:<nonce>`; strict parsing and global claim keys. |
| `lifecycle.ts` | The step transition table and its failure guards, `deriveIntentStatus`, `readySteps`, `topologicalOrder`, `validateIntentGraph` (environment, accounts, HyperCore-only kinds, snapshots, DAG). |
| `journey.ts` | "Where is my money": stops, the user's turn, ETAs and explorer links, from the graph alone. |
| `flow.ts` | Funded-step amount model (shares, gas reserve, third-party cap). |
| `errors.ts` | Error catalog: stable codes, HTTP status, category, retryability, plain-language message with the fix; `errorEnvelope`, `stepFailure` (unknown outcomes are held for review, never retried). |
| `goals.ts` | Language IR: `ValueGoal`, `TradeGoal`, `Rule` (schedules and conditions with limits), `AlertGoal`, `QueryGoal`, plus validators. |
| `validation.ts` | `POST /v1/intents` body validation. |
| `policy.ts` + `policyEvaluate.ts` | The Rule Book (`elyia.rulebook/v1`): document validation, canonical hash, `loosenedRules`, `DEFAULT_RULE_BOOK` (testnet) and templates; `evaluatePolicy(book, facts)` -> `{decision: allow|confirm|deny, reasons}`, `buildPolicyFacts(graph, sources)`, `scheduleState`. |
| `events.ts` | Event map and a tiny typed event bus. |
| `format.ts` | Display helpers: USD, compact USD, signed percent, token amounts with significant digits, short addresses, durations, latency, leverage. |
| `hypercore/` | Exported as the `hypercore` namespace (and `@elyia/core/hypercore/<file>`): `actions.ts` (typed L1 and user-signed actions, builders with the SDK's exact key order), `wire.ts` (`floatToWire`, tick and lot rules, `roundPrice`, `marketPrice`, asset indexes, cloids), `signing.ts` (`actionHash`, phantom agent, EIP-712 payloads, `splitSignature`, `buildExchangeRequest`), `info.ts` (info API response types). |

## Invariants

- **The server never signs.** Core builds hashes and typed data; wallets sign
  user actions, the in-browser agent key signs L1 actions, and an opt-in
  Keeper key may sign trading actions only (`KEEPER_SIGNABLE_ACTIONS`).
  No agent ever signs a withdrawal or transfer (`AGENT_SIGNABLE_ACTIONS`).
- **Fail closed.** `evaluatePolicy` denies (`facts.unavailable`) whenever a
  rule needs a fact it does not have: a price, open orders, the day's volume
  or losses, an order's leverage, window usage, fees. Unpriced is never zero.
- **De-risking always works.** The kill switch (`mode: "paused"`), a closed
  schedule and the daily loss stop block new risk but let reduce-only orders
  and cancels through.
- **One environment per intent.** Testnet and mainnet capital never mix;
  `validateIntentGraph` and `validateIntentRequest` refuse it.
- **Amounts are strings and bigints**, never floats. HyperCore prices and
  sizes are wire strings checked against the tick and lot rules; builders
  refuse instead of rounding silently (`roundPrice` / `roundSize` round on
  purpose, toward the user's safety).
- **Only registry tokens are verified.** Elysium has look-alike tokens.
- **Unknown things stay unknown.** ElysiumCoreWriter and the HyperCore
  market-data precompile are `coming` with no address; Elysium mainnet has no
  public RPC and no token-gateway addresses, so mainnet bridging stays off.

## HyperCore signing and its golden vectors

`hypercore/signing.ts` mirrors `hyperliquid/utils/signing.py` of the official
Python SDK:

```
connectionId = keccak256(msgpack(action) || nonce u64 BE || (vault ? 0x01 || vault : 0x00) || (expiresAfter ? 0x00 || expiresAfter u64 BE : ""))
L1:          EIP-712 Agent{source: "a" | "b", connectionId} in {name "Exchange", version "1", chainId 1337, verifyingContract 0x0}
user-signed: EIP-712 HyperliquidTransaction:<Name> in {name "HyperliquidSignTransaction", version "1", chainId = signatureChainId, verifyingContract 0x0}
```

`test/hypercore.test.mjs` ports every vector of the SDK's
`tests/signing_test.py` (phantom agent, L1 signatures with and without
vault, cloid and trigger orders, sub-account actions, schedule cancel, USD
transfer and withdrawal) and signs Elyia's payloads with viem in the test
only; the signatures must match exactly. `test/hypercore-wire.test.mjs`
pins `floatToWire` to outputs of the SDK's `float_to_wire` and the tick
rules to the Hyperliquid docs' own examples. If a vector fails, the encoding
is wrong: fix the encoding, never the vector.

Key order matters for msgpack: builders follow the SDK (`a, b, p, s, r, t, c`;
trigger `isMarket, triggerPx, tpsl`; `builder` last) and, for actions the SDK
lacks (`modify`, `twapOrder`, `twapCancel`), the exchange docs. Optional
flags the exchange requires omitted when false (`f` on cancels, `a` on
modifies) are only ever set to `true`.

## Extending the registries

- **A protocol:** append a row to `protocolData.ts`. Put every address under
  the network it lives on, use `testnet-live` for testnets and `live` for
  mainnets, and write how you established it in `evidence`. A malformed row
  fails at import and in `test/protocols.test.mjs`.
- **A token:** add it to `TOKENS` in `assets.ts` only after reading
  `name()`, `symbol()` and `decimals()` on-chain (and, for HyperCore links,
  `spotMeta`), with the evidence in the entry. Tests check checksums,
  counterpart symmetry and `weiDecimals + evmExtraWeiDecimals = decimals`.

## Scripts

```sh
npm run build -w @elyia/core        # tsc -> dist
npm test -w @elyia/core             # builds, then node --test test/*.test.mjs against dist
npx tsc -p packages/core --noEmit
npx eslint packages/core
```
