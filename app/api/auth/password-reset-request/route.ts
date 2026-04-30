/**
 * POST /api/auth/password-reset-request — request a password reset email.
 *
 * Body: { email: string }
 *
 * Disclosure policy (locked Phase 2 Session 3):
 *   ALWAYS returns 200 { ok: true } regardless of whether the email matches a
 *   user, the user is active, the role supports email auth, or the email is
 *   verified. Constant-shape response prevents trivial email enumeration.
 *   Internally, every request is audited with metadata.outcome capturing the
 *   real disposition for forensic visibility (spray-attack tracing).
 *
 * Audit shapes (auth_password_reset_requested):
 *   metadata.outcome:
 *     "user_not_found"        no users row matches
 *     "user_inactive"         user exists but active=false
 *     "role_not_email_auth"   user.role.hasEmailAuth=false (level <5)
 *     "email_not_verified"    user exists but email_verified=false (must verify first)
 *     "email_sent"            token inserted, Resend accepted send
 *     "email_failed"          token inserted, Resend rejected (network/quota/etc.)
 *     "insert_failed"         token row insert failed (rare; DB transient)
 *
 * Rate limiting is intentionally absent at this phase. Per the Phase 2 Session 3
 * scope decision, constant-shape responses prevent enumeration; per-IP rate
 * limiting is deferred to Phase 5+ when Vercel KV or similar infrastructure
 * is added. Acceptable risk for a small-team / single-tenant deployment.
 */

import { type NextRequest } from "next/server";

import { generateToken, hashToken } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { sendEmail } from "@/lib/email";
import { renderPasswordResetEmail } from "@/lib/email-templates/password-reset";
import { ROLES, type RoleCode } from "@/lib/roles";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { jsonOk, parseJsonBody, extractIp } from "@/lib/api-helpers";

interface ResetReqBody {
  email: string;
}

const RESET_EXPIRES_HOURS = 1;

function isResetReqBody(raw: unknown): raw is ResetReqBody {
  if (typeof raw !== "object" || raw === null) return false;
  const r = raw as Record<string, unknown>;
  return typeof r.email === "string";
}

function constantOk() {
  return jsonOk({ ok: true });
}

export async function POST(req: NextRequest) {
  // Parse the body but don't leak shape on failure — even malformed input
  // returns the constant 200 to keep the enumeration surface flat.
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return constantOk();
  if (!isResetReqBody(parsed)) return constantOk();
  const { email } = parsed;
  if (!email.includes("@") || email.length < 3) return constantOk();

  const ipAddress = extractIp(req);
  const userAgent = req.headers.get("user-agent");
  const normalizedEmail = email.trim().toLowerCase();

  // Look up user
  const sb = getServiceRoleClient();
  const { data: user } = await sb
    .from("users")
    .select("id, role, active, email_verified")
    .eq("email", normalizedEmail)
    .maybeSingle<{
      id: string;
      role: RoleCode;
      active: boolean;
      email_verified: boolean;
    }>();

  // Negative dispositions: audit + constant 200
  let negativeOutcome:
    | "user_not_found"
    | "user_inactive"
    | "role_not_email_auth"
    | "email_not_verified"
    | null = null;
  if (!user) negativeOutcome = "user_not_found";
  else if (!user.active) negativeOutcome = "user_inactive";
  else if (!ROLES[user.role].hasEmailAuth) negativeOutcome = "role_not_email_auth";
  else if (!user.email_verified) negativeOutcome = "email_not_verified";

  if (negativeOutcome) {
    await audit({
      actorId: user?.id ?? null,
      actorRole: user?.role ?? null,
      action: "auth_password_reset_requested",
      resourceTable: "password_resets",
      resourceId: null,
      metadata: { outcome: negativeOutcome, requested_email: normalizedEmail },
      ipAddress,
      userAgent,
    });
    return constantOk();
  }

  if (!user) return constantOk(); // narrow for TS; unreachable

  // Generate + insert + send
  const rawToken = generateToken();
  const tokenHash = await hashToken(rawToken);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + RESET_EXPIRES_HOURS * 3600 * 1000);

  const { data: inserted, error: insertErr } = await sb
    .from("password_resets")
    .insert({
      user_id: user.id,
      token_hash: tokenHash,
      expires_at: expiresAt.toISOString(),
    })
    .select("id")
    .maybeSingle<{ id: string }>();

  if (insertErr || !inserted) {
    await audit({
      actorId: user.id,
      actorRole: user.role,
      action: "auth_password_reset_requested",
      resourceTable: "password_resets",
      resourceId: null,
      metadata: {
        outcome: "insert_failed",
        requested_email: normalizedEmail,
        error: insertErr?.message ?? "no row returned",
      },
      ipAddress,
      userAgent,
    });
    return constantOk();
  }

  const { html, text } = renderPasswordResetEmail({
    rawToken,
    expiresInHours: RESET_EXPIRES_HOURS,
  });
  const result = await sendEmail({
    to: normalizedEmail,
    subject: "Reset your password — CO-OPS",
    html,
    text,
  });

  await audit({
    actorId: user.id,
    actorRole: user.role,
    action: "auth_password_reset_requested",
    resourceTable: "password_resets",
    resourceId: inserted.id,
    metadata: {
      outcome: "id" in result ? "email_sent" : "email_failed",
      requested_email: normalizedEmail,
      expires_at: expiresAt.toISOString(),
      ...("id" in result
        ? { resend_id: result.id }
        : { send_error: result.error }),
    },
    ipAddress,
    userAgent,
  });

  return constantOk();
}
