/**
 * Audit W07 / B156 + B157 — the self-service password reset.
 *
 * B156: the route consumed the reset link first and wrote the password in a separate request, so a failed
 * password write left the link dead and the password unchanged. B157: only the link used was consumed, so a
 * second link requested within the hour stayed usable after the reset. Both are closed by migration 0307's
 * `auth_password_reset_consume` (one transaction; proven in scripts/sql-harness-0307.mjs). This file pins the
 * route: it calls that function with HASHES only, never consumes the link itself, maps the named refusals to
 * the same constant 400, and keeps the pre-0307 steps for a database that does not have the function yet.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/auth/password-reset/route";
import { audit } from "@/lib/audit";
import { hashToken } from "@/lib/auth";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { makeSupabaseMock, type MockAnswer } from "./helpers/supabase-mock";

vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/auth", async (original) => ({
  ...(await original<typeof import("@/lib/auth")>()),
  hashPassword: vi.fn(async () => `hmac2$${"h".repeat(60)}`),
}));
vi.mock("@/lib/session", () => ({ revokeAllUserSessions: vi.fn(async () => ({ count: 2 })) }));

const TOKEN = "a".repeat(64);
const USER = "11111111-1111-4111-8111-111111111111";
const RESET = "33333333-3333-4333-8333-333333333333";
const PASSWORD = "CorrectHorse9";
const request = () => new NextRequest("https://example.test/api/auth/password-reset", {
  method: "POST", headers: { origin: "https://example.test", "content-type": "application/json" },
  body: JSON.stringify({ token: TOKEN, password: PASSWORD }),
});

function wire(consume: MockAnswer) {
  const sb = makeSupabaseMock({
    rpc: (fn) => (fn === "auth_password_reset_consume" ? consume : { data: null }),
    table: (table, ops) => {
      if (table === "password_resets" && ops.includes("update")) return { data: [{ id: RESET }] };
      if (table === "password_resets") return { data: { id: RESET, user_id: USER, expires_at: new Date(Date.now() + 3_600_000).toISOString(), consumed_at: null } };
      if (table === "users") return { data: { id: USER, role: "agm" } };
      return { data: null };
    },
  });
  vi.mocked(getServiceRoleClient).mockReturnValue(sb.client as never);
  return sb;
}
const auditRows = () => vi.mocked(audit).mock.calls.map((c) => c[0] as { action: string; actorRole: unknown; metadata: Record<string, unknown> });

beforeEach(() => vi.clearAllMocks());

describe("POST /api/auth/password-reset (B156 / B157)", () => {
  it("a failed password write never consumes the link", async () => {
    const sb = wire({ error: { code: "57014", message: "canceling statement due to statement timeout" } });
    const res = await POST(request());
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ code: "internal_error" });
    // the route itself never writes password_resets or users: the function owns the whole transaction
    expect(sb.wrote("password_resets")).toBe(false);
    expect(sb.wrote("users")).toBe(false);
    expect(auditRows().map((r) => r.action)).not.toContain("auth_password_reset_success");
  });

  it("the whole reset is one function call, given hashes only (never the token or the password)", async () => {
    const sb = wire({ data: { reset_id: RESET, user_id: USER, role: "agm", other_links_retired: 1, sessions_revoked: 3 } });
    const res = await POST(request());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(sb.rpcCalls).toEqual([["auth_password_reset_consume", { p_token_hash: await hashToken(TOKEN), p_password_hash: `hmac2$${"h".repeat(60)}` }]]);
    const sent = JSON.stringify(sb.rpcCalls);
    expect(sent).not.toContain(TOKEN);
    expect(sent).not.toContain(PASSWORD);
    expect(sb.wrote("password_resets")).toBe(false);
    expect(sb.wrote("users")).toBe(false);
  });

  it("the success audit names the reset, the sessions revoked and the other links retired (B157)", async () => {
    wire({ data: { reset_id: RESET, user_id: USER, role: "agm", other_links_retired: 1, sessions_revoked: 3 } });
    await POST(request());
    expect(auditRows()).toEqual([expect.objectContaining({
      action: "auth_password_reset_success", actorRole: "agm",
      metadata: { reset_id: RESET, sessions_revoked: 3, other_links_retired: 1 },
    })]);
    expect(JSON.stringify(auditRows())).not.toContain(TOKEN);
  });

  it.each([
    ["token_consumed", "auth_token_consumed_replay"],
    ["token_expired", "auth_token_expired"],
    ["token_invalid", "auth_token_invalid"],
  ])("a link that changed under the lock (%s) → the constant 400 and its own audit row", async (message, action) => {
    const sb = wire({ error: { code: "P0001", message } });
    const res = await POST(request());
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "invalid_token" });
    expect(auditRows().map((r) => r.action)).toEqual([action]);
    expect(sb.wrote("password_resets")).toBe(false);
  });

  it("before 0307 is applied (function missing) the reset still works through the pre-0307 steps", async () => {
    const sb = wire({ error: { code: "PGRST202", message: "Could not find the function public.auth_password_reset_consume in the schema cache" } });
    const res = await POST(request());
    expect(res.status).toBe(200);
    expect(sb.wrote("password_resets")).toBe(true);
    expect(sb.wrote("users")).toBe(true);
    expect(auditRows()).toEqual([expect.objectContaining({ action: "auth_password_reset_success", metadata: { reset_id: RESET, sessions_revoked: 2 } })]);
  });
});
