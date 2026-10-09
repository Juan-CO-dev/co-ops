import { beforeEach, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ session: vi.fn(), step: vi.fn(), save: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireSession: mocks.session }));
vi.mock("@/lib/admin/step-up", () => ({ assertStepUp: mocks.step }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => ({}) }));
vi.mock("@/lib/assignments", () => ({ saveStationTiming: mocks.save, AssignmentError: class extends Error {} }));
import { POST } from "@/app/api/admin/stations/route";
const body = { operation: "timing", locationId: "shop", stationId: "station", usuallyClosesAt: "14:00", trims: [{ at: "13:00", to_count: 1 }] };
const request = (data = body) => new Request("http://localhost/api/admin/stations", { method: "POST", body: JSON.stringify(data) }) as NextRequest;
beforeEach(() => { vi.clearAllMocks(); mocks.session.mockResolvedValue({ user: { id: "gm" }, role: "gm", level: 7, locations: ["shop"] }); mocks.step.mockReturnValue({ ok: true }); mocks.save.mockResolvedValue({ id: "station" }); });
it.each([3, 4, 5, 6])("rejects level %s before settings I/O", async level => {
  mocks.session.mockResolvedValue({ user: { id: "person" }, level });
  expect((await POST(request())).status).toBe(403); expect(mocks.save).not.toHaveBeenCalled();
});
it("requires Tier B step-up and passes validated configuration", async () => {
  mocks.step.mockReturnValue({ ok: false, code: "step_up_required" });
  expect((await POST(request())).status).toBe(403); expect(mocks.save).not.toHaveBeenCalled();
  mocks.step.mockReturnValue({ ok: true });
  expect((await POST(request())).status).toBe(200);
  expect(mocks.step).toHaveBeenLastCalledWith(expect.anything(), "B");
  expect(mocks.save).toHaveBeenCalledWith({}, expect.objectContaining({ trims: body.trims }));
});
it("rejects malformed trim schedules before I/O", async () => {
  expect((await POST(request({ ...body, trims: [{ at: "99:00", to_count: 1 }] }))).status).toBe(400);
  expect(mocks.save).not.toHaveBeenCalled();
});
