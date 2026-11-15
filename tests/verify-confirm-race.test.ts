/**
 * Audit W07, fix round 1 (review P2 #2; completes B053) — POST /api/auth/verify ("confirm your email").
 *
 * THE RACE. The route consumed the link, THEN hashed the password (slow), THEN wrote the password and the
 * verification in a separate request. While it was hashing, an admin could change the person's email or demote
 * them: the route still overwrote the password, marked the REPLACEMENT address confirmed and signed the person in.
 * And a failed password write left the link consumed — the person locked out of their own confirmation.
 *
 * THE FIX. Hash FIRST. Then ONE transaction (migration 0307's `auth_email_confirm_consume`) under the per-person
 * lock and the users row lock: re-check the link, re-check the person (still a manager role, the address the link
 * was mailed to, active), write the password + the verification, consume the link, revoke sessions. Any refusal
 * or failure writes nothing and leaves the link as it was.
 *
 * These tests drive the real route against tests/helpers/auth-race-model.ts and pause it INSIDE the password
 * hash — the window the review names. The SQL itself is proven in scripts/sql-harness-0307.mjs (R2).
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/auth/verify/route";
import { audit } from "@/lib/audit";
import { hashPassword, hashToken } from "@/lib/auth";
import { recordFailedAttempt, recordSuccessfulAuth } from "@/lib/auth-flows";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { deferred, makeAuthRaceModel } from "./helpers/auth-race-model";

/** The model the mocked session / sign-in modules act on (set per test by `wire`). */
let model: ReturnType<typeof makeAuthRaceModel>;

vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/auth", async (original) => ({
  ...(await original<typeof import("@/lib/auth")>()),
  hashPassword: vi.fn(async () => NEW_HASH),
}));
vi.mock("@/lib/session", async () => {
  const { CredentialChangedError } = await import("./helpers/auth-race-model");
  return {
    CredentialChangedError,
    applySessionCookie: (res: Response) => { res.headers.set("x-test-session", "minted"); return res; },
    revokeAllUserSessions: vi.fn(async () => model.revokeAllSessions()),
  };
});
vi.mock("@/lib/auth-flows", () => ({
  // The real one mints through auth_create_session: a compare-and-set on the hash (and the email) the caller names.
  recordSuccessfulAuth: vi.fn(async (_userId: string, _method: string, _ctx: unknown, credential: { kind: string; hash: string; loginEmail?: string }) => model.mint(credential) as never),
  recordFailedAttempt: vi.fn(async () => ({ locked: false })),
}));

const NEW_HASH = `hmac2$${"n".repeat(60)}`;
const TOKEN = "c".repeat(64);
const USER = "22222222-2222-4222-8222-222222222222";
const MAILED_TO = "promoted@example.test";
const PASSWORD = "CorrectHorse9";
const request = () => new NextRequest("https://example.test/api/auth/verify", {
  method: "POST", headers: { origin: "https://example.test", "content-type": "application/json" },
  body: JSON.stringify({ token: TOKEN, password: PASSWORD }),
});
/** A promoted manager: unconfirmed email, no password yet, a PIN session live, the link in their inbox. */
async function wire(opts: { installed?: boolean } = {}) {
  model = makeAuthRaceModel({ user: { id: USER, email: MAILED_TO, role: "agm", active: true, email_verified: false, password_hash: null }, installed: opts.installed ?? true });
  model.seedVerification(await hashToken(TOKEN));
  model.seedSession();
  vi.mocked(getServiceRoleClient).mockReturnValue(model.client as never);
  return model;
}
/** Pause the route inside bcrypt; `release()` lets the hash finish. */
function holdHash() {
  const h = deferred<string>();
  vi.mocked(hashPassword).mockImplementationOnce(async () => { h.arrive(); return h.released; });
  return h;
}
const actions = () => vi.mocked(audit).mock.calls.map((c) => (c[0] as unknown as { action: string }).action);
const signedIn = (res: Response) => res.headers.get("x-test-session") === "minted";
const untouched = () => {
  expect(model.user.password_hash).toBeNull();
  expect(model.user.email_verified).toBe(false);
  expect(model.sessions.filter((s) => s.minted)).toEqual([]);
};

beforeEach(() => vi.clearAllMocks());

describe("POST /api/auth/verify — confirmation races (W07 fix round 1)", () => {
  it("the password is hashed FIRST: while bcrypt runs, the link is not consumed and nothing has been written", async () => {
    await wire();
    const hash = holdHash();
    const pending = POST(request());
    await hash.reached;
    expect(model.writes).toEqual([]);
    expect(model.openVerifications()).toHaveLength(1);
    hash.release(NEW_HASH);
    const res = await pending;
    expect(res.status).toBe(200);
    // …then ONE call does the rest, given hashes only
    expect(model.rpcCalls).toEqual([["auth_email_confirm_consume", { p_token_hash: await hashToken(TOKEN), p_password_hash: NEW_HASH }]]);
    expect(model.writes).toEqual(["rpc:auth_email_confirm_consume"]);
    expect(JSON.stringify(model.rpcCalls)).not.toContain(TOKEN);
    expect(JSON.stringify(model.rpcCalls)).not.toContain(PASSWORD);
  });

  it("a confirmation: the password, the verification, the link, the old sessions and the sign-in", async () => {
    await wire();
    const res = await POST(request());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, user_id: USER });
    expect(model.user).toMatchObject({ password_hash: NEW_HASH, email_verified: true });
    expect(model.openVerifications()).toEqual([]);
    expect(model.liveSessions().map((s) => s.minted)).toEqual([true]); // the PIN session is gone; the new one is the only one
    expect(signedIn(res)).toBe(true);
    expect(actions()).toEqual(["auth_email_verified"]);
    expect(JSON.stringify(vi.mocked(audit).mock.calls)).not.toContain(NEW_HASH);
  });

  it("EMAIL CHANGE during the confirmation: the replacement address is not confirmed, no password is written, nobody is signed in", async () => {
    await wire();
    const hash = holdHash();
    const pending = POST(request());
    await hash.reached;
    model.adminChangeEmail("replacement@example.test"); // commits while the route is hashing
    hash.release(NEW_HASH);
    const res = await pending;

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "invalid_token" });
    untouched();
    expect(model.user.email).toBe("replacement@example.test");
    expect(signedIn(res)).toBe(false);
    expect(actions()).toEqual(["auth_token_consumed_replay"]); // the change retired the link; the function saw that under its lock
  });

  it("DEMOTION during the confirmation: no password, no confirmation, no sign-in — and the link is NOT burned", async () => {
    await wire();
    const hash = holdHash();
    const pending = POST(request());
    await hash.reached;
    model.adminSetRole("shift_lead"); // admin_user_set_role retires no link: only the function's own re-check stops this
    hash.release(NEW_HASH);
    const res = await pending;

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "invalid_token" });
    untouched();
    expect(signedIn(res)).toBe(false);
    expect(model.openVerifications()).toHaveLength(1);
    expect(vi.mocked(audit).mock.calls.map((c) => c[0] as unknown as { action: string; metadata: Record<string, unknown> })).toEqual([
      expect.objectContaining({ action: "auth_token_invalid", metadata: expect.objectContaining({ context: "verify", reason: "role_not_email_auth" }) }),
    ]);
  });

  it("WRITE FAILURE during the confirmation: a 500, nothing changed, and the SAME link works on the retry", async () => {
    await wire();
    model.failNextCredentialWrite();
    const failed = await POST(request());
    expect(failed.status).toBe(500);
    untouched();
    expect(signedIn(failed)).toBe(false);
    expect(model.openVerifications()).toHaveLength(1); // not burned
    expect(model.liveSessions()).toHaveLength(1); // the PIN session was not revoked either
    expect(actions()).toEqual([]);

    const retry = await POST(request());
    expect(retry.status).toBe(200);
    expect(model.user).toMatchObject({ password_hash: NEW_HASH, email_verified: true });
    expect(signedIn(retry)).toBe(true);
  });

  it("a change that lands between the confirmation and the sign-in mints no session (the mint names the hash AND the address)", async () => {
    await wire();
    // the confirmation commits; the address moves before the route's mint lands
    vi.mocked(recordSuccessfulAuth).mockImplementationOnce(async (_u, _m, _c, credential) => {
      model.adminChangeEmail("moved-after@example.test");
      return model.mint(credential) as never;
    });
    const res = await POST(request());
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "invalid_credentials" });
    expect(signedIn(res)).toBe(false);
    expect(model.sessions.filter((s) => s.minted)).toEqual([]);
    expect(vi.mocked(recordSuccessfulAuth).mock.calls[0]![3]).toEqual({ kind: "password", hash: NEW_HASH, loginEmail: MAILED_TO });
    expect(vi.mocked(recordFailedAttempt)).toHaveBeenCalledWith(USER, "password", "credential_changed", expect.anything());
    // the confirmation itself stands: the person signs in the ordinary way
    expect(model.user).toMatchObject({ password_hash: NEW_HASH, email_verified: true });
  });

  it("an inactive account: 403, and (now) nothing is written and the link is left as it was", async () => {
    await wire();
    model.user.active = false;
    const res = await POST(request());
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "account_inactive" });
    untouched();
    expect(model.openVerifications()).toHaveLength(1);
  });

  it("before 0307 is applied (function missing) the link still confirms through the pre-0307 steps", async () => {
    await wire({ installed: false });
    const res = await POST(request());
    expect(res.status).toBe(200);
    expect(model.writes).toEqual(["rpc:auth_email_confirm_consume", "email_verifications:update", "users:update"]);
    expect(model.user).toMatchObject({ password_hash: NEW_HASH, email_verified: true });
    expect(model.openVerifications()).toEqual([]);
    expect(signedIn(res)).toBe(true);
    expect(actions()).toEqual(["auth_email_verified"]);
  });
});
