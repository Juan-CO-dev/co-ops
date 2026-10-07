import { beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ tables: {} as Record<string, Record<string, unknown>[]> }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/prep-consumption", () => ({
  loadMeasures: async () => new Map([["oz", { dimension: "weight", toBaseFactor: 1 }]]),
  loadSkuPackChains: async () => new Map(),
}));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => ({
  from: (table: string) => {
    let rows = fixture.tables[table] ?? [];
    const query = {
      select: () => query,
      order: () => query,
      or: () => query,
      is: () => query,
      in: (key: string, values: unknown[]) => { rows = rows.filter(row => values.includes(row[key])); return query; },
      eq: (key: string, value: unknown) => {
        rows = rows.filter(row => key.split(".").reduce<unknown>((current, part) =>
          (current as Record<string, unknown> | undefined)?.[part], row) === value);
        return query;
      },
      range: (from: number, to: number) => { rows = rows.slice(from, to + 1); return query; },
      returns: () => query,
      then: (resolve: (value: { data: typeof rows; error: null }) => unknown) =>
        Promise.resolve({ data: rows, error: null }).then(resolve),
    };
    return query;
  },
}) }));

import { loadProductIndex } from "@/lib/products";

const receipt = (id: string, source: "vendor" | "store", location: string, day: number) => ({
  id, delivery_id: id, vendor_item_id: source === "store" ? "store-sku" : "regular-sku",
  created_at: `2026-10-${String(day).padStart(2, "0")}T12:00:00Z`,
  vendor_deliveries: { location_id: location,
    created_at: `2026-10-${String(day).padStart(2, "0")}T12:00:00Z`, vendors: { source_kind: source } },
});

beforeEach(() => {
  fixture.tables = {
    products: [{ id: "product", name: "Ingredient", active: true, unit_oz: 1 }],
    vendor_items: ["regular", "store"].map(source => ({ id: `${source}-sku`, name: source,
      vendor_id: source, product_id: "product", active: true, pending_review: false,
      location_id: source === "store" ? "north" : null, units_per_pack: 1,
      each_size: 16, each_measure: "oz", avg_oz_per_each: null })),
    vendors: [{ id: "regular", name: "Regular", active: true, source_kind: "vendor" },
      { id: "store", name: "Store", active: true, source_kind: "store" }],
    vendor_delivery_items: [receipt("one", "store", "north", 1), receipt("two", "store", "north", 2), receipt("three", "store", "south", 3)],
  };
});

describe("product loader store eligibility", () => {
  it("does not pool other-shop receipts, then promotes on the third local receipt", async () => {
    expect((await loadProductIndex(["product"], "north")).index.resolution.get("product")?.skuId).toBe("regular-sku");
    expect((await loadProductIndex(["product"])).index.resolution.get("product")?.skuId).toBe("regular-sku");
    fixture.tables.vendor_delivery_items!.push(receipt("four", "store", "north", 4));
    expect((await loadProductIndex(["product"], "north")).index.resolution.get("product")?.skuId).toBe("store-sku");
    expect((await loadProductIndex(["product"])).index.resolution.get("product")?.skuId).toBe("store-sku");
    fixture.tables.vendor_delivery_items!.push(receipt("five", "vendor", "north", 5));
    expect((await loadProductIndex(["product"], "north")).index.resolution.get("product")?.skuId).toBe("regular-sku");
  });
  it("uses the vendor-down exception but never another location's store member", async () => {
    fixture.tables.vendors![0]!.active = false;
    expect((await loadProductIndex(["product"], "north")).index.resolution.get("product")?.skuId).toBe("store-sku");
    expect((await loadProductIndex(["product"], "south")).index.resolution.get("product")?.skuId).toBeNull();
  });
  it("retains received stock membership when a supplier retires or merges", async () => {
    fixture.tables.vendors![1]!.active = false;
    const loaded = await loadProductIndex(["product"], "north");
    expect(loaded.byProduct.get("product")?.members.find(m => m.skuId === "store-sku"))
      .toMatchObject({ active: true, vendorActive: false });
    expect(loaded.index.resolution.get("product")?.skuId).toBe("regular-sku");
  });
});
