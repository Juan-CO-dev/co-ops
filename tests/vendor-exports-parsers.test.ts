import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EXPORT_ROOT, normalizeText } from "../scripts/vendor-exports/normalize";
import { parseCsv, parseDate, parsePack, parsePrice, parsePurchase } from "../scripts/vendor-exports/parsers";

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
