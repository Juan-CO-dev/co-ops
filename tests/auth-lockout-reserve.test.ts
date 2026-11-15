/**
 * Audit W07 / B049 + B050 — the sign-in lockout.
 *
 * B050: the routes read `locked_until`, ran bcrypt, and only THEN counted the failure, so a burst of guesses all
 * passed the read before any of them was counted. B049: the counter never restarted, so the first wrong answer
 * after a lockout re-locked the account. Both are closed by `reserveAttempt` (migration 0307's
 * `auth_reserve_attempt`): one step that decides the lock and counts the attempt BEFORE the credential check.
 * The SQL itself is proven in scripts/sql-harness-0307.mjs; this file pins the app side:
 *   - the reservation comes before the credential check in both routes;
 *   - a refused reservation never reaches the credential check;
 *   - a reserved failure is not counted a second time, and the fifth answers 423 from the reservation's own lock;
 *   - while 0307 is not applied the route takes the pre-0307 path (it keeps working, counted the old way).
 */
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST as pinPOST } from "@/app/api/auth/pin/route";
import { verifyPin } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { FAILURE_LIMIT, LOCKOUT_MINUTES, lockRetryAfterSeconds, parseAttemptReservation, isMissingRpc } from "@/lib/auth-lockout-shared";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { makeSupabaseMock, type MockAnswer } from "./helpers/supabase-mock";

vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/auth", () => ({
  verifyPin: vi.fn(), verifyPassword: vi.fn(), hashPassword: vi.fn(), isLegacyPasswordHash: () => false,
}));
vi.mock("@/lib/session", () => ({
  createSession: vi.fn(async () => ({ sessionId: "s1", jwt: "jwt", cookieName: "co_ops_session", cookieMaxAgeSeconds: 60, atomic: true })),
  applySessionCookie: (res: unknown) => res,
  CredentialChangedError: class extends Error {},
}));
vi.mock("@/lib/portal/rate-limit", () => ({ checkAndRecord: vi.fn(async () => true) }));

const USER = "11111111-1111-4111-8111-111111111111";
const pinRequest = (pin = "0000") => new NextRequest("https://example.test/api/auth/pin", {
  method: "POST", headers: { origin: "https://example.test", "content-type": "application/json" },
  body: JSON.stringify({ user_id: USER, pin }),
});

/** The users row the route looks up, and whatever the test wants `auth_reserve_attempt` to answer. */
function wire(reserve: MockAnswer, opts: { lockedUntil?: string | null; incremented?: number } = {}) {
  const sb = makeSupabaseMock({
    rpc: (fn) => {
      if (fn === "auth_reserve_attempt") return reserve;
      if (fn === "increment_failed_login") return { data: opts.incremented ?? 1 };
      return { data: null };
    },
    table: (table, ops, call) => {
      if (table !== "users") return { data: null };
      if (ops.includes("update")) return { data: [{ id: USER }] };
      const cols = String(call.ops.find((o) => o[0] === "select")?.[1][0] ?? "");
      if (cols.includes("pin_hash")) return { data: { id: USER, role: "employee", active: true, pin_hash: "$2a$10$abcdefghijklmnopqrstuv" } };
      if (cols === "locked_until") return { data: { locked_until: opts.lockedUntil ?? null } };
      if (cols === "failed_login_count") return { data: { failed_login_count: 0 } };
      return { data: { role: "employee" } };
    },
  });
  vi.mocked(getServiceRoleClient).mockReturnValue(sb.client as never);
  return sb;
}
const auditRows = () => vi.mocked(audit).mock.calls.map((c) => c[0] as { action: string; metadata: Record<string, unknown> });

beforeEach(() => vi.clearAllMocks());

describe("the reservation comes before the credential check (B050)", () => {
  const pin = readFileSync("app/api/auth/pin/route.ts", "utf8");
  const password = readFileSync("app/api/auth/password/route.ts", "utf8");

  it("PIN sign-in reserves the attempt before verifyPin", () => {
    const reserve = pin.indexOf("await reserveAttempt(user.id)");
    expect(reserve).toBeGreaterThan(-1);
    expect(reserve).toBeLessThan(pin.indexOf("await verifyPin("));
    // and the users lookup, the origin check and the per-source throttle still come first
    expect(pin.indexOf("checkAndRecord(")).toBeLessThan(reserve);
    expect(pin.indexOf('.from("users")')).toBeLessThan(reserve);
  });

  it("password sign-in reserves the attempt before verifyPassword, after the role / inactive / unverified gates", () => {
    const reserve = password.indexOf("await reserveAttempt(user.id)");
    expect(reserve).toBeGreaterThan(-1);
    expect(reserve).toBeLessThan(password.indexOf("await verifyPassword("));
    for (const gate of ['"role_not_email_auth"', '"account_inactive"', '"email_not_verified"']) {
      expect(password.indexOf(gate), gate).toBeGreaterThan(-1);
      expect(password.indexOf(gate), gate).toBeLessThan(reserve);
    }
  });

  it("neither route reads the lock separately before the credential check any more", () => {
    for (const src of [pin, password]) expect(src).not.toMatch(/await isLocked\(/);
  });
});

describe("POST /api/auth/pin with the 0307 reservation", () => {
  it("a burst attempt that loses the reservation never reaches the PIN check", async () => {
    const until = new Date(Date.now() + 600_000).toISOString();
    const sb = wire({ data: { allowed: false, locked_until: until, retry_after_seconds: 600 } });
    const res = await pinPOST(pinRequest());
    expect(res.status).toBe(423);
    expect(await res.json()).toMatchObject({ code: "account_locked", retry_after_seconds: 600 });
    expect(verifyPin).not.toHaveBeenCalled();
    // refused attempts never move the counter (the account_locked_attempt precondition law)
    expect(sb.rpcNames()).toEqual(["auth_reserve_attempt"]);
    expect(sb.wrote("users")).toBe(false);
    expect(auditRows().map((r) => [r.action, r.metadata.reason])).toEqual([["auth_signin_pin_failure", "account_locked_attempt"]]);
  });

  it("a wrong PIN on a reserved attempt is audited with the reserved number and counted exactly once", async () => {
    const sb = wire({ data: { allowed: true, attempt: 3, locked_until: null } });
    vi.mocked(verifyPin).mockResolvedValue(false);
    const res = await pinPOST(pinRequest());
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "invalid_credentials" });
    expect(sb.rpcNames()).toEqual(["auth_reserve_attempt"]); // never increment_failed_login on top
    expect(sb.wrote("users")).toBe(false);
    expect(auditRows()).toEqual([expect.objectContaining({ action: "auth_signin_pin_failure", metadata: { reason: "wrong_pin", attempt_number: 3 } })]);
  });

  it("the fifth reserved wrong PIN answers 423 from the reservation's own lock, with no second write", async () => {
    const until = new Date(Date.now() + LOCKOUT_MINUTES * 60_000).toISOString();
    const sb = wire({ data: { allowed: true, attempt: FAILURE_LIMIT, locked_until: until } });
    vi.mocked(verifyPin).mockResolvedValue(false);
    const res = await pinPOST(pinRequest());
    expect(res.status).toBe(423);
    const body = (await res.json()) as { code: string; retry_after_seconds: number };
    expect(body.code).toBe("account_locked");
    expect(body.retry_after_seconds).toBeGreaterThan((LOCKOUT_MINUTES - 1) * 60);
    expect(body.retry_after_seconds).toBeLessThanOrEqual(LOCKOUT_MINUTES * 60);
    expect(sb.rpcNames()).toEqual(["auth_reserve_attempt"]);
    expect(sb.wrote("users")).toBe(false);
    const rows = auditRows();
    expect(rows.map((r) => r.action)).toEqual(["auth_account_locked", "auth_signin_pin_failure"]);
    expect(rows[0]!.metadata).toMatchObject({ failed_count: FAILURE_LIMIT, locked_until: until, lock_persisted: true, method: "pin" });
    expect(rows[0]!.metadata).not.toHaveProperty("outcome");
    expect(rows[1]!.metadata).toMatchObject({ reason: "wrong_pin", attempt_number: FAILURE_LIMIT, triggered_lockout: true });
  });

  it("before 0307 is applied (function missing) the route still works, counted the pre-0307 way", async () => {
    const sb = wire({ error: { code: "PGRST202", message: "Could not find the function public.auth_reserve_attempt(p_user) in the schema cache" } }, { incremented: 2 });
    vi.mocked(verifyPin).mockResolvedValue(false);
    const res = await pinPOST(pinRequest());
    expect(res.status).toBe(401);
    expect(verifyPin).toHaveBeenCalledOnce();
    expect(sb.rpcNames()).toEqual(["auth_reserve_attempt", "increment_failed_login"]);
    expect(auditRows()).toEqual([expect.objectContaining({ action: "auth_signin_pin_failure", metadata: { reason: "wrong_pin", attempt_number: 2 } })]);
  });

  it("before 0307 a live lock is still refused before the PIN check (the old read)", async () => {
    const sb = wire({ error: { code: "PGRST202", message: "Could not find the function" } }, { lockedUntil: new Date(Date.now() + 300_000).toISOString() });
    const res = await pinPOST(pinRequest());
    expect(res.status).toBe(423);
    expect(verifyPin).not.toHaveBeenCalled();
    expect(sb.rpcNames()).toEqual(["auth_reserve_attempt"]);
  });

  it("a limiter fault (any other error) never fails the sign-in closed and never skips the count", async () => {
    const sb = wire({ error: { code: "57014", message: "canceling statement due to statement timeout" } });
    vi.mocked(verifyPin).mockResolvedValue(false);
    const res = await pinPOST(pinRequest());
    expect(res.status).toBe(401);
    expect(sb.rpcNames()).toEqual(["auth_reserve_attempt", "increment_failed_login"]);
  });
});

describe("the pure half (lib/auth-lockout-shared.ts)", () => {
  const now = Date.parse("2026-11-15T12:00:00Z");

  it("the policy numbers are the written ones", () => {
    expect([FAILURE_LIMIT, LOCKOUT_MINUTES]).toEqual([5, 15]);
  });

  it("reads an allowed reservation, a locking one and a refusal", () => {
    expect(parseAttemptReservation({ allowed: true, attempt: 1, locked_until: null }, now))
      .toEqual({ allowed: true, attempt: 1, lockedUntil: null, retryAfterSeconds: 0, degraded: false });
    expect(parseAttemptReservation({ allowed: true, attempt: 5, locked_until: "2026-11-15T12:15:00Z" }, now))
      .toEqual({ allowed: true, attempt: 5, lockedUntil: "2026-11-15T12:15:00Z", retryAfterSeconds: 900, degraded: false });
    expect(parseAttemptReservation({ allowed: false, locked_until: "2026-11-15T12:10:00Z", retry_after_seconds: 600 }, now))
      .toEqual({ allowed: false, attempt: null, lockedUntil: "2026-11-15T12:10:00Z", retryAfterSeconds: 600, degraded: false });
  });

  it("a refusal always tells the person to wait at least a second", () => {
    expect(parseAttemptReservation({ allowed: false }, now)?.retryAfterSeconds).toBe(1);
    expect(parseAttemptReservation({ allowed: false, locked_until: "2026-11-15T12:00:30Z" }, now)?.retryAfterSeconds).toBe(30);
  });

  it.each([null, undefined, 5, "x", [], {}, { allowed: "yes" }, { allowed: true }, { allowed: true, attempt: 0 }, { allowed: true, attempt: 1.5 }])(
    "refuses a malformed answer (%j) so the caller degrades instead of trusting it",
    (bad) => expect(parseAttemptReservation(bad, now)).toBeNull(),
  );

  it("lockRetryAfterSeconds is 0 for no lock or a dead one", () => {
    expect(lockRetryAfterSeconds(null, now)).toBe(0);
    expect(lockRetryAfterSeconds("2026-11-15T11:59:59Z", now)).toBe(0);
    expect(lockRetryAfterSeconds("2026-11-15T12:00:00.200Z", now)).toBe(1);
  });

  it("only a missing function reads as 'not installed'", () => {
    expect(isMissingRpc({ code: "PGRST202", message: "x" })).toBe(true);
    expect(isMissingRpc({ code: "42883", message: "function does not exist" })).toBe(true);
    expect(isMissingRpc({ message: "Could not find the function public.f in the schema cache" })).toBe(true);
    expect(isMissingRpc({ code: "57014", message: "statement timeout" })).toBe(false);
    expect(isMissingRpc({ code: "P0001", message: "credential_changed" })).toBe(false);
    expect(isMissingRpc(null)).toBe(false);
  });
});
