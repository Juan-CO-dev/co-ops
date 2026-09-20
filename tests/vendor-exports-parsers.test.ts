import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EXPORT_ROOT, normalizeText } from "../scripts/vendor-exports/normalize";
import { parseCsv, parseDate, parsePack, parsePrice, parsePurchase } from "../scripts/vendor-exports/parsers";
import { packEqual } from "../scripts/vendor-exports/diff-core";

describe("vendor export primitives", () => {
  it.each([
    ["12/12 CT", 12, 12, "CT"], ["1/13 LB", 1, 13, "LB"], ["6/#10 CN", 6, "#10", "CN"],
    ["24/16.9 OZ", 24, 16.9, "OZ"], ["1/1000 FT", 1, 1000, "FT"], ["250/1 CT", 250, 1, "CT"],
    ["2/5 LT", 2, 5, "LT"], ["9/3 LB", 9, 3, "LB"], ["1/30 DZ", 1, 30, "DZ"],
  ])("preserves pack %s", (raw, qty, size, unit) => {
    expect(parsePack(String(raw))).toEqual({ pack: raw, pack_qty: qty, pack_size: size, pack_unit: unit });
  });
  it.each(["", "10 pounds maybe", "0/5 LB", "1/0 LB", "6/#10 LB", "2/5 UNKNOWN"])("flags unknown pack %s", raw => {
    expect(parsePack(raw)).toEqual({ pack: raw, pack_qty: null, pack_size: null, pack_unit: null, pack_unparsed: true });
  });
  it("keeps per-pound decimal cents separate from case cents", () => {
    expect(parsePrice("$2.7263/lb")).toEqual({ price_cents: null, price_per_lb_cents: 272.63 });
    expect(parsePrice("$9.486/lb")).toEqual({ price_cents: null, price_per_lb_cents: 948.6 });
    expect(parsePrice("$39.97")).toEqual({ price_cents: 3997, price_per_lb_cents: null });
    expect(parsePrice("")).toEqual({ price_cents: null, price_per_lb_cents: null });
    expect(() => parsePrice("$2/case?")).toThrow();
  });
  it("validates dates and retains empty last purchases", () => {
    expect(parsePurchase("2 CS 09/17/2026")).toEqual({ last_purchase_qty: 2, last_purchase_uom: "CS", last_purchase_date: "2026-09-17" });
    expect(parsePurchase("").last_purchase_date).toBeNull();
    expect(() => parseDate("02/30/2026")).toThrow();
  });
  it("handles escaped inches, embedded commas/newlines, CRLF and physical line numbers", () => {
    expect(parseCsv('a,"FOIL 18"" ROLL",c\r\n"two,\nlines",b,c\r\nnext,b,c')).toEqual([
      { cells: ["a", 'FOIL 18" ROLL', "c"], line: 1 },
      { cells: ["two,\nlines", "b", "c"], line: 2 },
      { cells: ["next", "b", "c"], line: 4 },
    ]);
    expect(() => parseCsv('"unterminated')).toThrow();
    expect(() => parseCsv('"closed"junk')).toThrow();
  });
});

describe("waves 2–3 packs and adapters", () => {
  it.each([
    ["2/2 LB", { pack_qty: 2, pack_size: 2, pack_unit: "LB" }],
    ["10 LBA", { pack_qty: 1, pack_size: 10, pack_unit: "LB", pack_catch_weight: true }],
    ["6/#10 CN", { pack_qty: 6, pack_size: "#10", pack_unit: "CN" }],
    ["24/100 EA", { pack_qty: 24, pack_size: 100, pack_unit: "EA" }],
    ["2/9-10 LBA", { pack_qty: 2, pack_size: null, pack_unit: "LB", pack_catch_weight: true, pack_size_min: 9, pack_size_max: 10 }],
    ["2/90/.5 OZ", { pack_qty: 2, pack_inner_qty: 90, pack_size: 0.5, pack_unit: "OZ" }],
    ["12-14 LBA", { pack_qty: 1, pack_size: null, pack_unit: "LB", pack_catch_weight: true, pack_size_min: 12, pack_size_max: 14 }],
    ["1 RL", { pack_qty: 1, pack_size: 1, pack_unit: "RL" }],
    ["50 RL", { pack_qty: 1, pack_size: 50, pack_unit: "RL" }],
    ["48/10 GR", { pack_qty: 48, pack_size: 10, pack_unit: "GR" }],
    ["12/1 QT", { pack_qty: 12, pack_size: 1, pack_unit: "QT" }],
  ])("pins %s including vendor padding", (raw, parsed) => {
    expect(parsePack(raw)).toEqual({ pack: raw, ...parsed });
    expect(parsePack(`${raw}   `)).toEqual({ pack: `${raw}   `, ...parsed });
  });
  it("does not collapse ranges, inner packs or catch-weight into a fixed pack", () => {
    expect(packEqual("2/9-10 LBA", "2/8-10 LBA")).toBe(false);
    expect(packEqual("2/90/.5 OZ", "2/80/.5 OZ")).toBe(false);
    expect(packEqual("10 LBA", "10 LB")).toBe(false);
    for (const raw of ["2/10-9 LBA", "2/0/.5 OZ", "2/3/4/5 OZ", "6/#10 LB", "2/big LB"]) {
      expect(parsePack(raw)).toMatchObject({ pack: raw, pack_unparsed: true });
    }
  });
  it.each([
    ["order-guide-514925-managed", 96], ["list-daily", 241], ["list-master", 76],
    ["recently-purchased", 101], ["list-catering-supplies", 52],
  ])("pins the independently measured MOXe %s rows", (stem, count) => {
    const file = `${stem}-2026-09-18.csv`;
    const raw = readFileSync(join(EXPORT_ROOT, "usfoods", file), "utf8");
    const rows = normalizeText("usfoods", raw, file);
    expect(rows).toHaveLength(Number(count));
    expect(rows.every(r => r.account_id === "71628390" && r.exported_at === "2026-09-18")).toBe(true);
    expect(rows.every(r => r.price_cents === null && r.price_per_lb_cents === null && r.last_purchase_date === null && r.last_purchase_qty === null)).toBe(true);
    expect(rows.every(r => !r.pack_unparsed && r.description === r.description.trim())).toBe(true);
    expect(rows.at(-1)!.source_line).toBe(Number(count) + 1);
    for (const row of rows) expect(raw.split(/\r?\n/)[row.source_line - 1]).toContain(`"${row.item_no}"`);
    expect(() => normalizeText("usfoods", raw.replace("Product Number", "Wrong Number"), file)).toThrow(/adapter/);
    expect(() => normalizeText("usfoods", raw, "unknown-2026-09-18.csv")).toThrow(/metadata/);
  });
  const batch = (n: number) => {
    const file = `receipts-2026-09-18-batch${n}.json`;
    const text = readFileSync(join(EXPORT_ROOT, "receipts", file), "utf8");
    return { file, text, rows: normalizeText("receipts", text, file) };
  };
  it("pins all ten receipts, vendors, dates, quantities and source lines", () => {
    const one = batch(1), two = batch(2);
    expect(one.rows).toHaveLength(12); expect(two.rows).toHaveLength(19);
    const all = [...one.rows, ...two.rows];
    expect(new Set(all.map(r => r.receipt_doc)).size).toBe(10);
    expect(new Set(all.map(r => r.vendor)).size).toBe(8);
    expect(all.filter(r => !r.item_no)).toHaveLength(2);
    for (const { text, rows } of [one, two]) {
      const input = JSON.parse(text) as { receipts: { date: string; lines: { qty: number }[] }[] };
      expect(rows.map(r => [r.last_purchase_date, r.last_purchase_qty])).toEqual(input.receipts.flatMap(r => r.lines.map(l => [r.date, l.qty])));
      for (const row of rows) expect(text.split(/\r?\n/)[row.source_line - 1]).toContain(JSON.stringify(row.description));
    }
    expect(all.find(r => r.vendor === "Baldor")!.last_purchase_date).toBe("2026-07-01");
    expect(all.find(r => r.vendor === "TriMark")!.account_id).toBe("22031");
    expect(all.find(r => r.vendor === "Cardinal Bakery")!.account_id).toBe("CO");
  });
  it("preserves billed versus clarified Utz prices, zero price and catch-weight quantity", () => {
    const all = [...batch(1).rows, ...batch(2).rows];
    expect(all.find(r => r.item_no === "00602")).toMatchObject({ price_cents: 39, billed_price_cents: 2335, last_purchase_qty: 2, pack: "60/1 OZ" });
    expect(all.find(r => r.item_no === "27149")).toMatchObject({ price_cents: 437, pack: "9/12.5 OZ", last_purchase_qty: 108 });
    expect(all.find(r => r.item_no === "20970")!.price_cents).toBe(0);
    expect(all.find(r => r.item_no === "278")).toMatchObject({ price_cents: null, price_per_lb_cents: 629, net_wt_lb: 35.96, last_purchase_qty: 4, last_purchase_uom: "PIECE", pack_catch_weight: true });
    expect(all.find(r => r.item_no === "1030")).toMatchObject({ price_cents: 787, price_basis: "per dozen" });
    expect(all.find(r => r.vendor === "Country Snacks")).toMatchObject({ price_cents: 2520, price_basis: "per case", pack: "1/14 EA", last_purchase_qty: 23 });
    expect(all.find(r => r.item_no === "75")).toMatchObject({ price_cents: 2545, price_basis: "per case", uom: "CS" });
  });
  it("rejects malformed receipt dates, quantities, identity and prices", () => {
    const { text, file } = batch(1);
    for (const changed of [text.replace('"2026-09-17"', '"2026-02-30"'), text.replace('"qty": 108', '"qty": -1'), text.replace('"unit_net": 4.37', '"unit_net": "4.37"'), text.replace('"vendor": "Thompson Delivers"', '"vendor": null')]) {
      expect(() => normalizeText("receipts", changed, file)).toThrow();
    }
  });
});

describe("PFG real-file adapter", () => {
  // Counted independently with PowerShell ConvertFrom-Csv before implementing the parser.
  it.each([
    ["purchase-history", 97], ["list-izzy-main", 84], ["list-comp-only-opening", 58],
    ["list-compliments-only-managed", 14], ["list-paper-goods", 20],
  ])("pins every row in %s", (stem, count) => {
    const file = `${stem}-2026-09-18.csv`;
    const raw = readFileSync(join(EXPORT_ROOT, "pfg", file), "utf8");
    const rows = normalizeText("pfg", raw, file);
    expect(rows).toHaveLength(count as number);
    expect(rows[0]!.source_line).toBe(9);
    expect(rows.at(-1)!.source_line).toBe(8 + Number(count));
    expect(rows.every(r => r.account_id === "56910015" && r.exported_at === "2026-09-18")).toBe(true);
    expect(rows.every(r => !r.pack_unparsed)).toBe(true);
    expect(new Set(rows.map(r => r.item_no)).size).toBe(count);
    for (const row of rows) expect(raw.split(/\r?\n/)[row.source_line - 1]).toContain(`,${row.item_no},`);
    if (stem === "list-izzy-main") {
      expect(rows.find(r => r.item_no === "240288")!.description).toBe('FOIL STANDARD 18" ROLL');
      expect(rows.find(r => r.item_no === "913783")!.last_purchase_qty).toBeNull();
    }
    expect(() => normalizeText("us-foods", raw, file)).toThrow(/adapter/);
    expect(() => normalizeText("pfg", raw.replace("Product Number,Pack Size", "Wrong,Pack Size"), file)).toThrow(/adapter/);
  });
});
