/**
 * Plan a swap on Elysium testnet, prepare it, let the user's wallet sign, submit the hash.
 * Run: ELYIA_API_KEY=ely_... ELYIA_BASE_URL=http://localhost:3001 npx tsx examples/plan-and-sign.ts 0xYourAddress
 */
import { ElyiaClient } from "../src/index.js";

const address = process.argv[2] ?? "0x5e9ee1089755c3435139848e47e6635505d5a13a";
const elyia = new ElyiaClient({ baseUrl: process.env.ELYIA_BASE_URL ?? "http://localhost:3001", ...(process.env.ELYIA_API_KEY ? { apiKey: process.env.ELYIA_API_KEY } : {}) });

const plan = await elyia.plan({
  accounts: [`eip155:99801:${address}`],
  actions: [{ kind: "swap", network: "elysium-testnet", from: "HYPE", to: "USDC", amount: "0.1" }],
  dryRun: true,
});
console.log(plan.intent.summary.title, "->", plan.quotes.map((quote) => `${quote.protocol}${quote.winner ? " (winner)" : ""}`).join(", "));
console.log("policy:", plan.policy.decision, "notional:", plan.policy.notionalUsd, plan.policy.priceSource);

// To execute: plan without dryRun, then for each step:
//   const { payload } = await elyia.prepare(intent.id, step.id);
//   const hash = await walletClient.sendTransaction(payload.requests[0]);   // the USER's wallet signs
//   await elyia.submit(intent.id, step.id, [hash]);
//   for await (const event of elyia.journeyStream(intent.id)) console.log(event.type);
