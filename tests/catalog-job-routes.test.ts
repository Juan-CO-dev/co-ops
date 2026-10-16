import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createFakeDb, type Tables } from "./fixtures/counts-fake-db";
const h = vi.hoisted(() => ({ session: vi.fn(), step: vi.fn(() => ({ ok: true })) }));
let db: ReturnType<typeof createFakeDb>;
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => db.client }));
vi.mock("@/lib/session", () => ({ requireSession: h.session }));
vi.mock("@/lib/admin/step-up", () => ({ assertStepUp: h.step }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
import { POST } from "@/app/api/admin/skus/route";
const A = "11111111-1111-4111-8111-111111111111", B = "22222222-2222-4222-8222-222222222222";
let tables: Tables;
beforeEach(() => {
  tables = { vendor_items: [], locations: [A, B].map(id => ({ id, active: true })), vendors: [] };
  db = createFakeDb(tables);
  h.session.mockResolvedValue({ user: { id: "gm", role: "gm" }, locations: [A], level: 7 });
});
const post = (scope: Record<string, unknown>) => POST(new NextRequest("http://localhost/api/admin/skus", { method: "POST", body: JSON.stringify({ name: "New SKU", packFormat: "case", ...scope }) }));
it("omitted scope survives route parsing and infers the sole shop", async () => {
  const response = await post({});
  expect(response.status).toBe(201);
  expect(await response.json()).toMatchObject({ id: expect.any(String) });
  expect(tables.vendor_items![0]!.location_id).toBe(A);
  expect(h.step).toHaveBeenCalledWith(expect.anything(), "E");
});
it.each([[null, 403, "global_requires_moo"], [B, 404, "not_found"], [false, 400, "invalid_payload"]] as const)("route refuses scope %s before a write", async (locationId, status, code) => {
  const response = await post({ locationId });
  expect(response.status).toBe(status); expect(await response.json()).toMatchObject({ code });
  expect(db.writes).toEqual([]);
});
it("multi-shop omission is named and explicit global is available to MoO", async () => {
  h.session.mockResolvedValue({ user: { id: "gm", role: "gm" }, locations: [A, B], level: 7 });
  expect(await (await post({})).json()).toMatchObject({ code: "location_required" });
  h.session.mockResolvedValue({ user: { id: "moo", role: "moo" }, locations: [], level: 8 });
  const response = await post({ locationId: null });
  expect(response.status).toBe(201); expect(tables.vendor_items![0]!.location_id).toBeNull();
});
