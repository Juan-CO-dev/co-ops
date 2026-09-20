import { describe, expect, it } from "vitest";
import { parsePack } from "@/lib/vendor-import-shared/parsers";
import type { CatalogSku, ExportRow } from "@/lib/vendor-import-shared/model";
import { packComparison, priceAtRoot, vendorContents } from "@/lib/vendor-import-shared/reconcile";

const row = (pack: string, extra: Partial<ExportRow> = {}): ExportRow => ({ vendor: "v", source_file: "x", source_line: 1, account_id: "", list_name: "", category: "", item_no: "1", description: "x", brand: "", ...parsePack(pack), uom: "CS", price_cents: null, price_per_lb_cents: null, last_purchase_qty: null, last_purchase_uom: null, last_purchase_date: null, exported_at: "2026-09-20", ...extra });
const root = (quantity: number, dimension: "weight" | "volume" | "count" = "weight", unit = "oz"): NonNullable<CatalogSku["root"]> => ({ levelId: "r", label: "case", quantity, dimension, unit });
describe("vendor import reconciliation", () => {
  it("prices Butter per each (the pound) while its root is the 36 lb case", () => { expect(priceAtRoot(row("36/1 LB", { price_cents: 8030 }), root(576), "per_each")).toBe(2.23); expect(packComparison(row("36/1 LB"), root(576)).same).toBe(true); expect(packComparison(row("36/1 LB"), root(16)).proposedQuantity).toBe(576); });
  it("prices a per-pound quote per pound, per case at the root, per each at the vendor each", () => { expect(priceAtRoot(row("8 LB", { price_per_lb_cents: 629 }), root(128), "per_lb")).toBe(6.29); expect(priceAtRoot(row("8 LB", { price_per_lb_cents: 629 }), root(128), "per_case")).toBe(50.32); expect(priceAtRoot(row("2/4 LB", { price_per_lb_cents: 629 }), root(128), "per_each")).toBe(25.16); });
  it("normalizes volume without assuming mass", () => { expect(priceAtRoot(row("4/1 GA", { price_cents: 7399 }), root(512, "volume", "fl oz"), "per_each")).toBe(18.50); expect(priceAtRoot(row("4/1 GA", { price_cents: 7399 }), root(512, "volume", "fl oz"), "per_case")).toBe(73.99); expect(priceAtRoot(row("4/1 GA", { price_cents: 7399 }), root(512, "volume", "fl oz"), "per_lb")).toBeNull(); });
  it("preserves number-ten cans", () => expect(vendorContents(row("6/#10 CN"))).toEqual({ quantity: 6, unit: "can", dimension: "count" }));
  it("retains nested counts", () => expect(vendorContents(row("12/12 CT"))).toEqual({ quantity: 144, unit: "each", dimension: "count" }));
  it("refuses unknown basis", () => expect(priceAtRoot(row("1/1 LB", { price_cents: 100 }), root(16), null)).toBeNull());
  it("refuses dimension mismatch", () => expect(packComparison(row("1/1 GA"), root(128)).dimensionMismatch).toBe(true));
  it("does not treat can count as each", () => expect(packComparison(row("6/#10 CN"), root(6, "count", "each")).proposedQuantity).toBeUndefined());
  it("does not invent fixed ranges or catch weights", () => { expect(vendorContents(row("2/9-10 LBA"))).toBeNull(); expect(vendorContents(row("1/13 LBA"))).toBeNull(); });
  it("refuses a per-pound quote for count", () => expect(priceAtRoot(row("1/12 CT", { price_per_lb_cents: 100 }), root(12, "count", "each"), "per_lb")).toBeNull());
  it("uses receipt billing denomination", () => expect(priceAtRoot(row("9/12.5 OZ", { price_cents: 437, price_basis: "per each", uom: "EA" }), root(112.5), "per_case")).toBe(39.33));
  it("never zeros missing prices", () => expect(priceAtRoot(row("1/1 LB"), root(16), "per_case")).toBeNull());
});
