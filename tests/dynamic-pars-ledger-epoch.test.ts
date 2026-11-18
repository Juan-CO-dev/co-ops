/**
 * Audit W18/B106: after a pack-size change, the walk kept offering (and Accept kept writing) a
 * suggestion computed from the ledger's persisted `per_order_unit_oz` / `current_par`, a number
 * in the OLD case size. The engine now stamps `detail.pack_epoch` on every ledger row and the
 * walker drops a row whose epoch is not the shop's live one.
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb } from "./fixtures/counts-fake-db";

const h = vi.hoisted(() => ({ epochs: vi.fn(async () => new Map<string, number>()) }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));
vi.mock("@/lib/dynamic-pars-probes", () => ({ parAutoMovesReady: async () => true, parAutoLaneReady: async () => false, parSuggestionActionsReady: async () => false }));
vi.mock("@/lib/ordering-sources", () => ({ loadStoreVendorIds: async () => new Set<string>() }));
vi.mock("@/lib/prep-consumption", () => ({ loadShopPackEpochs: h.epochs }));
vi.mock("@/lib/vendor-rhythm", () => ({
  loadRhythmByVendor: async () => new Map([["v", [0, 1, 2, 3, 4, 5, 6].map((d) => ({ vendorId: "v", locationId: SHOP, orderDow: d, leadDays: 1 }))]]),
  loadRhythmSkips: async () => new Map(),
  loadAllCutoffsByVendor: async () => new Map(),
}));
import { loadParSuggestions } from "@/lib/dynamic-pars-walker";
import { ledgerEpochStands } from "@/lib/dynamic-pars-shared";

const SHOP = "11111111-1111-4111-8111-111111111111";
const SKU = "33333333-3333-4333-8333-333333333333";
const row = (dayClass: "weekday" | "weekend", detail: Record<string, unknown>) => ({
  id: `${dayClass}-1`, location_id: SHOP, sku_id: SKU, day_class: dayClass, run_date: "2026-10-14", tier: "suggestion",
  outcome: "suggestion", suppressed_by: null, reason_code: "ok", current_par: 10, par_step: 1,
  // Two covered days at 70 oz/day in 10 oz units: a target of 14 against a par of 10 (a suggestion).
  base_rate_oz_per_day: 70, velocity_ratio: 1, cushion_pct: 0, per_order_unit_oz: 10, peak_floor_oz: 0, detail,
});
const walk = { walkDateEt: "2026-10-15", walkMinutesEt: 600, dayClass: "weekday" as const, canAct: true };
const index = new Map([[SKU, { vendorId: "v", name: "Ham", locationId: null }]]);
const suggestions = (detail: Record<string, unknown>) =>
  loadParSuggestions(createFakeDb({ par_auto_moves: [row("weekday", detail), row("weekend", detail)] }).client, SHOP, walk, index);

beforeEach(() => vi.clearAllMocks());

describe("the walk drops a ledger row from an older pack epoch", () => {
  it("control: a row stamped with the live epoch is offered, carrying that epoch for the accept (fix round 1)", async () => {
    h.epochs.mockResolvedValue(new Map([[SKU, 2]]));
    const out = await suggestions({ pack_epoch: 2 });
    expect(out.has(SKU)).toBe(true);
    expect(out.get(SKU)!.packEpoch).toBe(2);
  });
  it("a suggestion computed in an older pack epoch is not offered (accept then answers suggestion_superseded)", async () => {
    h.epochs.mockResolvedValue(new Map([[SKU, 2]]));
    expect((await suggestions({ pack_epoch: 1 })).has(SKU)).toBe(false);
  });
  it("an unstamped pre-deploy row stands only at epoch 0", async () => {
    h.epochs.mockResolvedValue(new Map());
    expect((await suggestions({})).has(SKU)).toBe(true);
    h.epochs.mockResolvedValue(new Map([[SKU, 1]]));
    expect((await suggestions({})).has(SKU)).toBe(false);
  });
});

it("ledgerEpochStands: a numeric stamp must equal the live epoch; no stamp means epoch 0; anything else fails", () => {
  expect(ledgerEpochStands(3, 3)).toBe(true);
  expect(ledgerEpochStands(2, 3)).toBe(false);
  expect(ledgerEpochStands(undefined, 0)).toBe(true);
  expect(ledgerEpochStands(null, 0)).toBe(true);
  expect(ledgerEpochStands(undefined, 1)).toBe(false);
  expect(ledgerEpochStands("3", 3)).toBe(false);
  expect(ledgerEpochStands(Number.NaN, 0)).toBe(false);
});

it("the nightly engine stamps the pack epoch on every ledger row, outside the generation id", () => {
  const src = readFileSync("lib/dynamic-pars.ts", "utf8");
  // Item 4 PR 1: the nightly loop lives in the pure engine module now; the stamp moved with it, unchanged.
  const engine = readFileSync("lib/dynamic-pars-engine-shared.ts", "utf8");
  expect(engine).toContain("pack_epoch: inputs.packEpochBySku?.get(sku.skuId) ?? 0,");
  expect(src).toContain("const ledger = computeParLedger(inputs, mode);");
  expect(engine).not.toMatch(/generationIdFor\([^)]*pack_epoch/);
  // Epoch FIRST (fix round 2): the shop's whole epoch map is read before the par'd-SKU universe.
  expect(src).toContain("const shopPackEpochs = await loadShopPackEpochsAt(locationId);");
  expect(src.indexOf("await loadShopPackEpochsAt(locationId)")).toBeLessThan(src.indexOf("await loadParSkuUniverse<DbSkuRow>("));
  expect(src).toContain("stampEffectivePack(overlayBySku, packEpochBySku);");
  expect(src).not.toMatch(/generationIdFor\([^)]*pack_epoch/);
});
