/**
 * Catalog Phase 2a — shop versions PRESENT (spec §8 "Resolver tests"): shop version beats global;
 * a retired shop version falls back to global; another shop's version is invisible; and every number
 * downstream (order-unit oz, cost per oz, depletion oz, flat content) follows the shop's answer.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb } from "./fixtures/counts-fake-db";
import { buildShopVersionsFixture, LOC, OTHER, QUIET_DAY } from "./fixtures/shop-versions-fixture";
import { computeOutputs, liveApi } from "./fixtures/shop-versions-harness";
import { loadSkuPackResolution } from "@/lib/prep-consumption";
import { loadCurrentSkuPriceHeads } from "@/lib/admin/cost";

let current: ReturnType<typeof createFakeDb> | null = null;
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => {
  if (!current) throw new Error("no fake db installed");
  return current.client;
} }));

const FROM = "2026-10-10T00:00:00.000Z";
/** LOC: turkey 4 × 10 lb (640 oz/case) at $150; OTHER: its own tomato case; LOC's lettuce version is RETIRED. */
function withShopVersions() {
  const t = buildShopVersionsFixture();
  const lv = (id: string, sku: string, loc: string, ver: string, label: string, qty: number, next: string | null, unit: string | null, ord: number, active = true) =>
    ({ id, sku_id: sku, version_id: ver, location_id: loc, effective_from: FROM, label, contains_qty: qty, contains_level_id: next, contains_measure_unit: unit, display_ordinal: ord, active });
  t.sku_pack_versions!.push(
    { id: "sv-turkey-loc", sku_id: "s-turkey", location_id: LOC, based_on_version_id: "pv-s-turkey-live", active: true, valid_from: FROM, valid_to: null },
    { id: "sv-tomato-other", sku_id: "s-tomato", location_id: OTHER, based_on_version_id: "pv-s-tomato-live", active: true, valid_from: FROM, valid_to: null },
    { id: "sv-lettuce-loc-old", sku_id: "s-lettuce", location_id: LOC, based_on_version_id: null, active: false, valid_from: "2026-09-10T00:00:00.000Z", valid_to: "2026-09-20T00:00:00.000Z" },
  );
  t.sku_pack_levels!.push(
    lv("sl-t-case", "s-turkey", LOC, "sv-turkey-loc", "case", 4, "sl-t-bag", null, 0),
    lv("sl-t-bag", "s-turkey", LOC, "sv-turkey-loc", "bag", 10, null, "lb", 1),
    lv("sl-tom-case", "s-tomato", OTHER, "sv-tomato-other", "case", 30, null, "each", 0),
    lv("sl-let-case", "s-lettuce", LOC, "sv-lettuce-loc-old", "case", 12, null, "lb", 0, false),
  );
  t.sku_price_lanes!.push(
    { id: "lane-turkey-loc", sku_id: "s-turkey", location_id: LOC, based_on_price_id: "ph-02", active: true },
    { id: "lane-cheese-loc", sku_id: "s-cheese", location_id: LOC, based_on_price_id: "ph-04", active: false },
  );
  t.vendor_price_history!.push(
    { id: "ph-s1", vendor_item_id: "s-turkey", unit_price: 150, effective_date: "2026-10-10", recorded_at: "2026-10-10T12:00:00.000Z", location_id: LOC, price_lane_id: "lane-turkey-loc" },
    { id: "ph-s2", vendor_item_id: "s-cheese", unit_price: 99, effective_date: "2026-10-10", recorded_at: "2026-10-10T12:00:00.000Z", location_id: LOC, price_lane_id: "lane-cheese-loc" },
  );
  return t;
}

beforeEach(() => { current = createFakeDb(withShopVersions()); });
afterEach(() => { current = null; });

describe("shop version beats global — for that shop only", () => {
  it("LOC reads its turkey version; OTHER and global read the default", async () => {
    expect((await loadSkuPackResolution(["s-turkey"], LOC)).get("s-turkey")).toMatchObject({ versionId: "sv-turkey-loc", locationId: LOC });
    expect((await loadSkuPackResolution(["s-turkey"], OTHER)).get("s-turkey")).toMatchObject({ versionId: "pv-s-turkey-live", locationId: null });
    expect((await loadSkuPackResolution(["s-turkey"], null)).get("s-turkey")!.locationId).toBeNull();
  });
  it("a RETIRED shop version falls back to global live, but still answers for a date inside its own window", async () => {
    expect((await loadSkuPackResolution(["s-lettuce"], LOC)).has("s-lettuce")).toBe(false); // global lettuce is unchained
    expect((await loadSkuPackResolution(["s-lettuce"], LOC, "2026-09-15T12:00:00.000Z")).get("s-lettuce")!.versionId).toBe("sv-lettuce-loc-old");
    expect((await loadSkuPackResolution(["s-tomato"], LOC)).get("s-tomato")!.locationId).toBeNull();
    expect((await loadSkuPackResolution(["s-tomato"], OTHER)).get("s-tomato")!.versionId).toBe("sv-tomato-other");
  });
  it("prices: LOC's live lane answers; a retired lane does not; OTHER reads global", async () => {
    const loc = await loadCurrentSkuPriceHeads(["s-turkey", "s-cheese"], LOC);
    expect(loc.get("s-turkey")).toMatchObject({ value: 150, laneId: "lane-turkey-loc" });
    expect(loc.get("s-cheese")).toMatchObject({ value: 46.2, laneId: null });
    expect((await loadCurrentSkuPriceHeads(["s-turkey"], OTHER)).get("s-turkey")!.value).toBe(128);
  });
});

describe("every number downstream follows the shop's answer", () => {
  it("order unit, cost per oz, depletion oz at LOC; untouched at OTHER and global", async () => {
    const out = await computeOutputs(liveApi, withShopVersions(), [LOC, OTHER], QUIET_DAY);
    expect(out[LOC]!.orderUnitOz["s-turkey"]).toBe(640);
    expect(out[LOC]!.graph.costPerOz["s-turkey"]).toBeCloseTo(150 / 640, 12);
    expect(out[LOC]!.graph.menuOz["m-italian"]!["s-turkey"]).toBeCloseTo(8, 10); // 0.0125 case × 640
    expect(out[LOC]!.datedMenuOz["m-italian"]!["s-turkey"]).toBeCloseTo(8, 10); // the quiet day is after LOC's version
    expect(out[LOC]!.flatContentOz["s-turkey"]).toBe(640); // the shop version answers the flat consumers
    expect(out[OTHER]!.orderUnitOz["s-turkey"]).toBe(320);
    expect(out[OTHER]!.orderUnitOz["s-tomato"]).toBe(135); // 30 each × 4.5
    expect(out.global!.orderUnitOz["s-turkey"]).toBe(320);
    expect(out.global!.prices["s-turkey"]).toBe(128);
  });
});
