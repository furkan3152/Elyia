# Elyia

Elyia is the intent, trading and portfolio deck for **Elysium**, **HyperEVM** and
**HyperCore**. It turns a plain goal — bridge, swap, trade, earn, track — into an
auditable intent graph, builds the exact payloads to execute it, and keeps a Rule
Book between the user and their capital. Testnet first (Elysium 99801, HyperEVM 998,
HyperCore testnet); mainnet stays off until each network is reachable.

A guiding rule runs through the whole codebase: **the server never signs.** Elyia
builds hashes and typed data; wallets, an in-browser agent key and an opt-in Keeper
key sign. Policies fail closed, de-risking always works, and amounts are strings and
bigints — never floats.

## Architecture

Three workspaces, one shared spec:

```
                    ┌───────────────────────────┐
                    │        @elyia/core        │  packages/core
                    │  zero-I/O shared spec:     │
                    │  networks, tokens, intent  │
                    │  graph, Rule Book,         │
                    │  HyperCore signing         │
                    └─────────────┬─────────────┘
                   imports        │        imports
            ┌──────────────────┐  │  ┌──────────────────┐
            ▼                  │  │  │                  ▼
   ┌──────────────────┐       │  │  │       ┌──────────────────┐
   │    @elyia/api    │◀──────┘  └──┤       │    @elyia/web    │
   │  apps/api        │   HTTP / SSE │       │  apps/web        │
   │  Express 5:      │◀─────────────┼──────▶│  Vite 6 + React  │
   │  data, intents,  │              │       │  18, wagmi 2 +   │
   │  tracking, bot,  │              │       │  RainbowKit 2    │
   │  Elysium Agent   │              │       │  (the deck)      │
   └──────────────────┘              │       └──────────────────┘
```

| Package | Path | Role |
|---|---|---|
| [`@elyia/core`](packages/core/README.md) | `packages/core` | The zero-I/O shared spec: networks, token and protocol registries, the intent graph and its lifecycle, the Rule Book, and the HyperCore signing payloads with golden vectors. Runs anywhere JavaScript runs — no `node:` imports, no network, no secrets. |
| [`@elyia/api`](apps/api/README.md) | `apps/api` | One Express 5 service for Elysium, HyperEVM and HyperCore data, intents, tracking, alerts, Telegram and the Elysium Agent. Feature modules plug in under `src/modules/`. |
| [`@elyia/web`](apps/web/README.md) | `apps/web` | The Vite 6 / React 18 web app and design system: the trading terminal, portfolio deck and intent flows, wallet connection via wagmi 2 + RainbowKit 2. |

## Quick start

Requires Node 22.12 or newer (see [`.nvmrc`](.nvmrc)).

```sh
npm ci                 # installs all workspaces and builds @elyia/core

npm run dev:api        # @elyia/api on http://localhost:3001
npm run dev:web        # @elyia/web on http://localhost:5175
```

The API runs with sensible defaults and no configuration. To set RPC URLs, a
database, the Telegram bot or the Elysium Agent, copy the API's env template and edit
it — every variable is documented there:

```sh
cp apps/api/.env.example apps/api/.env
```

The web app reads `VITE_API_URL` (default `http://localhost:3001`) and an optional
`VITE_WALLETCONNECT_PROJECT_ID` at build time.

## Verify

One command runs the whole gate — package build, package tests, lint, typecheck, the
API and web test suites, and both app builds:

```sh
npm run verify
```

Useful subsets:

```sh
npm run lint           # eslint .
npm run typecheck      # tsc --noEmit across workspaces
npm run test:packages  # @elyia/core tests (incl. HyperCore golden vectors)
npm run test:api       # @elyia/api tests
npm run test:web       # @elyia/web tests
npm run build:web      # @elyia/web production build
```

## Layout

```
packages/core/   @elyia/core — shared spec (see its README)
apps/api/        @elyia/api  — Express service (see its README)
apps/web/        @elyia/web  — React deck (see its README)
tooling/         workspace build helpers
```

## License

Released under the [MIT License](LICENSE).
