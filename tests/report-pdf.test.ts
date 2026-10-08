import { describe, expect, it } from "vitest";
import { pdfSafe, renderReportPdf, splitColumns } from "@/lib/report-pdf";
import { EXPORT_COLUMNS, centsToDollars } from "@/lib/report-export-shared";

/** The text pdfkit wrote: every <hex> string in the (uncompressed) content streams, in order. */
function pdfText(pdf: Buffer): string {
  const raw = pdf.toString("latin1");
  return [...raw.matchAll(/<([0-9a-fA-F]+)>/g)].map((m) => Buffer.from(m[1]!, "hex").toString("latin1")).join("");
}
const pageCount = (pdf: Buffer) => (pdf.toString("latin1").match(/\/Type \/Page\b/g) ?? []).length;

const header = { title: "Cash reports", lines: ["Tenant", "Shop: Capitol Hill", "2026-10-01 to 2026-10-06", "Generated 2026-10-07 08:00 ET", "By Juan"] };
const label = (n: number, total: number) => `Page ${n} / ${total}`;

describe("renderReportPdf", () => {
  it("renders a real PDF (pdfkit + its font files load) with the header and a page count", async () => {
    const pdf = await renderReportPdf(header, [{
      heading: null, columns: EXPORT_COLUMNS.cash, emptyText: "No rows",
      rows: [{ business_date: "2026-10-06", location_code: "MEP", location_name: "Capitol Hill", projected: 50000, over_short: -250 }],
    }], { pageLabel: label, compress: false });
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(pageCount(pdf)).toBe(1);
    const text = pdfText(pdf);
    for (const s of ["Cash reports", "Shop: Capitol Hill", "2026-10-01 to 2026-10-06", "Generated 2026-10-07 08:00 ET", "By Juan", "Page 1 / 1", "-2.50", "500.00"]) {
      expect(text).toContain(s);
    }
  });

  it("paginates long tables, repeats the header on every page and numbers them n / N", async () => {
    const rows = Array.from({ length: 140 }, (_, i) => ({ business_date: "2026-10-06", location_code: "MEP", report_id: `r${i}` }));
    const pdf = await renderReportPdf(header, [{ heading: "Cash", columns: EXPORT_COLUMNS.cash, rows, emptyText: "No rows" }], { pageLabel: label, compress: false });
    const pages = pageCount(pdf);
    expect(pages).toBeGreaterThan(1);
    const text = pdfText(pdf);
    for (let n = 1; n <= pages; n++) expect(text).toContain(`Page ${n} / ${pages}`);
    expect(text.split("Shop: Capitol Hill").length - 1).toBe(pages);
    expect(text).toContain("r139");
  });

  it("an empty table states it instead of printing nothing", async () => {
    const pdf = await renderReportPdf(header, [{ heading: "Sales", columns: EXPORT_COLUMNS.sales, rows: [], emptyText: "Nothing in this range" }], { pageLabel: label, compress: false });
    expect(pdfText(pdf)).toContain("Nothing in this range");
  });

  it("compressed output (the default) is still a PDF", async () => {
    const pdf = await renderReportPdf(header, [], { pageLabel: label });
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });
});

it("pdfSafe keeps Spanish and replaces what WinAnsi cannot draw", () => {
  expect(pdfSafe("Año ñ ¿qué? ¡sí!")).toBe("Año ñ ¿qué? ¡sí!");
  expect(pdfSafe("ok 🙂 →")).toBe("ok ?? ?");
  expect(pdfSafe("a\nb\tc")).toBe("a b c");
});

describe("nothing is truncated (Astra P2): cells wrap, tall rows continue, wide tables split", () => {
  const squash = (t: string) => t.replace(/\s+/g, "");

  it("a long written-report body survives in full, across pages if it must", async () => {
    const body = Array.from({ length: 900 }, (_, i) => `word${i}`).join(" ");
    const pdf = await renderReportPdf(header, [{
      heading: null, columns: EXPORT_COLUMNS.written, emptyText: "-",
      rows: [{ submitted_at: "2026-10-06T12:00:00Z", location_code: "MEP", location_name: "Capitol Hill", report_id: "w1", title: "Long one", body }],
    }], { pageLabel: label, compress: false });
    const text = squash(pdfText(pdf));
    // A row taller than a page continues on the next page, so check every word arrived, in order.
    const seen = [...text.matchAll(/word(\d+)/g)].map((m) => Number(m[1]));
    expect(seen).toEqual(Array.from({ length: 900 }, (_, i) => i));
    expect(pageCount(pdf)).toBeGreaterThan(1);
    expect(text.split(squash("Shop: Capitol Hill")).length - 1).toBe(pageCount(pdf));
  });

  it("a wide accountant table is split into column parts that each repeat the key columns; every id and amount survives", async () => {
    const cols = Array.from({ length: 30 }, (_, i) => ({ key: `amount_column_${i}`, kind: "money" as const }));
    const columns = [{ key: "business_date", kind: "date" as const }, { key: "location_code", kind: "text" as const }, { key: "location_name", kind: "text" as const }, ...cols];
    const rows = Array.from({ length: 3 }, (_, r) => ({
      business_date: "2026-10-06", location_code: "MEP", location_name: "Capitol Hill",
      ...Object.fromEntries(cols.map((c, i) => [c.key, 1_000_000 + r * 1000 + i])),
    }));
    const pdf = await renderReportPdf(header, [{ heading: "Purchases", columns, rows, emptyText: "-" }], {
      pageLabel: label, partLabel: (i, n) => `Columns ${i} of ${n}`, compress: false,
    });
    const text = squash(pdfText(pdf));
    for (const r of rows) for (const c of cols) expect(text).toContain(centsToDollars((r as Record<string, unknown>)[c.key] as number));
    const parts = Number(/Columns1of(\d+)/.exec(text)?.[1]);
    expect(parts).toBeGreaterThan(1);
    for (let i = 1; i <= parts; i++) expect(text).toContain(`Columns${i}of${parts}`);
  });

  it("splitColumns packs parts that fit and repeats the identifying columns", () => {
    expect(splitColumns([50, 50, 50], 200, 2)).toEqual([[0, 1, 2]]);
    const parts = splitColumns([40, 40, 100, 100, 100, 100], 300, 2);
    expect(parts).toEqual([[0, 1, 2, 3], [0, 1, 4, 5]]);
    for (const p of parts) expect(p.slice(0, 2)).toEqual([0, 1]);
  });
});
