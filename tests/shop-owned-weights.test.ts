import { expect, it, vi } from "vitest";
import { createFakeDb } from "./fixtures/counts-fake-db";
import { buildShopOwnedFixture, OWNED } from "./fixtures/shop-owned-fixture";
import { OWNER_ACTOR } from "./fixtures/recipe-versions-harness";
import { loadWeightBoard } from "@/lib/weights";

let current: ReturnType<typeof createFakeDb>;
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => current.client }));

it("the global weight audit costs owned prep items through their owner's graph", async () => {
  const tables = buildShopOwnedFixture();
  tables.audit_log = [];
  tables.sku_count_lines = [];
  tables.vendor_delivery_items = [];
  current = createFakeDb(tables);
  const board = await loadWeightBoard(OWNER_ACTOR);
  for (const own of OWNED) {
    const row = board.rows.find(r => r.belief.subjectId === own.item);
    expect(row).toBeDefined();
    expect(row!.belief.costPerOz).toBe(0.25);
  }
});

// ── W08/B015: a single-shop GM cannot weigh the other shop's OWNED rows ──────────────
import { recordWeightMeasurement } from "@/lib/weights";
import { LOC } from "./fixtures/recipe-versions-fixture";
import type { AuthContext } from "@/lib/session";

const audits = vi.hoisted(() => [] as unknown[]);
vi.mock("@/lib/audit", () => ({ audit: async (row: unknown) => { audits.push(row); } }));

const gmAt = (loc: string) => ({ user: { id: "u-gm", role: "gm" }, role: "gm", level: 7, locations: [loc] }) as unknown as AuthContext;
const mooAt = (loc: string) => ({ user: { id: "u-moo", role: "moo" }, role: "moo", level: 8, locations: [loc] }) as unknown as AuthContext;

function freshDb() {
  const tables = buildShopOwnedFixture();
  current = createFakeDb(tables);
  audits.length = 0;
  return tables;
}

it("W08/B015: a single-shop GM cannot weigh the other shop's owned SKU or prep item", async () => {
  const tables = freshDb();
  const gm = gmAt(LOC);
  const skuBefore = tables.vendor_items!.find(r => r.id === OWNED[1].sku)!.avg_oz_per_each;
  const itemBefore = tables.items!.find(r => r.id === OWNED[1].item)!.oz_per_par_unit;
  await expect(recordWeightMeasurement(gm, { subjectKind: "sku", subjectId: OWNED[1].sku, valueOz: 99 }))
    .rejects.toMatchObject({ status: 404, code: "not_found" });
  await expect(recordWeightMeasurement(gm, { subjectKind: "item", subjectId: OWNED[1].item, valueOz: 99 }))
    .rejects.toMatchObject({ status: 404, code: "not_found" });
  expect(tables.vendor_items!.find(r => r.id === OWNED[1].sku)!.avg_oz_per_each).toBe(skuBefore);
  expect(tables.vendor_items!.find(r => r.id === OWNED[1].sku)!.weight_class).not.toBe("OPERATIONAL");
  expect(tables.items!.find(r => r.id === OWNED[1].item)!.oz_per_par_unit).toBe(itemBefore);
  expect(audits).toHaveLength(0);
});

it("W08/B015: own-shop owned rows, shared rows and MoO still weigh", async () => {
  const tables = freshDb();
  const gm = gmAt(LOC);
  await expect(recordWeightMeasurement(gm, { subjectKind: "sku", subjectId: OWNED[0].sku, valueOz: 3 })).resolves.toMatchObject({ afterOz: 3 });
  await expect(recordWeightMeasurement(gm, { subjectKind: "sku", subjectId: "s-lettuce", valueOz: 4 })).resolves.toMatchObject({ afterOz: 4 });
  await expect(recordWeightMeasurement(gm, { subjectKind: "item", subjectId: OWNED[0].item, valueOz: 5 })).resolves.toMatchObject({ afterOz: 5 });
  await expect(recordWeightMeasurement(mooAt(LOC), { subjectKind: "sku", subjectId: OWNED[1].sku, valueOz: 6 })).resolves.toMatchObject({ afterOz: 6 });
  await expect(recordWeightMeasurement(mooAt(LOC), { subjectKind: "item", subjectId: OWNED[1].item, valueOz: 7 })).resolves.toMatchObject({ afterOz: 7 });
  expect(tables.vendor_items!.find(r => r.id === OWNED[1].sku)!.avg_oz_per_each).toBe(6);
  expect(tables.items!.find(r => r.id === OWNED[1].item)!.oz_per_par_unit).toBe(7);
});
