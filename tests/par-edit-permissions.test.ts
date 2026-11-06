import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { AuthContext } from "@/lib/session";
import { getRoleLevel, type RoleCode } from "@/lib/roles";
import { createFakeDb, type Tables } from "./fixtures/counts-fake-db";
import { parWriteGate } from "@/lib/par-permissions-shared";

const h = vi.hoisted(() => ({ db: vi.fn(), audit: vi.fn(), session: vi.fn() }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: h.db }));
vi.mock("@/lib/session", () => ({ requireSession: h.session }));
vi.mock("@/lib/audit", () => ({ audit: h.audit }));
vi.mock("@/lib/dynamic-pars-probes", () => ({ parAutoLaneReady: async () => true }));
import { upsertLocationSkuSettings } from "@/lib/admin/skus";
import { setItemPar } from "@/lib/admin/templates";
import { POST as setupPost } from "@/app/api/admin/catalog/sku/[id]/setup/route";
import { setUpItemAtShop } from "@/lib/catalog/new-item";

const actor = (role: RoleCode) => ({ user: { id: "fixture-actor", role, language: "en" }, level: 10, locations: ["shop-a"] }) as AuthContext;
let tables: Tables;
let db: ReturnType<typeof createFakeDb>;
beforeEach(() => {
  vi.clearAllMocks();
  tables = {
    locations: ["shop-a", "shop-b"].map((id) => ({ id, active: true })),
    vendor_items: [{ id: "sku", location_id: null }], location_sku_settings: [],
    checklist_templates: ["shop-a", "shop-b"].map((id) => ({ id: `template-${id}`, location_id: id, type: "prep", prep_subtype: "am_prep", active: true })),
    checklist_template_items: ["shop-a", "shop-b"].map((id) => ({ id: `line-${id}`, template_id: `template-${id}`, active: true, item_id: "item" })),
    item_par_levels: [],
  };
  db = createFakeDb(tables); h.db.mockReturnValue(db.client);
});
const writers = {
  order: (ctx: AuthContext, shop: string) => upsertLocationSkuSettings(ctx, { skuId: "sku", locationId: shop, activeOverride: false, weekdayPar: 4, weekendPar: 6 }),
  prep: (ctx: AuthContext, shop: string) => setItemPar(ctx, { templateId: `template-${shop}`, lineItemId: `line-${shop}`, locationId: shop, dayOfWeek: null, parValue: 4, parUnit: null, parMode: "manual" }),
};
for (const [kind, write] of Object.entries(writers)) {
  for (const role of ["agm", "prep_mgr", "catering_mgr", "social_media_mgr", "gm", "moo", "owner", "cgs"] as const) {
    for (const shop of ["shop-a", "shop-b", null] as const) {
      it(`${kind}: ${role} / ${shop ?? "global"} is bound inside the real library`, async () => {
        const allowed = role !== "social_media_mgr" && shop !== null && (shop === "shop-a" || getRoleLevel(role) >= 9);
        if (allowed) {
          await write(actor(role), shop!);
          expect(db.writes.length).toBeGreaterThan(0);
          expect(h.audit).toHaveBeenCalledWith(expect.objectContaining({ actorId: "fixture-actor", actorRole: role,
            action: kind === "prep" ? "item_par.update" : "vendor_item.update" }));
        } else {
          const status = getRoleLevel(role) >= 7 && shop === "shop-b" ? 404 : 403;
          await expect(write(actor(role), shop as unknown as string)).rejects.toMatchObject({ status });
          expect(h.db).not.toHaveBeenCalled(); expect(db.writes).toEqual([]);
        }
      });
    }
    it(`${kind}: ${role} cannot write an inactive shop`, async () => {
      tables.locations![0]!.active = false;
      await expect(write(actor(role), "shop-a")).rejects.toMatchObject({ status: role === "social_media_mgr" ? 403 : kind === "order" ? 400 : 404 });
      expect(db.writes).toEqual([]); expect(h.audit).not.toHaveBeenCalled();
    });
  }
}
it.each(["agm", "prep_mgr", "catering_mgr", "social_media_mgr"] as const)("setup par: %s cannot reach I/O for another shop", async (role) => {
  await expect(setUpItemAtShop(actor(role), { skuId: "sku", shopId: "shop-b", step: { kind: "par", weekdayPar: 4, weekendPar: 6 } })).rejects.toMatchObject({ status: 403 });
  expect(h.db).not.toHaveBeenCalled();
});
it.each(["agm", "prep_mgr", "catering_mgr", "gm"] as const)("%s can edit each assigned shop", (role) => {
  expect(parWriteGate({ role, locations: ["shop-a", "shop-b"] }, "shop-b")).toEqual({ ok: true });
});

const A = "11111111-1111-4111-8111-111111111111", B = "22222222-2222-4222-8222-222222222222", SKU = "33333333-3333-4333-8333-333333333333";
for (const role of ["agm", "prep_mgr", "catering_mgr", "social_media_mgr", "gm"] as const) {
  it(`setup route and lib: ${role} has par-only own-shop authority`, async () => {
    const ctx = { ...actor(role), level: getRoleLevel(role), locations: [A], session: { catalogEditUnlockedAt: new Date().toISOString() } } as AuthContext;
    tables.locations = [{ id: A, active: true }, { id: B, active: true }];
    tables.vendor_items = [{ id: SKU, location_id: null, active: true }];
    const step = { kind: "par" as const, weekdayPar: 4, weekendPar: 6 };
    h.session.mockResolvedValue(ctx);
    const post = (shopId: string, bodyStep: unknown = step) => setupPost(new NextRequest("https://fixture.test/api/setup", {
      method: "POST", headers: { origin: "https://fixture.test", "content-type": "application/json" }, body: JSON.stringify({ shopId, step: bodyStep }),
    }), { params: Promise.resolve({ id: SKU }) });
    expect((await post(A)).status).toBe(role === "social_media_mgr" ? 403 : 200);
    if (role !== "social_media_mgr") expect(tables.location_sku_settings![0]).toMatchObject({ weekday_par: 4, weekend_par: 6, updated_by: "fixture-actor" });
    h.db.mockClear();
    expect((await post(B)).status).toBe(role === "gm" ? 404 : 403);
    expect(h.db).not.toHaveBeenCalled();
    if (role !== "gm") {
      const otherStep = { kind: "order_days" as const, days: [{ orderDow: 1, leadDays: 1 }] };
      expect((await post(A, otherStep)).status).toBe(403);
      await expect(setUpItemAtShop(ctx, { skuId: SKU, shopId: A, step: otherStep })).rejects.toMatchObject({ status: 403 });
      expect(h.db).not.toHaveBeenCalled();
    }
  });
}

it("setup refuses an AGM with a stale Tier E window before I/O", async () => {
  h.session.mockResolvedValue({ ...actor("agm"), level: 6, locations: [A], session: { catalogEditUnlockedAt: "2000-01-01T00:00:00.000Z" } });
  const response = await setupPost(new NextRequest("https://fixture.test/api/setup", {
    method: "POST", headers: { origin: "https://fixture.test", "content-type": "application/json" },
    body: JSON.stringify({ shopId: A, step: { kind: "par", weekdayPar: 4, weekendPar: 6 } }),
  }), { params: Promise.resolve({ id: SKU }) });
  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({ code: "step_up_stale" });
  expect(h.db).not.toHaveBeenCalled(); expect(db.writes).toEqual([]);
});
