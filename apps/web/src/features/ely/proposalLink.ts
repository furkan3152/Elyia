/**
 * Signing a route card that came from one of Ely's proposals: the proposal
 * is approved (`POST /v1/agent/proposals/:id/decision`), which stores ONE
 * intent for its actions and links it back, so the proposal shows approved
 * (then executed once the intent completes) and no second intent is made.
 * Approving again returns the same intent. Nothing is signed here: the
 * wallet signs each step it prepares, when the person presses the button.
 *
 * When the proposal can no longer be approved (expired, rejected, gone, or
 * the session ended), the card falls back to a plain intent for the same
 * actions and says so.
 */
import type { Proposal, ProposalDecisionResponse } from "@elyia/core/api/agent";

import { sessionFetch } from "../session/sessionApi";
import { fallbackReason } from "./proposalFallback";

export { fallbackReason } from "./proposalFallback";

export interface ProposalRef {
  readonly id: string;
  /** Session token of the proposal's owner (the connected wallet). */
  readonly session: string;
}

export type ProposalLink = { readonly kind: "linked"; readonly intentId: string; readonly proposal: Proposal } | { readonly kind: "fallback"; readonly reason: string };

const listeners = new Set<(proposal: Proposal) => void>();

/** The chat store follows approved proposals (their status and intent). */
export function onProposalUpdate(listener: (proposal: Proposal) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function linkProposal(ref: ProposalRef): Promise<ProposalLink> {
  try {
    const response = await sessionFetch<ProposalDecisionResponse>(`/v1/agent/proposals/${ref.id}/decision`, ref.session, { method: "POST", body: { decision: "approve", via: "wallet" }, timeoutMs: 25_000 });
    if (!response.next?.intentId) return { kind: "fallback", reason: "The proposal has no plan to sign. Signing a fresh plan of the same moves instead." };
    for (const listener of listeners) listener(response.proposal);
    return { kind: "linked", intentId: response.next.intentId, proposal: response.proposal };
  } catch (error) {
    const reason = fallbackReason(error);
    if (reason) return { kind: "fallback", reason };
    throw error;
  }
}
