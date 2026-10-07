import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(), access: vi.fn(), openingAccess: vi.fn(), pin: vi.fn(),
  cashSubmit: vi.fn(), midDayCreate: vi.fn(), template: vi.fn(), openingSubmit: vi.fn(),
  service: {} as Record<string, unknown>,
}));
vi.mock("@/lib/session", () => ({ requireSession: mocks.session }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => mocks.service }));
vi.mock("@/lib/assignments", () => ({ hasTaskAccess: mocks.access }));
vi.mock("@/lib/auth-flows", () => ({ verifyActorPin: mocks.pin }));
vi.mock("@/lib/cash", () => ({ CASH_REPORT_BASE_LEVEL: 4, DENOMINATION_UNITS_CENTS: [], sumDenominations: () => 0, submitCashReport: mocks.cashSubmit }));
vi.mock("@/lib/prep", () => ({ AM_PREP_BASE_LEVEL: 3, PrepRoleViolationError: class extends Error {}, createMidDayPrepInstance: mocks.midDayCreate, resolveMidDayPrepTemplate: mocks.template }));
vi.mock("@/lib/opening", () => ({ OpeningError: class extends Error {}, canAccessOpeningInstance: mocks.openingAccess, submitPhase2Atomic: mocks.openingSubmit }));
vi.mock("@/app/api/opening/_helpers", () => ({ mapOpeningError: () => Response.json({ error: "opening_error" }, { status: 403 }) }));

import { POST as cashPost } from "@/app/api/cash/route";
import { POST as midDayPost } from "@/app/api/prep/mid-day/route";
import { POST as openingPost } from "@/app/api/opening/submit/phase2/route";

const SHOP = "11111111-1111-4111-8111-111111111111";
const OTHER_SHOP = "22222222-2222-4222-8222-222222222222";
const INSTANCE = "33333333-3333-4333-8333-333333333333";
const USER = "44444444-4444-4444-8444-444444444444";
const DATE = "2026-10-07";
const ctx = { user: { id: USER }, role: "employee", level: 3, locations: [SHOP] };
function req(body: unknown): NextRequest {
  return new Request("http://localhost/api/test", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) as NextRequest;
}
const cashBody = { locationId: SHOP, date: DATE, pin: "1234", projectedCents: 0, cashTipsCents: 0, countMethod: "hand", drawerTotalCents: 0 };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue(ctx);
  mocks.access.mockResolvedValue(false);
  mocks.openingAccess.mockResolvedValue(false);
  mocks.pin.mockResolvedValue(true);
  mocks.cashSubmit.mockResolvedValue({ ok: true, id: "cash-report" });
  mocks.template.mockResolvedValue({ id: "template", name: "Prep" });
  mocks.midDayCreate.mockResolvedValue({ ok: true, id: INSTANCE });
  mocks.openingSubmit.mockResolvedValue({ instance: { id: INSTANCE }, submittedCompletionIds: [], closingAutoCompleteId: null, editCount: 0, originalSubmissionId: null, underParNotificationIds: [] });
  const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: { id: INSTANCE, location_id: SHOP, status: "phase1_complete" }, error: null }) };
  mocks.service = { from: vi.fn(() => query) };
});

describe("actual API assignment gates for employees", () => {
  it.each([false, true])("KH cash task access=%s denies or reaches submit", async (assigned) => {
    mocks.session.mockResolvedValue({ ...ctx, role: "key_holder", level: 4 });
    mocks.access.mockResolvedValue(assigned);
    const response = await cashPost(req(cashBody));
    expect(response.status).toBe(assigned ? 200 : 403);
    expect(mocks.access).toHaveBeenCalledWith(mocks.service, { userId: USER, level: 4, locationId: SHOP, date: DATE, task: "cash_report" });
    expect(mocks.cashSubmit).toHaveBeenCalledTimes(assigned ? 1 : 0);
    expect(mocks.pin).toHaveBeenCalledTimes(assigned ? 1 : 0);
  });
  it.each([false, true])("mid-day assignment=%s denies or reaches instance creation", async (assigned) => {
    mocks.access.mockResolvedValue(assigned);
    const response = await midDayPost(req({ locationId: SHOP, date: DATE }));
    expect(response.status).toBe(assigned ? 200 : 403);
    expect(mocks.access).toHaveBeenCalledWith(mocks.service, { userId: USER, level: 3, locationId: SHOP, date: DATE, task: "mid_day_prep" });
    expect(mocks.midDayCreate).toHaveBeenCalledTimes(assigned ? 1 : 0);
    expect(mocks.template).toHaveBeenCalledTimes(assigned ? 1 : 0);
  });
  it.each([false, true])("opening assignment=%s denies or reaches phase-2 submit", async (assigned) => {
    mocks.openingAccess.mockResolvedValue(assigned);
    const response = await openingPost(req({ instanceId: INSTANCE }));
    expect(response.status).toBe(assigned ? 200 : 403);
    expect(mocks.openingAccess).toHaveBeenCalledWith(mocks.service, { instanceId: INSTANCE, actor: { userId: USER, role: "employee", level: 3 } });
    expect(mocks.openingSubmit).toHaveBeenCalledTimes(assigned ? 1 : 0);
  });
  it("an assignment never bypasses the route's location binding", async () => {
    mocks.session.mockResolvedValue({ ...ctx, locations: [OTHER_SHOP] });
    mocks.access.mockResolvedValue(true);
    mocks.openingAccess.mockResolvedValue(true);
    expect((await cashPost(req(cashBody))).status).toBe(403);
    expect((await midDayPost(req({ locationId: SHOP, date: DATE }))).status).toBe(403);
    expect((await openingPost(req({ instanceId: INSTANCE }))).status).toBe(403);
    expect(mocks.cashSubmit).not.toHaveBeenCalled();
    expect(mocks.midDayCreate).not.toHaveBeenCalled();
    expect(mocks.openingSubmit).not.toHaveBeenCalled();
    expect(mocks.access).not.toHaveBeenCalled();
    expect(mocks.openingAccess).not.toHaveBeenCalled();
  });
  it("cash still requires a valid PIN after the assignment gate", async () => {
    mocks.access.mockResolvedValue(true);
    mocks.pin.mockResolvedValue(false);
    expect((await cashPost(req(cashBody))).status).toBe(401);
    expect(mocks.cashSubmit).not.toHaveBeenCalled();
  });
});
