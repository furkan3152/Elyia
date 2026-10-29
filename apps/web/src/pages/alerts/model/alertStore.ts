/**
 * The user's alert rules, the Guide's standing orders and the in-app feed
 * of what fired. Kept on this device (guarded storage); the Telegram copy
 * goes through the API once the bot is online.
 */
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { safeLocalStorage } from "../../../app/state/storage";
import type { AlertKind, AlertRule } from "./rules";

export interface FeedItem {
  readonly id: string;
  readonly at: number;
  readonly ruleId: string;
  readonly kind: AlertKind;
  readonly message: string;
  /** Standing order: the action the Guide drafted. */
  readonly action?: string;
  /** The coin it is about, when known. */
  readonly coin?: string;
  /** Delivered to Telegram as well (false while the bot is offline). */
  readonly telegram: boolean;
  readonly read: boolean;
}

export interface AlertStore {
  readonly rules: readonly AlertRule[];
  readonly feed: readonly FeedItem[];
  addRule(rule: AlertRule): void;
  updateRule(id: string, patch: Partial<AlertRule>): void;
  removeRule(id: string): void;
  /** Pauses every standing order (the kill switch); alerts keep listening. */
  pauseStanding(): number;
  pushFeed(item: FeedItem): void;
  markRead(): void;
  clearFeed(): void;
}

export const ALERT_STORAGE_KEY = "elyia.alerts";
const MAX_RULES = 40;
const MAX_FEED = 80;
const KINDS: readonly AlertKind[] = ["price", "funding", "rope", "fill", "bridge"];

const finiteOrNull = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);

/** Keeps only well-formed rules from storage (anything else is dropped). */
export function sanitizeRules(value: unknown): AlertRule[] {
  if (!Array.isArray(value)) return [];
  const out: AlertRule[] = [];
  for (const entry of value.slice(0, MAX_RULES)) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    if (typeof record.id !== "string" || !KINDS.includes(record.kind as AlertKind)) continue;
    const channels = record.channels && typeof record.channels === "object" ? (record.channels as Record<string, unknown>) : {};
    out.push({
      id: record.id.slice(0, 40),
      kind: record.kind as AlertKind,
      coin: typeof record.coin === "string" ? record.coin.toUpperCase().slice(0, 20) : null,
      direction: record.direction === "below" ? "below" : "above",
      threshold: finiteOrNull(record.threshold),
      channels: { app: channels.app !== false, telegram: channels.telegram === true },
      armed: record.armed === true,
      once: record.once === true,
      createdAt: finiteOrNull(record.createdAt) ?? 0,
      lastFiredAt: finiteOrNull(record.lastFiredAt),
      ...(typeof record.action === "string" && record.action.trim() ? { action: record.action.slice(0, 200) } : {}),
    });
  }
  return out;
}

function sanitizeFeed(value: unknown): FeedItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is FeedItem => Boolean(entry) && typeof entry === "object" && typeof (entry as FeedItem).id === "string" && typeof (entry as FeedItem).message === "string" && typeof (entry as FeedItem).at === "number")
    .slice(0, MAX_FEED);
}

export const useAlertStore = create<AlertStore>()(
  persist(
    (set, get) => ({
      rules: [],
      feed: [],
      addRule: (rule) => set((state) => ({ rules: [rule, ...state.rules].slice(0, MAX_RULES) })),
      updateRule: (id, patch) => set((state) => ({ rules: state.rules.map((rule) => (rule.id === id ? { ...rule, ...patch, id: rule.id } : rule)) })),
      removeRule: (id) => set((state) => ({ rules: state.rules.filter((rule) => rule.id !== id) })),
      pauseStanding: () => {
        const armed = get().rules.filter((rule) => rule.action && rule.armed).length;
        set((state) => ({ rules: state.rules.map((rule) => (rule.action ? { ...rule, armed: false } : rule)) }));
        return armed;
      },
      pushFeed: (item) => set((state) => ({ feed: [item, ...state.feed].slice(0, MAX_FEED) })),
      markRead: () => set((state) => ({ feed: state.feed.map((item) => (item.read ? item : { ...item, read: true })) })),
      clearFeed: () => set({ feed: [] }),
    }),
    {
      name: ALERT_STORAGE_KEY,
      version: 1,
      storage: createJSONStorage(() => safeLocalStorage),
      partialize: (state) => ({ rules: state.rules, feed: state.feed }),
      merge: (persisted, current) => {
        const record = persisted && typeof persisted === "object" ? (persisted as Record<string, unknown>) : {};
        return { ...current, rules: sanitizeRules(record.rules), feed: sanitizeFeed(record.feed) };
      },
    },
  ),
);
