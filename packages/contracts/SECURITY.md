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

**Invariants the code enforces**

1. The router only ever pulls funds from `msg.sender` (ERC-20 allowance, Permit2 signature with `owner = msg.sender`, or the sender's Permit2 allowance). The router owner cannot move anyone's allowance.
2. The router ends every call with no more of any touched token (or HYPE) than it started with. Pre-existing dust is never usable or sweepable by callers.
3. Venues get an exact allowance per hop, reset to zero right after; outputs are measured by balance differences.
4. `minAmountOut` and `deadline` apply to the total, net of protocol + integrator fees. Protocol fee is at most 30 bps (default 0); integrator fees need owner registration and are at most 50 bps.
5. The ElyAccount agent has no transfer, approve, arbitrary-call, policy or signing power. Every agent action forces the output back into the account, checks `spent <= amountIn` and `received >= minOut`, charges per-token per-tx and daily caps, and emits `AgentAction`.
6. Revocation and policy replacement bump `policyEpoch`, which voids every allowlisted call, token rule, market and spend counter at once. Expiry is checked on every agent call.
7. Only the account owner can produce ERC-1271 signatures, and only over `ElyAccountMessage(hash)` in the account's own EIP-712 domain, so signatures do not replay across accounts of the same owner.
8. ElyOrders: EIP-712 orders bound to chain id and contract; per-order execution counter, interval, start and deadline; cancel and monotonic nonce floor by the maker; tip <= signed `maxTip` <= 1% of `amountIn`; output always to the maker and re-checked against `minAmountOut`; `nonReentrant` everywhere.

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
12. **Toolchain.** `npm audit` reports advisories in the Hardhat dev toolchain. They are dev-only and not shipped, but keep the toolchain updated.

## Reporting

Report suspected vulnerabilities privately to the Elyia owner. Do not open public issues for them.
