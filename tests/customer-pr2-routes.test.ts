import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/session", () => ({ requireSession: vi.fn() }));
vi.mock("@/lib/admin/step-up", () => ({ assertStepUp: vi.fn() }));
vi.mock("@/lib/customers/customers", async (original) => ({
  ...await original<typeof import("@/lib/customers/customers")>(),
  customerProfilesEnabled: vi.fn(() => true), exportCustomers: vi.fn(), revokeProbableLink: vi.fn(),
}));
import { requireSession } from "@/lib/session";
import { assertStepUp } from "@/lib/admin/step-up";
import { exportCustomers, revokeProbableLink } from "@/lib/customers/customers";
import { POST as exportPost } from "@/app/api/admin/customers/export/route";
import { POST as operationPost } from "@/app/api/admin/customers/route";

const SHOP = "11111111-1111-4111-8111-111111111111";
const LINK = "22222222-2222-4222-8222-222222222222";
const params = { search: "", page: 1, sort: "recent", locationId: null, filters: { guests: false } };
const request = (body: unknown) => new NextRequest("http://localhost/api/admin/customers/export", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
function session(level: number) {
  vi.mocked(requireSession).mockResolvedValue({ user: { id: "owner" }, role: "owner", level, locations: [SHOP] } as never);
}
beforeEach(() => {
  vi.clearAllMocks(); session(9);
  vi.mocked(assertStepUp).mockReturnValue({ ok: true } as never);
  vi.mocked(exportCustomers).mockResolvedValue({ filename: "fixture.csv", csv: "header\r\n", count: 0 });
  vi.mocked(revokeProbableLink).mockResolvedValue({ revoked: true });
});
describe("export route server authority", () => {
  it.each([
    { kind: "marketing_email", params }, { kind: "meta_audience", params },
    { kind: "marketing_segment", params, widen: true }, { kind: "marketing_segment" },
    { kind: "marketing_segment", params: { ...params, level: 9 } },
    { kind: "marketing_segment", params: { ...params, filters: { override: true } } },
    { kind: "marketing_segment", params: { ...params, search: ["injected"] } },
  ])("rejects unrecognized payload %j", async (body) => {
    const response = await exportPost(request(body));
    expect(response.status).toBe(400);
    expect(exportCustomers).not.toHaveBeenCalled();
  });
  it.each([7, 8, 9])("reparses using session level %i, not client state", async (level) => {
    session(level);
    const response = await exportPost(request({ kind: "marketing_segment", params: {
      search: `  ${"a".repeat(90)} `, page: -10, sort: "bad", locationId: SHOP,
      filters: { guests: true, reachable: true, opted_in: false, min_visits: 5000 },
    } }));
    expect(response.status).toBe(200);
    expect(assertStepUp).toHaveBeenCalledWith(expect.objectContaining({ level }), "B");
    expect(vi.mocked(exportCustomers).mock.calls[0]?.[4]).toEqual({
      search: "a".repeat(80), page: 1, sort: "recent", locationId: level >= 8 ? SHOP : null,
      filters: { guests: true, min_visits: 1000, ...(level >= 9 ? { reachable: true, opted_in: false } : {}) },
    });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("step-up refusal prevents export", async () => {
    vi.mocked(assertStepUp).mockReturnValue({ ok: false, code: "step_up_required" } as never);
    expect((await exportPost(request({ kind: "marketing_segment", params }))).status).toBe(403);
    expect(exportCustomers).not.toHaveBeenCalled();
  });
});
describe("revoke operation route", () => {
  it("uses Tier A and only forwards the actor, link and request metadata", async () => {
    const response = await operationPost(request({ operation: "revoke_link", linkId: LINK }));
    expect(response.status).toBe(200);
    expect(assertStepUp).toHaveBeenCalledWith(expect.objectContaining({ level: 9 }), "A");
    expect(revokeProbableLink).toHaveBeenCalledWith({ userId: "owner", role: "owner", level: 9, locations: [SHOP] }, LINK, { ipAddress: null, userAgent: null });
  });
  it("rejects extra payload fields", async () => {
    expect((await operationPost(request({ operation: "revoke_link", linkId: LINK, name: "Private" }))).status).toBe(400);
    expect(revokeProbableLink).not.toHaveBeenCalled();
  });
});
