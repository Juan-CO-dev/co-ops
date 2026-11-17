import { describe, expect, it } from "vitest";
import { USFOODS_INVOICE_HEADER, usfoodsInvoice } from "@/lib/vendor-import-shared/adapters/usfoods-invoice";
import { usfoods, USFOODS_HEADER } from "@/lib/vendor-import-shared/adapters/usfoods";
import { detectAdapter } from "@/lib/vendor-import-shared/adapters";

// The real MOXe "CSV Full" invoice header (57 columns, BillToStreet/ShipToStreet twice). Rows are SYNTHETIC.
const columns = USFOODS_INVOICE_HEADER.split(",");
interface Line { doc?: string; type?: string; date?: string; customer?: string; credit?: string; item: string; desc: string;
  brand?: string; pack: string; weight?: string; qtyShip?: string; unit?: string; price: string; extended?: string }
function line(l: Line): string {
  const cells = columns.map(() => "");
  const set = (name: string, value: string, nth = 0) => {
    let seen = -1;
    const at = columns.findIndex(c => c === name && ++seen === nth);
    cells[at] = value;
  };
  set("DocumentNumber", l.doc ?? "1000001"); set("DocumentType", l.type ?? "FWC_INV"); set("DocumentDate", l.date ?? "11/16/2026");
  set("CustomerNumber", l.customer ?? "90000001"); set("CustomerName", "TEST SHOP ONE"); set("AccountNumber", l.customer ?? "90000001");
  set("CreditMemoNumber", l.credit ?? ""); set("BillToStreet", "1 TEST ST"); set("BillToStreet", "SUITE 2", 1);
  set("RemitToName", "US Foods, Inc."); set("ProductNumber", l.item); set("ProductDescription", l.desc);
  set("Product Label", l.brand ?? "TESTBRAND"); set("PackingSize", l.pack); set("Weight", l.weight ?? "0.00");
  set("QtyOrder", l.qtyShip ?? "1"); set("QtyShip", l.qtyShip ?? "1"); set("QtyAdjust", "0"); set("PricingUnit", l.unit ?? "CS");
  set("UnitPrice", l.price); set("ExtendedPrice", l.extended ?? l.price);
  return cells.map(c => /[",]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c).join(",");
}
const file = (...lines: Line[]) => [USFOODS_INVOICE_HEADER, ...lines.map(line)].join("\n") + "\n";
const name = "InvoiceDetails.csv";

describe("US Foods MOXe invoice CSV (CSV Full)", () => {
  it("pins the real 57-column header, duplicates included", () => {
    expect(columns).toHaveLength(57);
    expect(columns.filter(c => c === "BillToStreet")).toHaveLength(2);
    expect(columns.filter(c => c === "ShipToStreet")).toHaveLength(2);
    expect(columns[46]).toBe("ProductNumber");
    expect(columns[56]).toBe("ExtendedPrice");
  });

  it("is detected unambiguously against the MOXe list adapter, PFG and receipts", () => {
    const text = file({ item: "1000001", desc: "CHEESE, TEST SHRD", pack: "6/5 LB", price: "91.2700" });
    expect(usfoodsInvoice.detects(text)).toBe(true);
    expect(usfoods.detects(text)).toBe(false);
    expect(usfoodsInvoice.detects(`${USFOODS_HEADER}\n1,G,1,x,y,z,1,c,s\n`)).toBe(false);
    expect(detectAdapter(text)?.id).toBe("usfoods-invoice-csv");
    expect(detectAdapter(`﻿${text}`)?.id).toBe("usfoods-invoice-csv");
    expect(detectAdapter(text, undefined, "xlsx")).toBeNull();
    expect(usfoodsInvoice.detects(text.replace("ProductNumber", "ItemNumber"))).toBe(false);
  });

  it("reads a case-priced line: price per CS, pack, item, brand, account, invoice date, quantity shipped", () => {
    const [row] = usfoodsInvoice.parse(file({ item: "1000001", desc: "CHEESE, MOZZ TEST", brand: "TESTLABEL", pack: "6/5 LB", qtyShip: "2", price: "91.2700", extended: "182.54" }), name);
    expect(row).toMatchObject({
      vendor: "usfoods", source_file: name, source_line: 2, account_id: "90000001", list_name: "US Foods invoice 1000001",
      item_no: "1000001", description: "CHEESE, MOZZ TEST", brand: "TESTLABEL", pack: "6/5 LB", pack_qty: 6, pack_size: 5, pack_unit: "LB",
      uom: "CS", price_basis: "per case", price_cents: 9127, price_per_lb_cents: null,
      last_purchase_qty: 2, last_purchase_uom: "CS", last_purchase_date: "2026-11-16", exported_at: "2026-11-16",
    });
    expect(row!.pack_catch_weight).toBeUndefined();
  });

  it("reads PricingUnit LB as a catch-weight per-pound price and keeps the shipped weight", () => {
    const [row] = usfoodsInvoice.parse(file({ item: "1000002", desc: "HAM, TEST", pack: "2/13 LB", weight: "26.40", unit: "LB", price: "2.7263", extended: "71.97" }), name);
    expect(row).toMatchObject({ uom: "LB", price_basis: "per lb", price_cents: null, price_per_lb_cents: 272.63,
      pack_catch_weight: true, net_wt_lb: 26.4, last_purchase_uom: "LB" });
  });

  it("maps EA to per each and leaves an unknown pricing unit unresolved for a person", () => {
    const rows = usfoodsInvoice.parse(file(
      { item: "1000003", desc: "LIDS", pack: "1/100 EA", unit: "EA", price: "0.1500" },
      { item: "1000004", desc: "BAG THING", pack: "1/10 LB", unit: "BG", price: "4.0000" },
    ), name);
    expect(rows[0]).toMatchObject({ uom: "EA", price_basis: "per each", price_cents: 15 });
    expect(rows[1]).toMatchObject({ uom: "BG", price_basis: null, price_cents: 400 });
  });

  it("keeps several invoices and accounts in one file, each line citing its own invoice", () => {
    const rows = usfoodsInvoice.parse(file(
      { doc: "1000001", item: "1000001", desc: "A", pack: "6/5 LB", price: "10.0000" },
      { doc: "1000002", date: "11/18/2026", customer: "90000002", item: "1000001", desc: "A", pack: "6/5 LB", price: "11.0000" },
    ), name);
    expect(rows.map(r => [r.list_name, r.account_id, r.exported_at, r.source_line])).toEqual([
      ["US Foods invoice 1000001", "90000001", "2026-11-16", 2], ["US Foods invoice 1000002", "90000002", "2026-11-18", 3],
    ]);
  });

  it("never prices from a credit memo, a non-invoice document or a negative line, and counts what it skipped", () => {
    const text = file(
      { item: "1000001", desc: "A", pack: "6/5 LB", price: "10.0000" },
      { type: "FWC_CM", item: "1000001", desc: "A", pack: "6/5 LB", price: "10.0000" },
      { credit: "555", item: "1000001", desc: "A", pack: "6/5 LB", price: "10.0000" },
      { item: "1000001", desc: "A", pack: "6/5 LB", qtyShip: "-1", price: "10.0000", extended: "-10.00" },
      { type: "", item: "1000001", desc: "A", pack: "6/5 LB", price: "10.0000" },
      { item: "1000001", desc: "A", pack: "6/5 LB", price: "-10.0000" },
    );
    const rows = usfoodsInvoice.parse(text, name);
    expect(rows.map(r => r.source_line)).toEqual([2]);
    expect(usfoodsInvoice.ignoredRows!(text)).toBe(5);
  });

  it("refuses a malformed row rather than guessing columns", () => {
    const text = `${USFOODS_INVOICE_HEADER}\n1000001,FWC_INV,11/16/2026\n`;
    expect(() => usfoodsInvoice.parse(text, name)).toThrow(/invalid US Foods invoice row/);
    expect(() => usfoodsInvoice.parse(file({ item: "", desc: "A", pack: "6/5 LB", price: "1.0000" }), name)).toThrow();
    expect(() => usfoodsInvoice.parse(file({ date: "2026-11-16", item: "1", desc: "A", pack: "6/5 LB", price: "1.0000" }), name)).toThrow();
    expect(() => usfoodsInvoice.parse(file({ item: "1", desc: "A", pack: "6/5 LB", price: "1.23456" }), name)).toThrow();
  });
});

describe("US Foods invoice lines that did not ship (CC decision 4)", () => {
  it("keeps a QtyShip 0 line as price evidence but flags it not shipped; shipped lines carry no flag", () => {
    const rows = usfoodsInvoice.parse(file({ item: "1000001", desc: "SHIPPED", pack: "6/5 LB", price: "10.0000" },
      { item: "1000002", desc: "NOT SHIPPED", pack: "6/5 LB", price: "11.0000", qtyShip: "0" }), name);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.flags ?? []).toEqual([]);
    expect(rows[1]).toMatchObject({ item_no: "1000002", last_purchase_qty: 0, price_cents: 1100, flags: ["not_shipped"] });
  });
});
