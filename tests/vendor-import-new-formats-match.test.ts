import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { matchObservations } from "@/lib/vendor-import-shared/match";
import type { CatalogSku } from "@/lib/vendor-import-shared/model";
import { USFOODS_INVOICE_HEADER, usfoodsInvoice } from "@/lib/vendor-import-shared/adapters/usfoods-invoice";
import { baldorSmartshop, SMARTSHOP_COLUMNS } from "@/lib/vendor-import-shared/adapters/baldor";
import { rowsToCsv } from "@/lib/vendor-import-shared/parsers";

// The new rows feed the EXISTING matcher unchanged: prices are proposals for review, never writes.
const sku = (extra: Partial<CatalogSku> = {}): CatalogSku => ({ id: "s", vendor_id: "v", name: "X", item_number: "1000001", active: true,
  root: { levelId: "r", label: "case", quantity: 480, unit: "oz", dimension: "weight" }, latestPrice: { id: "p", unit_price: 80, effective_date: "2026-11-01" },
  price_basis: "per_case", ...extra });
const cols = USFOODS_INVOICE_HEADER.split(",");
function invoice(pack: string, unit: string, price: string, weight = "0.00") {
  const c = cols.map(() => "");
  const put = (n: string, v: string) => { c[cols.indexOf(n)] = v; };
  put("DocumentNumber", "1"); put("DocumentType", "FWC_INV"); put("DocumentDate", "11/16/2026"); put("CustomerNumber", "90000001");
  put("ProductNumber", "1000001"); put("ProductDescription", "TEST"); put("PackingSize", pack); put("Weight", weight);
  put("QtyShip", "1"); put("PricingUnit", unit); put("UnitPrice", price);
  return usfoodsInvoice.parse(`${USFOODS_INVOICE_HEADER}\n${c.join(",")}\n`, "InvoiceDetails.csv");
}

describe("new formats through the existing matcher", () => {
  it("a US Foods case price on the same 6/5 LB pack proposes a price change dated by the invoice", () => {
    expect(matchObservations(invoice("6/5 LB", "CS", "91.2700"), [sku()], "v")[0]).toMatchObject({ kind: "price", reason: "price_changed",
      proposed: { unit_price: 91.27, effective_date: "2026-11-16" } });
  });
  it("a US Foods per-pound line prices the weight root by the pound", () => {
    const root = { levelId: "r", label: "case", quantity: 416, unit: "oz", dimension: "weight" as const };
    expect(matchObservations(invoice("2/13 LB", "LB", "2.5000", "26.10"), [sku({ root, price_basis: "per_lb" })], "v")[0])
      .toMatchObject({ kind: "price", proposed: { unit_price: 65 } });
  });
  it("a Baldor catch-weight case estimate is held for a person, never priced", () => {
    const rows = baldorSmartshop.parse(rowsToCsv([[...SMARTSHOP_COLUMNS], ["1000001", "Test Chicken", "LB", "7", "115.6"]]),
      "smartshop_export_2026-01-01_2026-11-15.xlsx");
    expect(matchObservations(rows, [sku()], "v")[0]).toMatchObject({ kind: "needs_person", reason: "price_basis_unresolved" });
  });
});

describe("flagged rows are shown but never pre-selected (CC decision 4)", () => {
  it("a not-shipped invoice line's price is proposed for review but defaults to skip", async () => {
    const { defaultDecisions, observationKey } = await import("@/lib/vendor-import-shared/match");
    const [row] = invoice("6/5 LB", "CS", "91.2700");
    const shipped = matchObservations([row!], [sku()], "v");
    expect(defaultDecisions(shipped)[observationKey(shipped[0]!)]).toBe("accept");
    const unshipped = matchObservations([{ ...row!, last_purchase_qty: 0, flags: ["not_shipped"] }], [sku()], "v");
    expect(unshipped[0]).toMatchObject({ kind: "price", reason: "price_changed" });
    expect(defaultDecisions(unshipped)[observationKey(unshipped[0]!)]).toBe("skip");
  });
  it("a skipped not-shipped line does not stop a later shipped line for the same SKU from being pre-selected", async () => {
    const { defaultDecisions, observationKey } = await import("@/lib/vendor-import-shared/match");
    const [row] = invoice("6/5 LB", "CS", "91.2700");
    const obs = [{ ...matchObservations([{ ...row!, flags: ["not_shipped"] }], [sku()], "v")[0]!, source_row: 1 },
      { ...matchObservations([row!], [sku()], "v")[0]!, source_row: 2 }];
    const d = defaultDecisions(obs);
    expect([d[observationKey(obs[0]!)], d[observationKey(obs[1]!)]]).toEqual(["skip", "accept"]);
  });
  it("the Baldor listed-size flag is a note to check, not a skip", async () => {
    const { defaultDecisions, observationKey } = await import("@/lib/vendor-import-shared/match");
    const [row] = invoice("6/5 LB", "CS", "91.2700");
    const obs = matchObservations([{ ...row!, flags: ["price_per_listed_size"] }], [sku()], "v");
    expect(defaultDecisions(obs)[observationKey(obs[0]!)]).toBe("accept");
  });
});
