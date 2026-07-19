/**
 * API helpers — Phase 2 Session 3.
 *
 * Shared helpers for auth route handlers (and Phase 4+ routes).
 *
 * Error response shape (locked Phase 2 Session 3):
 *
 *   { error: string, code: string, field?: string, retry_after_seconds?: number }
 *
 *   - error: human-readable message (defaults to `code` when no message given)
 *   - code:  machine-stable identifier
 *   - field: optional, identifies the offending input field for validation errors
 *   - retry_after_seconds: optional, attached to 423 account_locked responses
 *
 * Status code policy (locked Phase 2 Session 3):
 *   400 invalid_payload / invalid_json — caller's request was malformed
 *   401 invalid_credentials / unauthorized
 *   403 account_inactive / email_not_verified / forbidden
 *   423 account_locked (with retry_after_seconds)
 *   429 rate_limited                — reserved for Phase 5+
 *   500 internal_error              — unexpected; should be rare
 */

import { NextResponse, type NextRequest } from "next/server";
import { trustedClientIp } from "./client-ip";

export interface JsonErrorOptions {
  /** Human-readable message. Falls back to `code` when omitted. */
  message?: string;
  /** Field name for validation errors (e.g., "email", "pin"). */
  field?: string;
  /** Lockout retry-after, in seconds. Attach to 423 responses. */
  retry_after_seconds?: number;
  [k: string]: unknown;
}

export function jsonError(
  status: number,
  code: string,
  options: JsonErrorOptions = {},
): NextResponse {
  const { message, ...rest } = options;
  return NextResponse.json({ error: message ?? code, code, ...rest }, { status });
}

export function jsonOk<T extends Record<string, unknown>>(
  body: T,
  status = 200,
): NextResponse {
  return NextResponse.json(body, { status });
}

/** Read the client IP from a PLATFORM-TRUSTED source (A-M2 — the leftmost x-forwarded-for is
 * client-spoofable). Delegates to trustedClientIp. Returns null if no source is set. */
export function extractIp(req: NextRequest): string | null {
  return trustedClientIp(req);
}

/**
 * Attempt to parse the request body as JSON.
 *
 *   On success → returns the parsed value as `unknown`. Caller MUST narrow
 *                with a type guard before consuming.
 *   On failure → returns a 400 NextResponse the caller should `return` directly.
 *
 * Distinguish via `result instanceof Response` (NextResponse extends Response).
 */
export async function parseJsonBody(req: NextRequest): Promise<unknown | NextResponse> {
  try {
    return await req.json();
  } catch {
    return jsonError(400, "invalid_json", { message: "Request body must be valid JSON" });
  }
}
