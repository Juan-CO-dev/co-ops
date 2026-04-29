/**
 * Session lifecycle — Phase 2.
 *
 * SERVER-ONLY. Uses the service-role Supabase client for all writes (sessions
 * and audit_log have RLS that denies direct user access; service-role bypasses).
 *
 * Architecture (locked Phase 2 Session 1, refined Session 2):
 *
 *   Cookie       co_ops_session = <signed JWT>
 *   JWT claims   { user_id, app_role, role_level, locations, session_id, role: 'authenticated', iat, exp }
 *   Sessions row { id, user_id, token_hash, auth_method, last_activity_at, expires_at, revoked_at, … }
 *
 * Dual verification on every authenticated request:
 *   1. JWT signature + exp via lib/auth.ts verifyJwt
 *   2. sessions.token_hash === hashToken(rawCookieJwt) for the row id = claim.session_id
 *
 * Mismatch on (2) is treated as revoked AND audited as `session_token_mismatch`
 * — it indicates a forged JWT in an AUTH_JWT_SECRET-leak scenario.
 *
 * Idle timeout: 10 minutes (configurable via SESSION_IDLE_MINUTES).
 * Hard expiration ceiling: 12 hours (matches JWT exp).
 *
 * Append-only philosophy: sessions are NEVER deleted by production code.
 * Lifecycle is via revoked_at and expires_at.
 */

import { NextResponse, type NextRequest } from "next/server";

import { signJwt, verifyJwt, hashToken, type AppJwtClaims } from "./auth";
import { getServiceRoleClient } from "./supabase-server";
import { type RoleCode, getRoleLevel } from "./roles";
import { audit } from "./audit";
import type { Session, User } from "./types";

const COOKIE_NAME = "co_ops_session";
const SESSION_DURATION_HOURS = 12;
const DEFAULT_IDLE_MINUTES = 10;

export type AuthMethod = "pin" | "password";

export interface AuthContext {
  user: User;
  session: Session;
  role: RoleCode;
  level: number;
  locations: string[];
}

function idleMinutes(): number {
  const raw = process.env.SESSION_IDLE_MINUTES;
  const n = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_IDLE_MINUTES;
}

function cookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: maxAgeSeconds,
  };
}

function clearedCookieOptions() {
  return cookieOptions(0);
}

function unauthorized(): NextResponse {
  const res = NextResponse.json({ error: "unauthorized" }, { status: 401 });
  res.cookies.set(COOKIE_NAME, "", clearedCookieOptions());
  return res;
}

// ─── snake_case ↔ camelCase mappers (until a shared transformer exists) ─────

interface UserRow {
  id: string;
  name: string;
  email: string | null;
  email_verified: boolean;
  email_verified_at: string | null;
  phone: string | null;
  role: RoleCode;
  active: boolean;
  sms_consent: boolean;
  sms_consent_at: string | null;
  created_at: string;
  created_by: string | null;
  last_login_at: string | null;
  failed_login_count: number;
  locked_until: string | null;
}

interface SessionRow {
  id: string;
  user_id: string;
  token_hash: string;
  auth_method: AuthMethod;
  step_up_unlocked: boolean | null;
  step_up_unlocked_at: string | null;
  created_at: string | null;
  last_activity_at: string | null;
  expires_at: string;
  revoked_at: string | null;
  ip_address: string | null;
  user_agent: string | null;
}

function mapUser(r: UserRow): User {
  return {
    id: r.id,
    name: r.name,
    email: r.email,
    emailVerified: r.email_verified,
    emailVerifiedAt: r.email_verified_at,
    phone: r.phone,
    role: r.role,
    active: r.active,
    smsConsent: r.sms_consent,
    smsConsentAt: r.sms_consent_at,
    createdAt: r.created_at,
    createdBy: r.created_by,
    lastLoginAt: r.last_login_at,
    failedLoginCount: r.failed_login_count,
    lockedUntil: r.locked_until,
  };
}

function mapSession(r: SessionRow): Session {
  return {
    id: r.id,
    userId: r.user_id,
    tokenHash: r.token_hash,
    authMethod: r.auth_method,
    stepUpUnlocked: r.step_up_unlocked ?? false,
    stepUpUnlockedAt: r.step_up_unlocked_at,
    createdAt: r.created_at ?? new Date(0).toISOString(),
    lastActivityAt: r.last_activity_at ?? new Date(0).toISOString(),
    expiresAt: r.expires_at,
    revokedAt: r.revoked_at,
    ipAddress: r.ip_address,
    userAgent: r.user_agent,
  };
}

// ─── createSession ───────────────────────────────────────────────────────────

export interface CreateSessionResult {
  sessionId: string;
  jwt: string;
  /** Apply via res.cookies.set(...spreadCookie(jwt)) in the route handler. */
  cookieName: string;
  cookieMaxAgeSeconds: number;
}

export async function createSession(
  userId: string,
  authMethod: AuthMethod,
  context?: { ipAddress?: string | null; userAgent?: string | null },
): Promise<CreateSessionResult> {
  const sb = getServiceRoleClient();

  const { data: userRow, error: userErr } = await sb
    .from("users")
    .select("id, role, active")
    .eq("id", userId)
    .single<{ id: string; role: RoleCode; active: boolean }>();
  if (userErr || !userRow) throw new Error(`createSession: user not found: ${userId}`);
  if (!userRow.active) throw new Error(`createSession: user inactive: ${userId}`);

  const { data: locRows, error: locErr } = await sb
    .from("user_locations")
    .select("location_id")
    .eq("user_id", userId);
  if (locErr) throw new Error(`createSession: failed to load user_locations: ${locErr.message}`);
  const locations = (locRows ?? []).map((r) => r.location_id as string);

  const role = userRow.role;
  const level = getRoleLevel(role);

  // Pre-allocate session id so we can embed it in the JWT before the row exists.
  const sessionId = crypto.randomUUID();

  const claims: AppJwtClaims = {
    user_id: userId,
    app_role: role,
    role_level: level,
    locations,
    session_id: sessionId,
    role: "authenticated",
  };
  const jwt = await signJwt(claims);
  const tokenHash = await hashToken(jwt);

  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_DURATION_HOURS * 3600 * 1000);

  const { error: insertErr } = await sb.from("sessions").insert({
    id: sessionId,
    user_id: userId,
    token_hash: tokenHash,
    auth_method: authMethod,
    step_up_unlocked: false,
    last_activity_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
    ip_address: context?.ipAddress ?? null,
    user_agent: context?.userAgent ?? null,
  });
  if (insertErr) throw new Error(`createSession: insert failed: ${insertErr.message}`);

  return {
    sessionId,
    jwt,
    cookieName: COOKIE_NAME,
    cookieMaxAgeSeconds: SESSION_DURATION_HOURS * 3600,
  };
}

// ─── requireSession ──────────────────────────────────────────────────────────

/**
 * Validate the session cookie and return the auth context for the route handler.
 *
 * @param req           Incoming request (cookies + headers).
 * @param currentPath   Path being served. Used to drive step-up clearing —
 *                      when navigating outside /admin/*, an unlocked step-up
 *                      flag is cleared automatically so the next admin entry
 *                      requires re-confirmation.
 *
 * Returns AuthContext on success. On any failure (missing cookie, bad
 * signature, expired exp, missing/revoked/expired session row, idle timeout,
 * token_hash mismatch, deactivated user) returns a 401 NextResponse with a
 * cleared cookie. Callers should `return result` directly when they get a
 * NextResponse — and treat the AuthContext as the request-scoped identity.
 */
export async function requireSession(
  req: NextRequest,
  currentPath: string,
): Promise<AuthContext | NextResponse> {
  const rawJwt = req.cookies.get(COOKIE_NAME)?.value;
  if (!rawJwt) return unauthorized();

  let claims;
  try {
    claims = await verifyJwt(rawJwt);
  } catch {
    return unauthorized();
  }

  const sb = getServiceRoleClient();
  const { data: rowRaw, error } = await sb
    .from("sessions")
    .select("*")
    .eq("id", claims.session_id)
    .maybeSingle<SessionRow>();
  if (error || !rowRaw) return unauthorized();
  const row = rowRaw;

  // Token-hash dual verification — guards against AUTH_JWT_SECRET-leak forgery.
  const expectedHash = await hashToken(rawJwt);
  if (expectedHash !== row.token_hash) {
    await audit({
      actorId: claims.user_id,
      actorRole: null, // claim is suspect; do not trust the role assertion
      action: "session_token_mismatch",
      resourceTable: "sessions",
      resourceId: row.id,
      metadata: { reason: "JWT signature valid but token_hash did not match sessions row" },
      ipAddress: extractIp(req),
      userAgent: req.headers.get("user-agent"),
    });
    return unauthorized();
  }

  if (row.revoked_at) return unauthorized();
  const now = new Date();
  if (new Date(row.expires_at) <= now) return unauthorized();

  const idleThresholdMs = idleMinutes() * 60 * 1000;
  const lastActivity = row.last_activity_at ? new Date(row.last_activity_at) : new Date(0);
  if (now.getTime() - lastActivity.getTime() > idleThresholdMs) return unauthorized();

  // Touch last_activity_at — non-blocking semantics: if the touch fails, keep
  // the request flowing rather than 401-ing on a transient write error.
  const touchedAt = now.toISOString();
  await sb.from("sessions").update({ last_activity_at: touchedAt }).eq("id", row.id);

  const { data: userRowRaw, error: userErr } = await sb
    .from("users")
    .select("*")
    .eq("id", claims.user_id)
    .maybeSingle<UserRow>();
  if (userErr || !userRowRaw) return unauthorized();
  if (!userRowRaw.active) return unauthorized();
  const userRow = userRowRaw;

  // Step-up auto-clearing: when the actor leaves the /admin/* surface, the
  // unlocked step-up flag clears so the next admin entry requires fresh
  // password re-confirmation. proxy.ts cannot do this (no DB in edge runtime),
  // so it lives here on the Node-runtime side.
  let stepUpCleared = false;
  if (row.step_up_unlocked && !currentPath.startsWith("/admin/")) {
    await clearStepUp(row.id);
    stepUpCleared = true;
  }

  return {
    user: mapUser(userRow),
    session: mapSession({
      ...row,
      last_activity_at: touchedAt,
      step_up_unlocked: stepUpCleared ? false : row.step_up_unlocked,
      step_up_unlocked_at: stepUpCleared ? null : row.step_up_unlocked_at,
    }),
    role: userRow.role,
    level: getRoleLevel(userRow.role),
    locations: claims.locations,
  };
}

function extractIp(req: NextRequest): string | null {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]?.trim() ?? null;
  return req.headers.get("x-real-ip");
}

// ─── revokeSession / unlockStepUp / clearStepUp / pruneExpiredSessions ──────

export async function revokeSession(sessionId: string): Promise<void> {
  const sb = getServiceRoleClient();
  const { error } = await sb
    .from("sessions")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", sessionId);
  if (error) throw new Error(`revokeSession failed: ${error.message}`);
}

export async function unlockStepUp(sessionId: string): Promise<void> {
  const sb = getServiceRoleClient();
  const now = new Date().toISOString();
  const { error } = await sb
    .from("sessions")
    .update({ step_up_unlocked: true, step_up_unlocked_at: now })
    .eq("id", sessionId);
  if (error) throw new Error(`unlockStepUp failed: ${error.message}`);
}

export async function clearStepUp(sessionId: string): Promise<void> {
  const sb = getServiceRoleClient();
  const { error } = await sb
    .from("sessions")
    .update({ step_up_unlocked: false, step_up_unlocked_at: null })
    .eq("id", sessionId);
  if (error) throw new Error(`clearStepUp failed: ${error.message}`);
}

/** Housekeeping for future cron use — not invoked anywhere in v1. */
export async function pruneExpiredSessions(): Promise<{ revoked: number }> {
  const sb = getServiceRoleClient();
  const { data, error } = await sb
    .from("sessions")
    .update({ revoked_at: new Date().toISOString() })
    .lt("expires_at", new Date().toISOString())
    .is("revoked_at", null)
    .select("id");
  if (error) throw new Error(`pruneExpiredSessions failed: ${error.message}`);
  return { revoked: data?.length ?? 0 };
}

export const SESSION_COOKIE_NAME = COOKIE_NAME;
