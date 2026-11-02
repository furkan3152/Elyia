/**
 * The live leg states of a route card, shared by the panel that signs it and
 * the compact card inline in the conversation, so both say the same thing
 * ("Settled" in the panel never sits next to "Sign next" inline). The panel
 * publishes under the turn id; the inline card reads them back.
 */
import type { ProposalStatus } from "@elyia/core/api/agent";
import { create } from "zustand";

import type { RouteStepState } from "../../topo/RouteCard";

interface CardStates {
  readonly byKey: Readonly<Record<string, readonly RouteStepState[]>>;
  publish(key: string, states: readonly RouteStepState[]): void;
}

export function sameStates(a: readonly RouteStepState[] | undefined, b: readonly RouteStepState[] | undefined): boolean {
  return a === b || (a !== undefined && b !== undefined && a.length === b.length && a.every((state, index) => state === b[index]));
}

export const useCardStates = create<CardStates>((set) => ({
  byKey: {},
  publish(key, states) {
    set((current) => (sameStates(current.byKey[key], states) ? current : { byKey: { ...current.byKey, [key]: [...states] } }));
  },
}));

/**
 * The states the inline card shows for `count` legs: the panel's states when
 * they line up leg for leg; every leg settled when the panel's route settled
 * (its plan may count legs differently) or the proposal executed; otherwise
 * none (the card's own defaults).
 */
export function inlineStates(published: readonly RouteStepState[] | undefined, count: number, proposalStatus: ProposalStatus | null = null): readonly RouteStepState[] | undefined {
  const allSettled = (published !== undefined && published.length > 0 && published.every((state) => state === "settled")) || proposalStatus === "executed";
  if (allSettled) return Array.from({ length: count }, () => "settled" as const);
  if (published && published.length === count) return published;
  return undefined;
}
