/** Catalog Phase 2a (lead decision) — the costing export is the board on screen: same shop, same bind, scope named. */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@/lib/session";

const A = "6f1d2c3e-0000-4000-8000-00000000000a";
const B = "6f1d2c3e-0000-4000-8000-00000000000b";
const seen = vi.hoisted(() => ({ scopes: [] as unknown[] }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => {
  const q: Record<string, unknown> = {};
  Object.assign(q, { select: () => q, eq: () => q, maybeSingle: async () => ({ data: { id: A, code: "EM", name: "P Street" }, error: null }) });
  return { from: () => q };
} }));
vi.mock("@/lib/admin/menu-costing", () => ({
  MENU_COSTING_READ_MIN: 6,
  loadMenuCostingBoard: async (_auth: unknown, opts?: { scope?: string | null }) => {
    seen.scopes.push(opts?.scope ?? null);
    const cost = opts?.scope === A ? 4.25 : 3.1; // the shop's own price makes its cost differ
    return { scope: opts?.scope ?? null, rows: [{ id: "m1", name: "Crunchy", nameEs: null, section: "subs", menuPrice: 13.5,
      rollup: { status: "ok", cost } as never, foodCostPct: null, marginDollars: null, overThreshold: false }] };
  },
}));
import { ExportError, loadExportTable } from "@/lib/report-export";
import { EXPORT_COLUMNS, toCsv } from "@/lib/report-export-shared";

const gm = { user: { id: "u", role: "gm", language: "en" }, role: "gm", level: 7, locations: [A] } as unknown as AuthContext;

describe("the costing export follows the board's shop", () => {
  it("a shop-scoped export: that shop's board, its costs, and its pricing scope", async () => {
    const t = await loadExportTable(gm, "costing", { location: A });
    expect(seen.scopes.at(-1)).toBe(A);
    expect(t.pricingScope).toEqual({ kind: "shop", name: "P Street" });
    expect(toCsv(t.columns, t.rows)).toContain("4.25");
  });
  it("no location, or ?location=global: the labelled all-shops view on global prices", async () => {
    for (const location of [undefined, "global"]) {
      const t = await loadExportTable(gm, "costing", { location });
      expect(seen.scopes.at(-1)).toBeNull();
      expect(t.pricingScope).toEqual({ kind: "global" });
      expect(toCsv(t.columns, t.rows)).toContain("3.10");
    }
  });
  it("a GM cannot export another shop's board", async () => {
    await expect(loadExportTable(gm, "costing", { location: B })).rejects.toMatchObject({ status: 403, code: "location_forbidden" });
    await expect(loadExportTable(gm, "costing", { location: B })).rejects.toBeInstanceOf(ExportError);
  });
  it("the CSV's FIRST line names the pricing scope; the header row follows", () => {
    const csv = toCsv(EXPORT_COLUMNS.costing, [], ["Prices: P Street"]);
    expect(csv.replace(/^﻿/, "").split("\r\n").slice(0, 2)).toEqual(["Prices: P Street", EXPORT_COLUMNS.costing.map((c) => c.key).join(",")]);
  });
  it("notes go AFTER the table: with no pricing scope the header row is line 1, and the two can sit in one file", () => {
    const header = EXPORT_COLUMNS.costing.map((c) => c.key).join(",");
    const lines = (csv: string) => csv.replace(/^﻿/, "").split("\r\n");
    expect(lines(toCsv(EXPORT_COLUMNS.costing, [], [], ["Notes", "Covers 6 of 7 days."]))).toEqual([header, "", "Notes", "Covers 6 of 7 days.", ""]);
    expect(lines(toCsv(EXPORT_COLUMNS.costing, [], ["Prices: P Street"], ["Notes", "One, with a comma"]))).toEqual(["Prices: P Street", header, "", "Notes", "\"One, with a comma\"", ""]);
    // No notes: byte-identical to before (no blank line, no block).
    expect(toCsv(EXPORT_COLUMNS.costing, [], [], [])).toBe(toCsv(EXPORT_COLUMNS.costing, []));
  });
  it("the route writes that line (CSV) and that header line (PDF); the page links the export with its own scope", () => {
    const route = readFileSync("app/api/reports/export/route.ts", "utf8");
    expect(route).toContain('"reports.export.pricing_scope_shop"');
    expect(route).toContain('"reports.export.pricing_scope_global"');
    // Business-report polish (2026-11-18): the two kinds of line have two places and never trade them. The costing
    // PRICING SCOPE still LEADS its file (it names whose prices every row is in: line 1, then the header row — the
    // test above). An export NOTICE (the business family's "this file covers N of M days") goes AFTER the table, so
    // a file without a pricing scope has its header row on line 1.
    expect(route).toContain("const topLines = pricingLine ? [pricingLine] : [];");
    expect(route).toContain("toCsv(table.columns, table.rows, topLines, csvNotes)");
    const page = readFileSync("app/admin/sandwiches/page.tsx", "utf8");
    expect(page).toContain('query={{ location: scope }}');
    expect(page).toContain('"admin.menu_costing.export_scope"');
  });
});
