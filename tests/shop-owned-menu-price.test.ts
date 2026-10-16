import { beforeEach, expect, it, vi } from "vitest";
import { fakeSupabase, type FakeDb } from "./fake-supabase";
import type { AuthContext } from "@/lib/session";
import { NextRequest } from "next/server";
let db: FakeDb;
const h = vi.hoisted(() => ({ session: vi.fn(), step: vi.fn(() => ({ ok: true })) }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => db.client }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireSession: h.session }));
vi.mock("@/lib/admin/step-up", () => ({ assertStepUp: h.step }));
import { updateMenuPrice } from "@/lib/admin/menu-prices";
import { PATCH } from "@/app/api/admin/menu-items/[id]/price/route";
const ID = "33333333-3333-4333-8333-333333333333";
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const gm = { user: { id: "gm", role: "gm" }, locations: [A] } as AuthContext;
const owner = { user: { id: "owner", role: "owner" }, locations: [] } as unknown as AuthContext;
beforeEach(() => {
  db = fakeSupabase({ menu_items: [{ id: ID, location_id: A, active: true, menu_price: 10, catering_available: false }] });
  h.session.mockResolvedValue(gm); h.step.mockClear();
});
it("the owning GM writes a price through the route with Tier E", async () => {
  const response = await PATCH(new NextRequest(`http://localhost/api/admin/menu-items/${ID}/price`, { method: "PATCH", body: JSON.stringify({ menuPrice: 12, expectedMenuPrice: 10 }) }), { params: Promise.resolve({ id: ID }) });
  expect(response.status).toBe(200);
  expect(db.tables.menu_items![0]!.menu_price).toBe(12);
  expect(h.step).toHaveBeenCalledWith(gm, "E");
});
it.each([[null, "global_requires_moo"], [B, "not_found"]] as const)("GM refuses price owned by %s", async (scope, code) => {
  db.tables.menu_items![0]!.location_id = scope;
  await expect(updateMenuPrice(gm, ID, 12, 10)).rejects.toMatchObject({ code });
  expect(db.writes).toEqual([]);
});
it.each([null, A])("owner changed after authorization (%s) refuses the update", async before => {
  db.tables.menu_items![0]!.location_id = before;
  const from = db.client.from.bind(db.client);
  db.client.from = ((table: string) => {
    const q = from(table), update = q.update.bind(q);
    q.update = ((...args: Parameters<typeof update>) => { db.tables.menu_items![0]!.location_id = B; return update(...args); }) as typeof q.update;
    return q;
  }) as typeof db.client.from;
  await expect(updateMenuPrice(owner, ID, 12, 10)).rejects.toMatchObject({ status: 409 });
  expect(db.tables.menu_items![0]!.menu_price).toBe(10);
  expect(db.writes.every(w => w.matched === 0)).toBe(true);
});
