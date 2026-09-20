import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { CATALOG_FILE, derivePack, latestPrices, loadCatalog, parseCatalog, type ProdExport, type ProdPrice } from "../scripts/vendor-exports/catalog";

describe("production export catalog join", () => {
  it("pins all exported table counts and physical SKU/price/pack citations", () => {
    const { catalog, data } = loadCatalog();
    const counts = { locations: 2, vendors: 21, vendor_items: 229, sku_pack_levels: 186, measure_units: 21, vendor_price_history: 103, location_sku_settings: 0, vendor_order_guides: 15, order_guide_sections: 24, order_guide_lines: 163 };
    expect(data.counts).toEqual(counts);
    for (const [key, count] of Object.entries(counts)) expect((data[key as keyof ProdExport] as unknown[]).length).toBe(count);
    expect(catalog).toHaveLength(229);
    const lines = readFileSync(CATALOG_FILE, "utf8").split("\n");
    for (const row of catalog) {
      expect(lines[row.source_line - 1]).toContain(row.id);
      expect(row.active).toBe(data.vendor_items.find(s => s.id === row.id)!.active);
      if (row.price_evidence) expect(lines[row.price_evidence.source_line - 1]).toContain('"id"');
      for (const evidence of row.pack_evidence ?? []) expect(lines[evidence.source_line - 1]).toMatch(/"(?:id|label)"/);
    }
    expect(catalog.some(row => !row.active)).toBe(true);
    data.counts.vendor_items = 230;
    expect(() => parseCatalog(JSON.stringify(data), "fixture.json")).toThrow("Export count mismatch: vendor_items");
  });

  it("selects effective date first, then recorded time, then id (DESC)", () => {
    const base: ProdPrice = { id: "a", vendor_item_id: "sku", unit_price: 10, effective_date: "2026-09-18", recorded_at: "2026-09-18T10:00:00Z" };
    expect(latestPrices([base, { ...base, id: "b", unit_price: 12, effective_date: "2026-09-19", recorded_at: "2026-09-17T10:00:00Z" }]).get("sku")?.unit_price).toBe(12);
    expect(latestPrices([base, { ...base, id: "b", unit_price: 14, recorded_at: "2026-09-18T11:00:00Z" }]).get("sku")?.unit_price).toBe(14);
    expect(latestPrices([{ ...base, id: "b", unit_price: 16 }, base]).get("sku")?.unit_price).toBe(16);
    expect(latestPrices([{ ...base, id: "b", unit_price: 18, recorded_at: "2026-09-18T06:00:00.000002-04:00" }, { ...base, recorded_at: "2026-09-18T10:00:00.000001Z" }]).get("sku")?.unit_price).toBe(18);
  });

  it("derives the Case, Each (no case), and Bag shapes actually present", () => {
    const { data } = loadCatalog();
    for (const [name, expected] of [["Parmesan (Grated)", "4/80 OZ"], ["Heavy Cream", "1/384 OZ"], ["Utz BBQ", "1/2.75 OZ"]]) {
      const sku = data.vendor_items.find(s => s.name.trim() === name)!;
      expect(sku).toBeDefined();
      expect(derivePack(sku)).toBe(expected);
    }
    expect(derivePack({ pack_format: "Case", units_per_pack: null, each_size: null, each_measure: null })).toBeNull();
  });

  it("uses active pointer-linked chains over stale flat fields without falling back on broken chains", () => {
    const { data } = loadCatalog();
    const sku = data.vendor_items.find(s => data.sku_pack_levels.some(p => p.sku_id === s.id && p.active))!;
    data.vendor_items = [{ ...sku, units_per_pack: 999, each_size: 999, each_measure: "oz" }];
    data.sku_pack_levels = [
      { id: "root", sku_id: sku.id, label: "case", contains_qty: 4, contains_level_id: "leaf", contains_measure_unit: null, display_ordinal: 99, active: true },
      { id: "leaf", sku_id: sku.id, label: "log", contains_qty: 34, contains_level_id: null, contains_measure_unit: "oz", display_ordinal: 0, active: true },
      { id: "old", sku_id: sku.id, label: "case", contains_qty: 500, contains_level_id: null, contains_measure_unit: "oz", display_ordinal: 0, active: false },
    ];
    data.counts.vendor_items = 1;
    data.counts.sku_pack_levels = 3;
    let result = parseCatalog(JSON.stringify(data, null, 2), "fixture.json").catalog[0]!;
    expect(result.content_oz).toBe(136);
    expect(result.pack).toBe("4/34 OZ");
    expect(result.flat_pack).toBe("999/999 OZ");
    data.sku_pack_levels[0]!.contains_level_id = "inner";
    data.sku_pack_levels.push({ id: "inner", sku_id: sku.id, label: "box", contains_qty: 2, contains_level_id: "leaf", contains_measure_unit: null, display_ordinal: 1, active: true });
    data.counts.sku_pack_levels = 4;
    result = parseCatalog(JSON.stringify(data, null, 2), "fixture.json").catalog[0]!;
    expect(result.pack).toBe("4/2/34 OZ");
    expect(result.content_oz).toBe(272);
    data.sku_pack_levels[0]!.contains_level_id = "missing";
    result = parseCatalog(JSON.stringify(data, null, 2), "fixture.json").catalog[0]!;
    expect(result.content_oz).toBeNull();
    expect(result.pack).toBeNull();
  });
});
