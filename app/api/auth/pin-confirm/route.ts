/**
 * POST /api/auth/pin-confirm — verify the authenticated actor's 4-digit PIN.
 *
 * Used as the "signature" step for cash deposit and any other flow that needs
 * a second-factor proof-of-presence from an already-authenticated actor.
 *
 * Body: { pin: string }
 *
 * Flow:
 *   1. requireSession — actor must be fully authenticated.
 *   2. Parse + validate body shape.
 *   3. verifyActorPin — bcrypt compare against users.pin_hash.
 *   4. Audit the outcome (success or failure).
 *   5. On failure return 401 pin_invalid; on success return 200 { confirmed: true }.
 *
 * NO LOCKOUT on repeated failures. The actor is already authenticated;
 * locking them out of a confirmation step doesn't meaningfully raise the bar
 * (an attacker who owns the session already owns the actor's context).
 * Audit every failure for forensic visibility — Phase 5+ admin tooling can
 * flag clusters of pin_confirm failures from a single session.
 */

import { type NextRequest } from "next/server";

import { jsonError, jsonOk, parseJsonBody, extractIp } from "@/lib/api-helpers";
import { verifyActorPin } from "@/lib/auth-flows";
import { audit } from "@/lib/audit";
import { requireSession } from "@/lib/session";

export async function POST(req: NextRequest) {
  // 1. Require authenticated session
  const ctx = await requireSession(req, "/api/auth/pin-confirm");
  if (ctx instanceof Response) return ctx;

  // 2. Parse + validate body
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const pin = (parsed as { pin?: unknown }).pin;
  if (typeof pin !== "string") {
    return jsonError(400, "invalid_payload", { message: "pin required", field: "pin" });
  }

  // 3. Verify PIN (no lockout — actor is already authenticated)
  const ok = await verifyActorPin(ctx.user.id, pin);

  // 4. Audit the outcome
  void audit({
    actorId: ctx.user.id,
    actorRole: ctx.role,
    action: ok ? "auth_pin_confirm_success" : "auth_pin_confirm_failure",
    resourceTable: "users",
    resourceId: ctx.user.id,
    metadata: { outcome: ok ? "confirmed" : "wrong_pin" },
    ipAddress: extractIp(req),
    userAgent: req.headers.get("user-agent"),
  });

  // 5. Respond
  if (!ok) return jsonError(401, "pin_invalid", { message: "Incorrect PIN." });
  return jsonOk({ confirmed: true });
}
