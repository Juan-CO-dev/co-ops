/**
 * W16 — the single-box and batch prep folds (lib/prep-consumption.ts) over the real recipe graph
 * (shop-versions fixture: Slaw = 24 oz lettuce + 8 oz mayo per quart).
 *   B183: the single-box fold reconciles the client's confirmed set against the SERVER's recipe.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb } from "./fixtures/counts-fake-db";
import { buildShopVersionsFixture, LOC } from "./fixtures/shop-versions-fixture";
import { recordProductionFromPrep, type ConfirmedInput } from "@/lib/prep-consumption";

let current: ReturnType<typeof createFakeDb> | null = null;
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => {
  if (!current) throw new Error("no fake db installed");
  return current.client;
} }));
const audits = vi.hoisted(() => [] as Array<Record<string, unknown>>);
vi.mock("@/lib/audit", () => ({ audit: async (row: Record<string, unknown>) => { audits.push(row); } }));

const actor = { userId: "u-kh", role: "key_holder" as const };
const base = { locationId: LOC, instanceId: "inst-1", templateItemId: "tpl-1", outputItemId: "i-slaw", source: "opening_p2" as const };
const confirmed = (skuId: string, qtyOz: number, extra: Partial<ConfirmedInput> = {}): ConfirmedInput =>
  ({ skuId, qtyOz, qtyEntered: null, unitEntered: null, derivedOz: qtyOz, ...extra });

beforeEach(() => {
  const t = buildShopVersionsFixture();
  t.productions = [];
  t.production_inputs = [];
  current = createFakeDb(t);
  audits.length = 0;
});
afterEach(() => { current = null; });

const writtenLines = () => current!.writes.filter((w) => w.table === "production_inputs").flatMap((w) => w.rows)
  .map((r) => ({ sku: r.input_sku_id, oz: r.input_oz, derived: r.derived_oz, qty: r.qty_entered, unit: r.unit_entered }))
  .sort((a, b) => String(a.sku).localeCompare(String(b.sku)));

describe("W16/B183: the single-box fold trusts the recipe for WHICH SKUs, the prepper for HOW MUCH", () => {
  it("a confirmed SKU the recipe does not name is dropped, and missing recipe SKUs are filled at their derived oz", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await recordProductionFromPrep(actor, { ...base, outputQty: 2,
      confirmedConsumption: [confirmed("s-pickle", 99), confirmed("s-lettuce", 50, { qtyEntered: 2, unitEntered: "each", derivedOz: 999 })] });
    expect(writtenLines()).toEqual([
      { sku: "s-lettuce", oz: 50, derived: 48, qty: 2, unit: "each" },  // the prepper's amount, the server's derived
      { sku: "s-mayo", oz: 16, derived: 16, qty: null, unit: null },     // filled from the recipe
    ]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("s-pickle"));
    warn.mockRestore();
  });

  it("null (crew / untouched panel) records the derived set exactly", async () => {
    await recordProductionFromPrep(actor, { ...base, outputQty: 2, confirmedConsumption: null });
    expect(writtenLines()).toEqual([
      { sku: "s-lettuce", oz: 48, derived: 48, qty: null, unit: null },
      { sku: "s-mayo", oz: 16, derived: 16, qty: null, unit: null },
    ]);
  });

  it("a recipe SKU zeroed on purpose stays out and is not refilled", async () => {
    await recordProductionFromPrep(actor, { ...base, outputQty: 2, confirmedConsumption: [confirmed("s-mayo", 0)] });
    expect(writtenLines()).toEqual([{ sku: "s-lettuce", oz: 48, derived: 48, qty: null, unit: null }]);
  });
});
