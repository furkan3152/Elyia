/**
 * Event model shared by the API (SSE streams, Telegram dispatch), the web
 * app's cross-feature bus and the Mini App. Payloads are small and carry ids;
 * consumers re-read full objects from the API.
 */
import type { NetworkKey } from "./networks.js";
import type { IntentStatus, StepStatus } from "./intent.js";
import type { PolicyDecision, PolicyRuleId } from "./policyEvaluate.js";

export interface ElyiaEventMap {
  "intent.created": { readonly intentId: string; readonly status: IntentStatus; readonly title: string };
  "intent.status_changed": { readonly intentId: string; readonly from: IntentStatus; readonly to: IntentStatus };
  "intent.step_updated": {
    readonly intentId: string;
    readonly stepId: string;
    readonly from: StepStatus;
    readonly to: StepStatus;
    readonly network: NetworkKey;
    readonly reference?: string;
  };
  "order.updated": {
    readonly intentId?: string;
    readonly account: string;
    readonly market: string;
    readonly oid?: number;
    readonly cloid?: string;
    /** HyperCore order status (open, filled, canceled, ...). */
    readonly status: string;
    readonly filledSz: string;
    readonly avgPx: string | null;
  };
  "fill.recorded": {
    readonly account: string;
    readonly market: string;
    readonly side: "buy" | "sell";
    readonly px: string;
    readonly sz: string;
    readonly closedPnl: string;
    readonly hash: string;
    readonly time: number;
  };
  "position.changed": { readonly account: string; readonly market: string; readonly szi: string; readonly liquidationPx: string | null };
  "alert.fired": { readonly alertId: string; readonly kind: string; readonly market?: string; readonly value: string; readonly threshold: string };
  "agent.proposal": { readonly automationId: string; readonly proposalId: string; readonly intentId?: string; readonly decision: PolicyDecision };
  "agent.blocked": { readonly automationId: string; readonly rules: readonly PolicyRuleId[] };
  "agent.paused": { readonly account: string; readonly reason: "kill-switch" | "loss-stop" | "keeper-expired" | "keeper-revoked" };
  "policy.updated": { readonly account: string; readonly ruleBookHash: string; readonly loosened: readonly string[] };
  "telegram.linked": { readonly account: string; readonly chatId: string };
  "wallet.connected": { readonly address: string; readonly chainId: number | null };
  "wallet.disconnected": { readonly address: string };
  "network.selected": { readonly network: NetworkKey };
  "portfolio.invalidated": { readonly account: string; readonly networks?: readonly NetworkKey[] };
}

export type ElyiaEventType = keyof ElyiaEventMap;

export const ELYIA_EVENT_TYPES: readonly ElyiaEventType[] = Object.freeze([
  "intent.created",
  "intent.status_changed",
  "intent.step_updated",
  "order.updated",
  "fill.recorded",
  "position.changed",
  "alert.fired",
  "agent.proposal",
  "agent.blocked",
  "agent.paused",
  "policy.updated",
  "telegram.linked",
  "wallet.connected",
  "wallet.disconnected",
  "network.selected",
  "portfolio.invalidated",
]);

export interface ElyiaEvent<T extends ElyiaEventType = ElyiaEventType> {
  readonly id: string;
  readonly type: T;
  readonly at: string;
  readonly data: ElyiaEventMap[T];
}

export type AnyElyiaEvent = { [K in ElyiaEventType]: ElyiaEvent<K> }[ElyiaEventType];

type Listener<T> = (payload: T) => void;

export interface EventBus<M extends object> {
  on<K extends keyof M>(type: K, listener: Listener<M[K]>): () => void;
  once<K extends keyof M>(type: K, listener: Listener<M[K]>): () => void;
  off<K extends keyof M>(type: K, listener: Listener<M[K]>): void;
  emit<K extends keyof M>(type: K, payload: M[K]): void;
  /** Every event, with its type. */
  onAny(listener: <K extends keyof M>(type: K, payload: M[K]) => void): () => void;
  clear(): void;
}

/** Tiny synchronous typed pub/sub. A throwing listener never stops the others. */
export function createEventBus<M extends object>(onListenerError: (error: unknown) => void = () => undefined): EventBus<M> {
  const listeners = new Map<keyof M, Set<Listener<unknown>>>();
  const wildcard = new Set<(type: keyof M, payload: unknown) => void>();
  const bus: EventBus<M> = {
    on(type, listener) {
      const set = listeners.get(type) ?? new Set();
      set.add(listener as Listener<unknown>);
      listeners.set(type, set);
      return () => bus.off(type, listener);
    },
    once(type, listener) {
      const unsubscribe = bus.on(type, (payload) => {
        unsubscribe();
        listener(payload);
      });
      return unsubscribe;
    },
    off(type, listener) {
      listeners.get(type)?.delete(listener as Listener<unknown>);
    },
    emit(type, payload) {
      for (const listener of [...(listeners.get(type) ?? [])]) {
        try {
          listener(payload);
        } catch (error) {
          onListenerError(error);
        }
      }
      for (const listener of [...wildcard]) {
        try {
          listener(type, payload);
        } catch (error) {
          onListenerError(error);
        }
      }
    },
    onAny(listener) {
      const wrapped = listener as (type: keyof M, payload: unknown) => void;
      wildcard.add(wrapped);
      return () => {
        wildcard.delete(wrapped);
      };
    },
    clear() {
      listeners.clear();
      wildcard.clear();
    },
  };
  return bus;
}
