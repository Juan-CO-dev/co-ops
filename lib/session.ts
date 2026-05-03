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
import { cookies as nextCookies, headers as nextHeaders } from "next/headers";
import { redirect } from "next/navigation";

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
  language: "en" | "es";
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
    language: r.language,
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

// ─── requireSession (route handler + server component) ──────────────────────

/**
 * Core session validation — pure function over (rawJwt, ipAddress, userAgent,
 * currentPath). Used by both the NextRequest-shaped route-handler wrapper
 * (`requireSession`) and the next/headers-shaped server-component wrapper
 * (`requireSessionFromHeaders`) so dual-verification, idle-timeout, last-
 * activity touch, and step-up auto-clear logic all live in exactly one place.
 *
 * Returns AuthContext on success or { denied: true } on any failure. Wrappers
 * convert the sentinel into the appropriate response shape (NextResponse 401
 * vs server-side redirect).
 */
async function requireSessionCore(
  rawJwt: string | null,
  ipAddress: string | null,
  userAgent: string | null,
  currentPath: string,
): Promise<AuthContext | { denied: true }> {
  if (!rawJwt) return { denied: true };

  let claims;
  try {
    claims = await verifyJwt(rawJwt);
  } catch {
    return { denied: true };
  }

  const sb = getServiceRoleClient();
  const { data: rowRaw, error } = await sb
    .from("sessions")
    .select("*")
    .eq("id", claims.session_id)
    .maybeSingle<SessionRow>();
  if (error || !rowRaw) return { denied: true };
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
      ipAddress,
      userAgent,
    });
    return { denied: true };
  }

  if (row.revoked_at) return { denied: true };
  const now = new Date();
  if (new Date(row.expires_at) <= now) return { denied: true };

  const idleThresholdMs = idleMinutes() * 60 * 1000;
  const lastActivity = row.last_activity_at ? new Date(row.last_activity_at) : new Date(0);
  if (now.getTime() - lastActivity.getTime() > idleThresholdMs) return { denied: true };

  // Touch last_activity_at — non-blocking semantics: if the touch fails, keep
  // the request flowing rather than 401-ing on a transient write error.
  const touchedAt = now.toISOString();
  await sb.from("sessions").update({ last_activity_at: touchedAt }).eq("id", row.id);

  const { data: userRowRaw, error: userErr } = await sb
    .from("users")
    .select("*")
    .eq("id", claims.user_id)
    .maybeSingle<UserRow>();
  if (userErr || !userRowRaw) return { denied: true };
  if (!userRowRaw.active) return { denied: true };
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

/**
 * Validate the session cookie and return the auth context for a ROUTE HANDLER.
 *
 * @param req           Incoming request (cookies + headers).
 * @param currentPath   Path being served. Used to drive step-up clearing —
 *                      when navigating outside /admin/*, an unlocked step-up
 *                      flag is cleared automatically so the next admin entry
 *                      requires re-confirmation.
 *
 * Returns AuthContext on success. On any failure returns a 401 NextResponse
 * with a cleared cookie. Callers should `return result` directly when they
 * get a NextResponse — and treat the AuthContext as the request-scoped identity.
 */
export async function requireSession(
  req: NextRequest,
  currentPath: string,
): Promise<AuthContext | NextResponse> {
  const rawJwt = req.cookies.get(COOKIE_NAME)?.value ?? null;
  const result = await requireSessionCore(
    rawJwt,
    extractIp(req),
    req.headers.get("user-agent"),
    currentPath,
  );
  if ("denied" in result) return unauthorized();
  return result;
}

/**
 * Validate the session cookie and return the auth context for a SERVER COMPONENT.
 *
 * Unlike the route-handler `requireSession`, denial here triggers a redirect
 * to `/?next=<currentPath>` — Server Components can't return a NextResponse,
 * and the user-facing experience for an authenticated-page denial is "send
 * me to login." Reads cookies + headers via next/headers (Server-Component-only).
 *
 * Imports `redirect` statically so TS sees its `never` return type and narrows
 * the result type below the failure branch. session.ts is Node-runtime only
 * (proxy.ts is the edge layer; it imports verifyJwt from lib/auth, NOT from
 * here), so the next/navigation import is safe.
 */
export async function requireSessionFromHeaders(
  currentPath: string,
): Promise<AuthContext> {
  const cookieStore = await nextCookies();
  const headerStore = await nextHeaders();
  const rawJwt = cookieStore.get(COOKIE_NAME)?.value ?? null;

  const xff = headerStore.get("x-forwarded-for");
  const ipAddress = xff ? (xff.split(",")[0]?.trim() ?? null) : headerStore.get("x-real-ip");
  const userAgent = headerStore.get("user-agent");

  const result = await requireSessionCore(rawJwt, ipAddress, userAgent, currentPath);
  if ("denied" in result) {
    const target = currentPath ? `/?next=${encodeURIComponent(currentPath)}` : "/";
    redirect(target); // throws — `never` return type narrows the type below
  }
  return result;
}

function extractIp(req: NextRequest): string | null {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]?.trim() ?? null;
  return req.headers.get("x-real-ip");
}

// ─── revokeSession / unlockStepUp / clearStepUp / pruneExpiredSessions ──────

/**
 * Idempotent session revocation.
 *
 * Sets revoked_at = now() for the session, but ONLY if it isn't already
 * revoked (`.is("revoked_at", null)` filter). Returns the number of rows
 * actually flipped:
 *   1 → newly revoked this call
 *   0 → already revoked, or session id doesn't exist (caller decides
 *       whether to treat as anomaly; logout treats it as idempotent success)
 *
 * The 0-rows case is the silent-denial pattern from AGENTS.md (Phase 1 RLS
 * audit) applied at the app layer for an idempotent operation. service-role
 * bypasses RLS; the .is() filter is the actual gate here.
 */
export async function revokeSession(sessionId: string): Promise<{ rowsAffected: number }> {
  const sb = getServiceRoleClient();
  const { data, error } = await sb
    .from("sessions")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", sessionId)
    .is("revoked_at", null)
    .select("id");
  if (error) throw new Error(`revokeSession failed: ${error.message}`);
  return { rowsAffected: data?.length ?? 0 };
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

// ─── cookie helpers (route-handler-facing) ──────────────────────────────────

/**
 * Apply a freshly-minted session cookie to a response. Routes call this after
 * recordSuccessfulAuth (or createSession directly) to attach the JWT cookie
 * with consistent httpOnly/secure/sameSite/path config.
 */
export function applySessionCookie(
  res: NextResponse,
  session: CreateSessionResult,
): NextResponse {
  res.cookies.set(session.cookieName, session.jwt, cookieOptions(session.cookieMaxAgeSeconds));
  return res;
}

/**
 * Clear the session cookie on a response. Used by /api/auth/logout and by
 * any route that detects a stale/invalid session cookie at the edge of the
 * request lifecycle. Mirrors the unauthorized() helper's clearing behavior.
 */
export function clearSessionCookie(res: NextResponse): NextResponse {
  res.cookies.set(COOKIE_NAME, "", clearedCookieOptions());
  return res;
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
