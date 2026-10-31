/**
 * Intent stream events: a per-intent ring buffer (the last 100 events, for
 * the last 2,000 intents touched) so an SSE client can resume with
 * Last-Event-ID, fanned out through the app bus (`intents.event`). Events
 * are derived by diffing the graph before and after each write, so every
 * writer (routes, poller) reports the same way.
 */
import { deriveIntentStatus, type IntentGraph, type IntentStatus } from "@elyia/core";
import type { IntentStreamEvent } from "@elyia/core/api/intents";
import type { EventBus } from "../bus.js";
import type { Clock } from "../clock.js";

declare module "../bus.js" {
  interface ElyiaEvents {
    /** One intent stream event (also buffered for Last-Event-ID resumes). */
    "intents.event": { readonly intentId: string; readonly event: IntentStreamEvent };
  }
}

export const EVENTS_PER_INTENT = 100;
export const BUFFERED_INTENTS = 2_000;

interface Buffer {
  seq: number;
  events: IntentStreamEvent[];
}

type EventBody = IntentStreamEvent extends infer E ? (E extends IntentStreamEvent ? Omit<E, "id" | "at"> : never) : never;

export class IntentEvents {
  private readonly buffers = new Map<string, Buffer>();

  constructor(
    private readonly bus: EventBus,
    private readonly clock: Clock,
  ) {}

  private buffer(intentId: string): Buffer {
    let buffer = this.buffers.get(intentId);
    if (buffer) {
      // LRU: re-insert on touch.
      this.buffers.delete(intentId);
      this.buffers.set(intentId, buffer);
      return buffer;
    }
    buffer = { seq: 0, events: [] };
    this.buffers.set(intentId, buffer);
    while (this.buffers.size > BUFFERED_INTENTS) {
      const oldest = this.buffers.keys().next().value;
      if (oldest === undefined) break;
      this.buffers.delete(oldest);
    }
    return buffer;
  }

  emit(intentId: string, body: EventBody): IntentStreamEvent {
    const buffer = this.buffer(intentId);
    buffer.seq += 1;
    const event = { ...body, id: String(buffer.seq), at: new Date(this.clock.now()).toISOString() } as IntentStreamEvent;
    buffer.events.push(event);
    if (buffer.events.length > EVENTS_PER_INTENT) buffer.events.splice(0, buffer.events.length - EVENTS_PER_INTENT);
    this.bus.emit("intents.event", { intentId, event });
    return event;
  }

  /** Events after `lastId`, or null when the buffer no longer reaches back that far (send a snapshot). */
  since(intentId: string, lastId: string | undefined): IntentStreamEvent[] | null {
    const buffer = this.buffers.get(intentId);
    if (!lastId) return [];
    const last = Number(lastId);
    if (!buffer || !Number.isInteger(last) || last < 0 || last > buffer.seq) return null;
    const first = buffer.events[0];
    if (last < buffer.seq && (!first || Number(first.id) > last + 1)) return null;
    return buffer.events.filter((event) => Number(event.id) > last);
  }

  /** The id the next snapshot sits at (the latest event id). */
  lastId(intentId: string): string {
    return String(this.buffers.get(intentId)?.seq ?? 0);
  }

  subscribe(intentId: string, listener: (event: IntentStreamEvent) => void): () => void {
    return this.bus.on("intents.event", (payload) => {
      if (payload.intentId === intentId) listener(payload.event);
    });
  }

  /** Emits what changed between two versions of an intent. */
  diff(before: IntentGraph | null, after: IntentGraph): void {
    const now = this.clock.now();
    if (!before) {
      this.emit(after.id, { type: "intent.created", data: { intentId: after.id, status: statusOf(after, now) } });
      return;
    }
    for (const step of after.steps) {
      const previous = before.steps.find((candidate) => candidate.id === step.id);
      const evidenceGrew = (previous?.evidence.length ?? 0) < step.evidence.length;
      if (previous && previous.status === step.status && !evidenceGrew) continue;
      const latest = step.evidence[step.evidence.length - 1];
      this.emit(after.id, { type: "intent.step_updated", data: { intentId: after.id, stepId: step.id, network: step.network, status: step.status, ...(evidenceGrew && latest ? { evidence: latest } : {}) } });
    }
    const was = statusOf(before, now);
    const is = statusOf(after, now);
    if (was !== is) this.emit(after.id, { type: "intent.status_changed", data: { intentId: after.id, status: is, previous: was } });
  }
}

export function statusOf(graph: IntentGraph, now: number): IntentStatus {
  return deriveIntentStatus(graph.steps, graph.expiresAt, now);
}
