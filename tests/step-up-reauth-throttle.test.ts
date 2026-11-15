/**
 * Audit W07 / B159 — the re-check screens were unthrottled credential oracles for anyone holding a session:
 * the password step-up, and the PIN re-entered on counts, the cash deposit and the checklist confirm. Owner
 * decisions W07-3 a / W07-4 a (2026-11-15) reverse the old "no lockout on re-checks" ruling: five wrong answers in
 * a row sign THAT SESSION out; the account is never locked. The unused /api/auth/pin-confirm route is deleted.
 *
 * The counter itself (sessions.reauth_failed_count, session_reauth_reserve / _clear) is proven in
 * scripts/sql-harness-0307.mjs. This file pins the app side: the reservation comes BEFORE the credential check,
 * a refused reservation never reaches it, the fifth wrong answer signs the session out, a right answer clears the
 * run, and before migration 0307 is applied everything behaves as it did.
 */
import { existsSync, readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  session: vi.fn(), verifyPassword: vi.fn(), verifyActorPin: vi.fn(), audit: vi.fn(async (_input: unknown) => undefined),
  rpc: vi.fn(), revokeSession: vi.fn(async () => ({ rowsAffected: 1 })), unlockStepUp: vi.fn(async () => undefined),
  createCountEvent: vi.fn(async () => ({ countEventId: "count-1", advisories: [] })),
}));
vi.mock("@/lib/supabase-server", () => ({
  getServiceRoleClient: () => ({
    rpc: h.rpc,
    from: () => {
      const q: Record<string, unknown> = {};
      for (const m of ["select", "eq"]) q[m] = () => q;
      q.maybeSingle = async () => ({ data: { password_hash: "hmac2$stored" }, error: null });
      return q;
    },
  }),
}));
vi.mock("@/lib/session", async (original) => ({
  ...(await original<typeof import("@/lib/session")>()),
  requireSession: h.session, revokeSession: h.revokeSession, unlockStepUp: h.unlockStepUp,
}));
vi.mock("@/lib/auth", () => ({ verifyPassword: h.verifyPassword }));
vi.mock("@/lib/auth-flows", () => ({ upgradeLegacyPasswordHash: async () => undefined, verifyActorPin: h.verifyActorPin }));
vi.mock("@/lib/audit", () => ({ audit: h.audit, auditChecked: async (input: unknown) => { await h.audit(input); return { ok: true }; } }));
vi.mock("@/lib/counts", () => ({ COUNT_WRITE_MIN: 4, CountError: class extends Error {}, createCountEvent: h.createCountEvent }));

import { POST as stepUpPOST } from "@/app/api/auth/step-up/route";
import { POST as countsPOST } from "@/app/api/operations/counts/route";
import { REAUTH_LOCKED_CODE as SERVER_CODE, clearReauth, reauthFailed, reserveReauth } from "@/lib/auth-reauth";
import { REAUTH_LOCKED_CODE as CLIENT_CODE } from "@/lib/auth-reauth-client";
import { verifyActorPinForSession } from "@/lib/auth-reauth-pin";
import { REAUTH_LIMIT, parseReauthReservation, reauthExhausted } from "@/lib/auth-lockout-shared";

const SESSION = "5e551011-0000-4000-8000-000000000001";
const USER = "05e20001-0000-4000-8000-000000000001";
const stepUp = () => stepUpPOST(new NextRequest("https://example.test/api/auth/step-up", {
  method: "POST", headers: { origin: "https://example.test", "content-type": "application/json" }, body: JSON.stringify({ password: "guess" }),
}));
const counts = (pin: string) => countsPOST(new NextRequest("https://example.test/api/operations/counts", {
  method: "POST", headers: { origin: "https://example.test", "content-type": "application/json" },
  body: JSON.stringify({ locationId: "shop", pin, lines: [{ skuId: "sku", levelLabel: "case", qty: 1 }] }),
}));
/** What `session_reauth_reserve` answers for this test (and `session_reauth_clear` always succeeds). */
function reserveAnswers(answer: { data?: unknown; error?: { code?: string; message: string } }) {
  h.rpc.mockImplementation(async (fn: string) => (fn === "session_reauth_reserve" ? { data: answer.data ?? null, error: answer.error ?? null } : { data: null, error: null }));
}
const rpcNames = () => h.rpc.mock.calls.map((c) => c[0] as string);
const auditRows = () => h.audit.mock.calls.map((c) => (c as unknown[])[0] as { action: string; metadata: Record<string, unknown> });

beforeEach(() => {
  vi.clearAllMocks();
  h.session.mockResolvedValue({ user: { id: USER, role: "gm" }, session: { id: SESSION, stepUpUnlocked: false }, role: "gm", level: 7, locations: [] });
});

describe("POST /api/auth/step-up — five wrong passwords in a row sign the session out (B159)", () => {
  it("the fifth wrong password signs the session out", async () => {
    reserveAnswers({ data: { allowed: true, attempt: REAUTH_LIMIT } });
    h.verifyPassword.mockResolvedValue(false);
    const res = await stepUp();
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "reauth_locked" });
    expect(h.revokeSession).toHaveBeenCalledWith(SESSION);
    expect(res.headers.get("set-cookie")).toMatch(/co_ops_session=;/); // the cookie is cleared
    expect(auditRows()).toEqual([expect.objectContaining({ action: "auth_step_up_failure",
      metadata: { reason: "wrong_password", attempt_number: REAUTH_LIMIT, signed_out: true } })]);
    expect(h.unlockStepUp).not.toHaveBeenCalled();
  });

  it("a session that is out of attempts never reaches the password check", async () => {
    reserveAnswers({ data: { allowed: false, session_revoked: true } });
    const res = await stepUp();
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "reauth_locked" });
    expect(h.verifyPassword).not.toHaveBeenCalled();
    expect(auditRows()).toEqual([expect.objectContaining({ action: "auth_step_up_failure", metadata: { reason: "reauth_limit", signed_out: true } })]);
  });

  it.each([1, 2, 3, 4])("wrong password number %i is an ordinary 401: the session stays, the attempt is audited", async (attempt) => {
    reserveAnswers({ data: { allowed: true, attempt } });
    h.verifyPassword.mockResolvedValue(false);
    const res = await stepUp();
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "invalid_credentials" });
    expect(h.revokeSession).not.toHaveBeenCalled();
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(auditRows()[0]!.metadata).toEqual({ reason: "wrong_password", attempt_number: attempt });
  });

  it("a right password clears the run and unlocks as before — even on the fifth attempt", async () => {
    reserveAnswers({ data: { allowed: true, attempt: REAUTH_LIMIT } });
    h.verifyPassword.mockResolvedValue(true);
    const res = await stepUp();
    expect(res.status).toBe(200);
    expect(rpcNames()).toEqual(["session_reauth_reserve", "session_reauth_clear"]);
    expect(h.revokeSession).not.toHaveBeenCalled();
    expect(h.unlockStepUp).toHaveBeenCalledWith(SESSION, { catalogWindow: false });
  });

  it("the reservation comes BEFORE the password check, after the session and the role gate", () => {
    const src = readFileSync("app/api/auth/step-up/route.ts", "utf8");
    const order = ["await requireSession(", "!ROLES[user.role].hasEmailAuth", "await reserveReauth(session.id)", "await verifyPassword(", "await clearReauth(session.id, reauth)", "await auditChecked("]
      .map((s) => src.indexOf(s));
    expect(order.every((i) => i > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it.each([
    ["before migration 0307 is applied (function missing)", { code: "PGRST202", message: "Could not find the function public.session_reauth_reserve" }],
    ["on a limiter fault", { code: "57014", message: "canceling statement due to statement timeout" }],
  ])("%s the step-up behaves exactly as before: checked, uncounted, never signed out", async (_name, error) => {
    reserveAnswers({ error });
    h.verifyPassword.mockResolvedValue(false);
    const wrong = await stepUp();
    expect(wrong.status).toBe(401);
    expect(await wrong.json()).toMatchObject({ code: "invalid_credentials" });
    expect(h.revokeSession).not.toHaveBeenCalled();
    expect(auditRows()[0]!.metadata).toEqual({ reason: "wrong_password" });
    h.verifyPassword.mockResolvedValue(true);
    expect((await stepUp()).status).toBe(200);
    expect(rpcNames()).not.toContain("session_reauth_clear"); // nothing was counted, so nothing is cleared
  });
});

describe("the PIN re-check is counted the same way (counts; the cash deposit and the checklist confirm share the helper)", () => {
  beforeEach(() => {
    h.session.mockResolvedValue({ user: { id: USER, role: "key_holder" }, session: { id: SESSION, stepUpUnlocked: false }, role: "key_holder", level: 4, locations: ["shop"] });
  });

  it("the fifth wrong PIN signs the session out and writes nothing", async () => {
    reserveAnswers({ data: { allowed: true, attempt: REAUTH_LIMIT } });
    h.verifyActorPin.mockResolvedValue(false);
    const res = await counts("0000");
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "reauth_locked" });
    expect(h.revokeSession).toHaveBeenCalledWith(SESSION);
    expect(h.createCountEvent).not.toHaveBeenCalled();
  });

  it("an earlier wrong PIN is the ordinary pin_invalid", async () => {
    reserveAnswers({ data: { allowed: true, attempt: 2 } });
    h.verifyActorPin.mockResolvedValue(false);
    const res = await counts("0000");
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "pin_invalid" });
    expect(h.revokeSession).not.toHaveBeenCalled();
  });

  it("a session out of attempts never reaches the PIN comparison", async () => {
    reserveAnswers({ data: { allowed: false, session_revoked: true } });
    expect(await verifyActorPinForSession(SESSION, USER, "1234")).toBe("signed_out");
    expect(h.verifyActorPin).not.toHaveBeenCalled();
  });

  it("a right PIN clears the run; a malformed PIN is not a guess and spends no attempt", async () => {
    reserveAnswers({ data: { allowed: true, attempt: 3 } });
    h.verifyActorPin.mockResolvedValue(true);
    expect(await verifyActorPinForSession(SESSION, USER, "1234")).toBe("ok");
    expect(h.verifyActorPin).toHaveBeenCalledWith(USER, "1234");
    expect(rpcNames()).toEqual(["session_reauth_reserve", "session_reauth_clear"]);
    h.rpc.mockClear();
    for (const bad of ["", "12", "12345", "abcd", "12 4"]) expect(await verifyActorPinForSession(SESSION, USER, bad)).toBe("wrong");
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("every PIN re-check route goes through the counted helper, never the bare comparison", () => {
    for (const path of ["app/api/operations/counts/route.ts", "app/api/cash/route.ts"]) {
      const src = readFileSync(path, "utf8");
      expect(src, path).toContain("await verifyActorPinForSession(ctx.session.id, ctx.user.id,");
      expect(src, path).toContain('if (pinCheck === "signed_out") return reauthLockedResponse();');
      expect(src, path).not.toMatch(/\bverifyActorPin\(/);
    }
    const checklists = readFileSync("lib/checklists.ts", "utf8");
    const confirm = checklists.slice(checklists.indexOf("export async function confirmInstance("));
    const order = ["await reserveReauth(args.sessionId)", "throw new ChecklistReauthLockedError();", "await verifyPin(pin, userRow.pin_hash)", "await reauthFailed(args.sessionId, reauth)"].map((s) => confirm.indexOf(s));
    expect(order.every((i) => i > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(readFileSync("app/api/checklist/confirm/route.ts", "utf8")).toContain("sessionId: ctx.session.id,");
    expect(readFileSync("app/api/checklist/_helpers.ts", "utf8")).toContain("if (err instanceof ChecklistReauthLockedError) return reauthLockedResponse();");
  });
});

describe("the helper (lib/auth-reauth.ts) and its pure half", () => {
  it("reads the database's answers; a malformed one is 'uncounted', never 'refused'", async () => {
    expect(parseReauthReservation({ allowed: true, attempt: 1 })).toEqual({ allowed: true, attempt: 1, degraded: false });
    expect(parseReauthReservation({ allowed: false, session_revoked: true })).toEqual({ allowed: false, attempt: null, degraded: false });
    for (const bad of [null, 5, [], {}, { allowed: true }, { allowed: true, attempt: 0 }, { allowed: "no" }]) expect(parseReauthReservation(bad)).toBeNull();
    reserveAnswers({ data: { nonsense: true } });
    expect(await reserveReauth(SESSION)).toEqual({ allowed: true, attempt: null, degraded: true });
  });

  it("only the fifth counted attempt is the last one", async () => {
    expect(REAUTH_LIMIT).toBe(5);
    for (let attempt = 1; attempt <= 5; attempt++) expect(reauthExhausted({ allowed: true, attempt, degraded: false })).toBe(attempt === 5);
    expect(reauthExhausted({ allowed: true, attempt: null, degraded: true })).toBe(false);
    expect(await reauthFailed(SESSION, { allowed: true, attempt: 4, degraded: false })).toBe(false);
    expect(h.revokeSession).not.toHaveBeenCalled();
    expect(await reauthFailed(SESSION, { allowed: true, attempt: 5, degraded: false })).toBe(true);
    expect(h.revokeSession).toHaveBeenCalledWith(SESSION);
  });

  it("a failed revoke still answers 'signed out' (the database refuses the next reservation and revokes then)", async () => {
    h.revokeSession.mockRejectedValueOnce(new Error("revokeSession failed: timeout"));
    expect(await reauthFailed(SESSION, { allowed: true, attempt: 5, degraded: false })).toBe(true);
  });

  it("clearing never throws, and does nothing for an uncounted re-check", async () => {
    h.rpc.mockRejectedValueOnce(new Error("network"));
    await expect(clearReauth(SESSION, { allowed: true, attempt: 2, degraded: false })).resolves.toBeUndefined();
    h.rpc.mockClear();
    await clearReauth(SESSION, { allowed: true, attempt: null, degraded: true });
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("server and client agree on the code, and the screens that ask for a re-check all handle it", () => {
    expect(SERVER_CODE).toBe("reauth_locked");
    expect(CLIENT_CODE).toBe(SERVER_CODE);
    for (const path of ["components/auth/PasswordModal.tsx", "components/counts/CountForm.tsx", "app/(authed)/cash/cash-client.tsx", "components/auth/PinConfirmModal.tsx"]) {
      const src = readFileSync(path, "utf8");
      expect(src, path).toContain("REAUTH_LOCKED_CODE");
      expect(src, path).toContain("leaveAfterReauthLock();");
      expect(src, path).toContain('t("auth.reauth.signed_out")');
    }
    const en = JSON.parse(readFileSync("lib/i18n/en.json", "utf8")) as Record<string, string>;
    const es = JSON.parse(readFileSync("lib/i18n/es.json", "utf8")) as Record<string, string>;
    expect(en["auth.reauth.signed_out"]).toBeTruthy();
    expect(es["auth.reauth.signed_out"]).toBeTruthy();
  });

  it("the unused, unthrottled /api/auth/pin-confirm route is gone", () => {
    expect(existsSync("app/api/auth/pin-confirm")).toBe(false);
  });
});
