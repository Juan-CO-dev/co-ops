/**
 * Audit W07, fix round 1 (review P2 #1; completes B052 / B157) — POST /api/auth/password-reset-request.
 *
 * THE RACE. The route read the account, then inserted its token in a SEPARATE request. An email change that
 * committed in between had already retired the person's reset links — before this one existed — so the route
 * went on to mail a usable link to the OLD address. The same gap let a link slip past a reset's or an admin
 * password set's "retire every open link".
 *
 * THE FIX. The link is issued by migration 0307's `auth_password_reset_issue`: one transaction under the same
 * per-person lock and users row lock the retirers hold, which re-checks — on the locked row — the email the request
 * looked up, the password generation it read, and the account's eligibility. Refused = nothing inserted, nothing
 * mailed, the same constant 200.
 *
 * These tests drive the real route against tests/helpers/auth-race-model.ts and pause it with a controlled promise
 * at the exact point the review names. The SQL itself is proven in scripts/sql-harness-0307.mjs (R1).
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/auth/password-reset-request/route";
import { audit } from "@/lib/audit";
import { hashToken } from "@/lib/auth";
import { sendEmail } from "@/lib/email";
import { checkAndRecord } from "@/lib/portal/rate-limit";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { makeAuthRaceModel } from "./helpers/auth-race-model";

vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn(async () => ({ id: "resend-1" })), teamFrom: () => "team@example.test" }));
vi.mock("@/lib/email-templates/password-reset", () => ({
  renderPasswordResetEmail: ({ rawToken }: { rawToken: string }) => ({ html: `link:${rawToken}`, text: `link:${rawToken}` }),
}));
vi.mock("@/lib/portal/rate-limit", () => ({ checkAndRecord: vi.fn(async () => true) }));

const USER = "11111111-1111-4111-8111-111111111111";
const OLD = "manager@old.example.test";
const NEW = "manager@new.example.test";
const STORED_HASH = `hmac2$${"s".repeat(60)}`;
const request = (email = OLD) => new NextRequest("https://example.test/api/auth/password-reset-request", {
  method: "POST", headers: { origin: "https://example.test", "content-type": "application/json" }, body: JSON.stringify({ email }),
});
const manager = () => ({ id: USER, email: OLD, role: "agm", active: true, email_verified: true, password_hash: STORED_HASH });
function wire(over: Partial<ReturnType<typeof manager>> = {}, installed = true) {
  const model = makeAuthRaceModel({ user: { ...manager(), ...over }, installed });
  vi.mocked(getServiceRoleClient).mockReturnValue(model.client as never);
  return model;
}
const outcomes = () => vi.mocked(audit).mock.calls.map((c) => (c[0] as unknown as { metadata: { outcome: string } }).metadata.outcome);
const mailedTo = () => vi.mocked(sendEmail).mock.calls.map((c) => (c[0] as { to: string }).to);
/** The raw token the route mailed (the template double puts it in the body), hashed as the database stores it. */
const mailedTokenHash = async () => hashToken((vi.mocked(sendEmail).mock.calls[0]![0] as { text: string }).text.replace("link:", ""));

beforeEach(() => vi.clearAllMocks());

describe("POST /api/auth/password-reset-request — issuance races (W07 fix round 1)", () => {
  it("read the account → the admin changes the email → the route goes on: NO usable link exists and nothing is mailed to the old address", async () => {
    const model = wire();
    const read = model.hold("users:select:after"); // the route has its (soon stale) read; its answer is in flight
    const pending = POST(request(OLD));
    await read.reached;
    model.adminChangeEmail(NEW); // commits while the request is paused: retires the links that exist — none yet
    read.release();
    const res = await pending;

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true }); // the constant shape never moves
    expect(model.usableResetLinks()).toEqual([]);
    expect(model.resets).toEqual([]); // nothing was even inserted
    expect(mailedTo()).toEqual([]);
    expect(outcomes()).toEqual(["email_changed"]);
  });

  it("the other order — the link is issued, THEN the email changes: the change retires it, so the mailed link is dead", async () => {
    const model = wire();
    const res = await POST(request(OLD));
    expect(res.status).toBe(200);
    expect(mailedTo()).toEqual([OLD]);
    expect(model.usableResetLinks()).toHaveLength(1);
    expect(model.resets[0]).toMatchObject({ token_hash: await mailedTokenHash(), issued_email: OLD });
    model.adminChangeEmail(NEW);
    expect(model.usableResetLinks()).toEqual([]);
  });

  it("read the account → an admin sets the password (retiring open links) → the route goes on: no link escapes that retirement", async () => {
    const model = wire();
    const read = model.hold("users:select:after");
    const pending = POST(request(OLD));
    await read.reached;
    model.adminSetPassword(`hmac2$${"n".repeat(60)}`);
    read.release();
    await pending;
    expect(model.usableResetLinks()).toEqual([]);
    expect(mailedTo()).toEqual([]);
    expect(outcomes()).toEqual(["credential_changed"]);
  });

  it("read the account → the person is demoted below manager → the route goes on: nothing issued, nothing mailed", async () => {
    const model = wire();
    const read = model.hold("users:select:after");
    const pending = POST(request(OLD));
    await read.reached;
    model.adminSetRole("shift_lead");
    read.release();
    await pending;
    expect(model.resets).toEqual([]);
    expect(mailedTo()).toEqual([]);
    expect(outcomes()).toEqual(["role_not_email_auth"]);
  });

  it("the link is issued by ONE function call, given what the route read and HASHES only — the route never inserts the token itself", async () => {
    const model = wire();
    await POST(request(` ${OLD.toUpperCase()} `));
    expect(model.rpcCalls).toHaveLength(1);
    const [fn, args] = model.rpcCalls[0]!;
    expect(fn).toBe("auth_password_reset_issue");
    expect(args).toMatchObject({ p_user: USER, p_email: OLD, p_seen_password_hash: STORED_HASH, p_token_hash: await mailedTokenHash() });
    expect(Object.keys(args).sort()).toEqual(["p_email", "p_expires_at", "p_seen_password_hash", "p_token_hash", "p_user"]);
    expect(args.p_token_hash).toMatch(/^[0-9a-f]{64}$/);
    const life = new Date(args.p_expires_at as string).getTime() - Date.now();
    expect(life).toBeGreaterThan(59 * 60_000);
    expect(life).toBeLessThanOrEqual(60 * 60_000);
    expect(model.writes).toEqual(["rpc:auth_password_reset_issue"]);
    // the raw token is in the email and nowhere else: not in the function call, not in any audit row
    const raw = (vi.mocked(sendEmail).mock.calls[0]![0] as { text: string }).text.replace("link:", "");
    expect(JSON.stringify(model.rpcCalls)).not.toContain(raw);
    expect(JSON.stringify(vi.mocked(audit).mock.calls)).not.toContain(raw);
    expect(JSON.stringify(vi.mocked(audit).mock.calls)).not.toContain(STORED_HASH);
    expect(outcomes()).toEqual(["email_sent"]);
  });

  it("a failed issue fails CLOSED: no plain insert behind it, nothing mailed, the constant 200", async () => {
    const model = wire();
    vi.mocked(getServiceRoleClient).mockReturnValue({
      from: model.client.from,
      rpc: async () => ({ data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } }),
    } as never);
    const res = await POST(request(OLD));
    expect(res.status).toBe(200);
    expect(model.resets).toEqual([]);
    expect(mailedTo()).toEqual([]);
    expect(outcomes()).toEqual(["insert_failed"]);
  });

  it("before 0307 is applied (function missing) the request still works through the pre-0307 insert", async () => {
    const model = wire({}, false);
    const res = await POST(request(OLD));
    expect(res.status).toBe(200);
    expect(model.writes).toEqual(["rpc:auth_password_reset_issue", "password_resets:insert"]);
    expect(model.resets).toHaveLength(1);
    expect(mailedTo()).toEqual([OLD]);
    expect(outcomes()).toEqual(["email_sent"]);
  });

  it.each([
    ["user_inactive", { active: false }],
    ["role_not_email_auth", { role: "key_holder" }],
    ["email_not_verified", { email_verified: false }],
  ] as const)("the early dispositions are unchanged and never reach the issuer (%s)", async (outcome, over) => {
    const model = wire(over);
    const res = await POST(request(OLD));
    expect(res.status).toBe(200);
    expect(model.writes).toEqual([]);
    expect(mailedTo()).toEqual([]);
    expect(outcomes()).toEqual([outcome]);
  });

  it("the per-email throttle still runs FIRST: a throttled request reads nothing, issues nothing, mails nothing", async () => {
    const model = wire();
    vi.mocked(checkAndRecord).mockResolvedValueOnce(false);
    const res = await POST(request(OLD));
    expect(res.status).toBe(200);
    expect(vi.mocked(checkAndRecord)).toHaveBeenCalledWith(`pwreset_email:${OLD}`, 15 * 60, 3);
    expect(vi.mocked(getServiceRoleClient)).not.toHaveBeenCalled();
    expect(model.writes).toEqual([]);
    expect(mailedTo()).toEqual([]);
    expect(outcomes()).toEqual(["throttled"]);
  });
});
