import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const walkerMocks = vi.hoisted(() => ({ rhythms: vi.fn(async () => new Map()), stores: vi.fn(async () => new Set<string>()) }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));
vi.mock("@/lib/dynamic-pars-probes", () => ({
  parAutoMovesReady: vi.fn(async () => true), parAutoLaneReady: vi.fn(async () => false),
  parSuggestionActionsReady: vi.fn(async () => false), salesSignalsReady: vi.fn(async () => true),
}));
vi.mock("@/lib/ordering-sources", () => ({ loadStoreVendorIds: walkerMocks.stores }));
vi.mock("@/lib/operational-task-access", () => ({ canDoOperationalTask: vi.fn(async () => true), auditOperationalTaskOverride: vi.fn(async () => {}) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));
vi.mock("@/lib/prep-consumption", () => ({
  loadMeasures: vi.fn(async () => new Map()), loadSkuPackChains: vi.fn(async () => new Map()),
  loadShopPackEpochs: vi.fn(async () => new Map()),
}));
vi.mock("@/lib/vendor-rhythm", () => ({
  loadRhythmByVendor: walkerMocks.rhythms,
  loadRhythmSkips: vi.fn(async () => new Map()),
  loadAllCutoffsByVendor: vi.fn(async () => new Map()),
}));

import { loadParSuggestions } from "@/lib/dynamic-pars-walker";
import { createCountsReadRefs } from "@/lib/counts-read-refs";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { createFakeDb } from "@/tests/fixtures/counts-fake-db";
import { recordDelivery } from "@/lib/receiving";
import { recordParRunSkipped, runParShadowForLocation } from "@/lib/dynamic-pars";
import { createCountEvent } from "@/lib/counts";

const source = (file: string) => readFileSync(new URL(`../lib/${file}`, import.meta.url), "utf8");

const SHOP = "11111111-1111-4111-8111-111111111111";
const FOREIGN = "22222222-2222-4222-8222-222222222222";
const SKU = "33333333-3333-4333-8333-333333333333";
const VENDOR = "44444444-4444-4444-8444-444444444444";
const ledger = [{
  id: "1", sku_id: SKU, day_class: "weekday", run_date: "2026-10-15", tier: "suggestion",
  outcome: "suggestion", suppressed_by: null, reason_code: "ok", current_par: 1, par_step: 1,
  base_rate_oz_per_day: 1, velocity_ratio: 1, cushion_pct: 0, per_order_unit_oz: 1,
  peak_floor_oz: 0, detail: {},
}];
function walkerClient(selfLoaded: boolean) {
  return { from(table: string) {
    const data = table === "par_auto_moves" ? ledger : selfLoaded
      ? [{ id: SKU, name: "Foreign", vendor_id: VENDOR, location_id: FOREIGN }]
      : [];
    const q: Record<string, unknown> = {};
    for (const op of ["select", "eq", "gte", "lte", "order", "or"]) q[op] = () => q;
    q.range = () => q;
    q.returns = () => q;
    q.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data, error: null }).then(resolve);
    return q;
  } } as never;
}

beforeEach(() => vi.clearAllMocks());

describe("shop-owned operational consumers", () => {
  it("filters product members before they enter product resolution", () => {
    const text = source("products.ts");
    expect(text).toContain("m.location_id !== locationId");
    expect(text.indexOf("m.location_id !== locationId")).toBeLessThan(text.indexOf("productBySku.set(m.id"));
  });

  it("filters both normal and skipped nightly par universes before writes", () => {
    const text = source("dynamic-pars.ts");
    expect(text.match(/s\.location_id == null \|\| s\.location_id === locationId/g)).toHaveLength(2);
    expect(text.indexOf("const routable =")).toBeLessThan(text.indexOf("const skuIds = routable"));
    expect(text.indexOf("const universe =")).toBeLessThan(text.indexOf("for (const s of universe)"));
  });

  it("filters self-loaded and passed suggestion indexes", () => {
    const text = source("dynamic-pars-walker.ts");
    expect(text).toContain("r.location_id == null || r.location_id === locationId");
    expect(text).toContain("sku.locationId == null || sku.locationId === locationId");
  });

  it.each(["passed", "self-loaded"] as const)("excludes historical foreign suggestions in %s index mode", async (mode) => {
    const passed = new Map([[SKU, { vendorId: VENDOR, name: "Foreign", locationId: FOREIGN }]]);
    const result = await loadParSuggestions(walkerClient(mode === "self-loaded"), SHOP, {
      walkDateEt: "2026-10-15", walkMinutesEt: 600, dayClass: "weekday", canAct: true,
    }, mode === "passed" ? passed : undefined);
    expect(result.size).toBe(0);
    expect(walkerMocks.rhythms).toHaveBeenCalledWith(expect.anything(), [], SHOP);
  });

  it("rejects a forged foreign missing-credit SKU before any delivery write", async () => {
    const delivered = "55555555-5555-4555-8555-555555555555";
    const missing = "66666666-6666-4666-8666-666666666666";
    const writes: string[] = [];
    const client = { from(table: string) {
      let ids: unknown[] = [];
      const q: Record<string, unknown> = {};
      for (const op of ["select", "eq", "is", "ilike", "order"]) q[op] = () => q;
      q.in = (_column: string, values: unknown[]) => { ids = values; return q; };
      q.insert = () => { writes.push(table); return q; };
      q.returns = () => q;
      q.maybeSingle = () => q;
      q.then = (resolve: (value: unknown) => unknown) => {
        let data: unknown = [];
        if (table === "vendors") data = { id: VENDOR, source_kind: "vendor" };
        else if (table === "purchase_orders") data = { id: "po", vendor_id: VENDOR, location_id: SHOP, status: "placed" };
        else if (table === "vendor_deliveries") data = null;
        else if (table === "vendor_items") data = ids.includes(missing)
          ? [{ id: missing, vendor_id: VENDOR, location_id: FOREIGN }]
          : [{ id: delivered, vendor_id: VENDOR, location_id: null, pack_format: null,
              each_container_label: null, units_per_pack: 1, each_size: null, each_measure: null,
              avg_oz_per_each: null, weight_class: null }];
        return Promise.resolve({ data, error: null }).then(resolve);
      };
      return q;
    } };
    vi.mocked(getServiceRoleClient).mockReturnValue(client as never);
    const actor = { user: { id: "user", role: "gm" }, locations: [SHOP], level: 7 } as never;
    await expect(recordDelivery(actor, {
      locationId: SHOP, vendorId: VENDOR, deliveryDate: "2026-10-15", purchaseOrderId: "po",
      lines: [{ skuId: delivered, qtyReceived: 1 }],
      missingLines: [{ skuId: missing, expectedQty: 1, unitPrice: 1 }],
    })).rejects.toMatchObject({ status: 404, code: "not_found" });
    expect(writes).toEqual([]);
  });

  it("rejects a forged foreign delivered SKU before creating a delivery header", async () => {
    const foreign = "77777777-7777-4777-8777-777777777777";
    const writes: string[] = [];
    const client = { from(table: string) {
      const q: Record<string, unknown> = {};
      for (const op of ["select", "eq", "is", "ilike", "order", "in"]) q[op] = () => q;
      q.insert = () => { writes.push(table); return q; };
      q.returns = () => q;
      q.maybeSingle = () => q;
      q.then = (resolve: (value: unknown) => unknown) => {
        const data = table === "vendors" ? { id: VENDOR, source_kind: "vendor" }
          : table === "vendor_deliveries" ? null
          : table === "vendor_items" ? [{ id: foreign, vendor_id: VENDOR, location_id: FOREIGN,
              pack_format: null, each_container_label: null, units_per_pack: 1, each_size: null,
              each_measure: null, avg_oz_per_each: null, weight_class: null }]
          : [];
        return Promise.resolve({ data, error: null }).then(resolve);
      };
      return q;
    } };
    vi.mocked(getServiceRoleClient).mockReturnValue(client as never);
    const actor = { user: { id: "user", role: "gm" }, locations: [SHOP], level: 7 } as never;
    await expect(recordDelivery(actor, {
      locationId: SHOP, vendorId: VENDOR, deliveryDate: "2026-10-15",
      lines: [{ skuId: foreign, qtyReceived: 1 }],
    })).rejects.toMatchObject({ status: 404, code: "not_found" });
    expect(writes).toEqual([]);
  });

  it("writes no skipped-run ledger rows for a foreign owned SKU", async () => {
    const inserted: Array<Record<string, unknown>> = [];
    const client = { from(table: string) {
      let operation = "select";
      const q: Record<string, unknown> = {};
      for (const op of ["select", "eq", "neq", "or", "order"]) q[op] = () => q;
      q.delete = () => { operation = "delete"; return q; };
      q.insert = (rows: Array<Record<string, unknown>>) => { operation = "insert"; inserted.push(...rows); return q; };
      q.returns = () => q;
      q.then = (resolve: (value: unknown) => unknown) => {
        const data = table === "vendor_items" ? [
          { id: "shared", vendor_id: VENDOR, active: true, weekday_par: 1, weekend_par: 1, par_step: 1, location_id: null },
          { id: "own", vendor_id: VENDOR, active: true, weekday_par: 1, weekend_par: 1, par_step: 1, location_id: SHOP },
          { id: "foreign", vendor_id: VENDOR, active: true, weekday_par: 1, weekend_par: 1, par_step: 1, location_id: FOREIGN },
        ] : [];
        return Promise.resolve({ data: operation === "select" ? data : null, error: null }).then(resolve);
      };
      return q;
    } };
    vi.mocked(getServiceRoleClient).mockReturnValue(client as never);
    await expect(recordParRunSkipped(SHOP, "2026-10-15", null)).resolves.toMatchObject({ rows: 4 });
    expect(new Set(inserted.map((row) => row.sku_id))).toEqual(new Set(["shared", "own"]));
    expect(inserted.some((row) => row.sku_id === "foreign")).toBe(false);
  });

  it("derives no IDs or ledger rows for a foreign-only normal nightly universe", async () => {
    const inserted: Array<Record<string, unknown>> = [];
    const inValues: unknown[][] = [];
    const client = { from(table: string) {
      let operation = "select";
      const q: Record<string, unknown> = {};
      for (const op of ["select", "eq", "neq", "or", "order", "is", "gt", "gte", "lt", "lte", "not", "limit"]) q[op] = () => q;
      q.in = (_column: string, values: unknown[]) => { inValues.push(values); return q; };
      q.range = () => q;
      q.delete = () => { operation = "delete"; return q; };
      q.insert = (rows: Array<Record<string, unknown>>) => { operation = "insert"; inserted.push(...rows); return q; };
      q.returns = () => q;
      q.maybeSingle = () => q;
      q.then = (resolve: (value: unknown) => unknown) => {
        const data = table === "vendor_items" ? [{
          id: "foreign", name: "Foreign", vendor_id: VENDOR, item_number: null, active: true,
          pack_format: null, weekday_par: 1, weekend_par: 1, each_container_label: null,
          units_per_pack: 1, each_size: null, each_measure: null, avg_oz_per_each: null,
          product_id: null, inventory_only: true, location_id: FOREIGN,
          cushion_class: null, par_step: 1, sku_class: null,
        }] : [];
        return Promise.resolve({ data: operation === "select" ? data : null, error: null }).then(resolve);
      };
      return q;
    }, rpc: () => Promise.resolve({ data: null, error: null }) };
    vi.mocked(getServiceRoleClient).mockReturnValue(client as never);
    await expect(runParShadowForLocation(SHOP, "2026-10-15")).resolves.toMatchObject({ rows: 0 });
    expect(inValues.some((values) => values.includes("foreign"))).toBe(false);
    expect(inserted.some((row) => row.sku_id === "foreign")).toBe(false);
  });

  it("paginates the complete count roster before projecting shared plus own rows", async () => {
    const vendor_items = Array.from({ length: 1001 }, (_, i) => ({
      id: String(i).padStart(4, "0"), name: `SKU ${String(i).padStart(4, "0")}`,
      pack_format: null, vendor_id: VENDOR, product_id: null, active: true,
      location_id: i < 1000 ? FOREIGN : SHOP,
    }));
    const fake = createFakeDb({ vendor_items });
    vi.mocked(getServiceRoleClient).mockReturnValue(fake.client);
    const roster = await createCountsReadRefs(SHOP).roster();
    expect(roster.map((row) => row.id)).toEqual(["1000"]);
    expect(fake.log.filter((entry) => entry.table === "vendor_items")).toHaveLength(2);
  });

  it("rejects a foreign direct count line before creating a count event", async () => {
    const writes: string[] = [];
    const client = { from(table: string) {
      const q: Record<string, unknown> = {};
      for (const op of ["select", "eq", "in"]) q[op] = () => q;
      q.insert = () => { writes.push(table); return q; };
      q.returns = () => q;
      q.then = (resolve: (value: unknown) => unknown) => Promise.resolve({
        data: table === "vendor_items" ? [{ id: SKU, location_id: FOREIGN }] : [], error: null,
      }).then(resolve);
      return q;
    } };
    vi.mocked(getServiceRoleClient).mockReturnValue(client as never);
    const actor = { user: { id: "user", role: "agm" }, locations: [SHOP], level: 6 } as never;
    await expect(createCountEvent(actor, {
      locationId: SHOP, lines: [{ skuId: SKU, levelLabel: "case", qty: 1, isLoose: false, partialFraction: null }],
    })).rejects.toMatchObject({ status: 400, code: "invalid_sku" });
    expect(writes).toEqual([]);
  });

  it("binds barcode lookup, teach and forget to the shop while allowing inactive own forget", () => {
    const text = source("barcodes.ts");
    expect(text).toContain("r.vendor_items.location_id == null || r.vendor_items.location_id === input.locationId");
    expect(text.match(/sku\.location_id != null && sku\.location_id !== input\.locationId/g)).toHaveLength(2);
    const forget = text.slice(text.indexOf("export async function forgetBarcode"));
    expect(forget).not.toContain("!sku.active");
  });
});
