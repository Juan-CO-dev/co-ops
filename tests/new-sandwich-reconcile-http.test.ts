import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { ShopOwnedError } from "@/lib/catalog/shop-owned-shared";
const m = vi.hoisted(() => ({ session: vi.fn(), reconcile: vi.fn(), step: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireSession: m.session }));
vi.mock("@/lib/catalog/new-sandwich", () => ({ reconcileNewSandwich: m.reconcile }));
vi.mock("@/lib/admin/step-up", () => ({ assertStepUp: m.step }));
import { POST } from "../app/api/admin/catalog/jobs/new-sandwich/reconcile/route";
const id = "11111111-1111-4111-8111-111111111111";
const actor = { level: 7, user: { id, role: "gm", language: "en" }, locations: [id] };
const body = { attemptKey: id, shopId: id, ownerLocationId: id, name: "Sandwich" };
const call = (raw = JSON.stringify(body)) => POST(new NextRequest("http://localhost/api/admin/catalog/jobs/new-sandwich/reconcile", { method: "POST", body: raw }));
beforeEach(() => { vi.clearAllMocks(); m.session.mockResolvedValue(actor); m.reconcile.mockResolvedValue({ matched: true, menuItemId: id }); });
it("reads without origin or step-up and returns only matched identity", async () => {
  const response = await call(); expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ matched: true, menuItemId: id });
  expect(m.reconcile).toHaveBeenCalledWith(actor, body); expect(m.step).not.toHaveBeenCalled();
});
it.each([6, 5])("refuses role level %i before the reader", async level => {
  m.session.mockResolvedValue({ ...actor, level }); expect((await call()).status).toBe(403); expect(m.reconcile).not.toHaveBeenCalled();
});
it("refuses SMM and unauthenticated callers", async () => {
  m.session.mockResolvedValue({ ...actor, user: { ...actor.user, role: "social_media_mgr" } }); expect((await call()).status).toBe(403);
  m.session.mockResolvedValue(new Response(null, { status: 401 })); expect((await call()).status).toBe(401); expect(m.reconcile).not.toHaveBeenCalled();
});
it.each(["{", "null", "[]"])("refuses malformed body %s", async raw => { expect((await call(raw)).status).toBe(400); expect(m.reconcile).not.toHaveBeenCalled(); });
it("returns normal name_taken without leaking another identity", async () => {
  m.reconcile.mockRejectedValue(new ShopOwnedError(409, "name_taken")); const response = await call();
  expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ code: "name_taken" });
});
it("keeps read failure distinct from an unmatched successful read", async () => {
  m.reconcile.mockRejectedValue(new Error("private database details")); const response = await call();
  expect(response.status).toBe(500); const result = await response.json(); expect(result.code).toBe("generic"); expect(JSON.stringify(result)).not.toContain("private database details");
});
