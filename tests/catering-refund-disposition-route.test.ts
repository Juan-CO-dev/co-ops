/**
 * Catering refunds Part B1 — POST /api/catering/quotes/[id]/refunds/disposition (plan B1.4 "Operator disposition").
 * Contract order: same-origin → session on the route's OWN path → the switch (503 `refunds_off` before the body is
 * read) → strict parse (`parseDispositionBody`, 400 by name incl. `evidence_required`) → quote id → ROLE (MoO / Owner /
 * CGS; 403 `forbidden` before the password is asked for) → Tier B → `resolveRefundAnomaly` → the stored summary re-read.
 *
 * The session is the REAL `requireSession` over the predicate-aware fake (the tests/labor-burden-route.test.ts
 * pattern), so the step-up surface admission in lib/session.ts is really exercised: an unlock set by the preceding
 * POST /api/auth/step-up survives THIS route's own requireSession and is cleared by the retry path's. The lib is mocked
 * at its boundary (its own rules are tests/catering-refunds-flow.test.ts and the 0359 harness).
 */
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase } from "./fake-supabase";

const h = vi.hoisted(() => ({ db: null as unknown as import("./fake-supabase").FakeDb, resolve: vi.fn(), summary: vi.fn(), request: vi.fn(), retry: vi.fn() }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => h.db.client }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  verifyJwt: async () => ({ user_id: "user-1", session_id: "session-1", locations: [] }),
  hashToken: async () => "hash-1",
  signJwt: async () => "jwt",
}));
vi.mock("@/lib/catering/refunds", async () => {
  const shared = await import("@/lib/catering/refunds-shared");
  class CateringRefundError extends Error {
    constructor(public status: number, public code: string, public detail?: Record<string, unknown>) { super(code); }
  }
  return { ...shared, REFUND_READ_MIN: 5, CateringRefundError, resolveRefundAnomaly: h.resolve, loadRefundSummary: h.summary, requestRefund: h.request, retryRefundRequest: h.retry };
});

import { isCateringStepUpPath, isStepUpSurface, requireSession, SESSION_COOKIE_NAME, unlockStepUp } from "@/lib/session";
import { POST, maxDuration } from "@/app/api/catering/quotes/[id]/refunds/disposition/route";
import { CateringRefundError } from "@/lib/catering/refunds";
import { DISPOSITION_ROLES } from "@/lib/catering/refund-outcomes-shared";
import { DESTRUCTIVE_ACTIONS, isDestructive } from "@/lib/destructive-actions";
import { NON_DESTRUCTIVE_ACTIONS, RESERVED_ACTIONS, isKnownAuditAction } from "@/lib/audit-actions";

const Q = "00000000-0000-4000-8000-0000000000b1";
const R = "00000000-0000-4000-8000-0000000000c1";
const ISSUE = "00000000-0000-4000-8000-0000000000e1";
const LOC = "00000000-0000-4000-8000-0000000000a1";
const PATH = `/api/catering/quotes/${Q}/refunds/disposition`;
const BODY = { issueId: ISSUE, expectedGeneration: 3, action: "resolve_event_floor", evidenceRef: "stripe:support#case-1" };
const cookie = { cookie: `${SESSION_COOKIE_NAME}=jwt` };
const post = (body: unknown, origin: string | null = "http://localhost", id = Q) => new NextRequest(`http://localhost/api/catering/quotes/${id}/refunds/disposition`, {
  method: "POST", body: typeof body === "string" ? body : JSON.stringify(body), headers: { ...cookie, ...(origin ? { origin } : {}), "content-type": "application/json" },
});
const call = (body: unknown = BODY, origin: string | null = "http://localhost", id = Q) => POST(post(body, origin, id), { params: Promise.resolve({ id }) });
const answer = async (res: Response) => { const j = (await res.json()) as { code?: string; error?: string }; return [res.status, j.code ?? j.error]; };
const sessionRow = () => (h.db.tables.sessions as Array<Record<string, unknown>>)[0]!;
const visit = async (path: string) => {
  const ctx = await requireSession(new NextRequest(`http://localhost${path}`, { headers: cookie }), path);
  if (ctx instanceof Response) throw new Error(`denied on ${path}`);
};
const libCalls = () => h.resolve.mock.calls.length + h.summary.mock.calls.length + h.request.mock.calls.length + h.retry.mock.calls.length;

function seed(role: string, opts: { session?: boolean } = {}) {
  const future = new Date(Date.now() + 3_600_000).toISOString();
  h.db = fakeSupabase({
    sessions: opts.session === false ? [] : [{
      id: "session-1", user_id: "user-1", token_hash: "hash-1", auth_method: "password",
      step_up_unlocked: false, step_up_unlocked_at: null, catalog_edit_unlocked_at: null,
      created_at: new Date().toISOString(), last_activity_at: new Date().toISOString(),
      expires_at: future, revoked_at: null, ip_address: null, user_agent: null,
    }],
    users: [{ id: "user-1", name: "Ops", email: "ops@example.test", role, active: true, language: "en" }],
    user_locations: [{ user_id: "user-1", location_id: LOC, active: true }],
  }, {});
}

beforeEach(() => {
  vi.stubEnv("CATERING_REFUNDS", "1");
  for (const f of [h.resolve, h.summary, h.request, h.retry]) f.mockReset();
  h.resolve.mockResolvedValue({ result: "resolved", state: "operator_resolved", generation: 4 });
  h.summary.mockResolvedValue({ quoteId: Q, issues: [] });
  seed("moo");
});
afterEach(() => vi.unstubAllEnvs());

describe("the step-up surface (lib/session.ts isCateringStepUpPath)", () => {
  it("admits EXACTLY /api/catering/quotes/<id>/refunds/disposition; the retry path and look-alikes stay out", () => {
    expect(isCateringStepUpPath(PATH)).toBe(true);
    expect(isStepUpSurface(PATH)).toBe(true);
    for (const path of [
      `/api/catering/quotes/${Q}/refunds/${R}/retry`, `/api/catering/quotes/${Q}/refunds/disposition/x`, `/api/catering/quotes/${Q}/refunds/dispositions`,
      `/api/catering/quotes/${Q}/refunds/disposition/`, `/api/catering/quotes/refunds/disposition`, `/api/catering/pipeline/${Q}/refunds/disposition`,
      `/api/catering/quotes/${Q}/x/refunds/disposition`, `/catering/quotes/${Q}/refunds/disposition`,
    ]) {
      expect([path, isCateringStepUpPath(path)]).toEqual([path, false]);
    }
    // Part A's confirm path is still admitted.
    expect(isCateringStepUpPath(`/api/catering/quotes/${Q}/refunds`)).toBe(true);
  });
  it("an unlock set just before survives THIS route's own requireSession; visiting the retry path clears it", async () => {
    await unlockStepUp("session-1");
    expect(await answer(await call())).toEqual([200, undefined]);
    expect(sessionRow().step_up_unlocked).toBe(true);
    await visit(`/api/catering/quotes/${Q}/refunds/${R}/retry`);
    expect(sessionRow().step_up_unlocked).toBe(false);
    expect(await answer(await call())).toEqual([403, "step_up_required"]);
    expect(h.resolve).toHaveBeenCalledTimes(1);
  });
  it("the route budget is explicit: maxDuration 120 s (plan B1.6)", () => {
    expect(maxDuration).toBe(120);
  });
});

describe("the order matrix", () => {
  it("bad origin (no origin, a foreign one, cross-site) is refused before the session: nothing read, nothing asked", async () => {
    await unlockStepUp("session-1");
    const before = JSON.stringify(sessionRow());
    for (const origin of [null, "https://evil.test"]) {
      expect(await answer(await call("{bad", origin, "x"))).toEqual([403, "bad_origin"]);
    }
    expect(JSON.stringify(sessionRow())).toBe(before);
    expect(libCalls()).toBe(0);
  });
  it("no session: 401 before the switch, the body or the role", async () => {
    seed("employee", { session: false });
    expect((await call("{bad")).status).toBe(401);
    vi.stubEnv("CATERING_REFUNDS", "");
    expect((await call("{bad")).status).toBe(401);
    expect(libCalls()).toBe(0);
  });
  it("OFF: 503 refunds_off before the body, the id, the role or the password; INERT (zero lib calls)", async () => {
    vi.stubEnv("CATERING_REFUNDS", "");
    for (const role of ["moo", "owner", "cgs", "gm", "agm", "catering_mgr", "employee"]) {
      for (const fresh of [true, false]) {
        seed(role);
        if (fresh) await unlockStepUp("session-1");
        for (const [body, id] of [[BODY, Q], ["{not json", Q], [{ nope: 1 }, "x"], [{ ...BODY, evidenceRef: null }, Q], ["null", Q]] as const) {
          expect([role, fresh, JSON.stringify(body), ...await answer(await call(body, "http://localhost", id))]).toEqual([role, fresh, JSON.stringify(body), 503, "refunds_off"]);
        }
      }
    }
    expect(libCalls()).toBe(0);
  });
  it("a bad body is 400 by name, before the id, the role and the password", async () => {
    seed("employee"); // the wrong role and no password: the body still answers first
    const cases: Array<[unknown, string]> = [
      ["{not json", "invalid_json"], ["null", "invalid_payload"], [[BODY], "invalid_request"], [{ ...BODY, extra: 1 }, "invalid_request"],
      [{ ...BODY, issueId: "nope" }, "invalid_request"], [{ ...BODY, expectedGeneration: 0 }, "invalid_request"], [{ ...BODY, expectedGeneration: 1.5 }, "invalid_request"],
      [{ ...BODY, action: "mark_succeeded" }, "invalid_request"], [{ ...BODY, evidenceRef: "has spaces and a name" }, "invalid_request"],
      [{ ...BODY, action: "bind_verified_refund" }, "invalid_request"], // a target is required
    ];
    for (const [body, code] of cases) {
      expect([JSON.stringify(body), ...await answer(await call(body, "http://localhost", "x"))]).toEqual([JSON.stringify(body), 400, code]);
    }
    expect(libCalls()).toBe(0);
  });
  it("evidence_required: an evidence-bearing action with no reference is 400 evidence_required, before the role", async () => {
    seed("gm");
    for (const action of ["resolve_event_floor", "keep_held", "release_unsent", "evidence_reviewed"]) {
      expect([action, ...await answer(await call({ ...BODY, action, evidenceRef: null }))]).toEqual([action, 400, "evidence_required"]);
      const { evidenceRef: _drop, ...without } = { ...BODY, action };
      void _drop;
      expect([action, ...await answer(await call(without))]).toEqual([action, 400, "evidence_required"]);
    }
    expect(libCalls()).toBe(0);
  });
  it("a quote id that is not a uuid is 400 invalid_request, before the role", async () => {
    seed("employee");
    expect(await answer(await call(BODY, "http://localhost", "x"))).toEqual([400, "invalid_request"]);
    expect(libCalls()).toBe(0);
  });
  it("the wrong role (gm, agm, catering_mgr and every other non-disposition role) is 403 forbidden BEFORE the step-up, password or not", async () => {
    expect([...DISPOSITION_ROLES].sort()).toEqual(["cgs", "moo", "owner"]);
    for (const role of ["gm", "agm", "catering_mgr", "prep_mgr", "social_media_mgr", "shift_lead", "key_holder", "trainer", "employee"]) {
      seed(role);
      expect([role, ...await answer(await call())]).toEqual([role, 403, "forbidden"]); // no password: forbidden, not step_up_required
      await unlockStepUp("session-1");
      expect([role, ...await answer(await call())]).toEqual([role, 403, "forbidden"]);
    }
    expect(libCalls()).toBe(0);
  });
  it("missing step-up = step_up_required; a stale one (past Tier B's 120 s) = step_up_stale; nothing is asked", async () => {
    for (const role of DISPOSITION_ROLES) {
      seed(role);
      expect([role, ...await answer(await call())]).toEqual([role, 403, "step_up_required"]);
      await unlockStepUp("session-1");
      sessionRow().step_up_unlocked_at = new Date(Date.now() - 10 * 60_000).toISOString();
      expect([role, ...await answer(await call())]).toEqual([role, 403, "step_up_stale"]);
    }
    expect(libCalls()).toBe(0);
  });
  it("success: MoO / Owner / CGS with a fresh password reach the lib ONCE with the parsed body, then the stored summary is re-read", async () => {
    for (const role of DISPOSITION_ROLES) {
      h.resolve.mockClear(); h.summary.mockClear();
      seed(role);
      await unlockStepUp("session-1");
      const res = await call({ ...BODY, issueId: ISSUE.toUpperCase(), target: null });
      expect([role, res.status, await res.json()]).toEqual([role, 200, { ok: true, result: { result: "resolved", state: "operator_resolved", generation: 4 }, summary: { quoteId: Q, issues: [] } }]);
      expect(h.resolve).toHaveBeenCalledTimes(1);
      const [ctx, id, body] = h.resolve.mock.calls[0]!;
      expect(h.resolve.mock.calls[0]!).toHaveLength(3); // the lib computes its own deadline
      expect([(ctx as { user: { id: string; role: string } }).user.id, (ctx as { user: { role: string } }).user.role, id, body])
        .toEqual(["user-1", role, Q, { issueId: ISSUE, expectedGeneration: 3, action: "resolve_event_floor", evidenceRef: "stripe:support#case-1", target: null }]);
      expect(h.summary.mock.calls.map((c) => c[1])).toEqual([Q]);
      expect(h.resolve.mock.invocationCallOrder[0]!).toBeLessThan(h.summary.mock.invocationCallOrder[0]!);
      expect([h.request.mock.calls.length, h.retry.mock.calls.length]).toEqual([0, 0]);
    }
  });
  it("a stale_generation from the lib is 409 by name; the summary is not re-read", async () => {
    await unlockStepUp("session-1");
    h.resolve.mockRejectedValueOnce(new CateringRefundError(409, "stale_generation"));
    expect(await answer(await call())).toEqual([409, "stale_generation"]);
    for (const [status, code] of [[404, "not_found"], [403, "forbidden"], [409, "issue_closed"], [503, "refunds_unavailable"], [403, "step_up_stale"]] as const) {
      await unlockStepUp("session-1");
      h.resolve.mockRejectedValueOnce(new CateringRefundError(status, code));
      expect(await answer(await call())).toEqual([status, code]);
    }
    expect(h.summary).not.toHaveBeenCalled();
  });
  it("an unexpected lib failure is not swallowed into a refusal", async () => {
    await unlockStepUp("session-1");
    h.resolve.mockRejectedValueOnce(new Error("database down"));
    await expect(call()).rejects.toThrow("database down");
  });
  it("the summary reload failing still returns ok: true with summary null (the disposition stands)", async () => {
    await unlockStepUp("session-1");
    h.summary.mockRejectedValueOnce(new CateringRefundError(404, "not_found"));
    const res = await call();
    expect([res.status, await res.json()]).toEqual([200, { ok: true, result: { result: "resolved", state: "operator_resolved", generation: 4 }, summary: null }]);
    expect(h.resolve).toHaveBeenCalledTimes(1);
    expect(h.summary).toHaveBeenCalledTimes(1);
  });
});

describe("0359's SQL-written audit actions are registered (the closed vocabulary)", () => {
  const sql = readFileSync("supabase/migrations/0359_catering_refund_reconciler.sql", "utf8");
  const written = [...new Set([...sql.matchAll(/'(catering\.(?:refund|payment)\.[a-z_]+)'/g)].map((m) => m[1]!))].sort();
  it("every catering.refund.* / catering.payment.* literal 0359 writes is a known action", () => {
    expect(written).toEqual([
      "catering.payment.provider_refunded", "catering.refund.anomaly", "catering.refund.break_glass", "catering.refund.disposition",
      "catering.refund.epoch", "catering.refund.provider_failed", "catering.refund.request", "catering.refund.reversed",
    ]);
    for (const a of written) expect([a, isKnownAuditAction(a)]).toEqual([a, true]);
  });
  it("the disposition and the break-glass close are destructive and SQL-only (reserved); the observations are not destructive", () => {
    for (const a of ["catering.refund.disposition", "catering.refund.break_glass"]) {
      expect([a, isDestructive(a), (RESERVED_ACTIONS as readonly string[]).includes(a), (NON_DESTRUCTIVE_ACTIONS as readonly string[]).includes(a)]).toEqual([a, true, true, false]);
    }
    for (const a of ["catering.refund.epoch", "catering.refund.reversed", "catering.refund.provider_failed", "catering.refund.anomaly"]) {
      expect([a, isDestructive(a), (NON_DESTRUCTIVE_ACTIONS as readonly string[]).includes(a), (DESTRUCTIVE_ACTIONS as readonly string[]).includes(a)]).toEqual([a, false, true, false]);
    }
    // Unchanged from Part A.
    expect([isDestructive("catering.refund.request"), (NON_DESTRUCTIVE_ACTIONS as readonly string[]).includes("catering.refund.stripe_result"), (NON_DESTRUCTIVE_ACTIONS as readonly string[]).includes("catering.payment.provider_refunded")]).toEqual([true, true, true]);
  });
  it("the disposition audit row is the SQL's own: the route writes none", () => {
    const route = readFileSync("app/api/catering/quotes/[id]/refunds/disposition/route.ts", "utf8");
    expect(route).not.toMatch(/\baudit\(/);
  });
});
