/**
 * Sales rework r1 (Astra review of PR #422): one test block per finding.
 */
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireSession: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));
vi.mock("@/lib/midshift-shared", async (orig) => ({ ...(await orig<typeof import("@/lib/midshift-shared")>()), operationalNow: () => ({ date: "2026-10-08" }) }));

import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";
import { GET } from "@/app/api/reports/export/route";
import { requireSession } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { SALES_EXPORT_COLUMNS, salesBreakdownRows } from "@/lib/report-export-shared";
import {
  loadSalesCatering, mergeBreakdown, mergeCateringValues, resolveSalesRange, rowAverageCents, salesDayParams, salesDeltaPct,
  salesHasData, shownCents, summarizeSales, toCheckDetail, unknownComponents, type DailyRaw,
} from "@/lib/sales-reports";

const A = "aaaaaaaa-0000-4000-8000-00000000000a";
const SHOP = { id: A, code: "MEP", name: "Capitol Hill" };
const E = en as Record<string, string>;
const S = es as Record<string, string>;
const day = (over: Partial<DailyRaw> = {}): DailyRaw => ({ classes: [], tips: [], discounts: [], refunds: [], captured_days: [], ezcater: [], ...over });

let rpc: (fn: string, args: Record<string, unknown>) => unknown;
const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
function client() {
  const chain = { id: "" };
  const q = { select: () => q, eq: (_c: string, v: string) => { chain.id = v; return q; }, maybeSingle: async () => ({ data: chain.id === A ? SHOP : null, error: null }) };
  return {
    from: (t: string) => { if (t !== "locations") throw new Error(`unexpected read ${t}`); return q; },
    rpc: async (fn: string, args: Record<string, unknown>) => { calls.push({ fn, args }); return { data: rpc(fn, args), error: null }; },
  };
}
const get = (q: string) => GET(new NextRequest(`https://example.test/api/reports/export?${q}`));

beforeEach(() => {
  vi.clearAllMocks();
  calls.length = 0;
  vi.mocked(getServiceRoleClient).mockImplementation(() => client() as never);
  vi.mocked(requireSession).mockResolvedValue({ user: { id: "v", name: "V", language: "en" }, role: "gm", level: 7, locations: [A], session: {} } as never);
  rpc = () => [];
});

describe("P1-1: legacy check totals stay separate from captured exact item-sales net", () => {
  it("screen labels say check totals / sales before refunds, with a visible caveat, in en and es", () => {
    expect(E["reports.sales.toast_checks"]).toBe("Toast check totals (before refunds)");
    expect(E["reports.sales.total"]).toBe("Sales (before refunds)");
    expect(E["reports.sales.toast_checks_hint"]).toMatch(/Not reconciled net sales/);
    expect(E["reports.sales.caveat"]).toMatch(/not item-sales net/);
    expect(S["reports.sales.caveat"]).toMatch(/no es el neto de ventas de artículos/i);
    expect(E["reports.sales.toast_net"]).toBe("Toast item-sales net (captured)");
    expect(E["reports.sales.net_basis"]).toMatch(/Missing accounting or unreconciled refunds show as unavailable/);
    expect(readFileSync("components/reports-hub/SalesSummary.tsx", "utf8")).toContain('t("reports.sales.caveat")');
    for (const [k, v] of Object.entries(E)) if (k.startsWith("reports.sales.") && /net sales/i.test(v)) expect(v, k).toMatch(/not reconciled/i);
  });
  it("only the new accounted summary and its basis note claim net", () => {
    for (const [view, cols] of Object.entries(SALES_EXPORT_COLUMNS)) for (const c of cols) {
      if (view === "summary" && ["toast_item_sales_net", "toast_net_basis"].includes(c.key)) continue;
      expect(c.key, `${view}.${c.key}`).not.toMatch(/net/);
    }
    expect(SALES_EXPORT_COLUMNS.summary.map((c) => c.key)).toEqual(expect.arrayContaining(["toast_check_totals", "sales_before_refunds"]));
    expect(SALES_EXPORT_COLUMNS.checks.map((c) => c.key)).toContain("check_total");
  });
});

describe("P1-2: refunds are 'captured so far', never a complete-looking zero", () => {
  it("label, hint and export column say captured so far", () => {
    expect(E["reports.sales.refunds"]).toBe("Refunds captured so far");
    expect(E["reports.sales.refunds_hint"]).toMatch(/only after that order is captured again/);
    expect(SALES_EXPORT_COLUMNS.summary.map((c) => c.key)).toEqual(expect.arrayContaining(["refunds_captured_so_far", "refunds_captured_count"]));
  });
});

describe("P2-6: catering values are read per bounded window, never over all history", () => {
  it("12 months = per-window sales_report_catering_values calls (<=31 days), merged; unvalued leads counted", async () => {
    rpc = (fn) => fn === "sales_report_catering_values"
      ? { completed_events: 1, completed_value_cents: 1000, completed_unvalued: 1, confirmed_events: 2, confirmed_value_cents: 500, confirmed_unvalued: 0 }
      : fn === "sales_report_ezcater_summary" ? { orders: 0, subtotal_cents: 0, amount_missing: 0, statuses: {}, orphan_checks: 0, orphan_cents: 0 } : [];
    const range = resolveSalesRange({ range: "last12m" }, "2026-10-08");
    const out = await loadSalesCatering({ userId: "v", level: 7, locations: [A] }, { locationId: A, range }, { client: client() as never });
    const values = calls.filter((c) => c.fn === "sales_report_catering_values");
    expect(values.length).toBeGreaterThanOrEqual(11);
    for (const c of values) expect((Date.parse(String(c.args.p_to)) - Date.parse(String(c.args.p_from))) / 86_400_000 + 1).toBeLessThanOrEqual(31);
    expect(calls.some((c) => c.fn === "catering_insights_window")).toBe(false);
    expect(out.pipeline).toMatchObject({ completedEvents: values.length, completedCents: 1000 * values.length, completedUnvalued: values.length });
    expect(mergeCateringValues([])).toEqual({ completedEvents: 0, completedCents: 0, completedUnvalued: 0, confirmedEvents: 0, confirmedCents: 0, confirmedUnvalued: 0 });
  });
});

describe("P2-7: EVERY Sales export view refuses past 10,000 rows", () => {
  it("a breakdown with 10,001 distinct item keys is a 413, not a file", async () => {
    rpc = (fn) => fn === "sales_report_breakdown" ? Array.from({ length: 10_001 }, (_, i) => ({ key: `item-${i}`, label: `Item ${i}`, units: 1, checks: 1 })) : [];
    expect((await get(`family=sales&format=csv&location=${A}&view=items`)).status).toBe(413);
  });
  it("10,000 rows still export", async () => {
    rpc = (fn) => fn === "sales_report_breakdown" ? Array.from({ length: 10_000 }, (_, i) => ({ key: `item-${i}`, label: `Item ${i}`, units: 1, checks: 1 })) : [];
    expect((await get(`family=sales&format=csv&location=${A}&view=items`)).status).toBe(200);
  });
});

describe("P2-8: a Today drill stays Today", () => {
  it("a window that is exactly today drills with range=today; anything else is custom", () => {
    expect(salesDayParams("2026-10-08", "2026-10-08", "2026-10-08")).toEqual({ range: "today", from: "2026-10-08", to: "2026-10-08", g: "day" });
    expect(salesDayParams("2026-10-07", "2026-10-07", "2026-10-08")).toEqual({ range: "custom", from: "2026-10-07", to: "2026-10-07", g: "day" });
    const drilled = resolveSalesRange(salesDayParams("2026-10-08", "2026-10-08", "2026-10-08"), "2026-10-08");
    expect(drilled).toMatchObject({ empty: false, todaySoFar: true, from: "2026-10-08", to: "2026-10-08" });
  });
  it("the summary drill and the check detail's same-day links use it", () => {
    expect(readFileSync("app/(authed)/reports/sales/page.tsx", "utf8")).toContain('shopHref("/reports/sales/checks", salesDayParams(from, to, today, range.grain))');
    expect(readFileSync("app/(authed)/reports/sales/checks/[checkGuid]/page.tsx", "utf8")).toContain("...salesDayParams(detail.businessDate, detail.businessDate, operationalNow(new Date()).date)");
  });
});

describe("P2-9: no capture and no rows renders unavailable, never $0.00", () => {
  it("salesHasData / shownCents", () => {
    const { totals } = summarizeSales([], "2026-10-06", "2026-10-07", "day");
    expect(salesHasData(totals)).toBe(false);
    expect(shownCents(totals, totals.totalCents)).toBeNull();
    const real = summarizeSales([day({ captured_days: ["2026-10-06"] })], "2026-10-06", "2026-10-06", "day").totals;
    expect(salesHasData(real)).toBe(true);
    expect(shownCents(real, real.totalCents)).toBe(0); // a captured empty day IS a measured zero
  });
  it("the summary component renders every total through shownCents", () => {
    const src = readFileSync("components/reports-hub/SalesSummary.tsx", "utf8");
    expect(src.match(/<Money /g)?.length).toBe(1);
    expect(src).toContain("<Money cents={shownCents(tt, cents)} language={language} />");
  });
});

describe("P2-10: unknown tax / tip / discount amounts are counted and block the percentage", () => {
  it("counted per component and in the export", () => {
    const raw = day({
      classes: [{ business_date: "2026-10-06", sale_class: "sale", checks: 2, amount_cents: 2000, tax_cents: 100, amount_missing: 0, tax_missing: 1 }],
      tips: [{ business_date: "2026-10-06", tip_cents: 300, tip_missing: 1 }],
      discounts: [{ business_date: "2026-10-06", count: 2, cents: 200, amount_missing: 1 }],
      captured_days: ["2026-10-06"],
    });
    const t = summarizeSales([raw], "2026-10-06", "2026-10-06", "day").totals;
    expect(t).toMatchObject({ taxMissing: 1, tipMissing: 1, discountMissing: 1 });
    expect(unknownComponents(t)).toBe(3);
    const prev = summarizeSales([day({ classes: [{ business_date: "2026-10-05", sale_class: "sale", checks: 1, amount_cents: 1000, tax_cents: 50, amount_missing: 0 }], captured_days: ["2026-10-05"] })], "2026-10-05", "2026-10-05", "day").totals;
    expect(salesDeltaPct(t, prev)).toBeNull();
    expect(salesDeltaPct({ ...t, taxMissing: 0, tipMissing: 0, discountMissing: 0 }, prev)).toBe(100);
    expect(SALES_EXPORT_COLUMNS.summary.map((c) => c.key)).toEqual(expect.arrayContaining(["unknown_tax", "unknown_tips", "unknown_discounts"]));
  });
});

describe("P2-11: averages are suppressed when any amount is unknown", () => {
  it("server export keeps amount_missing and blanks the average (Astra's reproduction)", () => {
    const rows = mergeBreakdown("server", [[{ key: "g-1", label: "Ana", checks: 2, cents: 1000, amount_missing: 1 }]]);
    const [row] = salesBreakdownRows("servers", rows, { from: "2026-10-06", to: "2026-10-06" }, SHOP);
    expect(row).toMatchObject({ sales: 1000, amount_missing: 1, average_check: null });
    expect(rowAverageCents({ cents: 1000, checks: 2, amountMissing: 0 })).toBe(500);
    expect(SALES_EXPORT_COLUMNS.servers.map((c) => c.key)).toContain("amount_missing");
  });
  it("the summary average check is suppressed too", () => {
    const t = summarizeSales([day({ classes: [{ business_date: "2026-10-06", sale_class: "sale", checks: 2, amount_cents: 1000, tax_cents: 0, amount_missing: 1 }], captured_days: ["2026-10-06"] })], "2026-10-06", "2026-10-06", "day").totals;
    expect(t.avgCheckCents).toBeNull();
  });
});

describe("P2-4 (detail): a discount on a voided line is shown but marked not counted", () => {
  it("counted flag survives the projection", () => {
    const d = toCheckDetail({ business_date: "2026-10-06", check_guid: "c", discounts: [{ ordinal: 1, name: "Happy Hour", amount_cents: 200, selection_guid: "s1", counted: false }], selections: [], payments: [], service_charges: [] });
    expect(d.discounts[0]!.counted).toBe(false);
  });
});

describe("ezCater subtotal is taken AS REPORTED (unverified with a discounted order)", () => {
  it("fixture: an ezCater order with a $15 provider discount contributes its subtotal unchanged", () => {
    // Shape of a real provider total block: subTotal 25000, discounts 1500, tax 1500, tip 2000, totalDue 27000.
    // Whether subTotal is before or after the 1500 discount is unverified; nothing is subtracted.
    const raw = day({ ezcater: [{ business_date: "2026-10-06", orders: 1, subtotal_cents: 25000, amount_missing: 0 }], captured_days: ["2026-10-06"] });
    const t = summarizeSales([raw], "2026-10-06", "2026-10-06", "day").totals;
    expect(t.ezcaterCents).toBe(25000);
    expect(t.totalCents).toBe(25000);
    expect(readFileSync("lib/sales-reports-shared.ts", "utf8")).toMatch(/subtotal AS REPORTED/);
  });
});
