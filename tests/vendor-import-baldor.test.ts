import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { buildXlsx, buildZip, SMARTSHOP_HEADER } from "./helpers/xlsx-fixture";
import { isZip, readXlsxFirstSheet, XLSX_LIMITS } from "@/lib/vendor-import-xlsx";
import { rowsToCsv } from "@/lib/vendor-import-shared/parsers";
import { baldorSmartshop, smartshopPack } from "@/lib/vendor-import-shared/adapters/baldor";
import { detectAdapter } from "@/lib/vendor-import-shared/adapters";

const fileName = "smartshop_export_2026-01-01_2026-11-15.xlsx";
// SYNTHETIC items in the SmartShop "Purchase History" shape.
const sheet = [
  [...SMARTSHOP_HEADER],
  ["t1", "Test Greens", "3 LB", 2, 18],
  ["t2", "Test Herb", "3 X 2 LB", 208, 33.75],
  ["t3", "Test Tomatoes", "6 X #10", 1, 12.990000000000002],
  ["t4", "Test Cream", "1/2 GAL", 4, null],
] as const;
const text = (rows: ReadonlyArray<ReadonlyArray<string | number | null>> = sheet) => rowsToCsv(readXlsxFirstSheet(buildXlsx(rows)));

describe("xlsx reader (no new dependency; node:zlib with limits)", () => {
  it("sniffs a ZIP by its local header signature, not the name", () => {
    expect(isZip(buildXlsx(sheet))).toBe(true);
    expect(isZip(new TextEncoder().encode("ID,Title\n"))).toBe(false);
    expect(isZip(new Uint8Array([0x50, 0x4b]))).toBe(false);
  });

  it("reads the first sheet with shared strings and numbers, row numbers preserved", () => {
    const rows = readXlsxFirstSheet(buildXlsx(sheet));
    expect(rows[0]).toEqual([...SMARTSHOP_HEADER]);
    expect(rows[1]).toEqual(["t1", "Test Greens", "3 LB", "2", "18"]);
    expect(rows[4]).toEqual(["t4", "Test Cream", "1/2 GAL", "4", ""]);
  });

  it("decodes XML entities and keeps a gap row so line numbers stay true", () => {
    const rows = readXlsxFirstSheet(buildXlsx([[...SMARTSHOP_HEADER], ["x", "Pete's & Co <b>", "1 LB", 1, 1]]));
    expect(rows[1]![1]).toBe("Pete's & Co <b>");
  });

  it("refuses a non-zip, an encrypted entry, an unknown method, a zip bomb and a DOCTYPE", () => {
    expect(() => readXlsxFirstSheet(new TextEncoder().encode("hello"))).toThrow(/xlsx/);
    const workbook = buildXlsx(sheet);
    const encrypted = buildZip([{ name: "xl/workbook.xml", data: "<workbook/>", flags: 1 }]);
    expect(() => readXlsxFirstSheet(encrypted)).toThrow(/xlsx/);
    const bomb = buildZip([
      { name: "xl/workbook.xml", data: `<workbook><sheets><sheet r:id="rId1"/></sheets></workbook>` },
      { name: "xl/_rels/workbook.xml.rels", data: `<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>` },
      { name: "xl/worksheets/sheet1.xml", data: "<worksheet>" + " ".repeat(XLSX_LIMITS.maxEntryBytes + 10) + "</worksheet>" },
    ]);
    expect(() => readXlsxFirstSheet(bomb)).toThrow(/xlsx/);
    const doctype = buildZip([
      { name: "xl/workbook.xml", data: `<!DOCTYPE x [<!ENTITY a "b">]><workbook><sheets><sheet r:id="rId1"/></sheets></workbook>` },
    ]);
    expect(() => readXlsxFirstSheet(doctype)).toThrow(/xlsx/);
    expect(() => readXlsxFirstSheet(workbook.slice(0, workbook.length - 30))).toThrow(/xlsx/);
  });

  it("refuses a sheet path that escapes xl/", () => {
    expect(() => readXlsxFirstSheet(buildXlsx(sheet, { sheetPath: "../../etc/sheet1.xml" }))).toThrow(/xlsx/);
  });
});

describe("Baldor SmartShop purchase-history adapter", () => {
  it("is detected only from an xlsx upload, never from a text CSV with the same header", () => {
    expect(detectAdapter(text(), undefined, "xlsx")?.id).toBe("baldor-smartshop-xlsx");
    expect(detectAdapter(text(), undefined, "text")).toBeNull();
    expect(detectAdapter(text())).toBeNull();
    expect(detectAdapter(text([["ID", "Title", "Size", "Qty", "Current Price"]]), undefined, "xlsx")).toBeNull();
  });

  it("maps ID, Title, Size, Quantity and Current Price; the date is the end of the export range", () => {
    const rows = baldorSmartshop.parse(text(), fileName);
    expect(rows[0]).toMatchObject({
      vendor: "baldor", source_file: fileName, source_line: 2, account_id: "", list_name: "SmartShop purchase history",
      item_no: "t1", description: "Test Greens", brand: "", pack: "3 LB", pack_qty: 1, pack_size: 3, pack_unit: "LB",
      uom: "CS", price_basis: "per case", price_cents: 1800, price_per_lb_cents: null,
      last_purchase_qty: 2, last_purchase_uom: "CS", last_purchase_date: null, exported_at: "2026-11-15",
    });
    expect(rows[1]).toMatchObject({ item_no: "t2", pack_qty: 3, pack_size: 2, pack_unit: "LB", price_cents: 3375, last_purchase_qty: 208 });
    expect(rows[2]).toMatchObject({ pack_qty: 6, pack_size: "#10", pack_unit: "CN", price_cents: 1299 });
    expect(rows[3]).toMatchObject({ pack_unparsed: true, price_cents: null });
    expect(rows[0]!.notes).toEqual(["Quantity is the total bought 2026-01-01 to 2026-11-15, not one order."]);
  });

  it("marks a bare-unit size (sold by weight) as catch weight with no fixed pack, so the case estimate never prices on its own", () => {
    const [row] = baldorSmartshop.parse(text([[...SMARTSHOP_HEADER], ["w1", "Test Chicken", "LB", 7, 115.6]]), fileName);
    expect(row).toMatchObject({ pack: "LB", pack_unparsed: true, pack_catch_weight: true, price_cents: 11560, price_basis: "per case" });
    expect(row!.notes).toContain("Sold by weight: the price is SmartShop's estimate for a case of varying weight.");
  });

  it("accepts a browser-renamed copy and refuses a file with no export range", () => {
    expect(baldorSmartshop.parse(text(), "smartshop_export_2026-01-01_2026-11-15 (1).xlsx")[0]!.exported_at).toBe("2026-11-15");
    expect(() => baldorSmartshop.parse(text(), "purchases.xlsx")).toThrow(/export range/);
    expect(() => baldorSmartshop.parse(text(), "smartshop_export_2026-11-15_2026-01-01.xlsx")).toThrow(/export range/);
  });

  it("refuses an unreadable price or quantity instead of guessing", () => {
    expect(() => baldorSmartshop.parse(text([[...SMARTSHOP_HEADER], ["x", "X", "1 LB", 1, "about 5"]]), fileName)).toThrow();
    expect(() => baldorSmartshop.parse(text([[...SMARTSHOP_HEADER], ["x", "X", "1 LB", "two", 5]]), fileName)).toThrow();
    expect(() => baldorSmartshop.parse(text([[...SMARTSHOP_HEADER], ["", "X", "1 LB", 1, 5]]), fileName)).toThrow();
  });

  it.each([
    ["3 LB", "3 LB"], ["3 X 2 LB", "3/2 LB"], ["24 X 16.9 OZ", "24/16.9 OZ"], ["6 X #10", "6/#10 CN"], ["1 GAL", "1 GA"],
    ["5 LT", "5 LT"], ["12 CT", "12 CT"], ["12 X 1 QT", "12/1 QT"],
  ])("normalizes SmartShop size %s like %s", (size, pack) => {
    const parsed = smartshopPack(size);
    expect(parsed.pack).toBe(size);
    expect(parsed.pack_unparsed).toBeUndefined();
    expect(parsed.pack_unit).toBe(pack.split(" ").at(-1));
  });

  it.each(["1/2 GAL", "Heavy Cream 40%", "", "2 inch Shells"])("never guesses a size like %s", size => {
    expect(smartshopPack(size)).toMatchObject({ pack: size, pack_unparsed: true });
  });
});

describe("rowsToCsv", () => {
  it("quotes every cell so commas, quotes and newlines round-trip", () => {
    expect(rowsToCsv([["a,b", 'q"t', "x\ny"]])).toBe('"a,b","q""t","x\ny"\n');
  });
});

describe("Baldor LB-sized rows (CC decision 1: a question for Juan)", () => {
  it("flags every size in pounds 'price per listed size - check', and nothing else", () => {
    const rows = baldorSmartshop.parse(text([[...SMARTSHOP_HEADER], ["a", "A", "3 LB", 1, 18], ["b", "B", "3 X 2 LB", 1, 33.75],
      ["c", "C", "LB", 1, 115.6], ["d", "D", "24 X 16.9 OZ", 1, 20], ["e", "E", "6 X #10", 1, 30]]), fileName);
    expect(rows.map(r => r.flags ?? [])).toEqual([["price_per_listed_size"], ["price_per_listed_size"], ["price_per_listed_size"], [], []]);
  });
});
