import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { EXPORT_ROOT, ROOT, normalizeText } from "../scripts/vendor-exports/normalize";
import { catalogPackComparison, crossVendorCandidates, purchaseProxyMetrics, receiptCatalogDelta, receiptPurchaseDecisions, receiptUnitCosts } from "../scripts/vendor-exports/wave-reports";
import type { ExportRow } from "../scripts/vendor-exports/model";
import type { CatalogRow } from "../scripts/vendor-exports/diff-core";

const load = (vendor: string, extension: string) => readdirSync(join(EXPORT_ROOT, vendor)).filter(f => f.endsWith(extension)).sort().flatMap(f => {
  const path = join(EXPORT_ROOT, vendor, f);
  return normalizeText(vendor, readFileSync(path, "utf8"), relative(ROOT, path).replaceAll("\\", "/"));
});
const us = load("usfoods", ".csv");
const receipts = load("receipts", ".json");
const pfg = load("pfg", ".csv");
const find = (vendor: string, item: string) => receipts.find(r => r.vendor === vendor && r.item_no === item)!;

describe("wave 2/3 report evidence", () => {
  it("generated JSON matches real-source normalization byte for byte", () => {
    for (const [vendor, ext] of [["usfoods", ".csv"], ["receipts", ".json"]]) {
      for (const file of readdirSync(join(EXPORT_ROOT, vendor!)).filter(f => f.endsWith(ext!))) {
        const path = join(EXPORT_ROOT, vendor!, file);
        const rows = normalizeText(vendor!, readFileSync(path, "utf8"), relative(ROOT, path).replaceAll("\\", "/"));
        expect(readFileSync(join(EXPORT_ROOT, "normalized", `${vendor}-${file.slice(0, -ext!.length)}.json`), "utf8")).toBe(JSON.stringify(rows, null, 2) + "\n");
      }
    }
  });
  it("new report table rows cite nonblank original source lines and include all A–H sections", () => {
    const dir = join(EXPORT_ROOT, "reports");
    for (const vendor of ["usfoods", "receipts"]) {
      const report = readFileSync(join(dir, `2026-09-18-${vendor}-diff.md`), "utf8");
      for (const section of "ABCDEFGH") expect(report).toContain(`## ${section}.`);
      const lines = report.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        if (!line.startsWith("| ") || line.startsWith("| ---") || lines[i + 1]?.startsWith("| ---")) continue;
        const refs = [...line.matchAll(/\]\(([^)]+)#L(\d+)\)/g)];
        expect(refs.length, line).toBeGreaterThan(0);
        for (const ref of refs) expect(readFileSync(resolve(dir, ref[1]!), "utf8").split(/\r?\n/)[Number(ref[2]) - 1]?.trim(), ref[0]).toBeTruthy();
      }
    }
  });
  it("counts the actual five lists and excludes the purchase proxy itself from live ranking", () => {
    expect(us).toHaveLength(566);
    const metrics = purchaseProxyMetrics(us);
    expect(metrics).toHaveLength(4);
    expect(metrics.every(m => m.proxyCount === 101 && m.name !== "Recently Purchased")).toBe(true);
    const expected: Record<string, number> = { "Order Guide #514925": 96, "Daily List": 240, "Master List": 75, "Catering Supplies": 51 };
    for (const m of metrics) {
      expect(m.count).toBe(expected[m.name]);
      expect(m.coverage).toBe(m.overlap / 101);
      expect(m.jaccard).toBe(m.overlap / (m.count + 101 - m.overlap));
    }
    expect(metrics[0]!.name).toBe("Order Guide #514925");
    expect(purchaseProxyMetrics([...us, us[0]!]).map(({ name, count, overlap, coverage, jaccard }) => ({ name, count, overlap, coverage, jaccard }))).toEqual(metrics.map(({ name, count, overlap, coverage, jaccard }) => ({ name, count, overlap, coverage, jaccard })));
  });
  it("refuses a mixed account proxy universe", () => {
    expect(() => purchaseProxyMetrics([...us, { ...us[0]!, account_id: "other" }])).toThrow(/scope/);
  });
  it("compares enriched packs only for exact vendor identities", () => {
    const row = find("Cardinal Bakery", "1030");
    const sku: CatalogRow = { id: "test", name: "Roll", vendor: row.vendor, item_number: row.item_no, pack: "1/2 DZ", source_file: "fixture", source_line: 1 };
    expect(catalogPackComparison(row, sku)).toContain("different parsed hierarchy");
    expect(catalogPackComparison(row, { ...sku, pack: row.pack })).toContain("same parsed hierarchy");
    expect(catalogPackComparison(row, { ...sku, pack: null })).toContain("unavailable");
    expect(catalogPackComparison(row, { ...sku, vendor: "other" })).toContain("unavailable");
  });
  it("finds real mayo and cooked-egg twins without merging turkey into ham", () => {
    const twins = crossVendorCandidates([...pfg, ...us, ...receipts]);
    const mayo = twins.find(t => t.family === "Duke's mayonnaise")!;
    expect(mayo.pfg.some(r => r.item_no === "32118")).toBe(true);
    expect(mayo.usfoods.some(r => r.item_no === "9189275")).toBe(true);
    const eggs = twins.find(t => t.family === "Hard-cooked eggs")!;
    expect(eggs.pfg.some(r => r.item_no === "439686")).toBe(true);
    expect(eggs.usfoods.some(r => r.item_no === "827428")).toBe(true);
    expect(twins.find(t => t.family === "Turkey")?.usfoods.every(r => /turkey/i.test(r.description)) ?? true).toBe(true);
    expect(twins.flatMap(t => t.pfg).every(r => r.vendor === "pfg")).toBe(true);
    expect(twins.some(t => t.family === "Fresh basil")).toBe(true);
    expect(twins.some(t => t.family === "Fresh peeled garlic")).toBe(true);
  });
  it("uses measured pounds, not printed pieces or nominal pack, for catch-weight extensions", () => {
    const turkey = find("Boar's Head", "278");
    expect(turkey.last_purchase_qty).toBe(4);
    expect(receiptUnitCosts(turkey)).toEqual({ perOzCents: 39.3125, perEachCents: null, extendedCents: 22619 });
    expect(receiptUnitCosts({ ...turkey, net_wt_lb: undefined }).extendedCents).toBeNull();
    expect(receiptUnitCosts({ ...turkey, last_purchase_qty: 999 })).toEqual(receiptUnitCosts(turkey));
  });
  it("retains dozen-to-roll precision and the billed mini-chip discrepancy", () => {
    expect(receiptUnitCosts(find("Cardinal Bakery", "1030")).perEachCents).toBeCloseTo(787 / 12);
    const mini = find("Thompson Delivers", "00602");
    expect(receiptUnitCosts(mini)).toMatchObject({ perEachCents: 39, extendedCents: 4670 });
    expect(mini.price_cents! * 60 - mini.billed_price_cents!).toBe(5);
    expect(receiptUnitCosts(find("Country Snacks", "")).extendedCents).toBe(57960);
  });
  it("converts dollar/oz catalog prices only on exact same-vendor identities", () => {
    const turkey = find("Boar's Head", "278");
    const sku: CatalogRow = { id: "test", name: "Turkey", vendor: "Boar's Head", item_number: "278", price_per_oz: 0.4, source_file: "fixture", source_line: 1 };
    expect(receiptCatalogDelta(turkey, sku).delta).toBe(-11);
    expect(receiptCatalogDelta(turkey, { ...sku, item_number: null }).delta).toBeNull();
    expect(receiptCatalogDelta(turkey, { ...sku, vendor: "US Foods" }).delta).toBeNull();
    expect(receiptCatalogDelta(turkey, { ...sku, price_per_oz: null }).delta).toBeNull();
    const dozen: ExportRow = find("Cardinal Bakery", "1030");
    expect(receiptCatalogDelta(dozen, { ...sku, vendor: dozen.vendor, item_number: dozen.item_no, price_cents: 700 }).delta).toBeNull();
  });
  it("recomputes purchase-unit explanations when receipt observations change", () => {
    const country = find("Country Snacks", "");
    const changed = receiptPurchaseDecisions([{ ...country, price_cents: 2800, billed_price_cents: 2800, last_purchase_qty: 2 }]);
    expect(changed[0]!.text).toContain("14 bags × $2.00 = $28.00/case; 2 cases = 28 bags = $56.00");
    expect(changed[0]!.text).not.toContain("579.60");
    const mini = find("Thompson Delivers", "00602");
    const explanation = receiptPurchaseDecisions([{ ...mini, price_cents: 40, billed_price_cents: 2390, last_purchase_qty: 3 }])[0]!.text;
    expect(explanation).toContain("$24.00/box versus billed $23.90/box: $0.10 difference");
    expect(explanation).toContain("billed extension $71.70");
    const roll = find("Cardinal Bakery", "1030");
    expect(receiptPurchaseDecisions([{ ...roll, price_cents: 840, billed_price_cents: 840, last_purchase_qty: 2 }])[0]!.text).toContain("$8.40/dozen = $0.70/roll; 2 dozen = 24 rolls ($16.80)");
  });
});
