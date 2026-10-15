/**
 * Catalog Phase 2a — D1: a shop pack version made TODAY never changes YESTERDAY's rebuilt depletion.
 * The materializer's seam is loadSalesConsumptionContext(...).graphFor(businessDate); the cron's
 * prior-day repair (lib/toast-sales-pull-run.ts) rebuilds T-1..T-3 through it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb } from "./fixtures/counts-fake-db";
import { buildShopVersionsFixture, LOC, OTHER } from "./fixtures/shop-versions-fixture";
import { createDatedGraphs, loadRecipeGraph, packIntervalIndex } from "@/lib/prep-consumption";
import { perUnitSkuOzForMenuItemFromGraph } from "@/lib/prep-consumption-graph";
import { loadSalesConsumptionContext } from "@/lib/catering/toast-sales";
import { skuContentOz } from "@/lib/recipe-math";
import { readFileSync } from "node:fs";

let current: ReturnType<typeof createFakeDb> | null = null;
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => {
  if (!current) throw new Error("no fake db installed");
  return current.client;
} }));

const TODAY_SAVE = "2026-10-15T14:00:00.000Z";
/** LOC makes its own turkey case (4 × 10 lb = 640 oz) at 10 AM ET on 2026-10-15. */
function withTodaysShopVersion() {
  const t = buildShopVersionsFixture();
  t.sku_pack_versions!.push({ id: "sv-today", sku_id: "s-turkey", location_id: LOC, based_on_version_id: "pv-s-turkey-live", active: true, valid_from: TODAY_SAVE, valid_to: null });
  t.sku_pack_levels!.push(
    { id: "sv-c", sku_id: "s-turkey", version_id: "sv-today", location_id: LOC, effective_from: TODAY_SAVE, label: "case", contains_qty: 4, contains_level_id: "sv-b", contains_measure_unit: null, display_ordinal: 0, active: true },
    { id: "sv-b", sku_id: "s-turkey", version_id: "sv-today", location_id: LOC, effective_from: TODAY_SAVE, label: "bag", contains_qty: 10, contains_level_id: null, contains_measure_unit: "lb", display_ordinal: 1, active: true },
  );
  t.toast_menu_map = [];
  t.toast_ingest_exclusions = [];
  return t;
}
const turkeyOz = (g: Awaited<ReturnType<typeof loadRecipeGraph>>) => perUnitSkuOzForMenuItemFromGraph(g, "m-italian").get("s-turkey");

beforeEach(() => { current = createFakeDb(withTodaysShopVersion()); });
afterEach(() => { current = null; });

describe("D1 — depletion resolves packs as of its business date", () => {
  it("yesterday (2026-10-14) still depletes 4 oz per Italian at LOC; today 8 oz; live 8 oz", async () => {
    const dated = createDatedGraphs({ locationId: LOC });
    expect(turkeyOz(await dated("2026-10-14"))).toBeCloseTo(4, 10);
    expect(turkeyOz(await dated("2026-10-15"))).toBeCloseTo(8, 10);
    expect(turkeyOz(await loadRecipeGraph({ locationId: LOC }))).toBeCloseTo(8, 10);
  });
  it("the materializer's own seam: the sales context rebuilds yesterday with yesterday's pack", async () => {
    const ctx = await loadSalesConsumptionContext(LOC);
    expect(turkeyOz(await ctx.graphFor!("2026-10-14"))).toBeCloseTo(4, 10);
    expect(turkeyOz(await ctx.graphFor!("2026-10-15"))).toBeCloseTo(8, 10);
  });
  it("another shop is untouched on every date", async () => {
    const dated = createDatedGraphs({ locationId: OTHER });
    expect(turkeyOz(await dated("2026-10-14"))).toBeCloseTo(4, 10);
    expect(turkeyOz(await dated("2026-10-15"))).toBeCloseTo(4, 10);
  });
  it("ezCater: the Toast window AND the actual-order loop both resolve by business date (Astra 2a r2#3)", () => {
    const src = readFileSync("lib/ezcater/depletion.ts", "utf8");
    expect(src).toContain("const dayGraph = await context.graphFor!(date);");
    expect(src).toContain("const graph = await datedGraphFor(locationId, order.event_date); // D1: the order's event date");
    expect(readFileSync("lib/ezcater/pass2.ts", "utf8")).toContain("const graph = await graphFor(order.location_id, order.event_date!);");
  });
  it("a SKU's FIRST global chain made today: yesterday still resolves to its old FLAT pack (Astra 2b r2#5)", async () => {
    const t = withTodaysShopVersion();
    const lettuce = t.vendor_items!.find((v) => v.id === "s-lettuce")!;
    const oldFlat = { pack_format: lettuce.pack_format, each_container_label: lettuce.each_container_label ?? null, units_per_pack: lettuce.units_per_pack, each_size: lettuce.each_size, each_measure: lettuce.each_measure };
    // The save overwrote the mirror with the new chain (a 12 lb case); the trigger kept the old flat pack as a baseline.
    Object.assign(lettuce, { pack_format: "case", units_per_pack: 1, each_size: 12, each_measure: "lb" });
    t.sku_pack_versions!.push(
      { id: "base-let", sku_id: "s-lettuce", location_id: null, based_on_version_id: null, active: false, valid_from: "2000-01-01T00:00:00.000Z", valid_to: TODAY_SAVE, flat_snapshot: oldFlat },
      { id: "g-let", sku_id: "s-lettuce", location_id: null, based_on_version_id: null, active: true, valid_from: TODAY_SAVE, valid_to: null },
    );
    t.sku_pack_levels!.push({ id: "g-let-c", sku_id: "s-lettuce", version_id: "g-let", location_id: null, effective_from: TODAY_SAVE, label: "case", contains_qty: 12, contains_level_id: null, contains_measure_unit: "lb", display_ordinal: 0, active: true });
    current = createFakeDb(t);
    const dated = createDatedGraphs({ locationId: OTHER });
    const content = (g: Awaited<ReturnType<typeof loadRecipeGraph>>) => skuContentOz(g.skuPack.get("s-lettuce")!, g.measures);
    expect(content(await dated("2026-10-14"))).toBe(384); // the old 24 × 1 lb flat pack
    expect(content(await dated("2026-10-15"))).toBe(192); // the new 12 lb case
  });
  it("a SKU whose pack was UNKNOWN before its first chain: yesterday stays unknown (null), never today's 192 (Astra 2b r3#1)", async () => {
    const t = withTodaysShopVersion();
    const lettuce = t.vendor_items!.find((v) => v.id === "s-lettuce")!;
    Object.assign(lettuce, { pack_format: "case", units_per_pack: 1, each_size: 12, each_measure: "lb" }); // the mirror the first chain wrote
    t.sku_pack_versions!.push(
      { id: "base-let", sku_id: "s-lettuce", location_id: null, based_on_version_id: null, active: false, valid_from: "2000-01-01T00:00:00.000Z", valid_to: TODAY_SAVE,
        flat_snapshot: { pack_format: null, each_container_label: null, units_per_pack: null, each_size: null, each_measure: null } },
      { id: "g-let", sku_id: "s-lettuce", location_id: null, based_on_version_id: null, active: true, valid_from: TODAY_SAVE, valid_to: null },
    );
    t.sku_pack_levels!.push({ id: "g-let-c", sku_id: "s-lettuce", version_id: "g-let", location_id: null, effective_from: TODAY_SAVE, label: "case", contains_qty: 12, contains_level_id: null, contains_measure_unit: "lb", display_ordinal: 0, active: true });
    current = createFakeDb(t);
    const dated = createDatedGraphs({ locationId: OTHER });
    const content = (g: Awaited<ReturnType<typeof loadRecipeGraph>>) => skuContentOz(g.skuPack.get("s-lettuce")!, g.measures);
    expect(content(await dated("2026-10-14"))).toBeNull();
    expect(content(await dated("2026-10-15"))).toBe(192);
  });
  it("a day after every boundary reuses the live graph (no extra graph load)", async () => {
    const dated = createDatedGraphs({ locationId: LOC });
    const before = current!.log.filter((q) => q.table === "recipes").length;
    await dated("2026-10-16");
    await dated("2026-10-17");
    expect(current!.log.filter((q) => q.table === "recipes").length - before).toBe(1);
  });
  it("chunk-3 P2a: a window with ONE boundary in it costs TWO graph loads, never one per date", async () => {
    // LOC's boundaries: 07-01, 08-01 (the backfilled versions) and TODAY_SAVE (10-15 14:00Z).
    // 10-08 .. 10-14 sit in ONE interval [08-01, TODAY_SAVE); 10-15 .. 10-17 are after the last boundary.
    const dated = createDatedGraphs({ locationId: LOC });
    const before = current!.log.filter((q) => q.table === "recipes").length;
    const days = ["2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11", "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17"];
    const graphs = [];
    for (const d of days) graphs.push(await dated(d));
    expect(current!.log.filter((q) => q.table === "recipes").length - before).toBe(2);
    expect(new Set(graphs.slice(0, 7)).size).toBe(1); // one as-of graph for the whole interval
    expect(new Set(graphs.slice(7)).size).toBe(1); // the live graph after the boundary
    expect(turkeyOz(graphs[0]!)).toBeCloseTo(4, 10);
    expect(turkeyOz(graphs[9]!)).toBeCloseTo(8, 10);
    // the boundaries are read ONCE for the whole window
    expect(current!.log.filter((q) => q.table === "sku_pack_versions" && q.select === "id, valid_from, valid_to").length).toBe(1);
  });
  it("chunk-3 P2b: ezCater orders reuse the shop's ONE dated-graph builder (its sales context), never a second", () => {
    const src = readFileSync("lib/ezcater/depletion.ts", "utf8");
    expect(src).not.toContain("createDatedGraphs");
    expect(src).toContain("contexts.set(locationId, context);");
    expect(src).toContain("return context.graphFor ? context.graphFor(businessDate) : context.graph;");
  });
});

describe("packIntervalIndex — which pack interval an instant falls in (pure)", () => {
  it("before the first boundary, inside, exactly on a boundary, after the last", () => {
    const b = [100, 200, 300];
    expect(packIntervalIndex(b, 50)).toBe(-1);
    expect(packIntervalIndex(b, 100)).toBe(0);
    expect(packIntervalIndex(b, 199)).toBe(0);
    expect(packIntervalIndex(b, 200)).toBe(1);
    expect(packIntervalIndex(b, 999)).toBe(2);
    expect(packIntervalIndex([], 5)).toBe(-1);
  });
});
