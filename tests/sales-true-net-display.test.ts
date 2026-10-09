import React, { type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { SalesSummary } from "@/components/reports-hub/SalesSummary";
import { SALES_EXPORT_COLUMNS, formatCell, salesSummaryRows, TOAST_NET_BASIS_NOTE } from "@/lib/report-export-shared";
import { resolveSalesRange, summarizeSales, type SalesSummaryDto, type SalesTotals } from "@/lib/sales-reports-shared";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";

// Open disclosures to exercise bucket cells as well as the summary cards.
vi.mock("@/components/ui/CollapsibleSection", () => ({ CollapsibleSection: ({ children }: { children: ReactNode }) => children }));
beforeAll(() => vi.stubGlobal("React", React));
afterAll(() => vi.unstubAllGlobals());
const from = "2026-10-06";
const to = "2026-10-07";
const base = summarizeSales([], from, to, "day");
const exact: SalesTotals = {
  ...base.totals, checks: 1, coveredDays: 2, coverage: "complete", toastChecksCents: 1300, totalCents: 3300, ezcaterCents: 2000,
  grossCents: 1600, discountsCompsCents: 200, voidsCents: 300, serviceChargesCents: 200, salesRefundsCents: 100,
  toastNetCents: 1000, accountingMissing: 0, salesRefundMissing: 0,
};
const dto = (totals: SalesTotals): SalesSummaryDto => ({
  locationId: "shop", range: resolveSalesRange({ range: "custom", from, to }, "2026-10-09"),
  totals, buckets: base.buckets.map((b) => ({ ...b, ...totals })), previous: null, deltaPct: null, capturedAt: null,
  modifiedCoverage: { start: "2026-10-01T12:00:00Z", through: "2026-10-08T12:00:00Z" },
});
const render = (totals: SalesTotals, language: "en" | "es" = "en") => renderToStaticMarkup(React.createElement(SalesSummary, {
  summary: dto(totals), language, checksHref: () => "/reports/sales/checks",
}));
const rows = (totals: SalesTotals) => salesSummaryRows(dto(totals).buckets, totals, { from, to }, { id: "shop", code: "A", name: "Shop" });

describe("true net screen and export", () => {
  it("cards and buckets render the exact DTO alongside unchanged legacy amounts", () => {
    const html = render(exact);
    for (const amount of ["$10.00", "$16.00", "$2.00", "$3.00", "$1.00", "$13.00", "$33.00", "$20.00"]) expect(html).toContain(amount);
    expect(html).toContain(en["reports.sales.toast_net"]);
    expect(html).toContain("Late-refund discovery coverage");
    expect(html).toContain("All non-gratuity service charges are removed");
    for (const row of rows(exact)) expect(row).toMatchObject({
      toast_gross: 1600, toast_discounts_comps: 200, toast_item_voids: 300, toast_service_charges: 200,
      toast_sales_refunds: 100, toast_item_sales_net: 1000, toast_check_totals: 1300, sales_before_refunds: 3300, ezcater_sales: 2000,
      toast_net_basis: TOAST_NET_BASIS_NOTE,
    });
  });
  it("historical/unreconciled values stay unavailable on screen and blank in exports", () => {
    const unknown = { ...exact, grossCents: null, discountsCompsCents: null, voidsCents: null, serviceChargesCents: null,
      salesRefundsCents: null, toastNetCents: null, accountingMissing: 1, salesRefundMissing: 2 };
    const html = render(unknown);
    expect(html).toContain("1 checks lack accounting details");
    expect(html).toContain("2 refunds cannot be allocated");
    expect(html).toContain(en["reports.sales.amount_unavailable"]);
    expect(html).not.toContain("$10.00");
    for (const row of rows(unknown)) {
      for (const key of ["toast_gross", "toast_discounts_comps", "toast_item_voids", "toast_service_charges", "toast_sales_refunds", "toast_item_sales_net"]) {
        expect(row[key]).toBeNull();
        expect(formatCell("money", row[key])).toBe("");
      }
      expect(row.accounting_missing).toBe(1);
      expect(row.sales_refund_missing).toBe(2);
    }
  });
  it("incomplete capture coverage exports blanks for exact money despite known captured sales", () => {
    const { totals } = summarizeSales([{
      classes: [{ business_date: from, sale_class: "sale", checks: 1, amount_cents: 1100, tax_cents: 0, amount_missing: 0,
        gross_cents: 1600, discounts_comps_cents: 200, voids_cents: 300, service_charges_cents: 0, accounting_missing: 0 }],
      tips: [], discounts: [], refunds: [], captured_days: [from], ezcater: [],
    }], from, to, "day");
    expect(totals.coverage).toBe("partial");
    expect(totals.toastChecksCents).toBe(1100);
    for (const row of rows(totals)) {
      expect(row.toast_item_sales_net).toBeNull();
      expect(row.toast_gross).toBeNull();
      expect(row.toast_sales_refunds).toBeNull();
    }
    expect(render(totals)).toContain(en["reports.sales.amount_unavailable"]);
  });
  it("new columns append after all legacy columns including basis notes", () => {
    const keys = SALES_EXPORT_COLUMNS.summary.map((c) => c.key);
    expect(keys.slice(keys.indexOf("refunds_basis") + 1)).toEqual([
      "toast_gross", "toast_discounts_comps", "toast_item_voids", "toast_service_charges", "toast_sales_refunds", "toast_item_sales_net",
      "accounting_missing", "sales_refund_missing", "toast_net_basis",
    ]);
  });
  it("Spanish renders translated accounting labels, basis and unknown reasons", () => {
    const html = render({ ...exact, toastNetCents: null, accountingMissing: 1, salesRefundMissing: 1 }, "es");
    for (const suffix of ["toast_net", "gross", "discounts_comps", "item_voids", "service_charges", "sales_refunds", "net_basis"]) {
      const key = `reports.sales.${suffix}` as keyof typeof es;
      expect(html).toContain(es[key]);
      expect(es[key]).not.toBe(en[key]);
      expect(es[key]).not.toContain("?");
    }
    expect(html).toContain("1 cuentas sin detalles contables");
    expect(html).toContain("1 reembolsos no se pueden asignar");
  });
});
