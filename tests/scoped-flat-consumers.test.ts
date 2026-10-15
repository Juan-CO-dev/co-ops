/**
 * Catalog Phase 2a — the two flat-only consumers follow the shop's pack: manual production PERSISTS
 * the shop's ounces; catering surplus divides by the shop's case. Global answers stay byte-identical.
 */
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb } from "./fixtures/counts-fake-db";
import { buildShopVersionsFixture, LOC, OTHER } from "./fixtures/shop-versions-fixture";
import { recordProduction } from "@/lib/production";
import { loadDerivedForItems, loadRecipeGraph, recordProductionFromPrep } from "@/lib/prep-consumption";
import { unitToOz } from "@/lib/production-units-shared";
import type { AuthContext } from "@/lib/session";

let current: ReturnType<typeof createFakeDb> | null = null;
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => {
  if (!current) throw new Error("no fake db installed");
  return current.client;
} }));
vi.mock("@/lib/audit", () => ({ audit: async () => {} }));

/** LOC buys lettuce as a case of 4 × 10 lb bags (640 oz); the global flat pack is 24 × 1 lb (384 oz). */
function withShopLettuce() {
  const t = buildShopVersionsFixture();
  const at = "2026-10-10T00:00:00.000Z";
  t.sku_pack_versions!.push({ id: "sv-let", sku_id: "s-lettuce", location_id: LOC, based_on_version_id: null, active: true, valid_from: at, valid_to: null });
  t.sku_pack_levels!.push(
    { id: "sv-let-c", sku_id: "s-lettuce", version_id: "sv-let", location_id: LOC, effective_from: at, label: "case", contains_qty: 4, contains_level_id: "sv-let-b", contains_measure_unit: null, display_ordinal: 0, active: true },
    { id: "sv-let-b", sku_id: "s-lettuce", version_id: "sv-let", location_id: LOC, effective_from: at, label: "bag", contains_qty: 10, contains_level_id: null, contains_measure_unit: "lb", display_ordinal: 1, active: true },
  );
  t.productions = [];
  t.production_inputs = [];
  return t;
}
const actor = (locations: string[]) => ({ user: { id: "u-cook", role: "key_holder" }, role: "key_holder", level: 4, locations }) as unknown as AuthContext;

beforeEach(() => { current = createFakeDb(withShopLettuce()); });
afterEach(() => { current = null; });

describe("manual production persists the shop's ounces", () => {
  it("1 case at LOC = 640 oz consumed (its own case); 1 case at OTHER = 384 oz (the global case)", async () => {
    await recordProduction(actor([LOC, OTHER]), { locationId: LOC, inputSkuId: "s-lettuce", inputQty: 1, outputItemId: "i-slaw", outputQty: 2 });
    await recordProduction(actor([LOC, OTHER]), { locationId: OTHER, inputSkuId: "s-lettuce", inputQty: 1, outputItemId: "i-slaw", outputQty: 2 });
    const lines = current!.writes.filter((w) => w.table === "production_inputs").flatMap((w) => w.rows);
    expect(lines.map((l) => l.input_oz)).toEqual([640, 384]);
  });
});

describe("chunk-3 P3b: prep reuses the packs its graph already resolved", () => {
  it("loadDerivedForItems reads sku_pack_levels exactly as often as the graph load itself — no second resolution", async () => {
    const levelReads = () => current!.log.filter((q) => q.table === "sku_pack_levels").length;
    const a = levelReads();
    await loadRecipeGraph({ versionLocationId: LOC });
    const graphOnly = levelReads() - a;
    const b = levelReads();
    await loadDerivedForItems(["i-slaw"], LOC);
    expect(levelReads() - b).toBe(graphOnly);
  });
});

describe("prep's 'each' comes from the SAME pack as its content (Astra 2a r2#1)", () => {
  it("1 each at LOC = 160 oz (640 ÷ 4 bags), never 640 ÷ the global 24; 1 each at OTHER = 16 oz", async () => {
    const atLoc = (await loadDerivedForItems(["i-slaw"], LOC)).get("i-slaw")!.find((d) => d.skuId === "s-lettuce")!;
    expect(atLoc).toMatchObject({ unitsPerPack: 4, contentOz: 640 });
    expect(unitToOz(1, "each", atLoc)).toBe(160); // what the panel persists as the consumed ounces
    const atOther = (await loadDerivedForItems(["i-slaw"], OTHER)).get("i-slaw")!.find((d) => d.skuId === "s-lettuce")!;
    expect(atOther).toMatchObject({ unitsPerPack: 24, contentOz: 384 });
    expect(unitToOz(1, "each", atOther)).toBe(16);

    // THE SAVE ITSELF (Astra r3 remark): the prep form's "1 each" goes through recordProductionFromPrep,
    // and the persisted production_inputs row carries 160 oz. A recording client stands in for the
    // database here (the fake db has no update(), which the supersede step uses).
    const saved: Array<Record<string, unknown>> = [];
    const chain = (table: string): Record<string, unknown> => {
      const q: Record<string, unknown> = {
        update: () => q, eq: () => q, is: () => q, select: () => q,
        insert: (rows: unknown) => { if (table === "production_inputs") saved.push(...(rows as Array<Record<string, unknown>>)); return q; },
        maybeSingle: async () => ({ data: { id: "prod-1" }, error: null }),
        then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(resolve),
      };
      return q;
    };
    current = { client: { from: chain } } as never;
    await recordProductionFromPrep({ userId: "u-cook", role: "key_holder" }, {
      locationId: LOC, instanceId: "inst-1", templateItemId: "tpl-1", outputItemId: "i-slaw", outputQty: 2, source: "opening_p2",
      confirmedConsumption: [{ skuId: "s-lettuce", qtyOz: unitToOz(1, "each", atLoc), qtyEntered: 1, unitEntered: "each", derivedOz: null }],
    });
    expect(saved).toEqual([expect.objectContaining({ input_sku_id: "s-lettuce", input_oz: 160, qty_entered: 1, unit_entered: "each" })]);
  });
});

describe("catering surplus divides by the shop's case", () => {
  it("routes its denominator through the one resolver and the scoped content rule", () => {
    const src = readFileSync("lib/catering/surplus.ts", "utf8");
    expect(src).toContain("loadSkuPackResolution(skuIds, args.locationId ?? null)");
    expect(src).toContain("contentOzForScope(");
  });
});
