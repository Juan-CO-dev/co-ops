/**
 * Audit W18/B189: upsertLocationSkuSettings checked `expected` against a READ, then ran an UPDATE
 * keyed on the row id alone. Two managers whose reads both passed the check both wrote, and the
 * second silently overwrote the first. The UPDATE is now a compare-and-set on the values it read,
 * and a duplicate first insert (two concurrent first writes) maps to the same 409.
 */
import { beforeEach, expect, it, vi } from "vitest";
import type { AuthContext } from "@/lib/session";
import { createFakeDb, type Tables } from "./fixtures/counts-fake-db";

const h = vi.hoisted(() => ({ db: vi.fn(), audit: vi.fn(), between: vi.fn(async () => {}) }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: h.db }));
vi.mock("@/lib/audit", () => ({ audit: h.audit }));
// parAutoLaneReady runs AFTER the read and BEFORE the write: the seam where a second manager's
// save lands in production.
vi.mock("@/lib/dynamic-pars-probes", () => ({ parAutoLaneReady: async () => { await h.between(); return true; } }));
import { upsertLocationSkuSettings, AdminSkuError } from "@/lib/admin/skus";

const SHOP = "6f1d2c3e-0000-4000-8000-00000000000a";
const actor = { user: { id: "u1", role: "gm", language: "en" }, level: 7, locations: [SHOP] } as unknown as AuthContext;
let tables: Tables;
beforeEach(() => {
  vi.clearAllMocks();
  h.between.mockImplementation(async () => {});
  tables = { vendor_items: [{ id: "sku", location_id: null }], locations: [{ id: SHOP, active: true }],
    location_sku_settings: [{ id: "overlay", sku_id: "sku", location_id: SHOP, active_override: null, weekday_par: 2, weekend_par: 3 }] };
  h.db.mockReturnValue(createFakeDb(tables).client);
});
const refusal = (p: Promise<unknown>) => p.then(() => null, (e: unknown) => (e instanceof AdminSkuError ? { status: e.status, code: e.code } : e));

it("a concurrent change between the read and the write is refused overlay_changed, never overwritten", async () => {
  h.between.mockImplementation(async () => { tables.location_sku_settings![0]!.weekday_par = 6; });
  const out = await refusal(upsertLocationSkuSettings(actor, {
    skuId: "sku", locationId: SHOP, activeOverride: null, weekdayPar: 4, weekendPar: 3,
    expected: { activeOverride: null, weekdayPar: 2, weekendPar: 3 },
  }));
  expect(out).toEqual({ status: 409, code: "overlay_changed" });
  expect(tables.location_sku_settings![0]).toMatchObject({ weekday_par: 6, weekend_par: 3 });
  expect(h.audit).not.toHaveBeenCalled();
});

it("an unchanged row still saves (the compare-and-set matches what was read)", async () => {
  await upsertLocationSkuSettings(actor, {
    skuId: "sku", locationId: SHOP, activeOverride: false, weekdayPar: 4, weekendPar: 3,
    expected: { activeOverride: null, weekdayPar: 2, weekendPar: 3 },
  });
  expect(tables.location_sku_settings![0]).toMatchObject({ active_override: false, weekday_par: 4, weekend_par: 3 });
  expect(h.audit).toHaveBeenCalledTimes(1);
});

it("a duplicate first insert maps to overlay_changed", async () => {
  tables.location_sku_settings = [];
  const fake = createFakeDb(tables);
  const client = {
    from: (t: string) => {
      const q = fake.client.from(t) as unknown as Record<string, unknown>;
      if (t !== "location_sku_settings") return q;
      return { ...q, insert: () => ({ then: (res: (v: unknown) => unknown) => Promise.resolve({ data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } }).then(res) }) };
    },
  };
  h.db.mockReturnValue(client);
  const out = await refusal(upsertLocationSkuSettings(actor, {
    skuId: "sku", locationId: SHOP, activeOverride: null, weekdayPar: 4, weekendPar: null,
    expected: { activeOverride: null, weekdayPar: null, weekendPar: null },
  }));
  expect(out).toEqual({ status: 409, code: "overlay_changed" });
  expect(h.audit).not.toHaveBeenCalled();
});
