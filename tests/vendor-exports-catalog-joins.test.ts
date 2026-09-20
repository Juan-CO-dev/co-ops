import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { compareCatalog, joinGuideLines, seedLines, type SeedLine } from "../scripts/vendor-exports/catalog-reports";
import { loadCatalog, CATALOG_FILE } from "../scripts/vendor-exports/catalog";
import { EXPORT_ROOT, ROOT } from "../scripts/vendor-exports/normalize";
import type { CatalogRow } from "../scripts/vendor-exports/diff-core";
import type { ExportRow } from "../scripts/vendor-exports/model";

const ev = { source_file: "fixture", source_line: 1 };
const sku = (id: string, item_number: string | null, vendor = "PFG"): CatalogRow => ({ ...ev, id, item_number, vendor, name: id, pack: "1/16 OZ", price_cents: 100, uom: "CS", content_oz: 16, cost_is_estimate: false });
const line = (id: string, sku_id: string | null): SeedLine => ({ ...ev, id, sku_id, vendor: "PFG", item_number: "stale", label: id, section: "section", position: 1 });
const row = (item_no: string, extra: Partial<ExportRow> = {}): ExportRow => ({ ...ev, vendor: "pfg", item_no, account_id: "a", list_name: "History", category: "", description: "item", brand: "", pack: "1/1 LB", pack_qty: 1, pack_size: 1, pack_unit: "LB", uom: "CS", price_cents: 200, price_per_lb_cents: null, last_purchase_qty: 2, last_purchase_uom: "CS", last_purchase_date: "2026-09-18", exported_at: "2026-09-18", ...extra });

describe("real catalog guide joins and comparable units", () => {
  it("uses linked SKU numbers, separates missing links/numbers, scopes vendor and counts each recent candidate once", () => {
    const catalog = [sku("a", "1"), sku("b", null), sku("c", "missing"), sku("d", "2", "Other"), sku("e", "3")];
    const lines = [line("one", "a"), line("two", "b"), line("three", "c"), line("four", null)];
    const result = joinGuideLines(lines, catalog, [row("1"), row("2"), row("2"), row("3"), row("old", { last_purchase_date: "2026-07-21" }), row("undated", { last_purchase_date: null }), row("", { receipt_doc: "receipt" })], "2026-09-19");
    expect(result.joined.map(x => x.status)).toEqual(["present in exports", "SKU has no item_number", "item_number absent from supplied exports (possible discontinued/substituted; not proof)", "unlinked guide line"]);
    expect(result.candidates.map(r => r.item_no)).toEqual(["2", "3"]);
    expect(result.unidentified).toHaveLength(1);
    expect(joinGuideLines(lines, catalog, [row("1", { vendor: "other" })], "2026-09-19").joined[0]!.observations).toHaveLength(0);
  });
  it("converts explicit mass units, preserves missing prices, and does not guess count/volume mass", () => {
    const c = compareCatalog(row("1"), sku("a", "1"), "2026-09-19");
    expect(c).toMatchObject({ before: 100, after: 200, delta: 100, impact: 200, ratio: 1 });
    expect(compareCatalog(row("1", { price_cents: null }), sku("a", "1"), "2026-09-19").delta).toBeNull();
    expect(compareCatalog(row("1"), { ...sku("a", "1"), cost_is_estimate: true }, "2026-09-19").delta).toBeNull();
    expect(compareCatalog(row("other"), sku("a", "1"), "2026-09-19").delta).toBeNull();
    expect(compareCatalog(row("1", { pack: "1/1 GA" }), { ...sku("a", "1"), pack: "1/128 FL OZ" }, "2026-09-19").delta).toBe(100);
    expect(compareCatalog(row("1", { price_per_lb_cents: 150, price_cents: null, last_purchase_qty: 99, last_purchase_uom: "PIECE", net_wt_lb: 3 }), { ...sku("a", "1"), price_per_lb_cents: 100 }, "2026-09-19")).toMatchObject({ delta: 50, impact: 150 });
  });
  it("accounts for all 163 real guide lines and preserves physical id citations", () => {
    const { data, catalog } = loadCatalog();
    const text = readFileSync(join(ROOT, CATALOG_FILE), "utf8");
    const lines = seedLines(data, text);
    expect(lines).toHaveLength(163);
    expect(new Set(lines.map(l => l.id)).size).toBe(163);
    expect(joinGuideLines(lines, catalog, [], "2026-09-19").joined).toHaveLength(163);
    for (const l of lines) expect(text.split(/\r?\n/)[l.source_line - 1]).toContain(l.id);
  });
  it("all generated wave-4 table rows cite real physical source lines and all vendor reports include A–I", () => {
    const dir = join(EXPORT_ROOT, "reports");
    for (const name of ["pfg-diff", "usfoods-diff", "receipts-diff", "catalog-join"]) {
      const report = readFileSync(join(dir, `2026-09-19-${name}.md`), "utf8");
      expect(report).toContain("Catalog: prod export 2026-09-19");
      if (name !== "catalog-join") for (const section of "ABCDEFGHI") expect(report).toContain(`## ${section}.`);
      const lines = report.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i]!;
        if (!l.startsWith("| ") || l.startsWith("| ---") || lines[i + 1]?.startsWith("| ---")) continue;
        const refs = [...l.matchAll(/\]\(([^)]+)#L(\d+)\)/g)];
        expect(refs.length, l).toBeGreaterThan(0);
        for (const ref of refs) expect(readFileSync(resolve(dir, ref[1]!), "utf8").split(/\r?\n/)[Number(ref[2]) - 1]?.trim(), ref[0]).toBeTruthy();
      }
    }
  });
});
