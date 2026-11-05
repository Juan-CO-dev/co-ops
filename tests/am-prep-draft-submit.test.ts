/**
 * Unit spine — CLEAR-ON-SUBMIT for the AM prep draft (migration 0214, Wave 1 branch A).
 *
 * Through the REAL POST /api/prep/submit handler, with its I/O mocked: a successful
 * original submission consumes the shop's draft for the instance's day; a failed submit
 * keeps it; a consume failure never turns a successful submit into an error; a C.46
 * chained update does not touch the draft.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/prep/submit/route";
import { consumeAmPrepDraft } from "@/lib/am-prep-draft";
import { PrepError, PrepClosingRefBusyError, PrepInstanceNotOpenError, submitAmPrep } from "@/lib/prep";
import { requireSession } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";

vi.mock("@/lib/session", () => ({ requireSession: vi.fn() }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));
vi.mock("@/lib/am-prep-draft", () => ({ consumeAmPrepDraft: vi.fn() }));
vi.mock("@/lib/prep", async () => {
  const actual = await vi.importActual<typeof import("@/lib/prep")>("@/lib/prep");
  return {
    ...actual,
    submitAmPrep: vi.fn(),
    resolveClosingReportRefItemId: vi.fn(async () => null),
    loadAssignmentForToday: vi.fn(async () => null),
  };
});

const SHOP_A = "11111111-1111-4111-8111-111111111111";
const INSTANCE = "33333333-3333-4333-8333-333333333333";
const SUBMISSION = "88888888-8888-4888-8888-888888888888";
const DAY = "2026-10-06";

const instanceRow = { id: INSTANCE, location_id: SHOP_A, date: DAY, status: "open", template_id: "tmpl" };

function serviceWithInstance() {
  const api = {
    select: () => api,
    eq: () => api,
    maybeSingle: async () => ({ data: instanceRow, error: null }),
  };
  return { from: () => api };
}

const req = (body: Record<string, unknown>) =>
  new NextRequest("https://example.com/api/prep/submit", {
    method: "POST",
    headers: { origin: "https://example.com", "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const okResult = {
  instance: { id: INSTANCE } as never,
  submittedCompletionIds: [],
  closingAutoCompleteId: null,
  editCount: 0,
  originalSubmissionId: null,
  skipped: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireSession).mockResolvedValue({
    user: { id: "u-kh" },
    role: "key_holder",
    level: 4,
    locations: [SHOP_A],
  } as never);
  vi.mocked(getServiceRoleClient).mockReturnValue(serviceWithInstance() as never);
  vi.mocked(consumeAmPrepDraft).mockResolvedValue(1);
});

describe("POST /api/prep/submit — the draft is consumed only by a successful submit", () => {
  it("success → consumeAmPrepDraft for the instance's shop and day, AFTER the submit", async () => {
    vi.mocked(submitAmPrep).mockResolvedValue(okResult);
    const res = await POST(req({ instanceId: INSTANCE, entries: [] }));
    expect(res.status).toBe(200);
    expect(consumeAmPrepDraft).toHaveBeenCalledOnce();
    expect(vi.mocked(consumeAmPrepDraft).mock.calls[0]![1]).toMatchObject({
      instanceId: INSTANCE,
      locationId: SHOP_A,
      businessDate: DAY,
      actor: expect.objectContaining({ locations: [SHOP_A] }),
    });
    const submitOrder = vi.mocked(submitAmPrep).mock.invocationCallOrder[0]!;
    const consumeOrder = vi.mocked(consumeAmPrepDraft).mock.invocationCallOrder[0]!;
    expect(consumeOrder).toBeGreaterThan(submitOrder);
  });

  it("failed submit → the draft is kept (consume never called)", async () => {
    vi.mocked(submitAmPrep).mockRejectedValue(new PrepInstanceNotOpenError(INSTANCE, "confirmed"));
    const res = await POST(req({ instanceId: INSTANCE, entries: [] }));
    expect(res.status).toBe(409);
    expect(consumeAmPrepDraft).not.toHaveBeenCalled();
  });

  it("maps a closing reference race to 409 retry copy and keeps the draft", async () => {
    vi.mocked(submitAmPrep).mockRejectedValue(new PrepClosingRefBusyError());
    const res = await POST(req({ instanceId: INSTANCE, entries: [] }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "prep_closing_ref_busy" });
    expect(consumeAmPrepDraft).not.toHaveBeenCalled();
  });

  it("a consume failure never turns a successful submit into an error", async () => {
    vi.mocked(submitAmPrep).mockResolvedValue(okResult);
    vi.mocked(consumeAmPrepDraft).mockRejectedValue(new Error("db down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await POST(req({ instanceId: INSTANCE, entries: [] }));
    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("a C.46 chained update leaves the draft alone", async () => {
    vi.mocked(submitAmPrep).mockResolvedValue({ ...okResult, editCount: 1, originalSubmissionId: SUBMISSION });
    const res = await POST(
      req({ instanceId: INSTANCE, entries: [], isUpdate: true, originalSubmissionId: SUBMISSION }),
    );
    expect(res.status).toBe(200);
    expect(consumeAmPrepDraft).not.toHaveBeenCalled();
  });
});

describe("0291 request identity route", () => {
  it.each([null, 42, "invalid", {}, ""])("rejects malformed key %j", async (clientRequestId) => {
    const res = await POST(req({ instanceId: INSTANCE, entries: [], clientRequestId }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "invalid_request_key" });
    expect(submitAmPrep).not.toHaveBeenCalled();
  });
  it("returns a replay and safely consumes the draft even if consuming fails", async () => {
    vi.mocked(submitAmPrep).mockResolvedValue({ ...okResult, replayed: true });
    vi.mocked(consumeAmPrepDraft).mockRejectedValue(new Error("unavailable"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await POST(req({ instanceId: INSTANCE, entries: [], clientRequestId: SUBMISSION, actor: "other" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ replayed: true });
    expect(submitAmPrep).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ clientRequestId: SUBMISSION, actor: expect.objectContaining({ userId: "u-kh" }) }));
    expect(consumeAmPrepDraft).toHaveBeenCalledOnce();
    spy.mockRestore();
  });
  it("maps a concurrent original SQL refusal to already_submitted 409", async () => {
    vi.mocked(submitAmPrep).mockRejectedValue(new PrepError("AM prep already submitted", "already_submitted"));
    const res = await POST(req({ instanceId: INSTANCE, entries: [], clientRequestId: SUBMISSION }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "already_submitted" });
    expect(consumeAmPrepDraft).not.toHaveBeenCalled();
  });
  it("maps key reuse to 409", async () => {
    vi.mocked(submitAmPrep).mockRejectedValue(new PrepError("reused", "prep_request_key_reused"));
    const res = await POST(req({ instanceId: INSTANCE, entries: [], clientRequestId: SUBMISSION }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "prep_request_key_reused" });
  });
  it("denies the wrong shop before the replay-capable library call", async () => {
    vi.mocked(requireSession).mockResolvedValue({ user: { id: "u-kh" }, role: "key_holder", level: 4, locations: [] } as never);
    expect((await POST(req({ instanceId: INSTANCE, entries: [], clientRequestId: SUBMISSION }))).status).toBe(403);
    expect(submitAmPrep).not.toHaveBeenCalled();
  });
});
