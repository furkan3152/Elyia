# @elyia/sdk

Typed TypeScript client for the [Elyia](../../apps/api/API.md) API: plan,
prepare and submit intents across Elysium, HyperEVM and HyperCore, follow
their journey live, read venues, protocols, portfolios and Shield reports,
talk to Ely, and verify webhooks.

**Elyia never signs.** `prepare` returns unsigned payloads; your user's
wallet signs them, and `submit` sends back only references (tx hashes,
`hc:cloid:...`, `hc:nonce:...`), which the server verifies on chain.

```ts
import { ElyiaClient } from "@elyia/sdk";

const elyia = new ElyiaClient({ baseUrl: "https://api.elyia.app", apiKey: process.env.ELYIA_API_KEY });

const plan = await elyia.plan({
  accounts: [`eip155:99801:${address}`],
  actions: [{ kind: "swap", network: "elysium-testnet", from: "HYPE", to: "USDC", amount: "1" }],
});
const step = plan.intent.steps[0];
const { payload } = await elyia.prepare(plan.intent.id, step.id);
const hash = await wallet.sendTransaction(payload.requests[0]); // the user's wallet
await elyia.submit(plan.intent.id, step.id, [hash]);
for await (const event of elyia.journeyStream(plan.intent.id)) console.log(event.type);
```

| method | route |
|---|---|
| `parse(text)` | `POST /v1/intents/parse` |
| `plan(body)` | `POST /v1/intents` (`dryRun` supported) |
| `intent(id)`, `journey(id)` | `GET /v1/intents/:id`, `/journey` |
| `prepare(id, step)`, `submit(id, step, refs)`, `stop(id)` | step lifecycle |
| `journeyStream(id)` | `GET /v1/intents/:id/stream` (SSE) |
| `venues()`, `protocols()`, `portfolio(addr)`, `shield(token)` | reads |
| `insights(addr)` | Ely's deterministic portfolio insights |
| `chat({ message, address })` | `POST /v1/agent/chat` (SSE) |
| `usage()`, `keys()` | developer portal (key or developer session) |
| `contracts()`, `widget(devId)` | public config |

Webhooks: `verifyWebhook({ secret, rawBody, signatureHeader })` checks
`Elyia-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, "<t>.<body>")>` with a
5-minute replay window (WebCrypto: Node 20+, Workers, browsers). Deliveries
are at least once: dedupe on `Elyia-Event-Id`.

Keys: server-side only. A key carries scopes (`read`, `plan`,
`execute-prepare`, `webhooks`) and quotas (per minute and per UTC day);
`429 QUOTA_EXCEEDED` carries `Retry-After`, which the client honours (2
retries by default).

Examples: `examples/plan-and-sign.ts`, `examples/ask-ely.ts`,
`examples/webhook-receiver.ts`. A React hooks package is not included yet.
