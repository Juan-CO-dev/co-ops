import { assertSameOrigin } from "@/lib/portal/csrf";
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
 *     "role_not_email_auth"   user.role.hasEmailAuth=false (level <6)
 *     "email_not_verified"    user exists but email_verified=false (must verify first)
 *     "email_sent"            token inserted, Resend accepted send
 *     "email_failed"          token inserted, Resend rejected (network/quota/etc.)
 *     "insert_failed"         the link could not be issued (rare; DB transient) — nothing is mailed
 *     "email_changed" / "credential_changed"  (and the four above, with `rechecked: "under_lock"`): the account
 *                             stopped being the one this request read before the link was issued — see below
 *
 * THE LINK IS ISSUED IN ONE LOCKED STEP (audit W07, review round 1 — completes B052 / B157).
 *   This route used to read the account and then insert its token in a separate request. An admin's email change
 *   that committed in between had already retired the person's reset links — before this one existed — and the
 *   route went on to mail a usable link to the OLD address; the same gap let a link land behind a reset's or an
 *   admin password set's "retire every open link". Migration 0307's `auth_password_reset_issue` now does the
 *   insert: under the per-person lock and the users row lock every retirer holds, it re-checks on the LOCKED row
 *   the email this request looked up, the password hash it read and the account's eligibility. Refused = nothing
 *   inserted, nothing mailed, the same constant 200. Any other failure of that call fails CLOSED the same way (the
 *   route never falls back to its own insert while the function exists). Only while 0307 is NOT applied
 *   (PGRST202 / 42883) does the pre-0307 insert below still run, so the route works before the apply.
 *
 * Rate limiting is intentionally absent at this phase. Per the Phase 2 Session 3
 * scope decision, constant-shape responses prevent enumeration; per-IP rate
 * limiting is deferred to Phase 5+ when Vercel KV or similar infrastructure
 * is added. Acceptable risk for a small-team / single-tenant deployment.
 */

import { type NextRequest } from "next/server";

import { generateToken, hashToken } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { sendEmail, teamFrom } from "@/lib/email";
import { renderPasswordResetEmail } from "@/lib/email-templates/password-reset";
import { ROLES, type RoleCode } from "@/lib/roles";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { jsonOk, parseJsonBody, extractIp } from "@/lib/api-helpers";
import { checkAndRecord } from "@/lib/portal/rate-limit";
import {
  PASSWORD_RESET_EXPIRES_HOURS,
  isMissingRpc,
  passwordResetIssueCall,
  passwordResetIssueRefusal,
} from "@/lib/auth-lockout-shared";

interface ResetReqBody {
  email: string;
}

const RESET_EXPIRES_HOURS = PASSWORD_RESET_EXPIRES_HOURS;

function isResetReqBody(raw: unknown): raw is ResetReqBody {
  if (typeof raw !== "object" || raw === null) return false;
  const r = raw as Record<string, unknown>;
  return typeof r.email === "string";
}

function constantOk() {
  return jsonOk({ ok: true });
}

export async function POST(req: NextRequest) {
  const origin = assertSameOrigin(req);
  if (origin) return origin;
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

  // A-M5: throttle reset requests per email (3 / 15 min) to stop mail-bombing a known address + the
  // unbounded password_resets row-growth. Constant-shape preserved — a throttled request returns the
  // same 200 { ok }, audited as outcome 'throttled'. (No per-SOURCE cap on sign-in: a whole location
  // shares one IP, so that would false-lock legit staff; the per-account lockout is the brake there.)
  if (!(await checkAndRecord(`pwreset_email:${normalizedEmail}`, 15 * 60, 3))) {
    await audit({
      actorId: null,
      actorRole: null,
      action: "auth_password_reset_requested",
      resourceTable: "password_resets",
      resourceId: null,
      metadata: { outcome: "throttled", requested_email: normalizedEmail },
      ipAddress,
      userAgent,
    });
    return constantOk();
  }

  // Look up user
  const sb = getServiceRoleClient();
  const { data: user } = await sb
    .from("users")
    .select("id, role, active, email_verified, password_hash")
    .eq("email", normalizedEmail)
    .maybeSingle<{
      id: string;
      role: RoleCode;
      active: boolean;
      email_verified: boolean;
      /** Read ONLY to hand back to the issuer (the password generation this request saw). Never logged or audited. */
      password_hash: string | null;
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

  // Generate + issue + send
  const rawToken = generateToken();
  const tokenHash = await hashToken(rawToken);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + RESET_EXPIRES_HOURS * 3600 * 1000);

  // The link is issued by ONE locked transaction that re-checks, on the locked row, what was read above.
  const call = passwordResetIssueCall({
    userId: user.id,
    email: normalizedEmail,
    seenPasswordHash: user.password_hash ?? null,
    tokenHash,
    expiresAt: expiresAt.toISOString(),
  });
  const { data: issuedData, error: issueErr } = await sb.rpc(call.fn, call.args);

  let inserted: { id: string } | null = null;
  /** The address the link is for: the LOCKED row's (equal to the requested one, by the issuer's own check). */
  let mailTo = normalizedEmail;

  if (issueErr && isMissingRpc(issueErr)) {
    // Migration 0307 is not applied yet: the pre-0307 insert, unchanged (the issuance race stays open until the apply).
    console.warn("[auth/password-reset-request] auth_password_reset_issue is not installed (migration 0307 not applied): using the pre-0307 insert");
    const { data: legacyRow, error: insertErr } = await sb
      .from("password_resets")
      .insert({
        user_id: user.id,
        token_hash: tokenHash,
        expires_at: expiresAt.toISOString(),
      })
      .select("id")
      .maybeSingle<{ id: string }>();
    if (insertErr || !legacyRow) {
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
    inserted = legacyRow;
  } else if (issueErr) {
    // A named refusal: the account changed between the read above and the lock (an email change, a password
    // reset, a demotion, a deactivation). Anything else: the call failed. Either way NOTHING was inserted, so
    // nothing is mailed — and there is no fallback insert behind a function that exists.
    const refusal = passwordResetIssueRefusal(issueErr.message);
    await audit({
      actorId: user.id,
      actorRole: user.role,
      action: "auth_password_reset_requested",
      resourceTable: "password_resets",
      resourceId: null,
      metadata: refusal
        ? { outcome: refusal, requested_email: normalizedEmail, rechecked: "under_lock" }
        : { outcome: "insert_failed", requested_email: normalizedEmail, error: issueErr.code ?? "unknown" },
      ipAddress,
      userAgent,
    });
    return constantOk();
  } else {
    const issued = (issuedData ?? {}) as { id?: unknown; email?: unknown };
    if (typeof issued.id !== "string" || typeof issued.email !== "string" || issued.email === "") {
      await audit({
        actorId: user.id,
        actorRole: user.role,
        action: "auth_password_reset_requested",
        resourceTable: "password_resets",
        resourceId: null,
        metadata: { outcome: "insert_failed", requested_email: normalizedEmail, error: "no row returned" },
        ipAddress,
        userAgent,
      });
      return constantOk();
    }
    inserted = { id: issued.id };
    mailTo = issued.email;
  }

  const { html, text } = renderPasswordResetEmail({
    rawToken,
    expiresInHours: RESET_EXPIRES_HOURS,
  });
  const result = await sendEmail({
    to: mailTo,
    subject: "Reset your password — CO-OPS",
    html,
    text,
    // Staff-facing send: team@ sender when EMAIL_FROM_TEAM is set (sender-split 2026-09-01).
    from: teamFrom(),
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
