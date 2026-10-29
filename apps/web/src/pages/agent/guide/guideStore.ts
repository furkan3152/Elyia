/**
 * The Guide's conversation (this session only: proposals carry live marks,
 * so they are never replayed from storage) and its audit log (every
 * proposal, signature, refusal, rule and kill-switch press; kept on this
 * device so the user can read back what happened).
 */
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { safeLocalStorage } from "../../../app/state/storage";
import type { RadioTone } from "../../../topo/RadioLog";
import type { GuideReply } from "./planner";

export type ProposalOutcome = "signed" | "refused" | "armed" | "opened" | "blocked";

export interface GuideMessage {
  readonly id: string;
  readonly at: number;
  readonly role: "you" | "guide";
  readonly text: string;
  readonly reply?: GuideReply;
  /** Outcome per proposal index, once acted on. */
  readonly outcomes?: Readonly<Record<number, { readonly status: ProposalOutcome; readonly note: string; readonly at: number }>>;
  /** A sample-range answer (labelled). */
  readonly sample?: boolean;
}

export interface AuditEntry {
  readonly id: string;
  readonly at: number;
  readonly from: string;
  readonly to?: string;
  readonly message: string;
  readonly tone: RadioTone;
}

export interface GuideStore {
  readonly thread: readonly GuideMessage[];
  /** The Guide message that is streaming in (session only). */
  readonly streamId: string | null;
  readonly audit: readonly AuditEntry[];
  /** Keeper licence draft: days of validity (≤ 30). */
  readonly licenceDays: 7 | 14 | 30;
  /** Your question (null when the Guide speaks first) and its reply. */
  ask(message: GuideMessage | null, reply: GuideMessage): void;
  setOutcome(messageId: string, index: number, status: ProposalOutcome, note: string): void;
  log(entry: Omit<AuditEntry, "id" | "at"> & { readonly at?: number }): void;
  clearThread(): void;
  clearAudit(): void;
  setLicenceDays(days: 7 | 14 | 30): void;
}

export const GUIDE_STORAGE_KEY = "elyia.guide";
const MAX_THREAD = 40;
const MAX_AUDIT = 80;
let counter = 0;

export function guideId(prefix: string, now: number): string {
  counter = (counter + 1) % 1_000_000;
  return `${prefix}${now.toString(36)}${counter.toString(36)}`;
}

function sanitizeAudit(value: unknown): AuditEntry[] {
  if (!Array.isArray(value)) return [];
  const tones: readonly RadioTone[] = ["plain", "alert", "settled", "refused"];
  return value
    .filter((entry): entry is AuditEntry => Boolean(entry) && typeof entry === "object" && typeof (entry as AuditEntry).id === "string" && typeof (entry as AuditEntry).message === "string" && typeof (entry as AuditEntry).at === "number" && typeof (entry as AuditEntry).from === "string")
    .map((entry) => ({ ...entry, message: entry.message.slice(0, 240), tone: tones.includes(entry.tone) ? entry.tone : "plain" }))
    .slice(0, MAX_AUDIT);
}

export const useGuideStore = create<GuideStore>()(
  persist(
    (set) => ({
      thread: [],
      streamId: null,
      audit: [],
      licenceDays: 7,
      ask: (message, reply) => set((state) => ({ thread: [...state.thread, ...(message ? [message] : []), reply].slice(-MAX_THREAD), streamId: reply.id })),
      setOutcome: (messageId, index, status, note) =>
        set((state) => ({
          thread: state.thread.map((message) => (message.id === messageId ? { ...message, outcomes: { ...(message.outcomes ?? {}), [index]: { status, note, at: Date.now() } } } : message)),
        })),
      log: (entry) => {
        const at = entry.at ?? Date.now();
        set((state) => ({ audit: [{ ...entry, at, id: guideId("a", at) }, ...state.audit].slice(0, MAX_AUDIT) }));
      },
      clearThread: () => set({ thread: [], streamId: null }),
      clearAudit: () => set({ audit: [] }),
      setLicenceDays: (licenceDays) => set({ licenceDays }),
    }),
    {
      name: GUIDE_STORAGE_KEY,
      version: 1,
      storage: createJSONStorage(() => safeLocalStorage),
      partialize: (state) => ({ audit: state.audit, licenceDays: state.licenceDays }),
      merge: (persisted, current) => {
        const record = persisted && typeof persisted === "object" ? (persisted as Record<string, unknown>) : {};
        const days = record.licenceDays === 14 || record.licenceDays === 30 ? record.licenceDays : 7;
        return { ...current, audit: sanitizeAudit(record.audit), licenceDays: days };
      },
    },
  ),
);
