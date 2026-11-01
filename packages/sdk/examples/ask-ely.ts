/**
 * Ask Ely about a public address (deterministic without ANTHROPIC_API_KEY on the server).
 * Run: npx tsx examples/ask-ely.ts "what's my HYPE exposure?" 0xAddress
 */
import { ElyiaClient } from "../src/index.js";

const elyia = new ElyiaClient({ baseUrl: process.env.ELYIA_BASE_URL ?? "http://localhost:3001" });
const [message = "help", address = "0x5e9ee1089755c3435139848e47e6635505d5a13a"] = process.argv.slice(2);
for await (const event of elyia.chat({ message, address })) {
  if (event.event === "token") process.stdout.write((event.data as { text: string }).text);
  else if (event.event === "proposal") console.log("\n[proposal]", (event.data as { title: string }).title);
  else if (event.event === "done") console.log();
}
