/**
 * Audit W07 / B051 — a sign-in racing a credential reset must not leave a live session behind the reset.
 *
 * The routes read the stored hash, ran bcrypt, then inserted a sessions row with no further check. An admin PIN /
 * password reset (or a self-service reset, or an email change) that committed while bcrypt ran had already revoked
 * the account's sessions — and the sign-in then inserted a NEW live one. The mint is now a compare-and-set
 * (migration 0307's `auth_create_session`): the row is inserted only while the verified hash is still the stored
 * one. The SQL is proven in scripts/sql-harness-0307.mjs; this file pins the app side.
 */
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST as pinPOST } from "@/app/api/auth/pin/route";
import { verifyPin } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { createSession, CredentialChangedError } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { makeSupabaseMock, type MockAnswer } from "./helpers/supabase-mock";

vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/auth", async (original) => ({
  ...(await original<typeof import("@/lib/auth")>()),
  verifyPin: vi.fn(),
}));
vi.mock("@/lib/portal/rate-limit", () => ({ checkAndRecord: vi.fn(async () => true) }));

const USER = "11111111-1111-4111-8111-111111111111";
const PIN_HASH = "$2a$10$abcdefghijklmnopqrstuvabcdefghijklmnopqrstuvabcdefghijk";

function wire(mint: MockAnswer) {
  const sb = makeSupabaseMock({
    rpc: (fn) => {
      if (fn === "auth_create_session") return mint;
      if (fn === "auth_reserve_attempt") return { data: { allowed: true, attempt: 1, locked_until: null } };
      return { data: null };
    },
    table: (table, ops, call) => {
      if (table === "user_locations") return { data: [{ location_id: "22222222-2222-4222-8222-222222222222" }] };
      if (table === "sessions") return { data: null };
      const cols = String(call.ops.find((o) => o[0] === "select")?.[1][0] ?? "");
      if (ops.includes("update")) return { data: [{ id: USER }] };
      if (cols.includes("pin_hash")) return { data: { id: USER, role: "employee", active: true, pin_hash: PIN_HASH } };
      return { data: { id: USER, role: "employee", active: true } };
    },
  });
  vi.mocked(getServiceRoleClient).mockReturnValue(sb.client as never);
  return sb;
}
const mintArgs = (sb: ReturnType<typeof wire>) => sb.rpcCalls.find((c) => c[0] === "auth_create_session")?.[1];

beforeEach(() => vi.clearAllMocks());

describe("createSession mints through the compare-and-set (B051)", () => {
  it("sends the verified hash to auth_create_session and never inserts the row itself", async () => {
    const sb = wire({ data: { session_id: "x" } });
    const s = await createSession(USER, "pin", { ipAddress: "203.0.113.7", userAgent: "ua" }, { kind: "pin", hash: PIN_HASH });
    expect(s.atomic).toBe(true);
    const args = mintArgs(sb)!;
    expect(args).toMatchObject({
      p_session_id: s.sessionId, p_user: USER, p_auth_method: "pin", p_credential_kind: "pin", p_verified_hash: PIN_HASH,
      p_login_email: null, p_ip: "203.0.113.7", p_user_agent: "ua",
    });
    expect(typeof args.p_token_hash).toBe("string");
    expect(args.p_token_hash).not.toBe(s.jwt); // the hash of the JWT, never the JWT
    expect(new Date(String(args.p_expires_at)).getTime()).toBeGreaterThan(Date.now());
    expect(sb.wrote("sessions")).toBe(false);
  });

  it("a password mint carries the email the account was looked up by", async () => {
    const sb = wire({ data: { session_id: "x" } });
    await createSession(USER, "password", undefined, { kind: "password", hash: "hmac2$abc", loginEmail: "boss@example.test" });
    expect(mintArgs(sb)).toMatchObject({ p_auth_method: "password", p_credential_kind: "password", p_verified_hash: "hmac2$abc", p_login_email: "boss@example.test" });
  });

  it("a credential that changed underneath the sign-in → CredentialChangedError and no session", async () => {
    const sb = wire({ error: { code: "P0001", message: "credential_changed" } });
    await expect(createSession(USER, "pin", undefined, { kind: "pin", hash: PIN_HASH })).rejects.toBeInstanceOf(CredentialChangedError);
    expect(sb.wrote("sessions")).toBe(false); // never falls back to the unchecked insert
  });

  it.each([
    ["account_inactive", "P0001"], ["invalid_payload", "P0001"], ["canceling statement due to statement timeout", "57014"],
  ])("any other mint failure (%s) throws and never falls back to the unchecked insert", async (message, code) => {
    const sb = wire({ error: { code, message } });
    const p = createSession(USER, "pin", undefined, { kind: "pin", hash: PIN_HASH });
    await expect(p).rejects.toThrow(/createSession: mint failed/);
    await expect(p).rejects.not.toBeInstanceOf(CredentialChangedError);
    expect(sb.wrote("sessions")).toBe(false);
  });

  it("before 0307 is applied (function missing) it mints with the pre-0307 insert, flagged atomic: false", async () => {
    const sb = wire({ error: { code: "PGRST202", message: "Could not find the function public.auth_create_session in the schema cache" } });
    const s = await createSession(USER, "pin", undefined, { kind: "pin", hash: PIN_HASH });
    expect(s.atomic).toBe(false);
    const insert = sb.tableCalls.find((c) => c.table === "sessions")!.ops.find((o) => o[0] === "insert")![1][0] as Record<string, unknown>;
    expect(insert).toMatchObject({ id: s.sessionId, user_id: USER, auth_method: "pin", step_up_unlocked: false });
  });
});

describe("POST /api/auth/pin when the PIN was reset mid-sign-in (B051)", () => {
  const request = () => new NextRequest("https://example.test/api/auth/pin", {
    method: "POST", headers: { origin: "https://example.test", "content-type": "application/json" },
    body: JSON.stringify({ user_id: USER, pin: "1234" }),
  });

  it("answers 401 with no session cookie, and audits a non-countable credential_changed", async () => {
    const sb = wire({ error: { code: "P0001", message: "credential_changed" } });
    vi.mocked(verifyPin).mockResolvedValue(true);
    const res = await pinPOST(request());
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "invalid_credentials" });
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(sb.rpcNames()).not.toContain("increment_failed_login");
    const rows = vi.mocked(audit).mock.calls.map((c) => c[0] as { action: string; metadata: Record<string, unknown> });
    expect(rows).toEqual([expect.objectContaining({ action: "auth_signin_pin_failure", metadata: { reason: "credential_changed" } })]);
  });

  it("a normal sign-in still gets its cookie, minted with the hash that was verified", async () => {
    const sb = wire({ data: { session_id: "x" } });
    vi.mocked(verifyPin).mockResolvedValue(true);
    const res = await pinPOST(request());
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain("co_ops_session=");
    expect(mintArgs(sb)).toMatchObject({ p_credential_kind: "pin", p_verified_hash: PIN_HASH });
    // 0307 cleared the counters inside the mint: no second, unchecked users UPDATE
    expect(sb.wrote("users")).toBe(false);
  });
});

describe("the source pins", () => {
  const session = readFileSync("lib/session.ts", "utf8");
  const password = readFileSync("app/api/auth/password/route.ts", "utf8");
  const pin = readFileSync("app/api/auth/pin/route.ts", "utf8");
  const verify = readFileSync("app/api/auth/verify/route.ts", "utf8");

  it("createSession tries the compare-and-set first; the plain insert lives only in the missing-function branch", () => {
    const body = session.slice(session.indexOf("export async function createSession("), session.indexOf("// ─── requireSession"));
    const rpc = body.indexOf("await sb.rpc(call.fn, call.args)");
    const missing = body.indexOf("if (!isMissingRpc(mintErr))");
    const insert = body.indexOf('.from("sessions").insert(');
    expect(rpc).toBeGreaterThan(-1);
    expect(missing).toBeGreaterThan(rpc);
    expect(insert).toBeGreaterThan(missing);
    expect(body.split('.from("sessions").insert(').length - 1).toBe(1);
    expect(body).toContain('if (mintErr.message === "credential_changed") throw new CredentialChangedError();');
  });

  it("the password route mints BEFORE it rewrites a legacy hash (else every legacy sign-in is refused)", () => {
    const mint = password.indexOf("await recordSuccessfulAuth(");
    const upgrade = password.indexOf("await upgradeLegacyPasswordHash(");
    expect(mint).toBeGreaterThan(-1);
    expect(upgrade).toBeGreaterThan(mint);
    expect(password).toContain('kind: "password", hash: user.password_hash, loginEmail: normalizedEmail,');
  });

  it("every caller names the credential it verified", () => {
    expect(pin).toContain('recordSuccessfulAuth(user.id, "pin", ctx, { kind: "pin", hash: user.pin_hash })');
    expect(verify).toContain('{ kind: "password", hash: passwordHash }');
    for (const src of [pin, password]) expect(src).toContain("e instanceof CredentialChangedError");
  });

  it("credential_changed is never a countable failure (it must not lock the account)", () => {
    const flows = readFileSync("lib/auth-flows.ts", "utf8");
    const set = flows.slice(flows.indexOf("const COUNTABLE_FAILURE_REASONS"), flows.indexOf("export interface AuthAttemptContext"));
    expect(set).not.toContain("credential_changed");
  });
});
