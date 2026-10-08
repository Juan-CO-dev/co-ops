import { describe, expect, it } from "vitest";
import { pdfSafe, renderReportPdf } from "@/lib/report-pdf";
import { EXPORT_COLUMNS } from "@/lib/report-export-shared";

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
