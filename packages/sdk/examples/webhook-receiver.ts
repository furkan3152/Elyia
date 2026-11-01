/**
 * Minimal webhook receiver (node:http) that verifies Elyia-Signature.
 * Run: ELYIA_WEBHOOK_SECRET=whsec_... npx tsx examples/webhook-receiver.ts
 */
import { createServer } from "node:http";
import { verifyWebhook, WebhookSignatureError } from "../src/index.js";

const seen = new Set<string>();
createServer((req, res) => {
  let raw = "";
  req.on("data", (chunk: Buffer) => (raw += chunk.toString("utf8")));
  req.on("end", async () => {
    try {
      const event = await verifyWebhook({ secret: process.env.ELYIA_WEBHOOK_SECRET ?? "", rawBody: raw, signatureHeader: req.headers["elyia-signature"] as string | undefined });
      if (!seen.has(event.id)) {
        seen.add(event.id);
        console.log(event.type, JSON.stringify(event.data));
      }
      res.writeHead(200).end();
    } catch (error) {
      res.writeHead(error instanceof WebhookSignatureError ? 401 : 400).end();
    }
  });
}).listen(8787, () => console.log("listening on :8787"));
