import { describe, expect, it } from "vitest";
import { parsePack } from "@/lib/vendor-import-shared/parsers";
import type { CatalogSku, ExportRow } from "@/lib/vendor-import-shared/model";
import { matchObservations } from "@/lib/vendor-import-shared/match";
import { priceAtRoot } from "@/lib/vendor-import-shared/reconcile";

/**
 * Audit W04/B008. `vendor_price_history.unit_price` is dollars per INTERNAL PURCHASE ROOT
 * (0210's column comment; costing divides it by the root's content oz). `price_basis` only says
 * how the vendor bills. A per-each receipt line must therefore land as the price of the whole root.
 */
const row = (pack: string, extra: Partial<ExportRow> = {}): ExportRow => ({ vendor: "v", source_file: "x", source_line: 1, account_id: "", list_name: "", category: "", item_no: "27149", description: "Utz Ripples", brand: "", ...parsePack(pack), uom: "CS", price_cents: null, price_per_lb_cents: null, last_purchase_qty: null, last_purchase_uom: null, last_purchase_date: null, exported_at: "2026-11-10", ...extra });
const ripplesRoot: NonNullable<CatalogSku["root"]> = { levelId: "box", label: "box", quantity: 112.5, unit: "oz", dimension: "weight" };

describe("W04/B008 importer prices the internal root, whatever the catalog price basis", () => {
  it("a $4.37/bag receipt for a per_each SKU whose root is the 9-bag box is $39.33 at the root", () => {
    const receipt = row("9/12.5 OZ", { price_cents: 437, price_basis: "per each", uom: "EA" });
    expect(priceAtRoot(receipt, ripplesRoot, "per_each")).toBe(39.33);
    expect(priceAtRoot(receipt, ripplesRoot, "per_case")).toBe(39.33);
  });

  it("the matcher sees the same $39.33 as the current price (no 9x-low price_changed)", () => {
    const receipt = row("9/12.5 OZ", { price_cents: 437, price_basis: "per each", uom: "EA", receipt_doc: "receipts-2026-11-10-batch1.json", last_purchase_date: "2026-11-10" });
    const sku: CatalogSku = { id: "ripples", vendor_id: "v", name: "Utz Ripples", item_number: "27149", active: true, root: ripplesRoot, packCounts: [9], latestPrice: { id: "p", unit_price: 39.33, effective_date: "2026-09-20" }, price_basis: "per_each" };
    const observations = matchObservations([receipt], [sku], "v");
    expect(observations.some((o) => o.kind === "price")).toBe(false);
    expect(observations[0]).toMatchObject({ kind: "noop", reason: "price_same" });
  });

  it("a per-each Butter case price stays the case price at the 36 lb root", () => {
    expect(priceAtRoot(row("36/1 LB", { price_cents: 8030 }), { ...ripplesRoot, quantity: 576 }, "per_each")).toBe(80.3);
  });

  it("a per-pound quote is expressed at the root for every coherent basis", () => {
    const quote = row("2/4 LB", { price_per_lb_cents: 629 });
    const root = { ...ripplesRoot, quantity: 128 };
    for (const basis of ["per_case", "per_each", "per_lb"] as const) expect(priceAtRoot(quote, root, basis)).toBe(50.32);
  });

  it("still refuses an unknown or incoherent catalog basis (held for a person)", () => {
    expect(priceAtRoot(row("1/1 LB", { price_cents: 100 }), { ...ripplesRoot, quantity: 16 }, null)).toBeNull();
    expect(priceAtRoot(row("4/1 GA", { price_cents: 7399 }), { ...ripplesRoot, quantity: 512, dimension: "volume", unit: "fl oz" }, "per_lb")).toBeNull();
  });
});
