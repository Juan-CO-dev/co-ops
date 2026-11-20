// Item 9 PR 9c: the business report EXPORT (CSV and PDF) through the existing /api/reports/export route.
// Failing-first. Same loader as the page (loadBusinessReport), same gates BEFORE any read (the three switches,
// the role, the shop), the Sales row cap (413 past it, never a cut file), audited `report.export`. Like every
// other family, a download is not gated by the digest delivery mode (no family is: lib/report-export.ts).
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireSession: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));

import { GET } from "@/app/api/reports/export/route";
import { audit } from "@/lib/audit";
import { requireSession } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { BUSINESS_EXPORT_COLUMNS, BUSINESS_EXPORT_TABS, EXPORT_COLUMNS, EXPORT_FAMILIES, assertBusinessRowCap } from "@/lib/report-export-shared";
import { SALES_EXPORT_MAX_ROWS } from "@/lib/sales-reports-shared";
import { A, GM_ALL_ON, fakeClient, gmOff } from "./helpers/business-report-fake";

const B = "bbbbbbbb-0000-4000-8000-00000000000b";

function session(role: string, level: number, locations: string[]) {
  vi.mocked(requireSession).mockResolvedValue({
    user: { id: "viewer-1", role, name: "Viewer One", language: "en" }, role, level, locations, session: {},
  } as never);
}
let reads = 0;
function wire(o: Parameters<typeof fakeClient>[0] = {}) {
  const biz = fakeClient(o);
  const shopQ = { select: () => shopQ, eq: () => shopQ, maybeSingle: async () => ({ data: { id: A, code: "MEP", name: "Capitol Hill" }, error: null }) };
  vi.mocked(getServiceRoleClient).mockImplementation(() => ({
    rpc: (...a: unknown[]) => { reads++; return (biz.client as { rpc: (...x: unknown[]) => unknown }).rpc(...a); },
    from: (t: string) => { reads++; return t === "locations" ? shopQ : (biz.client as { from: (x: string) => unknown }).from(t); },
  }) as never);
  return biz;
}
const get = (q: string) => GET(new NextRequest(`https://example.test/api/reports/export?family=business&${q}`));
const csv = async (r: Response) => (await r.text()).replace(/^﻿/, "").trim().split("\r\n").map((l) => l.split(","));
const col = (rows: string[][], name: string) => { const i = rows[0]!.indexOf(name); expect(i, name).toBeGreaterThanOrEqual(0); return rows.slice(1).map((r) => r[i]); };
// Ranges are finished days ending yesterday; the fake's facts cover 2026-08-01..10-07.
const RANGE = "range=custom&from=2026-10-01&to=2026-10-07";

beforeEach(() => {
  vi.clearAllMocks();
  reads = 0;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-08T16:00:00Z"));
  vi.stubEnv("BUSINESS_REPORT", "1"); vi.stubEnv("FACT_LAYER", "1"); vi.stubEnv("FACT_LAYER_LABOR", "1");
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe("the business family", () => {
  it("is registered with stable, pinned columns per tab", () => {
    expect(EXPORT_FAMILIES).toContain("business");
    expect(BUSINESS_EXPORT_TABS).toEqual(["overview", "hours", "channels", "people", "compare"]);
    expect(EXPORT_COLUMNS.business).toBe(BUSINESS_EXPORT_COLUMNS.overview);
    expect(Object.fromEntries(Object.entries(BUSINESS_EXPORT_COLUMNS).map(([k, v]) => [k, v.map((c) => c.key).join(",")]))).toEqual({
      overview: "row_type,period,period_start,period_end,location_code,location_name,status,coverage_status,checks,toast_check_totals,toast_item_sales_net,ezcater_sales,ezcater_orders,refunds_captured_so_far,sales_before_refunds,amount_missing,net_sales_for_labor,net_sales_state,labor_hours,pure_hourly_cost,overtime_premium,overtime_hours,pure_hourly_pct,pure_hourly_target_pct,labor_state,salaried_cost,burden_cost,burden_estimated,salary_estimated,salary_gaps,wage_estimated,hours_unverified,fully_loaded_cost,fully_loaded_pct,fully_loaded_target_pct,fully_loaded_state,large_checks,large_checks_amount,breakdown_state,rushes,figure_notes,currency",
      hours: "row_type,business_date,quarter_start,time_et,location_code,location_name,status,checks,toast_sales,amount_missing,labor_hours,labor_state,straight_time_cost,straight_time_pct,basis,figure_notes,currency",
      channels: "row_type,period_start,period_end,location_code,location_name,channel,provider,status,days_included,days_in_period,checks,sales,amount_missing,figure_notes,currency",
      people: "row_type,period_start,period_end,location_code,location_name,name,server_ref,source,status,days_included,days_in_period,labor_state,pay_class,hours,overtime_hours,weeks_withheld,straight_time_cost,checks,sales,amount_missing,figure_notes,currency",
      compare: "row_type,period,period_start,period_end,location_code,location_name,status,coverage_status,checks,toast_check_totals,toast_item_sales_net,ezcater_sales,ezcater_orders,refunds_captured_so_far,sales_before_refunds,amount_missing,net_sales_for_labor,net_sales_state,labor_hours,pure_hourly_cost,overtime_premium,overtime_hours,pure_hourly_pct,pure_hourly_target_pct,labor_state,salaried_cost,burden_cost,burden_estimated,salary_estimated,salary_gaps,wage_estimated,hours_unverified,fully_loaded_cost,fully_loaded_pct,fully_loaded_target_pct,fully_loaded_state,large_checks,large_checks_amount,breakdown_state,rushes,figure_notes,currency",
    });
  });
  it("refuses past the row cap (413), never a cut file", () => {
    expect(() => assertBusinessRowCap(new Array(SALES_EXPORT_MAX_ROWS).fill({}))).not.toThrow();
    expect(() => assertBusinessRowCap(new Array(SALES_EXPORT_MAX_ROWS + 1).fill({}))).toThrow(expect.objectContaining({ status: 413, code: "export_too_large" }));
  });
});

describe("gates run before any read", () => {
  it("switch off = 503 business_report_unavailable, no client at all", async () => {
    for (const k of ["BUSINESS_REPORT", "FACT_LAYER", "FACT_LAYER_LABOR"]) {
      vi.stubEnv(k, "0");
      session("moo", 8, []);
      wire();
      const r = await get(`location=${A}&format=csv&${RANGE}`);
      expect(r.status).toBe(503);
      expect(await r.json()).toMatchObject({ error: "business_report_unavailable" });
      expect(reads).toBe(0);
      expect(audit).not.toHaveBeenCalled();
      vi.stubEnv(k, "1");
    }
  });
  it("AGM, SMM = 403; a GM at another shop = 403; all = 400; nothing read", async () => {
    for (const [role, level, locs, loc, status] of [["agm", 6, [A], A, 403], ["social_media_mgr", 6, [A], A, 403], ["gm", 7, [A], B, 403], ["moo", 8, [], "all", 400]] as const) {
      session(role, level, [...locs]);
      wire();
      const r = await get(`location=${loc}&format=csv&${RANGE}`);
      expect(r.status, role).toBe(status);
      expect(reads, role).toBe(0);
    }
  });
});

describe("the files", () => {
  it("overview CSV: day, week and total rows; fully loaded empty with its reason; audited", async () => {
    // Fully loaded labor is in a GM's file only with the MoO+ switch on (tests/business-report-export-access.test.ts
    // covers every setting); here it is on, so the file is the one a GM had before the settings existed.
    session("gm", 7, [A]); wire({ visibility: [GM_ALL_ON] });
    const r = await get(`location=${A}&format=csv&${RANGE}`);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-disposition")).toContain("business_MEP_2026-10-01_2026-10-07.csv");
    const rows = await csv(r);
    expect(col(rows, "row_type")).toEqual([...Array(7).fill("day"), "week", "week", "total"]);
    expect(col(rows, "fully_loaded_cost").every((c) => c === "")).toBe(true);
    expect(col(rows, "fully_loaded_state")[0]).toBe("salary_unknown");
    expect(col(rows, "pure_hourly_pct")[0]).toBe("18");
    expect(col(rows, "labor_hours")[0]).toBe("0.5");
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "report.export", metadata: expect.objectContaining({ family: "business", format: "csv" }) }));
  });
  it("hours CSV: with the switch off a GM gets minutes only; a GM by default and the MoO get the 15-minute dollars", async () => {
    session("gm", 7, [A]); wire({ visibility: [gmOff("quarter_cost")] });
    const g = await csv(await get(`location=${A}&format=csv&tab=hours&${RANGE}`));
    expect(col(g, "labor_hours").some((c) => c === "0.5")).toBe(true);
    expect(col(g, "straight_time_cost").every((c) => c === "")).toBe(true);
    expect(col(g, "straight_time_pct").every((c) => c === "")).toBe(true);
    session("gm", 7, [A]); wire();
    expect(col(await csv(await get(`location=${A}&format=csv&tab=hours&${RANGE}`)), "straight_time_cost")).toContain("9.00");
    session("moo", 8, []); wire();
    const m = await csv(await get(`location=${A}&format=csv&tab=hours&${RANGE}`));
    expect(col(m, "straight_time_cost")).toContain("9.00");
  });
  it("people CSV: hours per person and sales per server; cost per hourly person for a GM by default and MoO+, empty with the switch off", async () => {
    session("gm", 7, [A]); wire({ visibility: [gmOff("person_cost")] });
    const g = await csv(await get(`location=${A}&format=csv&tab=people&${RANGE}`));
    expect(col(g, "row_type")).toContain("person");
    expect(col(g, "row_type")).toContain("server");
    expect(col(g, "straight_time_cost").every((c) => c === "")).toBe(true);
    session("gm", 7, [A]); wire();
    expect(col(await csv(await get(`location=${A}&format=csv&tab=people&${RANGE}`)), "straight_time_cost")).toContain("180.00");
    session("owner", 9, []); wire();
    const o = await csv(await get(`location=${A}&format=csv&tab=people&${RANGE}`));
    expect(col(o, "straight_time_cost")).toContain("180.00");
  });
  it("compare CSV: this period, the one before, and last year as no_data_yet (empty until July 2027)", async () => {
    session("gm", 7, [A]); wire();
    const rows = await csv(await get(`location=${A}&format=csv&tab=compare&${RANGE}`));
    expect(col(rows, "period")).toEqual(["current", "previous", "last_year"]);
    const ly = rows[3]!;
    expect(ly[rows[0]!.indexOf("status")]).toBe("no_data_yet");
    expect(ly[rows[0]!.indexOf("sales_before_refunds")]).toBe("");
  });
  it("PDF: the same table as a PDF", async () => {
    session("gm", 7, [A]); wire();
    const r = await get(`location=${A}&format=pdf&tab=channels&${RANGE}`);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("application/pdf");
    expect(r.headers.get("content-disposition")).toContain("business-channels_MEP_2026-10-01_2026-10-07.pdf");
  });
});
