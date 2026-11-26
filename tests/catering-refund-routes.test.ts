/**
 * Catering refund routes — the order of the gates, over a mocked session and a mocked lib (the lib's flow is
 * tests/catering-refunds-flow.test.ts):
 *   POST /api/catering/quotes/[id]/refunds                         same-origin → session → switch → parse → role → Tier B → lib
 *   POST /api/catering/quotes/[id]/refunds/[requestId]/retry       same-origin → session → switch → ids → role → lib (no tier)
 *   GET  /api/catering/quotes/[id]/refunds, /api/catering/pipeline/[id]/refunds   session → switch → floor → lib
 * Switch off = 503 `refunds_off` with the body unread and the lib never called.
 */
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ actor: null as unknown, session: vi.fn(), request: vi.fn(), retry: vi.fn(), summary: vi.fn(), lead: vi.fn() }));
vi.mock("@/lib/session", async (original) => ({ ...await original<typeof import("@/lib/session")>(), requireSession: h.session }));
vi.mock("@/lib/catering/refunds", async () => {
  const shared = await import("@/lib/catering/refunds-shared");
  class CateringRefundError extends Error {
    constructor(public status: number, public code: string, public detail?: Record<string, unknown>) { super(code); }
  }
  return { ...shared, REFUND_READ_MIN: 5, CateringRefundError, requestRefund: h.request, retryRefundRequest: h.retry, loadRefundSummary: h.summary, loadLeadRefundables: h.lead };
});

import { isStepUpSurface } from "@/lib/session";
import { GET, POST } from "@/app/api/catering/quotes/[id]/refunds/route";
import { POST as RETRY } from "@/app/api/catering/quotes/[id]/refunds/[requestId]/retry/route";
import { GET as LEAD_GET } from "@/app/api/catering/pipeline/[id]/refunds/route";

const ORIGIN = "http://localhost";
const Q = "00000000-0000-4000-8000-0000000000b1";
const R = "00000000-0000-4000-8000-0000000000c1";
const BODY = { clientToken: "11111111-1111-4111-8111-111111111111", amountCents: 100000, reasonCode: "event_lost", reasonNote: null, trigger: "lost" };
const post = (path: string, body: unknown, origin: string | null = ORIGIN) =>
  new NextRequest(`${ORIGIN}${path}`, { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body), headers: { "content-type": "application/json", ...(origin ? { origin } : {}) } });
const as = (role: string, fresh = true) => {
  h.actor = { user: { id: "u1", role, active: true, language: "en" }, locations: [], session: { stepUpUnlocked: fresh, stepUpUnlockedAt: fresh ? new Date().toISOString() : null, catalogEditUnlockedAt: null } };
};
const code = async (res: Response) => ((await res.json()) as { code?: string }).code;

beforeEach(() => {
  vi.stubEnv("CATERING_REFUNDS", "1");
  for (const f of [h.session, h.request, h.retry, h.summary, h.lead]) f.mockReset();
  h.session.mockImplementation(async () => h.actor);
  h.request.mockResolvedValue({ replay: false, results: [] });
  h.retry.mockResolvedValue({ id: R, status: "succeeded" });
  h.summary.mockResolvedValue({ quoteId: Q });
  h.lead.mockResolvedValue([]);
  as("catering_mgr");
});
afterEach(() => vi.unstubAllEnvs());

describe("POST /refunds — the confirm tap", () => {
  const path = `/api/catering/quotes/${Q}/refunds`;
  const ctx = { params: Promise.resolve({ id: Q }) };

  it("refuses a cross-origin POST before the session", async () => {
    const res = await POST(post(path, BODY, "https://evil.test"), ctx);
    expect(res.status).toBe(403);
    expect(h.session).not.toHaveBeenCalled();
  });
  it("switch off: 503 refunds_off, the lib never called", async () => {
    vi.stubEnv("CATERING_REFUNDS", "");
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
    vi.stubEnv("CATERING_REFUNDS", "");
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
  it("with everything in order the lib is asked once, with the parsed body", async () => {
    const res = await POST(post(path, BODY), ctx);
    expect(res.status).toBe(200);
    expect(h.request).toHaveBeenCalledTimes(1);
    expect(h.request.mock.calls[0]![2]).toEqual({ ...BODY, reasonNote: null });
  });
  it("a lib refusal passes through by name and status", async () => {
    const { CateringRefundError } = await import("@/lib/catering/refunds");
    h.request.mockRejectedValueOnce(new CateringRefundError(409, "over_refundable", { refundableCents: 500 }));
    const res = await POST(post(path, BODY), ctx);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "over_refundable", refundableCents: 500 });
  });
  it("the path is a step-up surface (its own requireSession keeps the unlock); the retry path is not", () => {
    expect(isStepUpSurface(path)).toBe(true);
    expect(isStepUpSurface(`${path}/${R}/retry`)).toBe(false);
    expect(isStepUpSurface(`/api/catering/quotes/${Q}/refundsx`)).toBe(false);
  });
});

describe("POST /refunds/[requestId]/retry", () => {
  const path = `/api/catering/quotes/${Q}/refunds/${R}/retry`;
  it("no step-up needed, but the role gate holds and the switch is first", async () => {
    as("catering_mgr", false);
    expect((await RETRY(post(path, {}), { params: Promise.resolve({ id: Q, requestId: R }) })).status).toBe(200);
    as("prep_mgr", true);
    expect((await RETRY(post(path, {}), { params: Promise.resolve({ id: Q, requestId: R }) })).status).toBe(403);
    vi.stubEnv("CATERING_REFUNDS", "");
    expect(await code(await RETRY(post(path, {}), { params: Promise.resolve({ id: Q, requestId: R }) }))).toBe("refunds_off");
    expect(h.retry).toHaveBeenCalledTimes(1);
  });
  it("Juan 2026-11-25: a GM and an AGM retry, check and release without a password; the refused roles never reach the lib", async () => {
    const ctx = () => ({ params: Promise.resolve({ id: Q, requestId: R }) });
    for (const role of ["gm", "agm"]) {
      h.retry.mockClear();
      as(role, false); // no fresh password: the retry path takes no tier
      expect((await RETRY(post(path, {}), ctx())).status).toBe(200);
      expect(h.retry.mock.calls[0]![4]).toBe("retry");
      expect((await RETRY(post(path, { release: true }), ctx())).status).toBe(200);
      expect(h.retry.mock.calls[1]![4]).toBe("release");
    }
    h.retry.mockClear();
    for (const role of ["prep_mgr", "social_media_mgr", "shift_lead", "employee"]) {
      as(role, true);
      const res = await RETRY(post(path, {}), ctx());
      expect([res.status, await code(res)]).toEqual([403, "forbidden"]);
      expect((await RETRY(post(path, { release: true }), ctx())).status).toBe(403);
    }
    expect(h.retry).not.toHaveBeenCalled();
  });
  it("the body is {} or { release: true } (review r2), and the mode reaches the lib", async () => {
    const ctx = { params: Promise.resolve({ id: Q, requestId: R }) };
    expect((await RETRY(post(path, { release: true }), ctx)).status).toBe(200);
    expect(h.retry.mock.calls[0]![4]).toBe("release");
    expect((await RETRY(post(path, {}), { params: Promise.resolve({ id: Q, requestId: R }) })).status).toBe(200);
    expect(h.retry.mock.calls[1]![4]).toBe("retry");
    for (const bad of [{ release: false }, { release: "yes" }, { other: 1 }, [1]]) {
      expect((await RETRY(post(path, bad), { params: Promise.resolve({ id: Q, requestId: R }) })).status).toBe(400);
    }
  });
  it("ids that are not uuids are 400", async () => {
    expect((await RETRY(post(`/api/catering/quotes/x/refunds/y/retry`, {}), { params: Promise.resolve({ id: "x", requestId: "y" }) })).status).toBe(400);
  });
});

describe("GETs", () => {
  it("the quote summary: switch first, then the read floor", async () => {
    const ctx = { params: Promise.resolve({ id: Q }) };
    as("employee");
    expect((await GET(new NextRequest(`${ORIGIN}/api/catering/quotes/${Q}/refunds`), ctx)).status).toBe(403);
    as("shift_lead");
    expect((await GET(new NextRequest(`${ORIGIN}/api/catering/quotes/${Q}/refunds`), ctx)).status).toBe(200);
    vi.stubEnv("CATERING_REFUNDS", "");
    expect(await code(await GET(new NextRequest(`${ORIGIN}/api/catering/quotes/${Q}/refunds`), ctx))).toBe("refunds_off");
    expect(h.summary).toHaveBeenCalledTimes(1);
  });
  it("the lead banner read", async () => {
    as("shift_lead");
    const res = await LEAD_GET(new NextRequest(`${ORIGIN}/api/catering/pipeline/${Q}/refunds`), { params: Promise.resolve({ id: Q }) });
    expect(res.status).toBe(200);
    vi.stubEnv("CATERING_REFUNDS", "");
    expect((await LEAD_GET(new NextRequest(`${ORIGIN}/api/catering/pipeline/${Q}/refunds`), { params: Promise.resolve({ id: Q }) })).status).toBe(503);
  });
});
