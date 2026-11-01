/**
 * Worker and queue stats for the admin dashboard. Background services
 * register a reader; the dashboard calls each one (a failing reader shows
 * as an error, never breaks the page).
 */
import type { AppContext } from "../../context.js";

export interface WorkerStats {
  readonly running: boolean;
  readonly lastRunAt: number | null;
  readonly lastError: string | null;
  readonly pending: number;
  readonly note?: string;
}

const readers = new WeakMap<AppContext, Map<string, () => WorkerStats | Promise<WorkerStats>>>();

export function registerStats(ctx: AppContext, name: string, read: () => WorkerStats | Promise<WorkerStats>): void {
  let map = readers.get(ctx);
  if (!map) {
    map = new Map();
    readers.set(ctx, map);
  }
  map.set(name, read);
}

export async function readStats(ctx: AppContext): Promise<Record<string, WorkerStats>> {
  const out: Record<string, WorkerStats> = {};
  for (const [name, read] of readers.get(ctx) ?? []) {
    try {
      out[name] = await read();
    } catch (error) {
      out[name] = { running: false, lastRunAt: null, lastError: error instanceof Error ? error.message.slice(0, 120) : "unreadable", pending: 0 };
    }
  }
  return out;
}
