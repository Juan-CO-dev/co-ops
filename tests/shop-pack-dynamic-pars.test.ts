/**
 * Catalog Phase 2a — D3: an auto par stands only in the PACK EPOCH it was computed in, per (sku, shop);
 * "back to default" is a new epoch, never the old one; the walk and its submission resolve through
 * ONE pack-aware loader.
 */
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakeDb } from "./fixtures/counts-fake-db";
import { loadPackAwareOverlay } from "@/lib/ordering";
import { autoPackStale, resolvePar, resolveParSlot, stampEffectivePack, type LocationSkuOverlay } from "@/lib/location-sku-shared";
import { parWriteColumns } from "@/lib/dynamic-pars-shared";

let current: ReturnType<typeof createFakeDb> | null = null;
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => {
  if (!current) throw new Error("no fake db installed");
  return current.client;
} }));

const GLOBAL = { weekdayPar: 3, weekendPar: 4 };
const auto = (extra: Partial<LocationSkuOverlay> = {}): LocationSkuOverlay => ({
  weekdayPar: null, weekendPar: null,
  autoWeekdayPar: 5, autoWeekdayBaselinePar: 3, autoWeekdayPackEpoch: 0,
  autoWeekendPar: 6, autoWeekendBaselinePar: 4, autoWeekendPackEpoch: 0,
  ...extra,
});

describe("the pure rule", () => {
  it("unstamped reader: today's behaviour exactly (auto stands)", () => {
    expect(resolveParSlot(auto(), GLOBAL, "weekday")).toEqual({ value: 5, lane: "auto" });
  });
  it("the same epoch it was computed in: auto stands", () => {
    expect(resolveParSlot(auto({ effectivePackEpoch: 0 }), GLOBAL, "weekday")).toEqual({ value: 5, lane: "auto" });
  });
  it("G → S → G (shop version made, then back to default): stale at 1 AND at 2 — never resurrected", () => {
    expect(resolveParSlot(auto({ effectivePackEpoch: 1 }), GLOBAL, "weekday")).toEqual({ value: 3, lane: "global" });
    expect(resolveParSlot(auto({ effectivePackEpoch: 2 }), GLOBAL, "weekday")).toEqual({ value: 3, lane: "global" });
    expect([0, 1, 2].map((e) => autoPackStale(0, e))).toEqual([false, true, true]);
  });
  it("a global version replaced while the shop rides it is a new epoch too: stale", () => {
    expect(resolveParSlot(auto({ autoWeekendPackEpoch: 3, effectivePackEpoch: 4 }), GLOBAL, "weekend")).toEqual({ value: 4, lane: "global" });
  });
  it("an unstamped value cannot prove its epoch: stale; an unstamping reader skips the check", () => {
    expect(autoPackStale(null, 0)).toBe(true);
    expect(autoPackStale(undefined, undefined)).toBe(false);
  });
  it("a human par still wins over everything", () => {
    expect(resolveParSlot(auto({ weekdayPar: 2, effectivePackEpoch: 1 }), GLOBAL, "weekday")).toEqual({ value: 2, lane: "human" });
  });
  it("stampEffectivePack stamps EVERY overlay with its SKU's current epoch (0 when there is no row)", () => {
    const overlays = new Map<string, LocationSkuOverlay>([["a", auto()], ["b", auto()]]);
    stampEffectivePack(overlays, new Map([["a", 2]]));
    expect(overlays.get("a")!.effectivePackEpoch).toBe(2);
    expect(overlays.get("b")!.effectivePackEpoch).toBe(0);
  });
  it("the machine must name its epoch; it writes the stamp on ITS slot only", () => {
    expect(() => parWriteColumns({ kind: "machine", dayClass: "weekday", value: null, autoValue: 5, baselinePar: 3, appliedAt: "2026-10-15T10:00:00.000Z" }))
      .toThrow(/packEpoch/);
    const cols = parWriteColumns({ kind: "machine", dayClass: "weekday", value: null, autoValue: 5, baselinePar: 3, appliedAt: "2026-10-15T10:00:00.000Z", packEpoch: 2 });
    expect(cols.autoLane.auto_weekday_pack_epoch).toBe(2);
    expect(Object.keys(cols.autoLane).some((k) => k.includes("weekend"))).toBe(false);
  });
});

const LOC = "6f1d2c3e-0000-4000-8000-0000000000a1";
const FROM = "2026-10-01T00:00:00.000Z";
/** turkey: global case 4 × 5 lb; auto par 5 computed in epoch 0; global par 3. `epoch` = this shop's current epoch. */
function tables(epoch: number, withShopVersion: boolean) {
  const t: Record<string, Array<Record<string, unknown>>> = {
    location_sku_settings: [{
      id: "lss-1", sku_id: "s-turkey", location_id: LOC, active_override: null, weekday_par: null, weekend_par: null,
      auto_weekday_par: 5, auto_weekend_par: 5, auto_weekday_baseline_par: 3, auto_weekend_baseline_par: 3,
      auto_weekday_applied_at: FROM, auto_weekend_applied_at: FROM,
      auto_weekday_pack_epoch: 0, auto_weekend_pack_epoch: 0,
    }],
    sku_pack_epochs: epoch === 0 ? [] : [{ sku_id: "s-turkey", location_id: LOC, epoch }],
    sku_pack_versions: [{ id: "pv-g", sku_id: "s-turkey", location_id: null, based_on_version_id: null, active: true, valid_from: FROM, valid_to: null }],
    sku_pack_levels: [
      { id: "g-c", sku_id: "s-turkey", version_id: "pv-g", location_id: null, effective_from: FROM, label: "case", contains_qty: 4, contains_level_id: "g-b", contains_measure_unit: null, display_ordinal: 0, active: true },
      { id: "g-b", sku_id: "s-turkey", version_id: "pv-g", location_id: null, effective_from: FROM, label: "bag", contains_qty: 5, contains_level_id: null, contains_measure_unit: "lb", display_ordinal: 1, active: true },
    ],
  };
  if (withShopVersion) {
    t.sku_pack_versions!.push({ id: "sv-l", sku_id: "s-turkey", location_id: LOC, based_on_version_id: "pv-g", active: true, valid_from: "2026-10-15T14:00:00.000Z", valid_to: null });
    t.sku_pack_levels!.push({ id: "s-c", sku_id: "s-turkey", version_id: "sv-l", location_id: LOC, effective_from: "2026-10-15T14:00:00.000Z", label: "case", contains_qty: 2, contains_level_id: null, contains_measure_unit: "lb", display_ordinal: 0, active: true });
  }
  return t;
}

describe("ONE pack-aware overlay loader for the walk and its submission (display/submission parity)", () => {
  afterEach(() => { current = null; });
  it("epoch 0 (the one it was computed in): the auto par (5) answers, and the chain is the global one", async () => {
    current = createFakeDb(tables(0, false));
    const { overlayBySku, chainsBySku } = await loadPackAwareOverlay(current.client as never, LOC, ["s-turkey"]);
    expect(resolvePar(overlayBySku.get("s-turkey") ?? null, GLOBAL, false)).toBe(5);
    expect(chainsBySku.get("s-turkey")!.map((l) => l.label)).toEqual(["case", "bag"]);
  });
  it("this shop makes its own case (epoch 1): the SAME loader retires the auto par — 3 (global), never 5", async () => {
    current = createFakeDb(tables(1, true));
    const { overlayBySku, chainsBySku } = await loadPackAwareOverlay(current.client as never, LOC, ["s-turkey"]);
    expect(overlayBySku.get("s-turkey")!.effectivePackEpoch).toBe(1);
    expect(resolvePar(overlayBySku.get("s-turkey") ?? null, GLOBAL, false)).toBe(3);
    expect(chainsBySku.get("s-turkey")!.map((l) => l.label)).toEqual(["case"]);
  });
  it("…and back to default (epoch 2, the global chain again): STILL 3 — the old value is never resurrected", async () => {
    current = createFakeDb(tables(2, false));
    const { overlayBySku, chainsBySku } = await loadPackAwareOverlay(current.client as never, LOC, ["s-turkey"]);
    expect(chainsBySku.get("s-turkey")!.map((l) => l.label)).toEqual(["case", "bag"]);
    expect(resolvePar(overlayBySku.get("s-turkey") ?? null, GLOBAL, false)).toBe(3);
  });
  it("the walk and the submit both resolve through that loader and nothing else loads overlays", () => {
    const src = readFileSync("lib/ordering.ts", "utf8");
    expect(src.match(/loadPackAwareOverlay\(sb, locationId, skuIds\)/g)?.length).toBe(2);
    expect(src.match(/loadOverlayBySku\(sb, locationId\)/g)?.length).toBe(1); // inside loadPackAwareOverlay only
    const submit = src.slice(src.indexOf("export async function submitParPass("));
    expect(submit).toContain("const [{ chainsBySku, overlayBySku }, measures] = await Promise.all([loadPackAwareOverlay(sb, locationId, skuIds), loadMeasures()]);");
    expect(submit).toContain("const par = resolvePar(overlayForPar,");
  });
  it("the nightly engine and readiness stamp from the epochs too", () => {
    const pars = readFileSync("lib/dynamic-pars.ts", "utf8");
    expect(pars).toContain("stampEffectivePack(overlayBySku, await loadShopPackEpochs(skuIds, locationId));");
    expect(pars).toContain("auto_weekday_pack_epoch");
    const ready = readFileSync("lib/sku-data-readiness.ts", "utf8");
    expect(ready).toContain("effectivePackEpoch: stamped ? epochFor(shopId, id) : undefined");
  });
});
