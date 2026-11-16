/**
 * Audit W17 / B099 — a packaging product with ONE active member can be counted.
 *
 * "Plastic forks" has two vendor twins, both chained to a COUNT leaf (case → each, no ounces).
 * With one twin switched off the count sheet offers only the product row (member SKUs of an
 * offered product are hidden, and "Split by vendor" needs two active members) — and the submit
 * refused it with `product_count_dimension`. There was no way to count the item at all.
 *
 * A count-dimension product line whose product has exactly one active member is now written as an
 * ordinary direct count of that member: leaf units, provenance NULL (nothing was derived).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb } from "./fixtures/counts-fake-db";
import { buildCountsFixture, LOC, OTHER } from "./fixtures/counts-onhand-fixture";
import { audit } from "@/lib/audit";
import { productCountLineDisposition } from "@/lib/counts-shared";
import type { AuthContext } from "@/lib/session";

let current: ReturnType<typeof createFakeDb> | null = null;
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => {
  if (!current) throw new Error("no fake db installed");
  return current.client;
} }));
vi.mock("@/lib/operational-task-access", () => ({ canDoOperationalTask: vi.fn(async () => true), auditOperationalTaskOverride: vi.fn(async () => {}) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));
const counts = await import("@/lib/counts");

const actor = { user: { id: "u-owner", role: "owner", language: "en", name: "Owner", email: "o@x", active: true }, role: "owner", level: 10, locations: [LOC] } as unknown as AuthContext;

describe("productCountLineDisposition", () => {
  const base = { resolvedOz: null, activeMemberSkuIds: ["forks-leonard"], primarySkuId: "forks-leonard" };
  it("a count-dimension product with exactly one active member writes that member directly", () => {
    expect(productCountLineDisposition({ ...base, anchorDimension: "count" })).toBe("direct_single_member");
  });
  it("a weight line is allocated across the members' lots, one member or many", () => {
    expect(productCountLineDisposition({ ...base, anchorDimension: "weight", resolvedOz: 48 })).toBe("allocate_weight");
    expect(productCountLineDisposition({ anchorDimension: "weight", resolvedOz: 48, activeMemberSkuIds: ["a", "b"], primarySkuId: "a" })).toBe("allocate_weight");
  });
  it("a count line with two or more active members is counted by vendor", () => {
    expect(productCountLineDisposition({ ...base, anchorDimension: "count", activeMemberSkuIds: ["forks-leonard", "forks-pfg"] })).toBe("refuse_count_dimension");
  });
  it("never writes a count directly at a SKU that is not the resolved primary, nor with no active member", () => {
    expect(productCountLineDisposition({ ...base, anchorDimension: "count", primarySkuId: "someone-else" })).toBe("refuse_count_dimension");
    expect(productCountLineDisposition({ ...base, anchorDimension: "count", activeMemberSkuIds: [] })).toBe("refuse_count_dimension");
  });
});

/** The counts fixture plus "Plastic forks": two count-chained twins (case → 100 each). */
function withForks(edit: (t: ReturnType<typeof buildCountsFixture>) => void = () => {}) {
  const t = buildCountsFixture();
  const sku = (id: string, vendorId: string, active: boolean) => ({
    id, name: "Plastic forks", pack_format: null, vendor_id: vendorId, product_id: "p-forks", active, avg_oz_per_each: null,
    pending_review: false, location_id: null, units_per_pack: null, each_size: null, each_measure: null, each_container_label: null,
  });
  t.vendor_items!.push(sku("s-forks-leonard", "v-a", true), sku("s-forks-pfg", "v-b", true));
  t.products!.push({ id: "p-forks", name: "Plastic forks", unit_oz: null, active: true });
  for (const id of ["s-forks-leonard", "s-forks-pfg"]) {
    t.sku_pack_levels!.push({ id: `pl-${id}`, sku_id: id, label: "case", contains_qty: 100, contains_level_id: null, contains_measure_unit: "each", display_ordinal: 1, active: true });
  }
  edit(t);
  return t;
}
const pfgOffInCatalog = (t: ReturnType<typeof buildCountsFixture>) => { t.vendor_items!.find((s) => s.id === "s-forks-pfg")!.active = false; };
const pfgOffHere = (t: ReturnType<typeof buildCountsFixture>) => { t.location_sku_settings!.push({ sku_id: "s-forks-pfg", location_id: LOC, active_override: false }); };

const lineWrites = () => current!.writes.filter((w) => w.table === "sku_count_lines").flatMap((w) => w.rows);
const refusal = async (p: Promise<unknown>) => p.then(() => null, (e: unknown) => (e instanceof counts.CountError ? { status: e.status, code: e.code } : Promise.reject(e)));

beforeEach(() => { vi.mocked(audit).mockClear(); });

describe("createCountEvent — a packaging product with one active twin", () => {
  it.each([
    ["switched off in the catalog", pfgOffInCatalog],
    ["switched off at this shop", pfgOffHere],
  ])("Plastic forks with one active twin (%s): 3 cases → one count line of 300 units on the active SKU", async (_label, off) => {
    current = createFakeDb(withForks(off));
    const res = await counts.createCountEvent(actor, { locationId: LOC, lines: [{ productId: "p-forks", levelLabel: "case", qty: 3 }] });
    expect(res.advisories).toEqual([]);

    const rows = lineWrites();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      count_event_id: res.countEventId, sku_id: "s-forks-leonard", level_label: "case", qty: 3,
      anchor_dimension: "count", resolved_units: 300, resolved_oz: null, is_loose: false, partial_fraction: null,
    });
    // Counted directly at that SKU: no derived-from-product provenance (and no 0180 column named).
    expect(rows[0]!.allocated_from_product_id ?? null).toBeNull();

    const meta = vi.mocked(audit).mock.calls[0]![0].metadata as Record<string, unknown>;
    expect(meta).toMatchObject({
      line_count: 1, sku_ids: ["s-forks-leonard"], allocated_line_count: 0, product_lines: [],
      direct_product_lines: [{ product_id: "p-forks", product_name: "Plastic forks", written_as: "direct_single_member", sku_id: "s-forks-leonard", level_label: "case", qty: 3, anchor_dimension: "count", resolved_units: 300 }],
    });
  });

  it("the count then anchors that SKU on the on-hand panel, in units", async () => {
    const tables = withForks(pfgOffInCatalog);
    current = createFakeDb(tables);
    await counts.createCountEvent(actor, { locationId: LOC, lines: [{ productId: "p-forks", levelLabel: "case", qty: 3 }] });
    // The fake's insert has no column defaults: give the new session the timestamp the database would.
    const now = new Date().toISOString();
    for (const e of tables.sku_count_events!) e.counted_at ??= now;
    const view = await counts.deriveOnHand(LOC, Date.now());
    expect(view.rows.find((r) => r.skuId === "s-forks-leonard")).toMatchObject({ dimension: "count", anchorUnits: 300, onHandUnits: 300, unitLabel: "each" });
  });

  it("the same product line plus a direct line for that SKU is refused: it would count the SKU twice", async () => {
    current = createFakeDb(withForks(pfgOffInCatalog));
    expect(await refusal(counts.createCountEvent(actor, { locationId: LOC, lines: [
      { productId: "p-forks", levelLabel: "case", qty: 3 },
      { skuId: "s-forks-leonard", levelLabel: "case", qty: 1, isLoose: false, partialFraction: null },
    ] }))).toEqual({ status: 400, code: "product_line_overlaps_sku" });
    expect(lineWrites()).toEqual([]);
  });

  it("with BOTH twins active it is still counted by vendor (the split)", async () => {
    current = createFakeDb(withForks());
    expect(await refusal(counts.createCountEvent(actor, { locationId: LOC, lines: [{ productId: "p-forks", levelLabel: "case", qty: 3 }] })))
      .toEqual({ status: 400, code: "product_count_dimension" });
    expect(lineWrites()).toEqual([]);
  });

  it("a twin switched off at ANOTHER shop changes nothing here", async () => {
    current = createFakeDb(withForks((t) => { t.location_sku_settings!.push({ sku_id: "s-forks-pfg", location_id: OTHER, active_override: false }); }));
    expect(await refusal(counts.createCountEvent(actor, { locationId: LOC, lines: [{ productId: "p-forks", levelLabel: "case", qty: 3 }] })))
      .toEqual({ status: 400, code: "product_count_dimension" });
  });

  it("a single-member packaging line rides beside ordinary lines in one event", async () => {
    current = createFakeDb(withForks(pfgOffInCatalog));
    await counts.createCountEvent(actor, { locationId: LOC, lines: [
      { skuId: "s-bags", levelLabel: "sleeve", qty: 2, isLoose: false, partialFraction: null },
      { productId: "p-forks", levelLabel: "case", qty: 1 },
    ] });
    expect(lineWrites().map((r) => [r.sku_id, r.anchor_dimension, r.resolved_units])).toEqual([
      ["s-bags", "count", 100],
      ["s-forks-leonard", "count", 100],
    ]);
  });
});
