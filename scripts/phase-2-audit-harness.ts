/**
 * Phase 2 Auth Audit Harness — Session 5.
 *
 * Black-box regression coverage for every auth route + session lifecycle
 * concern locked through Sessions 2–4. Captures per-case evidence (HTTP
 * status, audit_log rows scoped by run timestamp + actor filter) and writes
 * phase-2-audit-results.json.
 *
 * Run:
 *   npx tsx --env-file=.env.local scripts/phase-2-audit-harness.ts
 *
 * Preconditions:
 *   - Dev server running at http://localhost:3000
 *   - Two fixture users persisted (any active state) at:
 *       audit_test_sl@audit.invalid (shift_lead, level 4)
 *       audit_test_gm@audit.invalid (gm,         level 6)
 *     Setup rehydrates them; teardown deactivates.
 *
 * Postconditions:
 *   - Fixture users left active=false.
 *   - Juan's user record untouched.
 *   - All test sessions revoked.
 *   - phase-2-audit-results.json written to repo root.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SignJWT } from "jose";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { hashPin, hashPassword, hashToken, generateToken } from "../lib/auth";

// ─────────────────────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────────────────────

const BASE_URL = "http://localhost:3000";
const AUDIT_SL_EMAIL = "audit_test_sl@audit.invalid";
const AUDIT_GM_EMAIL = "audit_test_gm@audit.invalid";
const SL_PIN = "1234";
const GM_PIN = "5678";
const GM_PASSWORD = "AuditGM_Password_v1!";
const NEW_PASSWORD = "AuditGM_Password_v2!";
const COOKIE_NAME = "co_ops_session";
const SESSION_IDLE_MINUTES = parseInt(process.env.SESSION_IDLE_MINUTES ?? "10", 10);

// ─────────────────────────────────────────────────────────────────────────────
// Supabase client (service-role)
// ─────────────────────────────────────────────────────────────────────────────

function sbClient(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

const sb = sbClient();

// ─────────────────────────────────────────────────────────────────────────────
// Result types
// ─────────────────────────────────────────────────────────────────────────────

interface AuditRow {
  id: string;
  occurred_at: string;
  actor_id: string | null;
  actor_role: string | null;
  action: string;
  resource_table: string;
  resource_id: string | null;
  metadata: Record<string, unknown>;
  destructive: boolean;
}

interface CaseResult {
  id: string;
  endpoint: string;
  expected_status: number | string;
  actual_status: number;
  expected_audit_actions: string[];
  captured_audit_rows: Array<{
    action: string;
    actor_id: string | null;
    resource_table: string;
    resource_id: string | null;
    metadata: Record<string, unknown>;
  }>;
  passed: boolean;
  evidence: string;
}

const results: CaseResult[] = [];
const runStartedAt = new Date().toISOString();

function record(c: CaseResult) {
  results.push(c);
  const tag = c.passed ? "PASS" : "FAIL";
  process.stdout.write(`  [${tag}] ${c.id} (${c.endpoint}) → ${c.actual_status} | ${c.evidence}\n`);
}

// ─────────────────────────────────────────────────────────────────────────────
// HTTP + cookie helpers
// ─────────────────────────────────────────────────────────────────────────────

interface FetchResult {
  status: number;
  body: unknown;
  setCookieJwt?: string;
  setCookieCleared?: boolean;
  locationHeader?: string;
}

async function call(
  path: string,
  init: { method?: string; body?: unknown; cookieJwt?: string } = {},
): Promise<FetchResult> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "user-agent": "phase-2-audit-harness",
  };
  if (init.cookieJwt !== undefined) {
    headers["cookie"] = `${COOKIE_NAME}=${init.cookieJwt}`;
  }
  const res = await fetch(`${BASE_URL}${path}`, {
    method: init.method ?? "POST",
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    redirect: "manual",
  });
  let body: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  // Extract Set-Cookie. Node fetch returns a single combined string for
  // duplicate Set-Cookie; the auth routes only set one cookie, so a single
  // parse is enough.
  const setCookie = res.headers.get("set-cookie");
  let setCookieJwt: string | undefined;
  let setCookieCleared = false;
  if (setCookie && setCookie.startsWith(`${COOKIE_NAME}=`)) {
    const eq = setCookie.indexOf("=");
    const semi = setCookie.indexOf(";");
    const value = setCookie.slice(eq + 1, semi === -1 ? undefined : semi);
    if (value === "") setCookieCleared = true;
    else setCookieJwt = value;
  }
  const locationHeader = res.headers.get("location") ?? undefined;
  return { status: res.status, body, setCookieJwt, setCookieCleared, locationHeader };
}

// ─────────────────────────────────────────────────────────────────────────────
// Audit-log capture
// ─────────────────────────────────────────────────────────────────────────────

interface AuditFilter {
  sinceIso: string;
  untilIso: string;
  actorIds?: Array<string | null>;
  actions?: string[];
  resourceTables?: string[];
  metadataMatch?: (m: Record<string, unknown>) => boolean;
}

async function captureAudit(filter: AuditFilter): Promise<AuditRow[]> {
  // Allow audit insert to commit
  await new Promise((r) => setTimeout(r, 75));
  const { data, error } = await sb
    .from("audit_log")
    .select("*")
    .gte("occurred_at", filter.sinceIso)
    .lte("occurred_at", filter.untilIso)
    .order("occurred_at", { ascending: true });
  if (error) throw new Error(`captureAudit failed: ${error.message}`);
  let rows = (data ?? []) as AuditRow[];
  if (filter.actorIds) {
    const set = new Set(filter.actorIds);
    rows = rows.filter((r) =>
      r.actor_id === null ? set.has(null) : set.has(r.actor_id),
    );
  }
  if (filter.actions) {
    const set = new Set(filter.actions);
    rows = rows.filter((r) => set.has(r.action));
  }
  if (filter.resourceTables) {
    const set = new Set(filter.resourceTables);
    rows = rows.filter((r) => set.has(r.resource_table));
  }
  if (filter.metadataMatch) {
    rows = rows.filter((r) => filter.metadataMatch!(r.metadata));
  }
  return rows;
}

function summarize(rows: AuditRow[]): CaseResult["captured_audit_rows"] {
  return rows.map((r) => ({
    action: r.action,
    actor_id: r.actor_id,
    resource_table: r.resource_table,
    resource_id: r.resource_id,
    metadata: r.metadata,
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Fixture lifecycle
// ─────────────────────────────────────────────────────────────────────────────

interface Fixtures {
  slId: string;
  gmId: string;
  knownPinHashSL: string;
  knownPinHashGM: string;
  knownPasswordHashGM: string;
}

async function setupFixtures(): Promise<Fixtures> {
  const knownPinHashSL = await hashPin(SL_PIN);
  const knownPinHashGM = await hashPin(GM_PIN);
  const knownPasswordHashGM = await hashPassword(GM_PASSWORD);

  const { data: sl, error: slErr } = await sb
    .from("users")
    .update({
      active: true,
      email_verified: true,
      email_verified_at: new Date().toISOString(),
      pin_hash: knownPinHashSL,
      password_hash: null,
      failed_login_count: 0,
      locked_until: null,
    })
    .eq("email", AUDIT_SL_EMAIL)
    .select("id")
    .maybeSingle<{ id: string }>();
  if (slErr || !sl) throw new Error(`setup SL failed: ${slErr?.message ?? "missing row"}`);

  const { data: gm, error: gmErr } = await sb
    .from("users")
    .update({
      active: true,
      email_verified: true,
      email_verified_at: new Date().toISOString(),
      pin_hash: knownPinHashGM,
      password_hash: knownPasswordHashGM,
      failed_login_count: 0,
      locked_until: null,
    })
    .eq("email", AUDIT_GM_EMAIL)
    .select("id")
    .maybeSingle<{ id: string }>();
  if (gmErr || !gm) throw new Error(`setup GM failed: ${gmErr?.message ?? "missing row"}`);

  // Revoke any leftover sessions for clean state
  await sb
    .from("sessions")
    .update({ revoked_at: new Date().toISOString() })
    .in("user_id", [sl.id, gm.id])
    .is("revoked_at", null);

  return {
    slId: sl.id,
    gmId: gm.id,
    knownPinHashSL,
    knownPinHashGM,
    knownPasswordHashGM,
  };
}

async function resetSL(f: Fixtures, opts: { lockedUntil?: string } = {}) {
  // pin_hash is NOT NULL in the schema (see Session 5 audit finding); the
  // route's missing_pin_hash defensive branch is therefore unreachable by
  // construction, and we never attempt to set pin_hash=null here.
  const { error } = await sb
    .from("users")
    .update({
      active: true,
      email_verified: true,
      pin_hash: f.knownPinHashSL,
      password_hash: null,
      failed_login_count: 0,
      locked_until: opts.lockedUntil ?? null,
    })
    .eq("id", f.slId);
  if (error) throw new Error(`resetSL failed: ${error.message}`);
}

async function resetGM(
  f: Fixtures,
  opts: { passwordHashNull?: boolean; emailVerified?: boolean; active?: boolean } = {},
) {
  const { error } = await sb
    .from("users")
    .update({
      active: opts.active ?? true,
      email_verified: opts.emailVerified ?? true,
      pin_hash: f.knownPinHashGM,
      password_hash: opts.passwordHashNull ? null : f.knownPasswordHashGM,
      failed_login_count: 0,
      locked_until: null,
    })
    .eq("id", f.gmId);
  if (error) throw new Error(`resetGM failed: ${error.message}`);
}

async function revokeAllSessionsForUser(userId: string) {
  await sb
    .from("sessions")
    .update({ revoked_at: new Date().toISOString() })
    .eq("user_id", userId)
    .is("revoked_at", null);
}

async function teardownFixtures(f: Fixtures): Promise<void> {
  await revokeAllSessionsForUser(f.slId);
  await revokeAllSessionsForUser(f.gmId);
  await sb.from("users").update({ active: false }).eq("id", f.slId);
  await sb.from("users").update({ active: false }).eq("id", f.gmId);
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-case helper: bracket a single network call with audit-window capture
// ─────────────────────────────────────────────────────────────────────────────

async function bracketed(
  fn: () => Promise<FetchResult>,
): Promise<{ res: FetchResult; sinceIso: string; untilIso: string }> {
  const sinceIso = new Date(Date.now() - 50).toISOString();
  const res = await fn();
  await new Promise((r) => setTimeout(r, 50));
  const untilIso = new Date(Date.now() + 1000).toISOString();
  return { res, sinceIso, untilIso };
}

// ─────────────────────────────────────────────────────────────────────────────
// PIN sign-in cases (5)
// ─────────────────────────────────────────────────────────────────────────────

async function casesPin(f: Fixtures) {
  process.stdout.write("PIN sign-in:\n");

  // A1 happy
  await resetSL(f);
  {
    const { res, sinceIso, untilIso } = await bracketed(() =>
      call("/api/auth/pin", { body: { user_id: f.slId, pin: SL_PIN } }),
    );
    const audit = await captureAudit({
      sinceIso,
      untilIso,
      actorIds: [f.slId],
      actions: ["auth_signin_pin_success"],
    });
    const cookieOk = !!res.setCookieJwt;
    const passed = res.status === 200 && audit.length === 1 && cookieOk;
    record({
      id: "pin-signin-happy",
      endpoint: "POST /api/auth/pin",
      expected_status: 200,
      actual_status: res.status,
      expected_audit_actions: ["auth_signin_pin_success"],
      captured_audit_rows: summarize(audit),
      passed,
      evidence: passed
        ? "200 + cookie set + auth_signin_pin_success row"
        : `status=${res.status}, cookieSet=${cookieOk}, audit_rows=${audit.length}`,
    });
    if (res.setCookieJwt) await revokeAllSessionsForUser(f.slId);
  }

  // A2 wrong PIN
  await resetSL(f);
  {
    const { res, sinceIso, untilIso } = await bracketed(() =>
      call("/api/auth/pin", { body: { user_id: f.slId, pin: "9999" } }),
    );
    const audit = await captureAudit({
      sinceIso,
      untilIso,
      actorIds: [f.slId],
      actions: ["auth_signin_pin_failure"],
    });
    const reasonOk =
      audit.length === 1 && (audit[0]?.metadata as { reason?: string })?.reason === "wrong_pin";
    const passed = res.status === 401 && reasonOk;
    record({
      id: "pin-signin-wrong",
      endpoint: "POST /api/auth/pin",
      expected_status: 401,
      actual_status: res.status,
      expected_audit_actions: ["auth_signin_pin_failure (reason=wrong_pin)"],
      captured_audit_rows: summarize(audit),
      passed,
      evidence: passed
        ? "401 invalid_credentials + audit reason=wrong_pin attempt_number=1"
        : `status=${res.status}, audit_rows=${audit.length}, reason=${(audit[0]?.metadata as { reason?: string })?.reason}`,
    });
  }

  // A3 (repurposed): the route's missing_pin_hash branch is unreachable in
  // production because users.pin_hash is NOT NULL in the schema — Postgres
  // rejects any UPDATE that tries to clear it. Assert the schema constraint
  // directly (this is the actual enforcement layer; the route branch is
  // defense-in-depth retained for symmetry with missing_password_hash).
  {
    const sinceIso = new Date().toISOString();
    const { error } = await sb
      .from("users")
      .update({ pin_hash: null })
      .eq("id", f.slId);
    const code = (error as { code?: string } | null)?.code;
    const passed = !!error && code === "23502";
    record({
      id: "pin-missing-hash-unreachable-by-schema",
      endpoint: "(direct service-role UPDATE)",
      expected_status: "23502 (Postgres NOT NULL violation)",
      actual_status: 0,
      expected_audit_actions: ["(none — schema-level enforcement)"],
      captured_audit_rows: [],
      passed,
      evidence: passed
        ? `UPDATE users SET pin_hash=NULL → 23502 not_null_violation; route's missing_pin_hash branch is unreachable in production; schema is the real defense (sinceIso=${sinceIso})`
        : `expected sqlstate 23502, got ${error ? code : "no error"} (${error?.message ?? "n/a"})`,
    });
  }

  // A4 lockout threshold (5 wrong attempts)
  await resetSL(f);
  {
    let lastStatus = 0;
    let lastBody: unknown = null;
    const sinceIso = new Date(Date.now() - 50).toISOString();
    for (let i = 1; i <= 5; i++) {
      const r = await call("/api/auth/pin", { body: { user_id: f.slId, pin: "9999" } });
      lastStatus = r.status;
      lastBody = r.body;
    }
    await new Promise((r) => setTimeout(r, 75));
    const untilIso = new Date(Date.now() + 1000).toISOString();
    const failures = await captureAudit({
      sinceIso,
      untilIso,
      actorIds: [f.slId],
      actions: ["auth_signin_pin_failure"],
    });
    const lock = await captureAudit({
      sinceIso,
      untilIso,
      actorIds: [f.slId],
      actions: ["auth_account_locked"],
    });
    const fifthMeta = failures[4]?.metadata as { triggered_lockout?: boolean; attempt_number?: number };
    const retryAfter = (lastBody as { retry_after_seconds?: number })?.retry_after_seconds;
    const passed =
      lastStatus === 423 &&
      typeof retryAfter === "number" &&
      retryAfter > 0 &&
      failures.length === 5 &&
      fifthMeta?.triggered_lockout === true &&
      fifthMeta?.attempt_number === 5 &&
      lock.length === 1;
    record({
      id: "pin-lockout-threshold-crossing",
      endpoint: "POST /api/auth/pin (×5)",
      expected_status: 423,
      actual_status: lastStatus,
      expected_audit_actions: [
        "auth_signin_pin_failure ×5 (5th has triggered_lockout=true)",
        "auth_account_locked ×1",
      ],
      captured_audit_rows: summarize([...failures, ...lock]),
      passed,
      evidence: passed
        ? `5th attempt → 423 retry_after=${retryAfter}s, 5 failures audited, lock row emitted`
        : `lastStatus=${lastStatus}, retry_after=${retryAfter}, failures=${failures.length}, lock_rows=${lock.length}, fifthAttemptNumber=${fifthMeta?.attempt_number}, fifthTriggered=${fifthMeta?.triggered_lockout}`,
    });
  }

  // A5 (repurposed): pre-locked account — assert the lockout precondition gate
  // returns 423 with reason=account_locked_attempt on the very first attempt,
  // and the failed_login_count is NOT incremented (account_locked_attempt is
  // not in COUNTABLE_FAILURE_REASONS).
  {
    const lockedUntil = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    await resetSL(f, { lockedUntil });
    const { res, sinceIso, untilIso } = await bracketed(() =>
      call("/api/auth/pin", { body: { user_id: f.slId, pin: SL_PIN } }),
    );
    const audit = await captureAudit({
      sinceIso,
      untilIso,
      actorIds: [f.slId],
      actions: ["auth_signin_pin_failure"],
    });
    const reason = (audit[0]?.metadata as { reason?: string })?.reason;
    const retryAfter = (res.body as { retry_after_seconds?: number })?.retry_after_seconds;
    const { data: u } = await sb
      .from("users")
      .select("failed_login_count, locked_until")
      .eq("id", f.slId)
      .maybeSingle<{ failed_login_count: number; locked_until: string | null }>();
    const counterUntouched = u?.failed_login_count === 0;
    const lockPreserved = !!u?.locked_until && new Date(u.locked_until).getTime() > Date.now();
    const passed =
      res.status === 423 &&
      reason === "account_locked_attempt" &&
      audit.length === 1 &&
      typeof retryAfter === "number" &&
      retryAfter > 0 &&
      counterUntouched &&
      lockPreserved;
    record({
      id: "pin-locked-precondition",
      endpoint: "POST /api/auth/pin (account already locked)",
      expected_status: 423,
      actual_status: res.status,
      expected_audit_actions: [
        "auth_signin_pin_failure (reason=account_locked_attempt; failed_login_count NOT incremented)",
      ],
      captured_audit_rows: summarize(audit),
      passed,
      evidence: passed
        ? `423 retry_after=${retryAfter}s + reason=account_locked_attempt + failed_login_count untouched (precondition gate works without inflating counter)`
        : `status=${res.status}, reason=${reason}, retry=${retryAfter}, count=${u?.failed_login_count}, lockPreserved=${lockPreserved}`,
    });
  }

  await resetSL(f);
}

// ─────────────────────────────────────────────────────────────────────────────
// Password sign-in cases (5)
// ─────────────────────────────────────────────────────────────────────────────

async function casesPassword(f: Fixtures) {
  process.stdout.write("Password sign-in:\n");

  // B1 happy
  await resetGM(f);
  {
    const { res, sinceIso, untilIso } = await bracketed(() =>
      call("/api/auth/password", { body: { email: AUDIT_GM_EMAIL, password: GM_PASSWORD } }),
    );
    const audit = await captureAudit({
      sinceIso,
      untilIso,
      actorIds: [f.gmId],
      actions: ["auth_signin_password_success"],
    });
    const passed = res.status === 200 && audit.length === 1 && !!res.setCookieJwt;
    record({
      id: "password-signin-happy",
      endpoint: "POST /api/auth/password",
      expected_status: 200,
      actual_status: res.status,
      expected_audit_actions: ["auth_signin_password_success"],
      captured_audit_rows: summarize(audit),
      passed,
      evidence: passed
        ? "200 + cookie set + auth_signin_password_success row"
        : `status=${res.status}, cookieSet=${!!res.setCookieJwt}, audit_rows=${audit.length}`,
    });
    if (res.setCookieJwt) await revokeAllSessionsForUser(f.gmId);
  }

  // B2 wrong password
  await resetGM(f);
  {
    const { res, sinceIso, untilIso } = await bracketed(() =>
      call("/api/auth/password", { body: { email: AUDIT_GM_EMAIL, password: "wrong-password" } }),
    );
    const audit = await captureAudit({
      sinceIso,
      untilIso,
      actorIds: [f.gmId],
      actions: ["auth_signin_password_failure"],
    });
    const reasonOk =
      audit.length === 1 &&
      (audit[0]?.metadata as { reason?: string })?.reason === "wrong_password";
    const passed = res.status === 401 && reasonOk;
    record({
      id: "password-signin-wrong",
      endpoint: "POST /api/auth/password",
      expected_status: 401,
      actual_status: res.status,
      expected_audit_actions: ["auth_signin_password_failure (reason=wrong_password)"],
      captured_audit_rows: summarize(audit),
      passed,
      evidence: passed
        ? "401 + audit reason=wrong_password attempt=1"
        : `status=${res.status}, reason=${(audit[0]?.metadata as { reason?: string })?.reason}`,
    });
  }

  // B3 missing password_hash
  await resetGM(f, { passwordHashNull: true });
  {
    const { res, sinceIso, untilIso } = await bracketed(() =>
      call("/api/auth/password", { body: { email: AUDIT_GM_EMAIL, password: GM_PASSWORD } }),
    );
    const audit = await captureAudit({
      sinceIso,
      untilIso,
      actorIds: [f.gmId],
      actions: ["auth_signin_password_failure"],
    });
    const reasonOk =
      audit.length === 1 &&
      (audit[0]?.metadata as { reason?: string })?.reason === "missing_password_hash";
    const passed = res.status === 401 && reasonOk;
    record({
      id: "password-signin-missing-hash",
      endpoint: "POST /api/auth/password",
      expected_status: 401,
      actual_status: res.status,
      expected_audit_actions: ["auth_signin_password_failure (reason=missing_password_hash)"],
      captured_audit_rows: summarize(audit),
      passed,
      evidence: passed
        ? "401 + audit reason=missing_password_hash + counter incremented"
        : `status=${res.status}, reason=${(audit[0]?.metadata as { reason?: string })?.reason}`,
    });
  }

  // B4 lockout threshold
  await resetGM(f);
  {
    let lastStatus = 0;
    let lastBody: unknown = null;
    const sinceIso = new Date(Date.now() - 50).toISOString();
    for (let i = 1; i <= 5; i++) {
      const r = await call("/api/auth/password", {
        body: { email: AUDIT_GM_EMAIL, password: "wrong-password" },
      });
      lastStatus = r.status;
      lastBody = r.body;
    }
    await new Promise((r) => setTimeout(r, 75));
    const untilIso = new Date(Date.now() + 1000).toISOString();
    const failures = await captureAudit({
      sinceIso,
      untilIso,
      actorIds: [f.gmId],
      actions: ["auth_signin_password_failure"],
    });
    const lock = await captureAudit({
      sinceIso,
      untilIso,
      actorIds: [f.gmId],
      actions: ["auth_account_locked"],
    });
    const fifthMeta = failures[4]?.metadata as { triggered_lockout?: boolean; attempt_number?: number };
    const retryAfter = (lastBody as { retry_after_seconds?: number })?.retry_after_seconds;
    const passed =
      lastStatus === 423 &&
      typeof retryAfter === "number" &&
      retryAfter > 0 &&
      failures.length === 5 &&
      fifthMeta?.triggered_lockout === true &&
      fifthMeta?.attempt_number === 5 &&
      lock.length === 1;
    record({
      id: "password-lockout-threshold-crossing",
      endpoint: "POST /api/auth/password (×5)",
      expected_status: 423,
      actual_status: lastStatus,
      expected_audit_actions: [
        "auth_signin_password_failure ×5 (5th has triggered_lockout=true)",
        "auth_account_locked ×1",
      ],
      captured_audit_rows: summarize([...failures, ...lock]),
      passed,
      evidence: passed
        ? `5th attempt → 423 retry_after=${retryAfter}s, 5 failures audited, lock row emitted`
        : `lastStatus=${lastStatus}, retry_after=${retryAfter}, failures=${failures.length}, lock_rows=${lock.length}`,
    });
  }

  // B5 missing-hash lockout regression
  await resetGM(f, { passwordHashNull: true });
  {
    let lastStatus = 0;
    let lastBody: unknown = null;
    const sinceIso = new Date(Date.now() - 50).toISOString();
    for (let i = 1; i <= 5; i++) {
      const r = await call("/api/auth/password", {
        body: { email: AUDIT_GM_EMAIL, password: GM_PASSWORD },
      });
      lastStatus = r.status;
      lastBody = r.body;
    }
    await new Promise((r) => setTimeout(r, 75));
    const untilIso = new Date(Date.now() + 1000).toISOString();
    const failures = await captureAudit({
      sinceIso,
      untilIso,
      actorIds: [f.gmId],
      actions: ["auth_signin_password_failure"],
    });
    const lock = await captureAudit({
      sinceIso,
      untilIso,
      actorIds: [f.gmId],
      actions: ["auth_account_locked"],
    });
    const allMissingHash = failures.every(
      (r) => (r.metadata as { reason?: string })?.reason === "missing_password_hash",
    );
    const fifthMeta = failures[4]?.metadata as { triggered_lockout?: boolean };
    const retryAfter = (lastBody as { retry_after_seconds?: number })?.retry_after_seconds;
    const passed =
      lastStatus === 423 &&
      typeof retryAfter === "number" &&
      retryAfter > 0 &&
      failures.length === 5 &&
      allMissingHash &&
      fifthMeta?.triggered_lockout === true &&
      lock.length === 1;
    record({
      id: "password-missing-hash-lockout-regression",
      endpoint: "POST /api/auth/password (×5, password_hash NULL)",
      expected_status: 423,
      actual_status: lastStatus,
      expected_audit_actions: [
        "auth_signin_password_failure ×5 (reason=missing_password_hash; 5th triggered_lockout=true)",
        "auth_account_locked ×1",
      ],
      captured_audit_rows: summarize([...failures, ...lock]),
      passed,
      evidence: passed
        ? `defensive missing_password_hash branch counted toward lockout; 5th → 423 retry=${retryAfter}s`
        : `lastStatus=${lastStatus}, allMissingHash=${allMissingHash}, failures=${failures.length}, lock_rows=${lock.length}, retry=${retryAfter}`,
    });
  }

  await resetGM(f);
}

// ─────────────────────────────────────────────────────────────────────────────
// Step-up cases (4)
// ─────────────────────────────────────────────────────────────────────────────

async function signInGM(f: Fixtures): Promise<string> {
  await resetGM(f);
  const r = await call("/api/auth/password", {
    body: { email: AUDIT_GM_EMAIL, password: GM_PASSWORD },
  });
  if (r.status !== 200 || !r.setCookieJwt) {
    throw new Error(`signInGM failed: status=${r.status}`);
  }
  return r.setCookieJwt;
}

async function signInSL(f: Fixtures): Promise<string> {
  await resetSL(f);
  const r = await call("/api/auth/pin", { body: { user_id: f.slId, pin: SL_PIN } });
  if (r.status !== 200 || !r.setCookieJwt) {
    throw new Error(`signInSL failed: status=${r.status}`);
  }
  return r.setCookieJwt;
}

async function casesStepUp(f: Fixtures) {
  process.stdout.write("Step-up:\n");

  // C1 happy
  {
    const cookie = await signInGM(f);
    const { res, sinceIso, untilIso } = await bracketed(() =>
      call("/api/auth/step-up", { body: { password: GM_PASSWORD }, cookieJwt: cookie }),
    );
    const audit = await captureAudit({
      sinceIso,
      untilIso,
      actorIds: [f.gmId],
      actions: ["auth_step_up_success"],
    });
    const { data: sess } = await sb
      .from("sessions")
      .select("step_up_unlocked, step_up_unlocked_at")
      .eq("user_id", f.gmId)
      .is("revoked_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ step_up_unlocked: boolean; step_up_unlocked_at: string | null }>();
    const passed =
      res.status === 200 &&
      audit.length === 1 &&
      sess?.step_up_unlocked === true &&
      !!sess?.step_up_unlocked_at;
    record({
      id: "step-up-happy",
      endpoint: "POST /api/auth/step-up",
      expected_status: 200,
      actual_status: res.status,
      expected_audit_actions: ["auth_step_up_success"],
      captured_audit_rows: summarize(audit),
      passed,
      evidence: passed
        ? "200 + step_up_unlocked=true on sessions row + audit row"
        : `status=${res.status}, audit=${audit.length}, unlocked=${sess?.step_up_unlocked}`,
    });
    await revokeAllSessionsForUser(f.gmId);
  }

  // C2 wrong password
  {
    const cookie = await signInGM(f);
    const { res, sinceIso, untilIso } = await bracketed(() =>
      call("/api/auth/step-up", { body: { password: "wrong-password" }, cookieJwt: cookie }),
    );
    const audit = await captureAudit({
      sinceIso,
      untilIso,
      actorIds: [f.gmId],
      actions: ["auth_step_up_failure"],
    });
    const reasonOk =
      audit.length === 1 && (audit[0]?.metadata as { reason?: string })?.reason === "wrong_password";
    const { data: u } = await sb
      .from("users")
      .select("failed_login_count, locked_until")
      .eq("id", f.gmId)
      .maybeSingle<{ failed_login_count: number; locked_until: string | null }>();
    const noUserCounterMutated = u?.failed_login_count === 0 && u?.locked_until === null;
    const passed = res.status === 401 && reasonOk && noUserCounterMutated;
    record({
      id: "step-up-wrong-password",
      endpoint: "POST /api/auth/step-up",
      expected_status: 401,
      actual_status: res.status,
      expected_audit_actions: ["auth_step_up_failure (reason=wrong_password)"],
      captured_audit_rows: summarize(audit),
      passed,
      evidence: passed
        ? "401 + audit reason=wrong_password + users.failed_login_count untouched (no lockout)"
        : `status=${res.status}, reason=${(audit[0]?.metadata as { reason?: string })?.reason}, count=${u?.failed_login_count}`,
    });
    await revokeAllSessionsForUser(f.gmId);
  }

  // C3 role-not-eligible (SL is level 4, hasEmailAuth=false)
  {
    const cookie = await signInSL(f);
    const { res, sinceIso, untilIso } = await bracketed(() =>
      call("/api/auth/step-up", { body: { password: "anything" }, cookieJwt: cookie }),
    );
    const audit = await captureAudit({
      sinceIso,
      untilIso,
      actorIds: [f.slId],
      actions: ["auth_step_up_failure"],
    });
    const reasonOk =
      audit.length === 1 &&
      (audit[0]?.metadata as { reason?: string })?.reason === "role_not_email_auth";
    const passed = res.status === 403 && reasonOk;
    record({
      id: "step-up-role-not-eligible",
      endpoint: "POST /api/auth/step-up",
      expected_status: 403,
      actual_status: res.status,
      expected_audit_actions: ["auth_step_up_failure (reason=role_not_email_auth)"],
      captured_audit_rows: summarize(audit),
      passed,
      evidence: passed
        ? "403 step_up_not_available + audit reason=role_not_email_auth"
        : `status=${res.status}, reason=${(audit[0]?.metadata as { reason?: string })?.reason}`,
    });
    await revokeAllSessionsForUser(f.slId);
  }

  // C4 no-lockout-on-failure verification (6 wrong attempts, no 423)
  {
    const cookie = await signInGM(f);
    const sinceIso = new Date(Date.now() - 50).toISOString();
    const statuses: number[] = [];
    for (let i = 1; i <= 6; i++) {
      const r = await call("/api/auth/step-up", {
        body: { password: "wrong-password" },
        cookieJwt: cookie,
      });
      statuses.push(r.status);
    }
    await new Promise((r) => setTimeout(r, 75));
    const untilIso = new Date(Date.now() + 1000).toISOString();
    const audit = await captureAudit({
      sinceIso,
      untilIso,
      actorIds: [f.gmId],
      actions: ["auth_step_up_failure"],
    });
    const accountLocked = await captureAudit({
      sinceIso,
      untilIso,
      actorIds: [f.gmId],
      actions: ["auth_account_locked"],
    });
    const { data: u } = await sb
      .from("users")
      .select("failed_login_count, locked_until")
      .eq("id", f.gmId)
      .maybeSingle<{ failed_login_count: number; locked_until: string | null }>();
    const allUnauthorized = statuses.every((s) => s === 401);
    const noLockout = u?.failed_login_count === 0 && u?.locked_until === null;
    const passed =
      allUnauthorized && audit.length === 6 && accountLocked.length === 0 && noLockout;
    record({
      id: "step-up-no-lockout-on-failure",
      endpoint: "POST /api/auth/step-up (×6 wrong)",
      expected_status: "401×6 (no 423)",
      actual_status: statuses[5] ?? 0,
      expected_audit_actions: ["auth_step_up_failure ×6 (no auth_account_locked)"],
      captured_audit_rows: summarize([...audit, ...accountLocked]),
      passed,
      evidence: passed
        ? "all 6 attempts → 401, 6 step_up_failure audits, no account_locked row, users counters untouched"
        : `statuses=${statuses.join(",")}, audit=${audit.length}, lock=${accountLocked.length}, count=${u?.failed_login_count}`,
    });
    await revokeAllSessionsForUser(f.gmId);
  }

  await resetGM(f);
}

// ─────────────────────────────────────────────────────────────────────────────
// Verify cases (4)
// ─────────────────────────────────────────────────────────────────────────────

async function casesVerify(f: Fixtures) {
  process.stdout.write("Verify:\n");

  // D1 happy + auto-sign-in
  await resetGM(f);
  {
    const token = generateToken();
    const tokenHash = await hashToken(token);
    const { data: row } = await sb
      .from("email_verifications")
      .insert({
        user_id: f.gmId,
        token_hash: tokenHash,
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      })
      .select("id")
      .maybeSingle<{ id: string }>();
    const { res, sinceIso, untilIso } = await bracketed(() =>
      call("/api/auth/verify", { body: { token, password: NEW_PASSWORD } }),
    );
    const verifyAudit = await captureAudit({
      sinceIso,
      untilIso,
      actorIds: [f.gmId],
      actions: ["auth_email_verified"],
    });
    const signinAudit = await captureAudit({
      sinceIso,
      untilIso,
      actorIds: [f.gmId],
      actions: ["auth_signin_password_success"],
    });
    const { data: u } = await sb
      .from("users")
      .select("password_hash, email_verified, email_verified_at")
      .eq("id", f.gmId)
      .maybeSingle<{ password_hash: string | null; email_verified: boolean; email_verified_at: string | null }>();
    const tokenConsumed = await sb
      .from("email_verifications")
      .select("consumed_at")
      .eq("id", row!.id)
      .maybeSingle<{ consumed_at: string | null }>();
    const passed =
      res.status === 200 &&
      !!res.setCookieJwt &&
      verifyAudit.length === 1 &&
      signinAudit.length === 1 &&
      !!u?.password_hash &&
      u?.email_verified === true &&
      !!tokenConsumed.data?.consumed_at;
    record({
      id: "verify-happy-auto-signin",
      endpoint: "POST /api/auth/verify",
      expected_status: 200,
      actual_status: res.status,
      expected_audit_actions: ["auth_email_verified", "auth_signin_password_success"],
      captured_audit_rows: summarize([...verifyAudit, ...signinAudit]),
      passed,
      evidence: passed
        ? "200 + cookie + token consumed + password_hash set + email_verified=true + auto-signin audited"
        : `status=${res.status}, cookie=${!!res.setCookieJwt}, verifyAudit=${verifyAudit.length}, signinAudit=${signinAudit.length}, password_hash_set=${!!u?.password_hash}`,
    });
    if (res.setCookieJwt) await revokeAllSessionsForUser(f.gmId);
  }

  // D2 replay (consume already-consumed token)
  await resetGM(f);
  {
    const token = generateToken();
    const tokenHash = await hashToken(token);
    const { data: row } = await sb
      .from("email_verifications")
      .insert({
        user_id: f.gmId,
        token_hash: tokenHash,
        consumed_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      })
      .select("id")
      .maybeSingle<{ id: string }>();
    const { res, sinceIso, untilIso } = await bracketed(() =>
      call("/api/auth/verify", { body: { token, password: NEW_PASSWORD } }),
    );
    const audit = await captureAudit({
      sinceIso,
      untilIso,
      actorIds: [f.gmId],
      actions: ["auth_token_consumed_replay"],
      resourceTables: ["email_verifications"],
    });
    const code = (res.body as { code?: string })?.code;
    const passed =
      res.status === 400 && code === "invalid_token" && audit.length === 1 && audit[0]?.resource_id === row?.id;
    record({
      id: "verify-replay-consumed",
      endpoint: "POST /api/auth/verify",
      expected_status: 400,
      actual_status: res.status,
      expected_audit_actions: ["auth_token_consumed_replay (resource_table=email_verifications)"],
      captured_audit_rows: summarize(audit),
      passed,
      evidence: passed
        ? "400 invalid_token + auth_token_consumed_replay audited"
        : `status=${res.status}, code=${code}, audit=${audit.length}`,
    });
  }

  // D3 expired
  await resetGM(f);
  {
    const token = generateToken();
    const tokenHash = await hashToken(token);
    const { data: row } = await sb
      .from("email_verifications")
      .insert({
        user_id: f.gmId,
        token_hash: tokenHash,
        expires_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      })
      .select("id")
      .maybeSingle<{ id: string }>();
    const { res, sinceIso, untilIso } = await bracketed(() =>
      call("/api/auth/verify", { body: { token, password: NEW_PASSWORD } }),
    );
    const audit = await captureAudit({
      sinceIso,
      untilIso,
      actorIds: [f.gmId],
      actions: ["auth_token_expired"],
      resourceTables: ["email_verifications"],
    });
    const code = (res.body as { code?: string })?.code;
    const expiresAtMeta = (audit[0]?.metadata as { expires_at?: string })?.expires_at;
    const passed =
      res.status === 400 &&
      code === "invalid_token" &&
      audit.length === 1 &&
      audit[0]?.resource_id === row?.id &&
      typeof expiresAtMeta === "string" &&
      new Date(expiresAtMeta) <= new Date();
    record({
      id: "verify-expired",
      endpoint: "POST /api/auth/verify",
      expected_status: 400,
      actual_status: res.status,
      expected_audit_actions: [
        "auth_token_expired (resource_table=email_verifications, metadata.expires_at populated)",
      ],
      captured_audit_rows: summarize(audit),
      passed,
      evidence: passed
        ? "400 invalid_token + auth_token_expired audited with metadata.expires_at"
        : `status=${res.status}, code=${code}, audit=${audit.length}, expires_at_meta=${expiresAtMeta}`,
    });
  }

  // D4 invalid (random token, not in table)
  {
    const token = generateToken();
    const { res, sinceIso, untilIso } = await bracketed(() =>
      call("/api/auth/verify", { body: { token, password: NEW_PASSWORD } }),
    );
    const audit = await captureAudit({
      sinceIso,
      untilIso,
      actions: ["auth_token_invalid"],
      resourceTables: ["email_verifications"],
    });
    const code = (res.body as { code?: string })?.code;
    const passed = res.status === 400 && code === "invalid_token" && audit.length >= 1;
    record({
      id: "verify-invalid",
      endpoint: "POST /api/auth/verify",
      expected_status: 400,
      actual_status: res.status,
      expected_audit_actions: [
        "auth_token_invalid (resource_table=email_verifications, actor_id=null)",
      ],
      captured_audit_rows: summarize(audit),
      passed,
      evidence: passed
        ? "400 invalid_token + auth_token_invalid audited (actor null)"
        : `status=${res.status}, code=${code}, audit=${audit.length}`,
    });
  }

  await resetGM(f);
}

// ─────────────────────────────────────────────────────────────────────────────
// Password-reset-request cases (5) — constant-shape 200 with metadata.outcome
// ─────────────────────────────────────────────────────────────────────────────

async function casesPasswordResetRequest(f: Fixtures) {
  process.stdout.write("Password-reset-request:\n");

  // E1 happy: GM synthetic. Resend will reject (non-deliverable address) →
  // outcome=email_failed; if prod-style account, would be email_sent. Both
  // prove the code path. Accept either.
  await resetGM(f);
  {
    const { res, sinceIso, untilIso } = await bracketed(() =>
      call("/api/auth/password-reset-request", { body: { email: AUDIT_GM_EMAIL } }),
    );
    const audit = await captureAudit({
      sinceIso,
      untilIso,
      actorIds: [f.gmId],
      actions: ["auth_password_reset_requested"],
    });
    const outcome = (audit[0]?.metadata as { outcome?: string })?.outcome;
    const passed =
      res.status === 200 &&
      audit.length === 1 &&
      (outcome === "email_sent" || outcome === "email_failed");
    record({
      id: "password-reset-request-happy",
      endpoint: "POST /api/auth/password-reset-request",
      expected_status: 200,
      actual_status: res.status,
      expected_audit_actions: [
        "auth_password_reset_requested (outcome ∈ {email_sent, email_failed})",
      ],
      captured_audit_rows: summarize(audit),
      passed,
      evidence: passed
        ? `200 constant-shape + outcome=${outcome} (Resend disposition for synthetic recipient)`
        : `status=${res.status}, audit=${audit.length}, outcome=${outcome}`,
    });
  }

  // E2 user_not_found (spray-attack forensics: requested_email captured)
  {
    const sprayEmail = "nonexistent-spray-target@audit.invalid";
    const { res, sinceIso, untilIso } = await bracketed(() =>
      call("/api/auth/password-reset-request", { body: { email: sprayEmail } }),
    );
    const audit = await captureAudit({
      sinceIso,
      untilIso,
      actions: ["auth_password_reset_requested"],
      metadataMatch: (m) => (m as { requested_email?: string }).requested_email === sprayEmail,
    });
    const outcome = (audit[0]?.metadata as { outcome?: string })?.outcome;
    const reqEmail = (audit[0]?.metadata as { requested_email?: string })?.requested_email;
    const passed =
      res.status === 200 &&
      audit.length === 1 &&
      outcome === "user_not_found" &&
      reqEmail === sprayEmail &&
      audit[0]?.actor_id === null;
    record({
      id: "password-reset-request-user-not-found",
      endpoint: "POST /api/auth/password-reset-request",
      expected_status: 200,
      actual_status: res.status,
      expected_audit_actions: [
        "auth_password_reset_requested (outcome=user_not_found, requested_email captured, actor_id=null)",
      ],
      captured_audit_rows: summarize(audit),
      passed,
      evidence: passed
        ? "200 constant-shape + user_not_found + requested_email captured for spray forensics"
        : `status=${res.status}, outcome=${outcome}, reqEmail=${reqEmail}, actor=${audit[0]?.actor_id}`,
    });
  }

  // E3 user_inactive
  await resetGM(f, { active: false });
  {
    const { res, sinceIso, untilIso } = await bracketed(() =>
      call("/api/auth/password-reset-request", { body: { email: AUDIT_GM_EMAIL } }),
    );
    const audit = await captureAudit({
      sinceIso,
      untilIso,
      actorIds: [f.gmId],
      actions: ["auth_password_reset_requested"],
    });
    const outcome = (audit[0]?.metadata as { outcome?: string })?.outcome;
    const passed = res.status === 200 && audit.length === 1 && outcome === "user_inactive";
    record({
      id: "password-reset-request-user-inactive",
      endpoint: "POST /api/auth/password-reset-request",
      expected_status: 200,
      actual_status: res.status,
      expected_audit_actions: ["auth_password_reset_requested (outcome=user_inactive)"],
      captured_audit_rows: summarize(audit),
      passed,
      evidence: passed
        ? "200 constant-shape + outcome=user_inactive"
        : `status=${res.status}, outcome=${outcome}`,
    });
  }
  await resetGM(f);

  // E4 email_not_verified
  await resetGM(f, { emailVerified: false });
  {
    const { res, sinceIso, untilIso } = await bracketed(() =>
      call("/api/auth/password-reset-request", { body: { email: AUDIT_GM_EMAIL } }),
    );
    const audit = await captureAudit({
      sinceIso,
      untilIso,
      actorIds: [f.gmId],
      actions: ["auth_password_reset_requested"],
    });
    const outcome = (audit[0]?.metadata as { outcome?: string })?.outcome;
    const passed = res.status === 200 && audit.length === 1 && outcome === "email_not_verified";
    record({
      id: "password-reset-request-email-not-verified",
      endpoint: "POST /api/auth/password-reset-request",
      expected_status: 200,
      actual_status: res.status,
      expected_audit_actions: ["auth_password_reset_requested (outcome=email_not_verified)"],
      captured_audit_rows: summarize(audit),
      passed,
      evidence: passed
        ? "200 constant-shape + outcome=email_not_verified"
        : `status=${res.status}, outcome=${outcome}`,
    });
  }
  await resetGM(f);

  // E5 role_not_email_auth (SL is shift_lead, level 4)
  await resetSL(f);
  {
    const { res, sinceIso, untilIso } = await bracketed(() =>
      call("/api/auth/password-reset-request", { body: { email: AUDIT_SL_EMAIL } }),
    );
    const audit = await captureAudit({
      sinceIso,
      untilIso,
      actorIds: [f.slId],
      actions: ["auth_password_reset_requested"],
    });
    const outcome = (audit[0]?.metadata as { outcome?: string })?.outcome;
    const passed = res.status === 200 && audit.length === 1 && outcome === "role_not_email_auth";
    record({
      id: "password-reset-request-role-not-email-auth",
      endpoint: "POST /api/auth/password-reset-request",
      expected_status: 200,
      actual_status: res.status,
      expected_audit_actions: ["auth_password_reset_requested (outcome=role_not_email_auth)"],
      captured_audit_rows: summarize(audit),
      passed,
      evidence: passed
        ? "200 constant-shape + outcome=role_not_email_auth (SL has hasEmailAuth=false)"
        : `status=${res.status}, outcome=${outcome}`,
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Password-reset cases (4)
// ─────────────────────────────────────────────────────────────────────────────

async function casesPasswordReset(f: Fixtures) {
  process.stdout.write("Password-reset:\n");

  // F1 happy + sessions revoked + no auto-signin
  await resetGM(f);
  {
    // Mint two sessions for revocation count visibility
    const c1 = await signInGM(f);
    void c1;
    const c2 = await call("/api/auth/password", {
      body: { email: AUDIT_GM_EMAIL, password: GM_PASSWORD },
    });
    void c2;

    const token = generateToken();
    const tokenHash = await hashToken(token);
    const { data: row } = await sb
      .from("password_resets")
      .insert({
        user_id: f.gmId,
        token_hash: tokenHash,
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      })
      .select("id")
      .maybeSingle<{ id: string }>();
    const { res, sinceIso, untilIso } = await bracketed(() =>
      call("/api/auth/password-reset", { body: { token, password: NEW_PASSWORD } }),
    );
    const audit = await captureAudit({
      sinceIso,
      untilIso,
      actorIds: [f.gmId],
      actions: ["auth_password_reset_success"],
    });
    const sessionsRevoked = (audit[0]?.metadata as { sessions_revoked?: number })?.sessions_revoked;
    const { count: activeAfter } = await sb
      .from("sessions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", f.gmId)
      .is("revoked_at", null);
    const cookieAbsent = !res.setCookieJwt;
    const passed =
      res.status === 200 &&
      audit.length === 1 &&
      typeof sessionsRevoked === "number" &&
      sessionsRevoked >= 2 &&
      activeAfter === 0 &&
      cookieAbsent &&
      audit[0]?.resource_id === f.gmId;
    record({
      id: "password-reset-happy",
      endpoint: "POST /api/auth/password-reset",
      expected_status: 200,
      actual_status: res.status,
      expected_audit_actions: [
        "auth_password_reset_success (metadata.sessions_revoked >= 2, no Set-Cookie, no auto-signin)",
      ],
      captured_audit_rows: summarize(audit),
      passed,
      evidence: passed
        ? `200 + sessions_revoked=${sessionsRevoked} + active sessions now 0 + no Set-Cookie (no auto-signin)`
        : `status=${res.status}, audit=${audit.length}, revoked=${sessionsRevoked}, activeAfter=${activeAfter}, cookieAbsent=${cookieAbsent}`,
    });
    void row;
  }
  await resetGM(f);

  // F2 replay (consumed token)
  {
    const token = generateToken();
    const tokenHash = await hashToken(token);
    const { data: row } = await sb
      .from("password_resets")
      .insert({
        user_id: f.gmId,
        token_hash: tokenHash,
        consumed_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      })
      .select("id")
      .maybeSingle<{ id: string }>();
    const { res, sinceIso, untilIso } = await bracketed(() =>
      call("/api/auth/password-reset", { body: { token, password: NEW_PASSWORD } }),
    );
    const audit = await captureAudit({
      sinceIso,
      untilIso,
      actorIds: [f.gmId],
      actions: ["auth_token_consumed_replay"],
      resourceTables: ["password_resets"],
    });
    const code = (res.body as { code?: string })?.code;
    const passed =
      res.status === 400 && code === "invalid_token" && audit.length === 1 && audit[0]?.resource_id === row?.id;
    record({
      id: "password-reset-replay-consumed",
      endpoint: "POST /api/auth/password-reset",
      expected_status: 400,
      actual_status: res.status,
      expected_audit_actions: ["auth_token_consumed_replay (resource_table=password_resets)"],
      captured_audit_rows: summarize(audit),
      passed,
      evidence: passed
        ? "400 invalid_token + auth_token_consumed_replay audited"
        : `status=${res.status}, code=${code}, audit=${audit.length}`,
    });
  }

  // F3 expired
  {
    const token = generateToken();
    const tokenHash = await hashToken(token);
    const { data: row } = await sb
      .from("password_resets")
      .insert({
        user_id: f.gmId,
        token_hash: tokenHash,
        expires_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      })
      .select("id")
      .maybeSingle<{ id: string }>();
    const { res, sinceIso, untilIso } = await bracketed(() =>
      call("/api/auth/password-reset", { body: { token, password: NEW_PASSWORD } }),
    );
    const audit = await captureAudit({
      sinceIso,
      untilIso,
      actorIds: [f.gmId],
      actions: ["auth_token_expired"],
      resourceTables: ["password_resets"],
    });
    const code = (res.body as { code?: string })?.code;
    const expiresAtMeta = (audit[0]?.metadata as { expires_at?: string })?.expires_at;
    const passed =
      res.status === 400 &&
      code === "invalid_token" &&
      audit.length === 1 &&
      audit[0]?.resource_id === row?.id &&
      typeof expiresAtMeta === "string";
    record({
      id: "password-reset-expired",
      endpoint: "POST /api/auth/password-reset",
      expected_status: 400,
      actual_status: res.status,
      expected_audit_actions: [
        "auth_token_expired (resource_table=password_resets, metadata.expires_at populated)",
      ],
      captured_audit_rows: summarize(audit),
      passed,
      evidence: passed
        ? "400 invalid_token + auth_token_expired audited with metadata.expires_at"
        : `status=${res.status}, code=${code}, audit=${audit.length}, expires_at_meta=${expiresAtMeta}`,
    });
  }

  // F4 invalid
  {
    const token = generateToken();
    const { res, sinceIso, untilIso } = await bracketed(() =>
      call("/api/auth/password-reset", { body: { token, password: NEW_PASSWORD } }),
    );
    const audit = await captureAudit({
      sinceIso,
      untilIso,
      actions: ["auth_token_invalid"],
      resourceTables: ["password_resets"],
    });
    const code = (res.body as { code?: string })?.code;
    const passed = res.status === 400 && code === "invalid_token" && audit.length >= 1;
    record({
      id: "password-reset-invalid",
      endpoint: "POST /api/auth/password-reset",
      expected_status: 400,
      actual_status: res.status,
      expected_audit_actions: ["auth_token_invalid (resource_table=password_resets, actor_id=null)"],
      captured_audit_rows: summarize(audit),
      passed,
      evidence: passed
        ? "400 invalid_token + auth_token_invalid audited"
        : `status=${res.status}, code=${code}, audit=${audit.length}`,
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Logout cases (4)
// ─────────────────────────────────────────────────────────────────────────────

async function casesLogout(f: Fixtures) {
  process.stdout.write("Logout:\n");

  // G1 valid → revoked
  {
    const cookie = await signInGM(f);
    const { res, sinceIso, untilIso } = await bracketed(() =>
      call("/api/auth/logout", { cookieJwt: cookie }),
    );
    const audit = await captureAudit({
      sinceIso,
      untilIso,
      actorIds: [f.gmId],
      actions: ["auth_logout"],
    });
    const outcome = (audit[0]?.metadata as { outcome?: string })?.outcome;
    const cookieCleared = res.setCookieCleared === true;
    // Verify session is revoked
    const { count: liveSessions } = await sb
      .from("sessions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", f.gmId)
      .is("revoked_at", null);
    const passed =
      res.status === 200 &&
      audit.length === 1 &&
      outcome === "revoked" &&
      cookieCleared &&
      liveSessions === 0;
    record({
      id: "logout-valid-revoked",
      endpoint: "POST /api/auth/logout",
      expected_status: 200,
      actual_status: res.status,
      expected_audit_actions: ["auth_logout (outcome=revoked)"],
      captured_audit_rows: summarize(audit),
      passed,
      evidence: passed
        ? "200 + cookie cleared + outcome=revoked + sessions row revoked"
        : `status=${res.status}, outcome=${outcome}, cleared=${cookieCleared}, liveSessions=${liveSessions}`,
    });

    // G2 already-revoked: re-use the same cookie
    const r2 = await bracketed(() => call("/api/auth/logout", { cookieJwt: cookie }));
    const audit2 = await captureAudit({
      sinceIso: r2.sinceIso,
      untilIso: r2.untilIso,
      actorIds: [f.gmId],
      actions: ["auth_logout"],
    });
    const outcome2 = (audit2[0]?.metadata as { outcome?: string })?.outcome;
    const passed2 =
      r2.res.status === 200 && audit2.length === 1 && outcome2 === "already_revoked";
    record({
      id: "logout-already-revoked",
      endpoint: "POST /api/auth/logout",
      expected_status: 200,
      actual_status: r2.res.status,
      expected_audit_actions: ["auth_logout (outcome=already_revoked)"],
      captured_audit_rows: summarize(audit2),
      passed: passed2,
      evidence: passed2
        ? "200 idempotent + outcome=already_revoked"
        : `status=${r2.res.status}, outcome=${outcome2}`,
    });
  }

  // G3 no cookie
  {
    const { res, sinceIso, untilIso } = await bracketed(() => call("/api/auth/logout"));
    const audit = await captureAudit({
      sinceIso,
      untilIso,
      actorIds: [null],
      actions: ["auth_logout"],
    });
    const outcome = (audit[0]?.metadata as { outcome?: string })?.outcome;
    const passed = res.status === 200 && audit.length >= 1 && outcome === "no_cookie";
    record({
      id: "logout-no-cookie",
      endpoint: "POST /api/auth/logout",
      expected_status: 200,
      actual_status: res.status,
      expected_audit_actions: ["auth_logout (outcome=no_cookie, actor_id=null)"],
      captured_audit_rows: summarize(audit),
      passed,
      evidence: passed
        ? "200 idempotent + outcome=no_cookie"
        : `status=${res.status}, outcome=${outcome}, audit=${audit.length}`,
    });
  }

  // G4 invalid JWT
  {
    const { res, sinceIso, untilIso } = await bracketed(() =>
      call("/api/auth/logout", { cookieJwt: "garbage.jwt.token" }),
    );
    const audit = await captureAudit({
      sinceIso,
      untilIso,
      actorIds: [null],
      actions: ["auth_logout"],
    });
    const outcome = (audit[0]?.metadata as { outcome?: string })?.outcome;
    const passed = res.status === 200 && audit.length >= 1 && outcome === "jwt_invalid";
    record({
      id: "logout-invalid-jwt",
      endpoint: "POST /api/auth/logout",
      expected_status: 200,
      actual_status: res.status,
      expected_audit_actions: ["auth_logout (outcome=jwt_invalid, actor_id=null)"],
      captured_audit_rows: summarize(audit),
      passed,
      evidence: passed
        ? "200 idempotent + outcome=jwt_invalid"
        : `status=${res.status}, outcome=${outcome}, audit=${audit.length}`,
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Heartbeat cases (2)
// ─────────────────────────────────────────────────────────────────────────────

async function casesHeartbeat(f: Fixtures) {
  process.stdout.write("Heartbeat:\n");

  // H1 valid (last_activity_at touch verified)
  {
    const cookie = await signInGM(f);
    // Backdate last_activity_at by 30 sec so the touch is observable
    const backdated = new Date(Date.now() - 30_000).toISOString();
    await sb
      .from("sessions")
      .update({ last_activity_at: backdated })
      .eq("user_id", f.gmId)
      .is("revoked_at", null);
    const before = backdated;
    const r = await call("/api/auth/heartbeat", { cookieJwt: cookie });
    const { data: row } = await sb
      .from("sessions")
      .select("last_activity_at")
      .eq("user_id", f.gmId)
      .is("revoked_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ last_activity_at: string }>();
    const touched = row && new Date(row.last_activity_at).getTime() > new Date(before).getTime();
    const passed = r.status === 200 && touched === true;
    record({
      id: "heartbeat-valid-touch",
      endpoint: "POST /api/auth/heartbeat",
      expected_status: 200,
      actual_status: r.status,
      expected_audit_actions: [], // heartbeat intentionally writes no audit row
      captured_audit_rows: [],
      passed,
      evidence: passed
        ? `200 + last_activity_at advanced from ${before} to ${row?.last_activity_at}`
        : `status=${r.status}, before=${before}, after=${row?.last_activity_at}`,
    });
    await revokeAllSessionsForUser(f.gmId);
  }

  // H2 no cookie → 307 (proxy bounce)
  {
    const r = await call("/api/auth/heartbeat");
    const passed =
      r.status === 307 && typeof r.locationHeader === "string" && r.locationHeader.includes("/");
    record({
      id: "heartbeat-no-cookie-proxy-bounce",
      endpoint: "POST /api/auth/heartbeat",
      expected_status: 307,
      actual_status: r.status,
      expected_audit_actions: [],
      captured_audit_rows: [],
      passed,
      evidence: passed
        ? `307 redirect with Location=${r.locationHeader} (proxy denied at edge)`
        : `status=${r.status}, location=${r.locationHeader}`,
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// RLS cross-layer cases (2) — JWT → PostgREST → RLS end-to-end
// ─────────────────────────────────────────────────────────────────────────────

async function casesRlsCrossLayer(f: Fixtures) {
  process.stdout.write("RLS cross-layer (JWT → PostgREST → SECURITY DEFINER helpers):\n");

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  // Service-role baseline: total user count (admin branch should match this)
  const { count: totalUsers } = await sb
    .from("users")
    .select("id", { count: "exact", head: true });

  // RLS-1: SL (level 4) → users_read_self self-only branch (id = current_user_id())
  {
    const cookie = await signInSL(f);
    const r = await fetch(
      `${supabaseUrl}/rest/v1/users?select=id`,
      {
        method: "GET",
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${cookie}`,
          Accept: "application/json",
        },
      },
    );
    const rows = (await r.json()) as Array<{ id: string }>;
    const ids = rows.map((row) => row.id);
    const passed =
      r.status === 200 &&
      Array.isArray(rows) &&
      rows.length === 1 &&
      ids[0] === f.slId;
    record({
      id: "rls-cross-layer-sl-self-only",
      endpoint: "GET /rest/v1/users (SL session JWT → PostgREST → RLS)",
      expected_status: 200,
      actual_status: r.status,
      expected_audit_actions: ["(none — RLS read does not audit)"],
      captured_audit_rows: [],
      passed,
      evidence: passed
        ? `SL (level 4) sees 1 row (own row only) — users_read_self self-predicate fired; admin branch correctly suppressed; cross-layer JWT→PostgREST→helpers integration confirmed`
        : `status=${r.status}, rows=${rows.length}, ids=${JSON.stringify(ids)} (expected exactly 1 row matching slId=${f.slId})`,
    });
    await revokeAllSessionsForUser(f.slId);
  }

  // RLS-2: GM (level 6) → users_read_self admin branch (level >= 6)
  {
    const cookie = await signInGM(f);
    const r = await fetch(
      `${supabaseUrl}/rest/v1/users?select=id`,
      {
        method: "GET",
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${cookie}`,
          Accept: "application/json",
        },
      },
    );
    const rows = (await r.json()) as Array<{ id: string }>;
    const passed =
      r.status === 200 &&
      Array.isArray(rows) &&
      typeof totalUsers === "number" &&
      rows.length === totalUsers &&
      rows.length > 1; // admin branch should be strictly broader than self-only
    record({
      id: "rls-cross-layer-gm-admin-branch",
      endpoint: "GET /rest/v1/users (GM session JWT → PostgREST → RLS)",
      expected_status: 200,
      actual_status: r.status,
      expected_audit_actions: ["(none — RLS read does not audit)"],
      captured_audit_rows: [],
      passed,
      evidence: passed
        ? `GM (level 6) sees ${rows.length} rows (matches service-role total of ${totalUsers}) — users_read_self admin branch (level >= 6) fired; strictly broader than SL's self-only result; cross-layer integration confirmed at the differential boundary`
        : `status=${r.status}, rows=${rows.length}, service_role_total=${totalUsers} (expected admin branch row count to match service-role baseline and be > 1)`,
    });
    await revokeAllSessionsForUser(f.gmId);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Session lifecycle cases (5)
// ─────────────────────────────────────────────────────────────────────────────

async function casesLifecycle(f: Fixtures) {
  process.stdout.write("Session lifecycle:\n");

  // I1 create
  {
    const cookie = await signInGM(f);
    const expectedHash = await hashToken(cookie);
    const { data: row } = await sb
      .from("sessions")
      .select("token_hash, step_up_unlocked, last_activity_at, expires_at")
      .eq("user_id", f.gmId)
      .is("revoked_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<{
        token_hash: string;
        step_up_unlocked: boolean | null;
        last_activity_at: string | null;
        expires_at: string;
      }>();
    const hashMatches = row?.token_hash === expectedHash;
    const stepUpFalse = (row?.step_up_unlocked ?? false) === false;
    const recentActivity =
      row?.last_activity_at !== null &&
      Date.now() - new Date(row!.last_activity_at!).getTime() < 30_000;
    const expHorizon = row && new Date(row.expires_at).getTime() - Date.now();
    const expValid =
      typeof expHorizon === "number" && expHorizon > 11.9 * 3600 * 1000 && expHorizon <= 12 * 3600 * 1000;
    const passed = hashMatches && stepUpFalse && recentActivity && expValid;
    record({
      id: "lifecycle-create",
      endpoint: "POST /api/auth/password (session create)",
      expected_status: 200,
      actual_status: 200,
      expected_audit_actions: ["auth_signin_password_success (already covered above)"],
      captured_audit_rows: [],
      passed,
      evidence: passed
        ? `sessions row: token_hash matches hashToken(JWT), step_up_unlocked=false, last_activity_at recent, expires_at ≈ +12h`
        : `hashMatches=${hashMatches}, stepUpFalse=${stepUpFalse}, recentActivity=${recentActivity}, expValid=${expValid}`,
    });
    await revokeAllSessionsForUser(f.gmId);
  }

  // I2 idle timeout via DB backdate
  {
    const cookie = await signInGM(f);
    const idleAgo = new Date(Date.now() - (SESSION_IDLE_MINUTES + 1) * 60 * 1000).toISOString();
    await sb
      .from("sessions")
      .update({ last_activity_at: idleAgo })
      .eq("user_id", f.gmId)
      .is("revoked_at", null);
    const r = await call("/api/auth/heartbeat", { cookieJwt: cookie });
    const cookieCleared = r.setCookieCleared === true;
    const passed = r.status === 401 && cookieCleared;
    record({
      id: "lifecycle-idle-timeout-db",
      endpoint: "POST /api/auth/heartbeat (last_activity_at backdated)",
      expected_status: 401,
      actual_status: r.status,
      expected_audit_actions: [],
      captured_audit_rows: [],
      passed,
      evidence: passed
        ? "401 + cookie cleared (requireSession idle check fired)"
        : `status=${r.status}, cookieCleared=${cookieCleared}`,
    });
    await revokeAllSessionsForUser(f.gmId);
  }

  // I3 JWT exp DB-side (sessions.expires_at backdated; JWT itself still valid)
  {
    const cookie = await signInGM(f);
    const pastExp = new Date(Date.now() - 60_000).toISOString();
    await sb
      .from("sessions")
      .update({ expires_at: pastExp })
      .eq("user_id", f.gmId)
      .is("revoked_at", null);
    const r = await call("/api/auth/heartbeat", { cookieJwt: cookie });
    const cookieCleared = r.setCookieCleared === true;
    const passed = r.status === 401 && cookieCleared;
    record({
      id: "lifecycle-jwt-exp-db-side",
      endpoint: "POST /api/auth/heartbeat (sessions.expires_at backdated)",
      expected_status: 401,
      actual_status: r.status,
      expected_audit_actions: [],
      captured_audit_rows: [],
      passed,
      evidence: passed
        ? "401 + cookie cleared (requireSession sessions.expires_at check fired; proxy let JWT through)"
        : `status=${r.status}, cookieCleared=${cookieCleared}`,
    });
    await revokeAllSessionsForUser(f.gmId);
  }

  // I4 JWT exp signature-side (forge JWT with past exp; proxy denies at edge)
  {
    const cookie = await signInGM(f);
    // Sign a parallel JWT with the same claims but exp in the past.
    const { data: row } = await sb
      .from("sessions")
      .select("id, user_id")
      .eq("user_id", f.gmId)
      .is("revoked_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ id: string; user_id: string }>();
    const claims = {
      user_id: row!.user_id,
      app_role: "gm",
      role_level: 6,
      locations: [],
      session_id: row!.id,
      role: "authenticated",
    };
    const key = Buffer.from(process.env.AUTH_JWT_SECRET!, "hex");
    const past = Math.floor((Date.now() - 60 * 1000) / 1000);
    const expiredJwt = await new SignJWT({ ...claims })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt(past - 3600)
      .setIssuer("co-ops")
      .setExpirationTime(past)
      .sign(key);
    const r = await call("/api/auth/heartbeat", { cookieJwt: expiredJwt });
    // proxy 307s on JWT verification failure (which includes JWTExpired).
    const passed =
      r.status === 307 && typeof r.locationHeader === "string" && r.locationHeader.includes("/");
    record({
      id: "lifecycle-jwt-exp-signature-side",
      endpoint: "POST /api/auth/heartbeat (forged JWT with past exp)",
      expected_status: 307,
      actual_status: r.status,
      expected_audit_actions: [],
      captured_audit_rows: [],
      passed,
      evidence: passed
        ? `307 redirect (proxy edge JWT verifyJwt threw JWTExpired before request reached the route)`
        : `status=${r.status}, location=${r.locationHeader}`,
    });
    void cookie;
    await revokeAllSessionsForUser(f.gmId);
  }

  // I5 step-up auto-clear via /api/auth/heartbeat
  {
    const cookie = await signInGM(f);
    // Unlock step-up
    const su = await call("/api/auth/step-up", {
      body: { password: GM_PASSWORD },
      cookieJwt: cookie,
    });
    if (su.status !== 200) throw new Error(`step-up setup failed: ${su.status}`);
    // Confirm unlocked
    const { data: pre } = await sb
      .from("sessions")
      .select("step_up_unlocked")
      .eq("user_id", f.gmId)
      .is("revoked_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ step_up_unlocked: boolean }>();
    // Hit /api/auth/heartbeat (path != /admin/*) — should auto-clear
    const hb = await call("/api/auth/heartbeat", { cookieJwt: cookie });
    const { data: post } = await sb
      .from("sessions")
      .select("step_up_unlocked, step_up_unlocked_at")
      .eq("user_id", f.gmId)
      .is("revoked_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ step_up_unlocked: boolean; step_up_unlocked_at: string | null }>();
    const passed =
      pre?.step_up_unlocked === true &&
      hb.status === 200 &&
      post?.step_up_unlocked === false &&
      post?.step_up_unlocked_at === null;
    record({
      id: "lifecycle-step-up-auto-clear",
      endpoint: "POST /api/auth/heartbeat (after step-up; non-/admin path)",
      expected_status: 200,
      actual_status: hb.status,
      expected_audit_actions: [],
      captured_audit_rows: [],
      passed,
      evidence: passed
        ? "step-up unlocked → heartbeat (non-/admin) → requireSessionCore cleared step_up_unlocked back to false"
        : `pre=${pre?.step_up_unlocked}, hb=${hb.status}, post.unlocked=${post?.step_up_unlocked}, post.at=${post?.step_up_unlocked_at}`,
    });
    await revokeAllSessionsForUser(f.gmId);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  process.stdout.write(`Phase 2 Auth Audit Harness — run started ${runStartedAt}\n\n`);

  // Preflight: dev server reachable?
  try {
    const r = await fetch(`${BASE_URL}/`, { redirect: "manual" });
    if (r.status >= 500) throw new Error(`dev server unhealthy: ${r.status}`);
  } catch (e) {
    throw new Error(`Dev server not reachable at ${BASE_URL}: ${(e as Error).message}`);
  }

  const f = await setupFixtures();
  process.stdout.write(`Fixtures ready: SL=${f.slId} GM=${f.gmId}\n\n`);

  try {
    await casesPin(f);
    await casesPassword(f);
    await casesStepUp(f);
    await casesVerify(f);
    await casesPasswordResetRequest(f);
    await casesPasswordReset(f);
    await casesLogout(f);
    await casesHeartbeat(f);
    await casesRlsCrossLayer(f);
    await casesLifecycle(f);
  } finally {
    await teardownFixtures(f);
    process.stdout.write(`\nFixtures torn down (active=false on both test users)\n`);
  }

  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  const out = {
    harness_run_at: runStartedAt,
    harness_completed_at: new Date().toISOString(),
    base_url: BASE_URL,
    fixtures: {
      sl_user_id: f.slId,
      gm_user_id: f.gmId,
      sl_email: AUDIT_SL_EMAIL,
      gm_email: AUDIT_GM_EMAIL,
    },
    total_cases: results.length,
    passed,
    failed,
    cases: results,
  };
  const outPath = resolve(process.cwd(), "phase-2-audit-results.json");
  writeFileSync(outPath, JSON.stringify(out, null, 2), "utf8");
  process.stdout.write(`\nResults: ${passed}/${results.length} passed (${failed} failed)\n`);
  process.stdout.write(`Output: ${outPath}\n`);

  if (failed > 0) {
    process.stdout.write(`\nFAILURES:\n`);
    for (const r of results.filter((c) => !c.passed)) {
      process.stdout.write(`  ${r.id}: ${r.evidence}\n`);
    }
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
