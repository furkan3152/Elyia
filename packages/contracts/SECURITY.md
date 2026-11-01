# Security: @elyia/contracts

> **NOT AUDITED.** These contracts have not had an external audit, formal verification or a bug bounty.
> The tests below are thorough but do not prove the code is safe. Do not route meaningful user funds
> through them before an independent audit. Treat any deployment as experimental, start with small caps,
> and keep the router owner on a multisig.

## Contracts and trust model

| Contract | Holds funds? | Admin | Upgradeable |
|---|---|---|---|
| `ElyiaRouter` | No. Every call snapshots each touched token and reverts if any ends above its snapshot. | `owner` (Ownable2Step, renounce disabled): venues, fees (hard caps), integrators, pause, rescue of stray dust. | No |
| `ElyAccount` (EIP-1167 clones) | Yes, the user's own funds. | The user (`owner`, fixed at creation). | No |
| `ElyAccountFactory` | No | None | No |
| `ElyOrders` | No (funds stay in maker wallets behind an allowance; asserted after every fill). | None | No |
| `ElyHerd` (The Herd NFT) | Yes: mint proceeds, until the owner withdraws them. | `owner` (Ownable2Step, renounce disabled): phases, prices, oracle, allocations, lists, metadata, royalty, treasury, pause, withdraw. | No |

**Invariants the code enforces**

1. The router only ever pulls funds from `msg.sender` (ERC-20 allowance, Permit2 signature with `owner = msg.sender`, or the sender's Permit2 allowance). The router owner cannot move anyone's allowance.
2. The router ends every call with no more of any touched token (or HYPE) than it started with. Pre-existing dust is never usable or sweepable by callers.
3. Venues get an exact allowance per hop, reset to zero right after; outputs are measured by balance differences.
4. `minAmountOut` and `deadline` apply to the total, net of protocol + integrator fees. Protocol fee is at most 30 bps (default 0); integrator fees need owner registration and are at most 50 bps.
5. The ElyAccount agent has no transfer, approve, arbitrary-call, policy or signing power. Every agent action forces the output back into the account, checks `spent <= amountIn` and `received >= minOut`, charges per-token per-tx and daily caps, and emits `AgentAction`.
6. Revocation and policy replacement bump `policyEpoch`, which voids every allowlisted call, token rule, market and spend counter at once. Expiry is checked on every agent call.
7. Only the account owner can produce ERC-1271 signatures, and only over `ElyAccountMessage(hash)` in the account's own EIP-712 domain, so signatures do not replay across accounts of the same owner.
8. ElyOrders: EIP-712 orders bound to chain id and contract; per-order execution counter, interval, start and deadline; cancel and monotonic nonce floor by the maker; tip <= signed `maxTip` <= 1% of `amountIn`; output always to the maker and re-checked against `minAmountOut`; `nonReentrant` everywhere.
9. ElyHerd:
   - Supply: `team + wl + collab + public + burned <= 3333` and `minted <= cap` per bucket, always. Allocations are only settable while `CLOSED`. After that, supply moves only through explicit `rollover` txs with phase rules; burn removes supply for good.
   - One per wallet: `mintedBy[account]` blocks a second WL, collab or public mint in any phase. Team mints are exempt.
   - The phase moves forward only. Mints need the current phase, its window (`start <= now < end`) and `!paused`.
   - Payment: `msg.value >= quote`. The excess goes back to `msg.sender` as the last step (CEI) under a transient reentrancy guard. Mints use `_mint`, so no receiver hook runs.
   - Oracle: a USD-pegged price needs a TWAP within `maxDeviationBps` of spot and of a fresh fallback, or else a fresh fallback alone. Anything else reverts: fail closed.
   - Funds leave only through `withdraw(to)` with `to` in {owner, treasury}. ERC-2981 is capped at 10%. Provenance can only change before the first mint, and the metadata freeze is one-way.

## Threats and mitigations

| Threat | Mitigation | Tests |
|---|---|---|
| Venue steals, under-pays, pays elsewhere, over-pulls or re-enters | Owner allowlist by kind; exact approval reset to 0; output by balance diff (`NoOutput`); leftover detection (`FundsLeftInRouter`); `nonReentrant` | `unit.router` "adversarial venues" |
| Malicious token re-enters during transfer | `nonReentrant` on every entry point of all three contracts | `unit.router`, `unit.orders` reentrancy tests |
| Front-running a Permit2 signature to redirect output | Permit2 `owner` is always `msg.sender`; replayed nonces fail | `fork.venues` Permit2 tests |
| Someone uses a victim's router allowance | No function takes a `from`; pulls only from `msg.sender` | `unit.router` "never pulls from anyone but msg.sender", fork allowance-mode test |
| Funds left in the router / dust theft | Ledger snapshot + `_settle`; `CONTRACT_BALANCE` uses only what this call brought in | `unit.router` sweep/dust tests; fork tests assert router balances are 0 |
| Stray HYPE sent to the router | `receive()` only accepts from an allowlisted wrapper during a call (fits WETH9's 2300-gas `transfer`) | `unit.router`, fork unwrap tests on four real wrappers |
| Agent exfiltrates (recipient, integrator fee, non-allowlisted target, arbitrary token, permissionless Morpho market with a hostile oracle) | Typed actions only; recipient forced; integrator must be 0; (target, action) allowlist; allowed tokens; lending pinned to market ids | `unit.account` agent tests + seeded model-based fuzz (250 random actions, invariants checked after each) |
| Agent exceeds caps, acts after expiry/revocation | Per-tx and daily caps per token; `policyEpoch`; expiry check | `unit.account` caps/expiry/revocation + fuzz |
| Order replay, forged or tampered orders, cross-contract replay | EIP-712 with chain id + verifying contract; execution counter; cancel; nonce floor | `unit.orders` |
| Malicious keeper | Recipient fixed to maker; router venue allowlist; `minAmountOut`; tip caps; no integrator fee | `unit.orders` "malicious keeper", fork limit-order test |
| Oracle manipulation to trigger stop-loss / take-profit | Optional TWAP with spot-vs-TWAP deviation bound; both must satisfy the trigger; fails closed on bad oracle | `unit.orders` oracle tests, fork stop-loss on a real Kalos pool |
| Herd: second mint from one wallet, contract farms minting from constructors | `mintedBy` across phases; `eoaOnly` (default on) on `mintPublic` | `unit.herd` "second mint…", "contract minter via its constructor…" |
| Herd: forged or cross-list allowlist proofs, wrong partner tag | Separate WL and collab roots; leaves bind `msg.sender` (and the partner tag) in OZ StandardMerkleTree encoding; per-partner caps inside the collab bucket | `unit.herd` allowlist/collab tests |
| Herd: reentrancy through the refund | Refund last (CEI), `nonReentrant` on every mint and on withdraw; a rejected refund reverts the whole mint | `unit.herd` "adversarial: reentrancy and refunds" |
| Herd: price manipulation (USD mode) | TWAP window >= 60 s; spot-vs-TWAP and TWAP-vs-fallback deviation bounds; zero liquidity, extreme ticks, reverting or missing oracle -> revert | `unit.herd` USD tests; `fork.herd` real Kalos pool (cardinality 1 fallback, warmed TWAP, 150 HYPE spot dump fails closed) |
| Herd: supply over-mint, bad rollover | Packed caps/minted counters; phase-gated rollover; seeded fuzz checks invariants after every step | `unit.herd` allocation tests + seeded fuzz (220 steps) |
| Herd: trait sniping via reveal timing | Provenance before the first mint; commit only after ENDED or sell-out; offset from the hash of a block 32 blocks after the commit | `unit.herd` metadata tests |
| Re-initialising an account clone or the implementation | `initialize` only by the factory, once; implementation locked in its constructor | `unit.account` factory tests |

## Residual risks (honest list)

1. **Bad execution by a compromised agent key.** The agent chooses routes and `minAmountOut`. It can swap at a poor price (for example into a thin pool it manipulated or sandwiched) and lose value. It cannot send funds elsewhere, but the loss is bounded only by the per-token per-tx and daily caps. Daily caps use UTC days, so up to 2x `dailyCap` can be spent across a day boundary. Set caps accordingly; there is no on-chain oracle check on agent swaps.
2. **Router owner compromise.** A compromised owner can list a malicious venue (users, keepers or agents routing through it can lose in-flight amounts down to their `minAmountOut`), raise the protocol fee up to 30 bps, or pause (denial of service). It cannot pull allowances or touch ElyAccount funds directly. Use a multisig. There is no timelock.
3. **Keeper MEV on ElyOrders.** Makers always get at least `minAmountOut`; anything above it can be captured by the keeper. Set `minAmountOut` tightly.
4. **TWAP availability.** Kalos pools on Elysium testnet ship with observation cardinality 1, so `observe()` with a window reverts until someone calls `increaseObservationCardinalityNext` and observations accrue (fork test does this). Spot-only orders (`twapWindow = 0`) are manipulable within a block; `minAmountOut` remains the real protection.
5. **Allowances to ElyOrders.** Any validly signed order of the maker executes when its conditions hold. Approve ElyOrders for what open orders need, not unlimited.
6. **Third-party venues are testnet, unaudited and partly anonymous.** Dex Da Costa is tagged `reported-concern`, HexSwap uses look-alike test tokens, every venue has its own wrapped HYPE, and many impostor WHYPE contracts exist. Every address is pinned from `packages/core` and re-checked in fork tests; never add venues by name.
7. **Unsupported tokens.** Fee-on-transfer, rebasing and ERC-777 hook tokens are not supported; swaps with them revert or may lose the transfer fee.
8. **ERC-1271 is wrapped.** Owners sign `ElyAccountMessage(hash)` typed data. Dapps that expect the owner to sign the raw digest will not validate (by design, to block replay across accounts).
9. **Not upgradeable.** A bug means redeploying and migrating. Accounts are tied to the factory's implementation forever.
10. **Chain assumptions.** Compiled for `cancun` (PUSH0, MCOPY, TSTORE verified on Elysium testnet by `eth_call` on 2026-11-01). Re-check mainnet (chain 99901) before any mainnet deploy, and build a mainnet venue list: the testnet venues do not exist there.
11. **Not covered on a fork.** The PerpMe SwapRouter02 adapter (no liquid PerpMe v2 pools at the pinned block) and Morpho-style lending (Cheshire's core exposes no standard market getters) are covered by mock-based unit tests only. SwapRouter02 is therefore excluded from the default venue list.
12. **ElyHerd: owner powers.**
    - The owner can do all of the following:
      - change prices and windows at any time;
      - pause minting;
      - set Merkle roots;
      - move unminted supply (within the phase rules);
      - change the treasury and then withdraw to it;
      - set the fallback price.
    - A compromised owner key can therefore redirect proceeds and reprice the mint. It cannot mint beyond the team bucket or touch holders' tokens.
    - Keep the owner on a multisig. There is no timelock.
13. **ElyHerd: oracle.**
    - Kalos WHYPE/USDC pools on testnet have observation cardinality **1**, so the TWAP is unavailable until someone grows it and swaps write observations. Two of the four pools have zero liquidity.
    - Testnet prices are fake (≈6,400 test-USDC per HYPE), so testnet uses the fixed 1 HYPE price.
    - In USD mode with only a TWAP (no fresh fallback), the price is bounded by the spot-vs-TWAP check alone. A manipulator who holds the pool off-price for the whole window moves the quote.
    - A griefer moving spot beyond `maxDeviationBps` pauses USD-mode mints (fail closed) for as long as they hold it.
    - The mainnet pool must be re-researched before launch.
14. **ElyHerd: randomness.**
    - The reveal offset comes from an L2 block hash 32 blocks after the commit. On an Arbitrum Orbit chain the sequencer produces block hashes and could in theory bias the offset; `prevrandao` is not usable there.
    - The provenance hash makes any change of the art order after minting detectable, but it does not stop a malicious sequencer.
    - The 256-block hash window is short on Elysium (sub-second blocks): call `reveal` promptly, or re-commit after expiry.
15. **ElyHerd: 1 per wallet is not 1 per person.** Sybils with many EOAs can each mint once in public. `eoaOnly` only stops single-tx contract farms. With EIP-7702, delegated EOAs pass `msg.sender == tx.origin`. Allowlists (WL scoring, raffle) carry the anti-sybil work off chain.
16. **ElyHerd: Kalos.**
    - Listing on Kalos needs a Kalos admin to register the collection.
    - Kalos enforces royalties as a marketplace-set creator fee (verified on a fork: 5% to the treasury). ERC-2981 is not read on chain, and other venues or direct transfers pay nothing.
    - Kalos settles in its own WHYPE (`0x4105…9Ac7`), not the canonical one.
    - The Kalos deployer also runs fake "BAYC/Punks/…" collections. Never show them as authentic. See `research/kalos-nft.md`.
17. **Toolchain.** `npm audit` reports advisories in the Hardhat dev toolchain. They are dev-only and not shipped, but keep the toolchain updated.

## Reporting

Report suspected vulnerabilities privately to the Elyia owner. Do not open public issues for them.
