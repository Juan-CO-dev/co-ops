/**
 * POST /api/auth/step-up — re-authenticate with password to unlock destructive
 * admin actions for the current session.
 *
 * Body: { password: string }
 *
 * Flow (locked Phase 2 Session 3):
 *   1. Validate body shape.
 *   2. requireSession (this route is NOT public — proxy enforces JWT, route
 *      enforces full session validation). On failure, 401 unauthorized.
 *   3. If user.role.hasEmailAuth = false (level <5) OR password_hash IS NULL,
 *      respond 403 step_up_not_available. (PIN-only roles can't step up; they
 *      have no password to verify against.)
 *   4. verifyPassword. Wrong → audit auth_step_up_failure, return 401.
 *   5. Success → unlockStepUp(sessionId), audit auth_step_up_success, 200.
 *
 * NO LOCKOUT on repeated step-up failures. The actor is already authenticated;
 * locking them out of admin would just lock them out of admin access without
 * meaningfully raising the bar (an attacker who knows the PIN already owns the
 * session). Audit every failure for forensic visibility — Phase 5+ admin
 * tooling can flag clusters of step-up failures from a single session.
 */

import { type NextRequest } from "next/server";

import { verifyPassword } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { requireSession, unlockStepUp } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { jsonError, jsonOk, parseJsonBody, extractIp } from "@/lib/api-helpers";
import { ROLES, type RoleCode } from "@/lib/roles";

interface StepUpBody {
  password: string;
}

function isStepUpBody(raw: unknown): raw is StepUpBody {
  if (typeof raw !== "object" || raw === null) return false;
  const r = raw as Record<string, unknown>;
  return typeof r.password === "string";
}

export async function POST(req: NextRequest) {
  // 1. Parse + validate
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  if (!isStepUpBody(parsed)) {
    return jsonError(400, "invalid_payload", { message: "Body must include password" });
  }
  const { password } = parsed;
  if (password.length === 0) {
    return jsonError(400, "invalid_payload", {
      field: "password",
      message: "password must not be empty",
    });
  }

  // 2. requireSession
  const ctx = await requireSession(req, "/api/auth/step-up");
  if (ctx instanceof Response) return ctx;
  const { user, session } = ctx;
  const ipAddress = extractIp(req);
  const userAgent = req.headers.get("user-agent");

  // 3. Role gating + password_hash presence (single observable failure mode)
  if (!ROLES[user.role].hasEmailAuth) {
    await audit({
      actorId: user.id,
      actorRole: user.role,
      action: "auth_step_up_failure",
      resourceTable: "sessions",
      resourceId: session.id,
      metadata: { reason: "role_not_email_auth" },
      ipAddress,
      userAgent,
    });
    return jsonError(403, "step_up_not_available", {
      message: "Step-up not available for your role.",
    });
  }

  // password_hash absence on a level-5+ user means they haven't completed
  // verify-and-set-password yet. Same observable error as role gating.
  const sb = getServiceRoleClient();
  const { data: pwRow } = await sb
    .from("users")
    .select("password_hash")
    .eq("id", user.id)
    .maybeSingle<{ password_hash: string | null }>();
  if (!pwRow?.password_hash) {
    await audit({
      actorId: user.id,
      actorRole: user.role as RoleCode,
      action: "auth_step_up_failure",
      resourceTable: "sessions",
      resourceId: session.id,
      metadata: { reason: "missing_password_hash" },
      ipAddress,
      userAgent,
    });
    return jsonError(403, "step_up_not_available", {
      message: "Step-up not available for your role.",
    });
  }

  // 4. Verify password
  const ok = await verifyPassword(password, pwRow.password_hash);
  if (!ok) {
    await audit({
      actorId: user.id,
      actorRole: user.role,
      action: "auth_step_up_failure",
      resourceTable: "sessions",
      resourceId: session.id,
      metadata: { reason: "wrong_password" },
      ipAddress,
      userAgent,
    });
    return jsonError(401, "invalid_credentials");
  }

  // 5. Success
  await unlockStepUp(session.id);
  await audit({
    actorId: user.id,
    actorRole: user.role,
    action: "auth_step_up_success",
    resourceTable: "sessions",
    resourceId: session.id,
    metadata: {},
    ipAddress,
    userAgent,
  });

  return jsonOk({ ok: true });
}
