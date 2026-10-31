/**
 * Engine errors are API errors: the catalog in @elyia/core gives the status
 * and the plain-language message, so every failure leaves with the same
 * envelope (`{error:{code,message,details,requestId}}`).
 */
import { describeError } from "@elyia/core";
import { ElyiaHttpError, retryAfterHeader, type ErrorDetails } from "../http/errors.js";

/** Codes the engine emits that the core catalog does not list (status given here). */
const EXTRA_STATUS: Readonly<Record<string, number>> = Object.freeze({
  TEXT_NOT_SUPPORTED_YET: 400,
  REFERENCE_WRONG_CHAIN: 422,
  STEP_NOT_PREPARED: 409,
  TOKEN_LOOKALIKE: 422,
  NAME_UNRESOLVED: 422,
  VENUE_UNAVAILABLE: 422,
});

/** An ElyiaHttpError with the catalog status and (unless given) the catalog message. */
export function engineError(code: string, message?: string, details?: ErrorDetails, retryAfterSeconds?: number): ElyiaHttpError {
  const described = describeError(code);
  const status = EXTRA_STATUS[code] ?? described?.status ?? 500;
  return new ElyiaHttpError(
    code,
    status,
    message ?? described?.message ?? "The request could not be completed.",
    details,
    retryAfterSeconds !== undefined ? { headers: retryAfterHeader(retryAfterSeconds) } : {},
  );
}

export function isEngineError(error: unknown, code?: string): error is ElyiaHttpError {
  return error instanceof ElyiaHttpError && (code === undefined || error.code === code);
}
