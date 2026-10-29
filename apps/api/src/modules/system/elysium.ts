/**
 * Elysium pulse routes.
 *
 * GET /v1/elysium/pulse?network=        -> Pulse (core type); waits briefly for a
 *                                          warm poller, 503 PULSE_UNAVAILABLE if none
 * GET /v1/elysium/blocks/stream?network= -> SSE: `event: block` (id = block
 *                                          number, data = PulseBlock) and
 *                                          `event: pulse` (data = Pulse), the
 *                                          last pulse sent immediately on connect;
 *                                          Last-Event-ID replays buffered blocks
 */
import { PULSE_EVENTS, type NetworkKey } from "@elyia/core";
import type { Request, Router } from "express";
import { z } from "zod";
import type { AppContext } from "../../context.js";
import { ElyiaHttpError, retryAfterHeader } from "../../http/errors.js";
import { openSse } from "../../http/sse.js";
import { parseQuery } from "../../http/validate.js";
import { networkKey } from "./query.js";

const PulseQuery = z.object({ network: networkKey.optional() });

export const PULSE_WAIT_MS = 3_000;

function networkOf(req: Request, ctx: AppContext): NetworkKey {
  return parseQuery(req, PulseQuery).network ?? ctx.pulse.defaultNetwork;
}

export function registerElysium(router: Router, ctx: AppContext): void {
  router.get("/elysium/pulse", async (req, res) => {
    const network = networkOf(req, ctx);
    const pulse = await ctx.pulse.waitForPulse(network, { timeoutMs: PULSE_WAIT_MS });
    if (!pulse) {
      throw new ElyiaHttpError(
        "PULSE_UNAVAILABLE",
        503,
        "The Elysium pulse is not available yet: the block poller is warming up or no RPC endpoint is answering. Retry shortly.",
        { network },
        { headers: retryAfterHeader(2) },
      );
    }
    res.json(pulse);
  });

  router.get("/elysium/blocks/stream", (req, res) => {
    const network = networkOf(req, ctx);
    if (req.method === "HEAD") {
      // Validates the network (400/503) without starting the poller.
      ctx.pulse.latest(network);
      res.status(200).setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.end();
      return;
    }
    // Fails (400/503 envelope) before any SSE header when the network cannot be polled.
    const release = ctx.pulse.retain(network);
    let stream;
    try {
      stream = openSse(req, res, { slots: ctx.limits.streams, now: () => ctx.clock.now() });
    } catch (error) {
      release();
      throw error;
    }
    stream.onClose(release);
    if (stream.closed) return;

    // Replay and subscribe in one synchronous section: no block can fall between them.
    const resumeFrom = stream.lastEventId && /^\d{1,15}$/u.test(stream.lastEventId) ? Number(stream.lastEventId) : null;
    if (resumeFrom !== null) {
      for (const block of ctx.pulse.recentBlocks(network, resumeFrom)) stream.send(PULSE_EVENTS.block, block, block.number);
    }
    const latest = ctx.pulse.latest(network);
    if (latest) stream.send(PULSE_EVENTS.pulse, latest);
    const offBlock = ctx.bus.on("elysium.block", (block) => {
      if (block.network === network) stream.send(PULSE_EVENTS.block, block, block.number);
    });
    const offPulse = ctx.bus.on("elysium.pulse", (pulse) => {
      // A newer pulse supersedes this one: skip it for a client that is not keeping up.
      if (pulse.network === network) stream.send(PULSE_EVENTS.pulse, pulse, undefined, { droppable: true });
    });
    stream.onClose(() => {
      offBlock();
      offPulse();
    });
  });
}
