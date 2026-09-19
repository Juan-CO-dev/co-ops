import { describe, expect, it } from "vitest";
import { buildDiff, catalogCandidates, descriptionCandidate, listMetrics, matchGuide, packEqual, priceDelta, recent, uniqueItems, type CatalogRow, type GuideRow } from "../scripts/vendor-exports/diff-core";
import type { ExportRow } from "../scripts/vendor-exports/model";
import { parsePack } from "../scripts/vendor-exports/parsers";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { EXPORT_ROOT } from "../scripts/vendor-exports/normalize";
import { loadInputs } from "../scripts/vendor-exports/diff";

const asOf = "2026-09-18";
const observation = (item_no: string, extra: Partial<ExportRow> = {}): ExportRow => ({
  vendor: "pfg", account_id: "56910015", source_file: "fixture.csv", source_line: 9,
  list_name: "Purchase History", category: "PRODUCE", item_no, description: "ARUGULA BABY", brand: "PACKER",
  ...parsePack("2/2 LB"), uom: "CS", price_cents: 1200, price_per_lb_cents: null,
  last_purchase_qty: 2, last_purchase_uom: "CS", last_purchase_date: "2026-09-17", exported_at: asOf, ...extra,
});
const guide = (item: string, item_number: string): GuideRow => ({ item, item_number, vendor: "PFG", section: "Produce", source_file: "guide.json", source_line: 7 });
const sku = (extra: Partial<CatalogRow> = {}): CatalogRow => ({ id: "s1", vendor: "PFG", name: "Arugula", source_file: "catalog.json", source_line: 6, ...extra });

describe("offline vendor diff", () => {
  it("tiny fixture: number-first, description fallback, genuine gap, candidate absence, and deduplicated lists", () => {
    const rows = [observation("1"), observation("1", { list_name: "Live" }), observation("2", { description: "MINT FRESH" }), observation("3", { description: "BASIL FRESH", last_purchase_date: null, last_purchase_qty: null })];
    const result = buildDiff(rows, [guide("Arugula", "1"), guide("Basil", "old-number"), guide("Absent", "4")], [sku()], asOf);
    expect(result.items).toHaveLength(3);
    expect(result.gaps.map(m => m.guide.item)).toEqual(["Absent"]);
    expect(result.guideMatches[1]!.candidates.map(r => r.item_no)).toEqual(["3"]);
    expect(result.unmatchedPurchases.map(m => m.row.item_no)).toEqual(["2"]);
    expect(result.comparisons[0]!.price.delta).toBeNull(); // missing price is not zero
    expect(result.lists[0]).toMatchObject({ count: 1, overlap: 1, recentCount: 2, jaccard: 0.5, coverage: 0.5 });
  });
  it("keeps vendor/account boundaries and null-vendor catalog records", () => {
    expect(catalogCandidates(observation("1"), [sku({ vendor: "Other", item_number: "1" }), sku({ vendor: null })], []).skus).toEqual([]);
    expect(() => uniqueItems([observation("1"), observation("1", { account_id: "different" })])).toThrow(/scope/);
    expect(() => uniqueItems([observation("1"), observation("1", { vendor: "other" })])).toThrow(/scope/);
  });
  it("does not substitute a different known catalog item number or choose among duplicate catalog numbers", () => {
    expect(catalogCandidates(observation("1"), [sku({ item_number: "2" })], []).skus).toEqual([]);
    const result = buildDiff([observation("1")], [], [sku({ item_number: "1" }), sku({ id: "s2", item_number: "1" })], asOf);
    expect(result.matches[0]!.skus).toHaveLength(2);
    expect(result.comparisons).toEqual([]);
  });
  it("checks inclusive 60 calendar dates and excludes future/missing purchases", () => {
    expect(recent(observation("1", { last_purchase_date: "2026-07-21" }), asOf)).toBe(true);
    expect(recent(observation("1", { last_purchase_date: "2026-07-20" }), asOf)).toBe(false);
    expect(recent(observation("1", { last_purchase_date: asOf }), asOf)).toBe(true);
    expect(recent(observation("1", { last_purchase_date: "2026-09-19" }), asOf)).toBe(false);
    expect(recent(observation("1", { last_purchase_date: null }), asOf)).toBe(false);
    expect(() => recent(observation("1"), "2026-02-30")).toThrow();
  });
  it("does not conflate shell/cooked eggs or fresh/dried chives", () => {
    const cooked = observation("439686", { description: "EGG HARD COOKED PEELED DRY PACK" });
    const shell = observation("517879", { description: "EGG WHITE LARGE AA LOOSE" });
    const m = matchGuide(guide("Eggs", "439686"), [cooked, shell]);
    expect(m.direct).toEqual([cooked]);
    expect(m.candidates).toEqual([shell]);
    expect(catalogCandidates(cooked, [sku({ name: "Eggs" }), sku({ name: "Eggs (cooked)", id: "s2" })], [guide("Eggs", "439686")]).skus.map(s => s.id)).toEqual(["s2"]);
    expect(descriptionCandidate("Dried Chives", observation("855552", { description: "CHIVES FRESH" }))).toBe(false);
  });
  it("prefers newest observations without adding duplicate last-purchase quantities", () => {
    const old = observation("1", { last_purchase_date: "2026-08-01", last_purchase_qty: 99 });
    const newer = observation("1", { list_name: "Live" });
    expect(uniqueItems([old, newer])).toEqual([newer]);
    expect(listMetrics([old, newer, newer], asOf)[0]).toMatchObject({ count: 1, overlap: 1, recentCount: 1 });
  });
  it("computes and sorts absolute price impact only with comparable packs and units", () => {
    const catalog = [sku({ item_number: "1", pack: "2/2 LB", uom: "CS", price_cents: 1000 }), sku({ id: "s2", item_number: "2", pack: "2/2 LB", uom: "CS", price_cents: 2000 })];
    const result = buildDiff([observation("1"), observation("2", { price_cents: 1500 })], [], catalog, asOf);
    expect(result.comparisons.map(c => c.row.item_no)).toEqual(["2", "1"]);
    expect(result.comparisons[0]!.price).toMatchObject({ delta: -500, percent: -25, impact: 1000, weight: 2 });
    expect(priceDelta(sku({ price_cents: 1000, pack: "1/2 LB", uom: "CS" }), observation("1"), asOf).delta).toBeNull();
    expect(priceDelta(sku({ price_cents: 0, pack: "2/2 LB", uom: "CS" }), observation("1"), asOf).percent).toBeNull();
    expect(packEqual("6/#10 CN", "6/10 LB")).toBe(false);
    expect(packEqual("unknown", "unknown")).toBeNull();
  });
  it("does not multiply /lb by case quantity or infer a nominal case weight", () => {
    const row = observation("1", { price_cents: null, price_per_lb_cents: 272.63 });
    const priced = sku({ pack: row.pack, uom: "CS", price_per_lb_cents: 200 });
    expect(priceDelta(priced, row, asOf)).toMatchObject({ delta: 72.63, impact: null, weight: null });
    expect(priceDelta(priced, { ...row, last_purchase_uom: "LB" }, asOf).impact).toBeCloseTo(145.26);
  });
  it("pins wave-1 conflicts, evidence limits, gaps and list metrics from the real artifacts", () => {
    const rows = readdirSync(join(EXPORT_ROOT, "normalized")).filter(f => f.startsWith("pfg-") && f.endsWith(".json")).flatMap(f => JSON.parse(readFileSync(join(EXPORT_ROOT, "normalized", f), "utf8")) as ExportRow[]);
    const { guides, catalog } = loadInputs();
    const result = buildDiff(rows, guides, catalog, asOf);
    expect(rows).toHaveLength(273);
    expect(result.items).toHaveLength(115);
    expect(result.gaps.map(m => m.guide.item)).toEqual(["Dried Chives"]);
    expect(result.unmatchedPurchases.map(m => m.row.item_no)).toEqual(["273740", "273753", "437582", "594968", "71415", "855540"]);
    expect(result.lists[0]).toMatchObject({ name: "Izzy MAIN", overlap: 73, recentCount: 90, count: 84 });
    expect(result.lists[0]!.jaccard).toBeCloseTo(73 / 101);
    expect(result.comparisons.every(c => c.price.delta === null)).toBe(true);
    for (const [label, ids] of [
      ["Eggs (cooked)", ["439686", "466355"]], ["Parmesan (Grated)", ["232190", "238641"]],
      ["Garlic", ["283987", "275595"]], ["Oregano", ["261432", "264694"]],
      ["Basil", ["855571", "23097"]], ["Onion (White)", ["898641", "907426"]],
      ["Fresh Mozzarella", ["397845", "541963"]],
    ] as const) {
      const family = result.conflicts.find(m => m.guide.item === label)!;
      expect(family).toBeDefined();
      expect(new Set([...family.direct, ...family.candidates].map(r => r.item_no))).toEqual(new Set(ids));
    }
  });
  it("every generated report data row cites existing source files and physical lines", () => {
    const reportDir = join(EXPORT_ROOT, "reports");
    const report = readFileSync(join(reportDir, "2026-09-18-pfg-diff.md"), "utf8");
    const lines = report.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      if (!line.startsWith("| ") || line.startsWith("| ---") || lines[i + 1]?.startsWith("| ---")) continue;
      const refs = [...line.matchAll(/\]\(([^)]+)#L(\d+)\)/g)];
      expect(refs.length, line).toBeGreaterThan(0);
      for (const ref of refs) {
        const source = readFileSync(resolve(reportDir, ref[1]!), "utf8").split(/\r?\n/);
        expect(source[Number(ref[2]) - 1]?.trim(), ref[0]).toBeTruthy();
      }
    }
  });
});
