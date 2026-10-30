# @elyia/web

The Elyia web app: Vite 6, React 18, Tailwind 3, wagmi 2 + RainbowKit 2. Testnet first (Elysium 99801, HyperEVM 998, HyperCore testnet).

```sh
npm run dev -w @elyia/web        # http://localhost:5175 (the /kit reference page is dev-only)
npm run build -w @elyia/web      # tsc -b && vite build -> dist/
npm run typecheck -w @elyia/web
npm test -w @elyia/web           # node --test, pure modules only
```

Env (build time): `VITE_API_URL` (origin only, default `http://localhost:3001`), `VITE_WALLETCONNECT_PROJECT_ID` (32 hex; without it WalletConnect is hidden and only injected wallets are offered).

## Layout

```
src/
  main.tsx                 storage fallback, <html> theme/motion sync, QueryClientProvider, router
  app/
    router.tsx             custom history router (ported from Kletia), lazy pages, meta, focus, scroll
    routes/                routeTable.ts (every route, pure), matchPath.ts, history.ts, Link.tsx, useRoute.ts
    providers.tsx          WalletProviders: wagmi + RainbowKit (loaded only with /app)
    wallet/                chains (defineChain from @elyia/core NETWORKS), wallet list, RainbowKit theme
    state/                 ui store (theme, motion, mode, rail) with guarded storage; uiPrefs.ts is pure
    shell/                 AppShell (rail, top bar, mobile bar), SiteLayout (header, footer), Page, ElyiaMark,
                           UnderConstruction (placeholder panel)
    keyboard/              ⌘K / "/" Oracle, "?" shortcuts, "g t" style navigation
  ui/                      the kit (import from "src/ui"); see /kit for every component, live
  motion/                  reduced-motion preference, useAnimationFrame, AuroraBackdrop, Reveal, view transitions
  topo/                    the drawn Survey artifacts (Relief, Rope, RouteCard, ...); see src/topo/README.md
  features/                agentKey/ (trading key vault and signer), trading/ (see its README)
  oracle/                  OracleDialog, store, preview tokenizer + navigation commands
  lib/                     api.ts (fetch + error envelope), sse.ts, format.ts, pulse/ (hub, model, RPC fallback)
  hooks/                   usePulse, useMarkets, useNow
  pages/<name>/            one folder per route; placeholders render UnderConstruction
```

## Building a page

1. Replace `src/pages/<name>/<Name>Page.tsx` (it must keep a default export). Deck pages render inside the app shell;
   wrap content in `<Page>` (and `<PageHeader>` when the top bar title is not enough).
2. Links: `routeHref("trade", { market: "ETH" })` and `<Link>` / `<ButtonLink>`; params via `useRouteParam("market")`.
3. Data: `apiGet("/v1/...")` inside react-query; errors are `ApiError` with a stable `code` and a plain message.
4. Streams: `openEventStream({ url: apiUrl(...), parsers, onEvent })` validates every event and reconnects.

## Rules the kit encodes

- Colours are tokens only (`bg-bg-1 text-text-1 border-line text-mint bg-violet/15`); the Tailwind palette is replaced.
- Every number is tabular (`tnum`, mono). Money and prices never tween: `NumberTicker` flashes once, it does not count.
- Skeletons, not spinners. Empty states teach with an example intent (`<EmptyState example="..." />`).
- Motion: canvas loops run only while visible, on screen and allowed (`useAnimationFrame`); CSS animations stop under
  `prefers-reduced-motion` or the Motion switch (`html[data-motion="off"]`). Nothing flashes as a whole above 3 Hz.
- Honesty: data that is unavailable says so (demo labels, "under construction in this build", stale/offline states).
  The pulse falls back to Elysium's public RPC from the browser when the API is unreachable, and says so.
- Marketing routes (`kind: "site"`) never import the wallet stack; only the app shell loads it.
- Storage goes through `src/app/state/storage.ts` (never throws). The Oracle's sentence stays in memory.
