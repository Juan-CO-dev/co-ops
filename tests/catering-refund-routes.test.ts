/**
 * Catering refund routes — the order of the gates, over a mocked session and a mocked lib (the lib's flow is
 * tests/catering-refunds-flow.test.ts; the disposition route with the REAL requireSession is
 * tests/catering-refund-disposition-route.test.ts):
 *   POST /api/catering/quotes/[id]/refunds                         same-origin → session → switch → parse → id → role → Tier B → lib
 *   POST /api/catering/quotes/[id]/refunds/[requestId]/retry       same-origin → session → switch → ids → parse → role → lib (no tier)
 *   POST /api/catering/quotes/[id]/refunds/disposition             same-origin → session → switch → parse → id → role → Tier B → lib
 *   GET  /api/catering/quotes/[id]/refunds, /api/catering/pipeline/[id]/refunds   session → switch → floor → id → lib
 * Switch off = 503 `refunds_off` with the body unread and the lib never called. Part B1: reads are stored state (the
 * GET calls only `loadRefundSummary`), a mutation answers with the re-read stored summary, and every route file with
 * the switch OFF answers exactly what main's (9ce98df5, frozen in tests/fixtures/main-9ce98df5/) answers.
 */
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  actor: null as unknown, session: vi.fn(), request: vi.fn(), retry: vi.fn(), summary: vi.fn(), lead: vi.fn(), resolve: vi.fn(),
}));
vi.mock("@/lib/session", async (original) => ({ ...await original<typeof import("@/lib/session")>(), requireSession: h.session }));
vi.mock("@/lib/catering/refunds", async () => {
  const shared = await import("@/lib/catering/refunds-shared");
  class CateringRefundError extends Error {
    constructor(public status: number, public code: string, public detail?: Record<string, unknown>) { super(code); }
  }
  return {
    ...shared, REFUND_READ_MIN: 5, CateringRefundError, requestRefund: h.request, retryRefundRequest: h.retry, loadRefundSummary: h.summary,
    loadLeadRefundables: h.lead, resolveRefundAnomaly: h.resolve,
  };
});

import { isStepUpSurface } from "@/lib/session";
import { GET, POST } from "@/app/api/catering/quotes/[id]/refunds/route";
import { POST as RETRY } from "@/app/api/catering/quotes/[id]/refunds/[requestId]/retry/route";
import { POST as DISPOSITION } from "@/app/api/catering/quotes/[id]/refunds/disposition/route";
import { GET as LEAD_GET } from "@/app/api/catering/pipeline/[id]/refunds/route";
import { GET as MAIN_GET, POST as MAIN_POST } from "./fixtures/main-9ce98df5/app/api/catering/quotes/[id]/refunds/route";
import { POST as MAIN_RETRY } from "./fixtures/main-9ce98df5/app/api/catering/quotes/[id]/refunds/[requestId]/retry/route";
import { GET as MAIN_LEAD_GET } from "./fixtures/main-9ce98df5/app/api/catering/pipeline/[id]/refunds/route";

const ORIGIN = "http://localhost";
const Q = "00000000-0000-4000-8000-0000000000b1";
const R = "00000000-0000-4000-8000-0000000000c1";
const ISSUE = "00000000-0000-4000-8000-0000000000e1";
const BODY = { clientToken: "11111111-1111-4111-8111-111111111111", amountCents: 100000, reasonCode: "event_lost", reasonNote: null, trigger: "lost" };
const DISP = { issueId: ISSUE, expectedGeneration: 3, action: "keep_held", evidenceRef: "stripe:dashboard#note-1" };
const post = (path: string, body: unknown, origin: string | null = ORIGIN) =>
  new NextRequest(`${ORIGIN}${path}`, { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body), headers: { "content-type": "application/json", ...(origin ? { origin } : {}) } });
const get = (path: string) => new NextRequest(`${ORIGIN}${path}`);
const as = (role: string, fresh = true) => {
  h.actor = { user: { id: "u1", role, active: true, language: "en" }, locations: [], session: { id: "s1", stepUpUnlocked: fresh, stepUpUnlockedAt: fresh ? new Date().toISOString() : null, catalogEditUnlockedAt: null } };
};
const noSession = () => { h.actor = Response.json({ error: "unauthorized", code: "unauthorized" }, { status: 401 }); };
const code = async (res: Response) => ((await res.json()) as { code?: string; error?: string }).code ?? "";
const answer = async (res: Response) => { const j = (await res.json()) as { code?: string; error?: string }; return [res.status, j.code ?? j.error]; };
const libCalls = () => h.request.mock.calls.length + h.retry.mock.calls.length + h.summary.mock.calls.length + h.lead.mock.calls.length + h.resolve.mock.calls.length;
const off = () => vi.stubEnv("CATERING_REFUNDS", "");

const confirmPath = `/api/catering/quotes/${Q}/refunds`;
const retryPath = `${confirmPath}/${R}/retry`;
const dispPath = `${confirmPath}/disposition`;
const leadPath = `/api/catering/pipeline/${Q}/refunds`;
const qctx = (id = Q) => ({ params: Promise.resolve({ id }) });
const rctx = (id = Q, requestId = R) => ({ params: Promise.resolve({ id, requestId }) });

beforeEach(() => {
  vi.stubEnv("CATERING_REFUNDS", "1");
  for (const f of [h.session, h.request, h.retry, h.summary, h.lead, h.resolve]) f.mockReset();
  h.session.mockImplementation(async () => h.actor);
  h.request.mockResolvedValue({ replay: false, results: [] });
  h.retry.mockResolvedValue({ id: R, status: "succeeded" });
  h.summary.mockResolvedValue({ quoteId: Q });
  h.lead.mockResolvedValue([]);
  h.resolve.mockResolvedValue({ result: "resolved", state: "closed", generation: 4 });
  as("catering_mgr");
});
afterEach(() => vi.unstubAllEnvs());

describe("POST /refunds — the confirm tap", () => {
  const path = confirmPath;
  const ctx = qctx();

  it("refuses a cross-origin POST before the session", async () => {
    const res = await POST(post(path, BODY, "https://evil.test"), ctx);
    expect(res.status).toBe(403);
    expect(h.session).not.toHaveBeenCalled();
  });
  it("switch off: 503 refunds_off, the lib never called", async () => {
    off();
    const res = await POST(post(path, "{not json"), ctx);
    expect([res.status, await code(res)]).toEqual([503, "refunds_off"]);
    expect(h.request).not.toHaveBeenCalled();
  });
  it("a bad body is 400 by name; `other` without a note is note_required", async () => {
    expect(await code(await POST(post(path, { ...BODY, extra: 1 }), ctx))).toBe("invalid_request");
    expect(await code(await POST(post(path, { ...BODY, reasonCode: "other" }), ctx))).toBe("note_required");
    expect(await code(await POST(post(path, { ...BODY, amountCents: 1.5 }), ctx))).toBe("invalid_amount");
    // Review r1: "Full" is sent as the confirmed number; no amount is never "everything".
    expect(await code(await POST(post(path, { ...BODY, amountCents: null }), ctx))).toBe("invalid_amount");
    expect(h.request).not.toHaveBeenCalled();
  });
  it("a prep manager / social media manager / shift lead and below is refused by ROLE before the password is asked for", async () => {
    for (const role of ["prep_mgr", "social_media_mgr", "shift_lead", "key_holder", "trainer", "employee"]) {
      as(role, false);
      const res = await POST(post(path, BODY), ctx);
      expect([res.status, await code(res)]).toEqual([403, "forbidden"]);
      // …and a fresh password does not change a role refusal.
      as(role, true);
      expect(await code(await POST(post(path, BODY), ctx))).toBe("forbidden");
    }
    expect(h.request).not.toHaveBeenCalled();
  });
  it("Juan 2026-11-25: a GM and an AGM pass the role gate and reach the Tier B password, like every other refunder", async () => {
    for (const role of ["gm", "agm", "catering_mgr", "moo", "owner", "cgs"]) {
      h.request.mockClear();
      as(role, false);
      const stale = await POST(post(path, BODY), ctx);
      expect([role, stale.status, await code(stale)]).toEqual([role, 403, "step_up_required"]);
      expect(h.request).not.toHaveBeenCalled();
      as(role, true);
      expect((await POST(post(path, BODY), ctx)).status).toBe(200);
      expect(h.request).toHaveBeenCalledTimes(1);
    }
  });
  it("the switch still comes first for a GM: off = 503 refunds_off, nothing asked", async () => {
    off();
    as("gm", true);
    const res = await POST(post(path, BODY), ctx);
    expect([res.status, await code(res)]).toEqual([503, "refunds_off"]);
    expect(h.request).not.toHaveBeenCalled();
  });
  it("Tier B: no fresh password = step_up_required, and nothing is refunded", async () => {
    as("catering_mgr", false);
    const res = await POST(post(path, BODY), ctx);
    expect([res.status, await code(res)]).toEqual([403, "step_up_required"]);
    expect(h.request).not.toHaveBeenCalled();
  });
  it("with everything in order the lib is asked once, with the parsed body and NOTHING else (the lib computes its own deadline)", async () => {
    const res = await POST(post(path, BODY), ctx);
    expect(res.status).toBe(200);
    expect(h.request).toHaveBeenCalledTimes(1);
    expect(h.request.mock.calls[0]!).toHaveLength(3);
    expect(h.request.mock.calls[0]![1]).toBe(Q);
    expect(h.request.mock.calls[0]![2]).toEqual({ ...BODY, reasonNote: null });
  });
  it("a lib refusal passes through by name and status", async () => {
    const { CateringRefundError } = await import("@/lib/catering/refunds");
    h.request.mockRejectedValueOnce(new CateringRefundError(409, "over_refundable", { refundableCents: 500 }));
    const res = await POST(post(path, BODY), ctx);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "over_refundable", refundableCents: 500 });
  });
  it("a B1 admission refusal (no live epoch) passes through by name, and the summary is not re-read", async () => {
    const { CateringRefundError } = await import("@/lib/catering/refunds");
    h.request.mockRejectedValueOnce(new CateringRefundError(503, "refunds_recovering"));
    expect(await answer(await POST(post(path, BODY), ctx))).toEqual([503, "refunds_recovering"]);
    expect(h.summary).not.toHaveBeenCalled();
  });
  it("the path is a step-up surface (its own requireSession keeps the unlock); the retry path is not", () => {
    expect(isStepUpSurface(path)).toBe(true);
    expect(isStepUpSurface(`${path}/${R}/retry`)).toBe(false);
    expect(isStepUpSurface(`/api/catering/quotes/${Q}/refundsx`)).toBe(false);
  });
  it("the route budget is explicit: maxDuration 120 s (plan B1.6)", async () => {
    expect((await import("@/app/api/catering/quotes/[id]/refunds/route")).maxDuration).toBe(120);
  });
});

describe("POST /refunds/[requestId]/retry", () => {
  const path = retryPath;
  it("no step-up needed, but the role gate holds and the switch is first", async () => {
    as("catering_mgr", false);
    expect((await RETRY(post(path, {}), rctx())).status).toBe(200);
    as("prep_mgr", true);
    expect((await RETRY(post(path, {}), rctx())).status).toBe(403);
    off();
    expect(await code(await RETRY(post(path, {}), rctx()))).toBe("refunds_off");
    expect(h.retry).toHaveBeenCalledTimes(1);
  });
  it("Juan 2026-11-25: a GM and an AGM retry, check and release without a password; the refused roles never reach the lib", async () => {
    for (const role of ["gm", "agm"]) {
      h.retry.mockClear();
      as(role, false); // no fresh password: the retry path takes no tier
      expect((await RETRY(post(path, {}), rctx())).status).toBe(200);
      expect(h.retry.mock.calls[0]![4]).toBe("retry");
      expect((await RETRY(post(path, { release: true }), rctx())).status).toBe(200);
      expect(h.retry.mock.calls[1]![4]).toBe("release");
      expect((await RETRY(post(path, { release: true, staffVerified: true }), rctx())).status).toBe(200);
      expect(h.retry.mock.calls[2]!.slice(4)).toEqual(["release", true]);
    }
    h.retry.mockClear();
    for (const role of ["prep_mgr", "social_media_mgr", "shift_lead", "employee"]) {
      as(role, true);
      const res = await RETRY(post(path, {}), rctx());
      expect([res.status, await code(res)]).toEqual([403, "forbidden"]);
      expect((await RETRY(post(path, { release: true }), rctx())).status).toBe(403);
    }
    expect(h.retry).not.toHaveBeenCalled();
  });
  it("the body matrix: {} | { release: true } | { release: true, staffVerified: true }; the mode and the verification reach the lib exactly", async () => {
    const good: Array<[unknown, string, boolean]> = [[{}, "retry", false], [{ release: true }, "release", false], [{ release: true, staffVerified: true }, "release", true]];
    for (const [body, mode, verified] of good) {
      h.retry.mockClear();
      expect((await RETRY(post(path, body), rctx())).status).toBe(200);
      const call = h.retry.mock.calls[0]!;
      // retryRefundRequest(ctx, quoteId, requestId, nowMs, mode, staffVerified): no deadline from the route.
      expect(call).toHaveLength(6);
      expect([call[1], call[2], typeof call[3], call[4], call[5]]).toEqual([Q, R, "number", mode, verified]);
    }
    h.retry.mockClear();
    const bad: unknown[] = [
      { release: false }, { release: "yes" }, { other: 1 }, [1], "7", 0,
      { staffVerified: true }, { release: true, staffVerified: false }, { release: true, staffVerified: "true" },
      { staffVerified: false }, { release: true, staffVerified: true, extra: 1 }, { release: null },
    ];
    for (const body of bad) {
      expect([JSON.stringify(body), ...await answer(await RETRY(post(path, body), rctx()))]).toEqual([JSON.stringify(body), 400, "invalid_request"]);
    }
    // A body that is not JSON at all is the shared parser's refusal.
    expect(await answer(await RETRY(post(path, "{nope"), rctx()))).toEqual([400, "invalid_json"]);
    expect(h.retry).not.toHaveBeenCalled();
  });
  it("ids that are not uuids are 400", async () => {
    expect((await RETRY(post(`/api/catering/quotes/x/refunds/y/retry`, {}), rctx("x", "y"))).status).toBe(400);
  });
  it("a lib refusal passes through by name (staff_verification_required, not_releasable)", async () => {
    const { CateringRefundError } = await import("@/lib/catering/refunds");
    h.retry.mockRejectedValueOnce(new CateringRefundError(409, "staff_verification_required"));
    expect(await answer(await RETRY(post(path, { release: true }), rctx()))).toEqual([409, "staff_verification_required"]);
    h.retry.mockRejectedValueOnce(new CateringRefundError(409, "not_releasable"));
    expect(await answer(await RETRY(post(path, { release: true, staffVerified: true }), rctx()))).toEqual([409, "not_releasable"]);
    expect(h.summary).not.toHaveBeenCalled();
  });
  it("the route budget is explicit: maxDuration 120 s (plan B1.6)", async () => {
    expect((await import("@/app/api/catering/quotes/[id]/refunds/[requestId]/retry/route")).maxDuration).toBe(120);
  });
});

describe("GETs", () => {
  it("the quote summary: switch first, then the read floor", async () => {
    as("employee");
    expect((await GET(get(confirmPath), qctx())).status).toBe(403);
    as("shift_lead");
    expect((await GET(get(confirmPath), qctx())).status).toBe(200);
    off();
    expect(await code(await GET(get(confirmPath), qctx()))).toBe("refunds_off");
    expect(h.summary).toHaveBeenCalledTimes(1);
  });
  it("quote_get_reads_only: the GET calls ONLY loadRefundSummary (stored state), once, and nothing that can mutate or reach Stripe", async () => {
    as("shift_lead");
    const res = await GET(get(confirmPath), qctx());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ summary: { quoteId: Q } });
    expect(h.summary).toHaveBeenCalledTimes(1);
    expect(h.summary.mock.calls[0]!.slice(1)).toEqual([Q]);
    expect([h.request, h.retry, h.resolve, h.lead].map((f) => f.mock.calls.length)).toEqual([0, 0, 0, 0]);
  });
  it("the lead banner read: one call of the stored batch read, nothing else", async () => {
    as("shift_lead");
    const res = await LEAD_GET(get(leadPath), qctx());
    expect(res.status).toBe(200);
    expect(h.lead).toHaveBeenCalledTimes(1);
    expect([h.request, h.retry, h.resolve, h.summary].map((f) => f.mock.calls.length)).toEqual([0, 0, 0, 0]);
    off();
    expect((await LEAD_GET(get(leadPath), qctx())).status).toBe(503);
  });
});

describe("confirm_and_retry_reload_stored_summary", () => {
  it("confirm_and_retry_reload_stored_summary: Confirm and Retry answer with the reloaded stored summary, one mutation each, and a failing reload is still ok with summary null", async () => {
    const stored = { quoteId: Q, epoch: { state: "live" }, issues: [] };
    h.summary.mockResolvedValue(stored);
    h.request.mockResolvedValue({ replay: false, results: [{ id: R, status: "succeeded" }] });
    const c = await POST(post(confirmPath, BODY), qctx());
    expect([c.status, await c.json()]).toEqual([200, { ok: true, replay: false, results: [{ id: R, status: "succeeded" }], summary: stored }]);
    expect([h.request.mock.calls.length, h.summary.mock.calls.length]).toEqual([1, 1]);
    const r = await RETRY(post(retryPath, {}), rctx());
    expect([r.status, await r.json()]).toEqual([200, { ok: true, result: { id: R, status: "succeeded" }, summary: stored }]);
    expect([h.request.mock.calls.length, h.retry.mock.calls.length, h.summary.mock.calls.length]).toEqual([1, 1, 2]);
    // The reload asks for this order only, after the mutation.
    expect(h.summary.mock.calls.map((x) => x[1])).toEqual([Q, Q]);
    expect(h.request.mock.invocationCallOrder[0]!).toBeLessThan(h.summary.mock.invocationCallOrder[0]!);
    expect(h.retry.mock.invocationCallOrder[0]!).toBeLessThan(h.summary.mock.invocationCallOrder[1]!);

    // The reload fails: the mutation's result stands, the summary is null, and nothing is asked a second time.
    h.summary.mockRejectedValue(new Error("summary read failed"));
    const c2 = await POST(post(confirmPath, BODY), qctx());
    expect([c2.status, await c2.json()]).toEqual([200, { ok: true, replay: false, results: [{ id: R, status: "succeeded" }], summary: null }]);
    const r2 = await RETRY(post(retryPath, { release: true, staffVerified: true }), rctx());
    expect([r2.status, await r2.json()]).toEqual([200, { ok: true, result: { id: R, status: "succeeded" }, summary: null }]);
    expect([h.request.mock.calls.length, h.retry.mock.calls.length, h.summary.mock.calls.length]).toEqual([2, 2, 4]);
    expect(h.resolve).not.toHaveBeenCalled();
  });
});

// ── The order of checks, pinned per route, switch ON and OFF ──────────────────────────────────────────────
// Each row stacks EVERY later failure under the one being tested: only the first gate in the contract may answer.
describe("the order of checks — every route, switch ON and OFF", () => {
  type Row = { name: string; setup: () => void; req: () => Promise<Response>; on: [number, string]; off?: [number, string]; session?: boolean };

  const confirmRows: Row[] = [
    { name: "bad origin (+ no session, bad body, bad id)", setup: () => noSession(), req: () => POST(post(`/api/catering/quotes/x/refunds`, "{bad", "https://evil.test"), qctx("x")), on: [403, "bad_origin"], off: [403, "bad_origin"], session: false },
    { name: "no origin header at all", setup: () => as("catering_mgr"), req: () => POST(post(confirmPath, BODY, null), qctx()), on: [403, "bad_origin"], off: [403, "bad_origin"], session: false },
    { name: "no session (+ bad body, bad id)", setup: () => noSession(), req: () => POST(post(`/api/catering/quotes/x/refunds`, "{bad"), qctx("x")), on: [401, "unauthorized"], off: [401, "unauthorized"] },
    { name: "switch (+ malformed body, bad id, wrong role, stale)", setup: () => as("employee", false), req: () => POST(post(`/api/catering/quotes/x/refunds`, "{bad"), qctx("x")), on: [400, "invalid_json"], off: [503, "refunds_off"] },
    { name: "strict body (+ bad id, wrong role, stale)", setup: () => as("employee", false), req: () => POST(post(`/api/catering/quotes/x/refunds`, { ...BODY, extra: 1 }), qctx("x")), on: [400, "invalid_request"], off: [503, "refunds_off"] },
    { name: "id (+ wrong role, stale)", setup: () => as("employee", false), req: () => POST(post(`/api/catering/quotes/x/refunds`, BODY), qctx("x")), on: [400, "invalid_request"], off: [503, "refunds_off"] },
    { name: "role (+ stale)", setup: () => as("prep_mgr", false), req: () => POST(post(confirmPath, BODY), qctx()), on: [403, "forbidden"], off: [503, "refunds_off"] },
    { name: "Tier B", setup: () => as("gm", false), req: () => POST(post(confirmPath, BODY), qctx()), on: [403, "step_up_required"], off: [503, "refunds_off"] },
    { name: "the lib", setup: () => as("gm", true), req: () => POST(post(confirmPath, BODY), qctx()), on: [200, ""], off: [503, "refunds_off"] },
  ];
  const retryRows: Row[] = [
    { name: "bad origin (+ no session, bad ids, bad body)", setup: () => noSession(), req: () => RETRY(post(`/api/catering/quotes/x/refunds/y/retry`, "{bad", "https://evil.test"), rctx("x", "y")), on: [403, "bad_origin"], off: [403, "bad_origin"], session: false },
    { name: "no session (+ bad ids, bad body)", setup: () => noSession(), req: () => RETRY(post(`/api/catering/quotes/x/refunds/y/retry`, "{bad"), rctx("x", "y")), on: [401, "unauthorized"], off: [401, "unauthorized"] },
    { name: "switch (+ bad ids, malformed body, wrong role)", setup: () => as("employee"), req: () => RETRY(post(`/api/catering/quotes/x/refunds/y/retry`, "{bad"), rctx("x", "y")), on: [400, "invalid_request"], off: [503, "refunds_off"] },
    { name: "ids (+ malformed body, wrong role)", setup: () => as("employee"), req: () => RETRY(post(`/api/catering/quotes/${Q}/refunds/y/retry`, "{bad"), rctx(Q, "y")), on: [400, "invalid_request"], off: [503, "refunds_off"] },
    { name: "JSON (+ wrong role)", setup: () => as("employee"), req: () => RETRY(post(retryPath, "{bad"), rctx()), on: [400, "invalid_json"], off: [503, "refunds_off"] },
    { name: "strict body (+ wrong role)", setup: () => as("employee"), req: () => RETRY(post(retryPath, { staffVerified: true }), rctx()), on: [400, "invalid_request"], off: [503, "refunds_off"] },
    { name: "role", setup: () => as("prep_mgr", true), req: () => RETRY(post(retryPath, {}), rctx()), on: [403, "forbidden"], off: [503, "refunds_off"] },
    { name: "the lib, with NO tier (a stale unlock passes)", setup: () => as("agm", false), req: () => RETRY(post(retryPath, { release: true, staffVerified: true }), rctx()), on: [200, ""], off: [503, "refunds_off"] },
  ];
  const dispRows: Row[] = [
    { name: "bad origin (+ no session, bad body, bad id)", setup: () => noSession(), req: () => DISPOSITION(post(`/api/catering/quotes/x/refunds/disposition`, "{bad", "https://evil.test"), qctx("x")), on: [403, "bad_origin"], off: [403, "bad_origin"], session: false },
    { name: "no session (+ bad body)", setup: () => noSession(), req: () => DISPOSITION(post(dispPath, "{bad"), qctx()), on: [401, "unauthorized"], off: [401, "unauthorized"] },
    { name: "switch (+ malformed body, bad id, wrong role, stale)", setup: () => as("gm", false), req: () => DISPOSITION(post(`/api/catering/quotes/x/refunds/disposition`, "{bad"), qctx("x")), on: [400, "invalid_json"], off: [503, "refunds_off"] },
    { name: "strict body (+ bad id, wrong role, stale)", setup: () => as("gm", false), req: () => DISPOSITION(post(`/api/catering/quotes/x/refunds/disposition`, { ...DISP, extra: 1 }), qctx("x")), on: [400, "invalid_request"], off: [503, "refunds_off"] },
    { name: "evidence_required (+ bad id, wrong role)", setup: () => as("gm", false), req: () => DISPOSITION(post(`/api/catering/quotes/x/refunds/disposition`, { ...DISP, evidenceRef: null }), qctx("x")), on: [400, "evidence_required"], off: [503, "refunds_off"] },
    { name: "id (+ wrong role, stale)", setup: () => as("gm", false), req: () => DISPOSITION(post(`/api/catering/quotes/x/refunds/disposition`, DISP), qctx("x")), on: [400, "invalid_request"], off: [503, "refunds_off"] },
    { name: "role (+ stale)", setup: () => as("catering_mgr", false), req: () => DISPOSITION(post(dispPath, DISP), qctx()), on: [403, "forbidden"], off: [503, "refunds_off"] },
    { name: "Tier B", setup: () => as("moo", false), req: () => DISPOSITION(post(dispPath, DISP), qctx()), on: [403, "step_up_required"], off: [503, "refunds_off"] },
    { name: "the lib", setup: () => as("moo", true), req: () => DISPOSITION(post(dispPath, DISP), qctx()), on: [200, ""], off: [503, "refunds_off"] },
  ];
  const getRows: Row[] = [
    { name: "quote GET: no session", setup: () => noSession(), req: () => GET(get(`/api/catering/quotes/x/refunds`), qctx("x")), on: [401, "unauthorized"], off: [401, "unauthorized"] },
    { name: "quote GET: switch (+ floor, bad id)", setup: () => as("employee"), req: () => GET(get(`/api/catering/quotes/x/refunds`), qctx("x")), on: [403, "forbidden"], off: [503, "refunds_off"] },
    { name: "quote GET: floor (+ bad id)", setup: () => as("employee"), req: () => GET(get(`/api/catering/quotes/x/refunds`), qctx("x")), on: [403, "forbidden"], off: [503, "refunds_off"] },
    { name: "quote GET: id", setup: () => as("shift_lead"), req: () => GET(get(`/api/catering/quotes/x/refunds`), qctx("x")), on: [400, "invalid_request"], off: [503, "refunds_off"] },
    { name: "quote GET: the lib", setup: () => as("shift_lead"), req: () => GET(get(confirmPath), qctx()), on: [200, ""], off: [503, "refunds_off"] },
    { name: "lead GET: no session", setup: () => noSession(), req: () => LEAD_GET(get(`/api/catering/pipeline/x/refunds`), qctx("x")), on: [401, "unauthorized"], off: [401, "unauthorized"] },
    { name: "lead GET: floor (+ bad id)", setup: () => as("employee"), req: () => LEAD_GET(get(`/api/catering/pipeline/x/refunds`), qctx("x")), on: [403, "forbidden"], off: [503, "refunds_off"] },
    { name: "lead GET: id", setup: () => as("shift_lead"), req: () => LEAD_GET(get(`/api/catering/pipeline/x/refunds`), qctx("x")), on: [400, "invalid_request"], off: [503, "refunds_off"] },
    { name: "lead GET: the lib", setup: () => as("shift_lead"), req: () => LEAD_GET(get(leadPath), qctx()), on: [200, ""], off: [503, "refunds_off"] },
  ];

  for (const [label, rows] of [["confirm", confirmRows], ["retry", retryRows], ["disposition", dispRows], ["GETs", getRows]] as const) {
    for (const sw of ["ON", "OFF"] as const) {
      it(`${label}, switch ${sw}: each gate answers in contract order`, async () => {
        for (const row of rows) {
          for (const f of [h.session, h.request, h.retry, h.summary, h.lead, h.resolve]) f.mockClear();
          if (sw === "OFF") off(); else vi.stubEnv("CATERING_REFUNDS", "1");
          row.setup();
          const res = await row.req();
          const [status, c] = sw === "ON" ? row.on : row.off!;
          expect([row.name, ...await answer(res).then(([s, k]) => [s, s === 200 ? "" : k])]).toEqual([row.name, status, c]);
          // The session is asked unless same-origin refused first; the lib is reached only on the last row ON.
          expect([row.name, h.session.mock.calls.length]).toEqual([row.name, row.session === false ? 0 : 1]);
          if (status !== 200) expect([row.name, libCalls()]).toEqual([row.name, 0]);
          if (sw === "OFF") expect([row.name, libCalls()]).toEqual([row.name, 0]);
          // The session is read on the route's OWN path.
          if (row.session !== false) expect(String(h.session.mock.calls[0]![1])).toMatch(/^\/api\/catering\/(quotes|pipeline)\/[^/]+\/refunds(\/[^/]+\/retry|\/disposition)?$/);
        }
      });
    }
  }
});

// ── each_dark_pr_matches_main_off (routes half) ───────────────────────────────────────────────────────────
describe("each_dark_pr_matches_main_off", () => {
  type Pair = { name: string; branch: () => Promise<Response>; main: () => Promise<Response> };
  const actors: Array<[string, () => void]> = [
    ["no session", noSession], ["employee", () => as("employee")], ["shift_lead", () => as("shift_lead")], ["prep_mgr", () => as("prep_mgr", true)],
    ["catering_mgr stale", () => as("catering_mgr", false)], ["gm fresh", () => as("gm", true)], ["moo fresh", () => as("moo", true)], ["owner stale", () => as("owner", false)],
  ];
  const confirmBodies: unknown[] = [BODY, "{not json", { ...BODY, extra: 1 }, { ...BODY, amountCents: null }, null, []];
  const retryBodies: unknown[] = [{}, { release: true }, { release: true, staffVerified: true }, { staffVerified: true }, "{not json", { release: false }];
  const pairs: Pair[] = [];
  for (const origin of [ORIGIN, "https://evil.test", null]) {
    for (const body of confirmBodies) {
      for (const id of [Q, "x"]) {
        pairs.push({ name: `confirm ${origin} ${JSON.stringify(body)} ${id}`, branch: () => POST(post(`/api/catering/quotes/${id}/refunds`, body ?? "null", origin), qctx(id)), main: () => MAIN_POST(post(`/api/catering/quotes/${id}/refunds`, body ?? "null", origin), qctx(id)) });
      }
    }
    for (const body of retryBodies) {
      for (const [id, rid] of [[Q, R], [Q, "y"], ["x", R]] as const) {
        pairs.push({ name: `retry ${origin} ${JSON.stringify(body)} ${id}/${rid}`, branch: () => RETRY(post(`/api/catering/quotes/${id}/refunds/${rid}/retry`, body, origin), rctx(id, rid)), main: () => MAIN_RETRY(post(`/api/catering/quotes/${id}/refunds/${rid}/retry`, body, origin), rctx(id, rid)) });
      }
    }
  }
  for (const id of [Q, "x"]) {
    pairs.push({ name: `quote GET ${id}`, branch: () => GET(get(`/api/catering/quotes/${id}/refunds`), qctx(id)), main: () => MAIN_GET(get(`/api/catering/quotes/${id}/refunds`), qctx(id)) });
    pairs.push({ name: `lead GET ${id}`, branch: () => LEAD_GET(get(`/api/catering/pipeline/${id}/refunds`), qctx(id)), main: () => MAIN_LEAD_GET(get(`/api/catering/pipeline/${id}/refunds`), qctx(id)) });
  }

  it("each_dark_pr_matches_main_off: with the switch OFF, every route file answers main's status and body for the fixed matrix, with main's dependency trace", async () => {
    off();
    let compared = 0;
    for (const [who, setActor] of actors) {
      for (const p of pairs) {
        const run = async (fn: () => Promise<Response>) => {
          for (const f of [h.session, h.request, h.retry, h.summary, h.lead, h.resolve]) f.mockClear();
          setActor();
          const res = await fn();
          return { status: res.status, body: await res.text(), session: h.session.mock.calls.map((c) => c[1]), lib: libCalls() };
        };
        const mine = await run(p.branch);
        const theirs = await run(p.main);
        expect([who, p.name, mine]).toEqual([who, p.name, theirs]);
        expect([who, p.name, mine.lib]).toEqual([who, p.name, 0]);
        compared += 1;
      }
    }
    expect(compared).toBe(actors.length * pairs.length);
  });

  it("each_dark_pr_matches_main_off: the new disposition route has no main twin and is 503 refunds_off for every session-holding request, INERT (zero lib calls)", async () => {
    off();
    for (const [who, setActor] of actors) {
      if (who === "no session") continue;
      for (const body of [DISP, "{not json", { ...DISP, evidenceRef: null }, { nope: 1 }, null]) {
        for (const id of [Q, "x"]) {
          for (const f of [h.session, h.request, h.retry, h.summary, h.lead, h.resolve]) f.mockClear();
          setActor();
          const res = await DISPOSITION(post(`/api/catering/quotes/${id}/refunds/disposition`, body ?? "null"), qctx(id));
          expect([who, JSON.stringify(body), id, ...await answer(res)]).toEqual([who, JSON.stringify(body), id, 503, "refunds_off"]);
          expect(libCalls()).toBe(0);
        }
      }
    }
  });
});
