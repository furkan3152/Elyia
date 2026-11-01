/** Which proposal-approve errors fall back to a plain intent (pure; see proposalLink.ts). */
import { ApiError } from "../../lib/apiErrors";

/** Errors that mean "this proposal cannot be approved now": sign a plain intent instead. Others are real failures. */
export function fallbackReason(error: unknown): string | null {
  if (!(error instanceof ApiError)) return null;
  if (error.status === 409) return `${error.message} Signing a fresh plan of the same moves instead.`;
  if (error.status === 404) return "That proposal is gone. Signing a fresh plan of the same moves instead.";
  if (error.status === 401 || error.status === 403) return "Your sign-in ended, so the proposal stays as it was. Signing a fresh plan of the same moves instead.";
  return null;
}

