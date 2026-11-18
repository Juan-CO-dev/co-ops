/**
 * Item 9b review r10 (P2, BC-031 / BC-035): a wide table split across PDF pages repeats the ROW'S
 * IDENTITY in every part, declared per table in the column registry (`identity: true`), never
 * "the first three columns". Two servers in the same period must be told apart on every part.
 * The CSV leads with the same identity columns (the on-screen registries; the accountant
 * package's CSV order is a frozen contract, so there the PDF brings its identity forward).
 */
import { describe, expect, it } from "vitest";
import { renderReportPdf, splitColumns } from "@/lib/report-pdf";
import {
  BUSINESS_EXPORT_COLUMNS, EXPORT_COLUMNS, SALES_EXPORT_COLUMNS, formatCell, identityKeys,
  type ExportColumn, type ExportRow,
} from "@/lib/report-export-shared";
import { PACKAGE_COLUMNS } from "@/lib/report-package-shared";

function pdfText(pdf: Buffer): string {
  const raw = pdf.toString("latin1");
  return [...raw.matchAll(/<([0-9a-fA-F]+)>/g)].map((m) => Buffer.from(m[1]!, "hex").toString("latin1")).join("");
}
const squash = (t: string) => t.replace(/\s+/g, "");
const header = { title: "Business report", lines: ["Tenant", "Shop: P Street"] };

const TABLES: Array<[string, readonly ExportColumn[], "screen" | "package"]> = [
  ...Object.entries(EXPORT_COLUMNS).map(([k, v]) => [`export.${k}`, v, "screen"] as [string, readonly ExportColumn[], "screen"]),
  ...Object.entries(SALES_EXPORT_COLUMNS).map(([k, v]) => [`sales.${k}`, v, "screen"] as [string, readonly ExportColumn[], "screen"]),
  ...Object.entries(BUSINESS_EXPORT_COLUMNS).map(([k, v]) => [`business.${k}`, v, "screen"] as [string, readonly ExportColumn[], "screen"]),
  ...Object.entries(PACKAGE_COLUMNS).map(([k, v]) => [`package.${k}`, v, "package"] as [string, readonly ExportColumn[], "package"]),
];

/** A row whose every cell is unique to row `r` (identity cells included), wide enough to force a split. */
function rowFor(columns: readonly ExportColumn[], r: number): ExportRow {
  const row: ExportRow = {};
  columns.forEach((c, i) => {
    switch (c.kind) {
      case "date": row[c.key] = `2026-0${r + 1}-1${i % 10}`; break;
      case "datetime": row[c.key] = `2026-0${r + 1}-1${i % 10}T1${r}:00:00.000Z`; break;
      case "money": row[c.key] = 7_000_000 + r * 100_000 + i * 101; break;
      case "int": case "number": row[c.key] = 800_000 + r * 10_000 + i; break;
      case "bool": row[c.key] = r === 0; break;
      case "currency": row[c.key] = "USD"; break;
      default: row[c.key] = `R${r}x${c.key}Qwide${"w".repeat(18)}`;
    }
  });
  return row;
}

describe("every table declares its row identity in the registry", () => {
  it.each(TABLES)("%s declares identity columns", (_name, columns) => {
    const keys = identityKeys(columns);
    expect(keys.length).toBeGreaterThan(0);
    for (const k of keys) expect(columns.find((c) => c.key === k)?.kind).not.toBe("currency");
  });
  it.each(TABLES.filter(([, , k]) => k === "screen"))("%s: the CSV leads with its identity columns", (_name, columns) => {
    const keys = identityKeys(columns);
    expect(columns.slice(0, keys.length).map((c) => c.key)).toEqual(keys);
  });
  it("People and Servers are identified by the person, not by the period", () => {
    expect(identityKeys(BUSINESS_EXPORT_COLUMNS.people)).toEqual(expect.arrayContaining(["name", "server_ref", "source"]));
    expect(identityKeys(SALES_EXPORT_COLUMNS.servers)).toEqual(expect.arrayContaining(["server_first_name", "server_ref"]));
    expect(identityKeys(BUSINESS_EXPORT_COLUMNS.channels)).toEqual(expect.arrayContaining(["channel", "provider"]));
  });
});

describe("the PDF repeats each row's identity in every column part", () => {
  it.each(TABLES)("%s", async (_name, columns) => {
    const rows = [rowFor(columns, 0), rowFor(columns, 1)];
    const pdf = await renderReportPdf(header, [{ heading: "T", columns, rows, emptyText: "-" }], {
      pageLabel: (n, t) => `Page ${n} / ${t}`, partLabel: (i, n) => `@@PART${i}of${n}@@`, compress: false,
    });
    const text = squash(pdfText(pdf));
    const keys = identityKeys(columns);
    const idText = (row: ExportRow) => squash(keys.map((k) => formatCell(columns.find((c) => c.key === k)!.kind, row[k])).join(""));
    const segments = text.split(/@@PART\d+of\d+@@/).slice(1);
    const parts = segments.length === 0 ? [text] : segments;
    for (const part of parts) {
      const at = rows.map((row) => part.indexOf(idText(row)));
      // Both rows are named in this part, in order …
      expect(at[0]).toBeGreaterThanOrEqual(0);
      expect(at[1]).toBeGreaterThan(at[0]!);
    }
    // … and every value of a row sits inside a part right after THAT row's identity.
    for (const [r, row] of rows.entries()) {
      for (const c of columns) {
        if (keys.includes(c.key) || c.kind === "currency" || c.kind === "bool") continue;
        const value = squash(formatCell(c.kind, row[c.key]));
        const owner = parts.find((part) => part.includes(value));
        expect(owner, `${c.key} drawn`).toBeDefined();
        const start = owner!.indexOf(idText(row));
        const next = r + 1 < rows.length ? owner!.indexOf(idText(rows[r + 1]!)) : owner!.length;
        const pos = owner!.indexOf(value, start);
        expect(start, `${c.key} has its row's identity in its part`).toBeGreaterThanOrEqual(0);
        expect(pos, `${c.key} follows its own row's identity`).toBeGreaterThan(start);
        expect(pos, `${c.key} before the next row`).toBeLessThan(next);
      }
    }
  });

  it("the review's case: two servers in one period are told apart beside their money on every part", async () => {
    const columns = BUSINESS_EXPORT_COLUMNS.people;
    const base = { row_type: "server", period_start: "2026-11-01", period_end: "2026-11-07", location_code: "PS", location_name: "P Street", status: "ready", labor_state: "assessed", days_included: 7, days_in_period: 7, figure_notes: "sales=known(covered_days_only)" };
    const rows = [
      { ...base, name: "Ana", server_ref: "a1b2", checks: 41, sales: 123_456, amount_missing: 0 },
      { ...base, name: "Beto", server_ref: "c3d4", checks: 39, sales: 654_321, amount_missing: 0 },
    ];
    const pdf = await renderReportPdf(header, [{ heading: null, columns, rows, emptyText: "-" }], {
      pageLabel: (n, t) => `Page ${n} / ${t}`, partLabel: (i, n) => `@@PART${i}of${n}@@`, compress: false,
    });
    const parts = squash(pdfText(pdf)).split(/@@PART\d+of\d+@@/).slice(1);
    expect(parts.length).toBeGreaterThan(1);
    const salesPart = parts.find((p) => p.includes("1234.56"))!;
    expect(salesPart.indexOf("Ana")).toBeGreaterThanOrEqual(0);
    expect(salesPart.indexOf("Ana")).toBeLessThan(salesPart.indexOf("1234.56"));
    expect(salesPart.indexOf("Beto")).toBeGreaterThan(salesPart.indexOf("1234.56"));
    expect(salesPart.indexOf("6543.21")).toBeGreaterThan(salesPart.indexOf("Beto"));
    for (const p of parts) for (const n of ["Ana", "a1b2", "Beto", "c3d4"]) expect(p).toContain(n);
  });
});

describe("splitColumns takes the identity by index and never drops it", () => {
  it("repeats the named identity columns first in every part, wherever they sit", () => {
    const parts = splitColumns([100, 100, 40, 100, 40, 100], 300, [2, 4]);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(p.slice(0, 2)).toEqual([2, 4]);
    expect(new Set(parts.flat())).toEqual(new Set([0, 1, 2, 3, 4, 5]));
  });
  it("keeps an identity wider than the page share (the renderer narrows it; it is never dropped)", () => {
    const parts = splitColumns([200, 200, 100, 100], 300, [0, 1]);
    for (const p of parts) expect(p.slice(0, 2)).toEqual([0, 1]);
  });
});
