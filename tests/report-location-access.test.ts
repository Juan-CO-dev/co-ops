import React from "react";
import { resolveTrendRange } from "@/lib/reports-trends";
import { reportRangeParams } from "@/lib/report-range";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { canReadReportLocation, lockLocationContext } from "@/lib/locations";
import { listWrittenReports, loadWrittenReport } from "@/lib/written-reports";
import type { RoleCode } from "@/lib/roles";

describe("report read scope is independent of task/write scope", () => {
  it.each<RoleCode>(["gm", "key_holder", "trainer", "shift_lead", "agm", "catering_mgr", "prep_mgr", "social_media_mgr"])("%s reads only their shops", (role) => {
    const actor = { role, locations: ["mine"] };
    expect(canReadReportLocation(actor, "mine")).toBe(true);
    expect(canReadReportLocation(actor, "other")).toBe(false);
  });
  it.each<RoleCode>(["moo"])("%s may read another shop without operational permission", (role) => {
    const actor = { role, locations: ["mine"] };
    expect(canReadReportLocation(actor, "other")).toBe(true);
    expect(lockLocationContext(actor, "other")).toBe(false);
  });
  it.each<RoleCode>(["owner", "cgs"])("%s retains all-shop access", (role) => {
    const actor = { role, locations: [] };
    expect(canReadReportLocation(actor, "other")).toBe(true);
    expect(lockLocationContext(actor, "other")).toBe(true);
  });
});

function reportService(visibilityMinLevel: number): SupabaseClient {
  return {
    from: (table: string) => {
      let nullLocationOnly = false;
      let visibilityCeiling = Number.POSITIVE_INFINITY;
      const query = {
        select: () => query,
        eq: () => query,
        in: () => query, lte: (_column: string, value: number) => { visibilityCeiling = value; return query; }, gte: () => query, lt: () => query,
        not: () => query, filter: () => query,
        or: (value: string) => {
          const match = value.match(/visibility_min_level\.lte\.(\d+)/);
          if (match) visibilityCeiling = Number(match[1]);
          if (value.includes("location_id.is.null") && !value.includes("location_id.in.(other)")) nullLocationOnly = true;
          return query;
        },
        order: () => query, limit: () => query,
        is: () => { nullLocationOnly = true; return query; },
        then: async (resolve: (value: unknown) => unknown) => {
          const row = (await query.maybeSingle()).data;
          return resolve({ error: null, data: table === "users" || nullLocationOnly || visibilityMinLevel > visibilityCeiling ? [] : [row] });
        },
        maybeSingle: async () => ({ error: null, data: table === "users" ? { name: "Writer" } : {
          id: "report", location_id: "other", submitted_by: "writer", submitted_by_role: "shift_lead",
          submitted_at: "2026-10-07T12:00:00Z", last_edited_at: null, edit_count: 0,
          category: "observation", title: "Shift", body: "Synthetic report", visibility_min_level: visibilityMinLevel,
          related_table: null, related_id: null,
        } }),
      };
      return query;
    },
  } as unknown as SupabaseClient;
}

describe("written report reads", () => {
  it("the all-location sentinel cannot grant a GM cross-shop detail or list access", async () => {
    const viewer = { userId: "reader", level: 7, locations: "all" as const };
    expect(await loadWrittenReport(reportService(5), { id: "report", viewer })).toBeNull();
    expect((await listWrittenReports(reportService(5), { viewer })).reports).toEqual([]);
    const moo = { ...viewer, level: 8 };
    expect(await loadWrittenReport(reportService(5), { id: "report", viewer: moo })).toMatchObject({ id: "report" });
    expect((await listWrittenReports(reportService(5), { viewer: moo })).reports).toMatchObject([{ id: "report" }]);
  });
  it("MoO reads another shop while GM remains location-bound", async () => {
    const args = { id: "report", viewer: { userId: "reader", level: 8, locations: ["mine"] } };
    expect(await loadWrittenReport(reportService(5), args)).toMatchObject({ id: "report", canEdit: false });
    expect(await loadWrittenReport(reportService(5), { ...args, viewer: { ...args.viewer, level: 7 } })).toBeNull();
  });
  it("the all-shop grant never bypasses a report's visibility floor", async () => {
    expect(await loadWrittenReport(reportService(9), { id: "report", viewer: { userId: "reader", level: 7, locations: [] } })).toBeNull();
  });
  it("employees receive visibility-targeted colleague posts while higher-floor data stays absent", async () => {
    const employee = { userId: "reader", level: 3, locations: ["other"] };
    expect(await loadWrittenReport(reportService(3), { id: "report", viewer: employee }))
      .toMatchObject({ id: "report", submittedBy: "writer" });
    expect(await loadWrittenReport(reportService(4), { id: "report", viewer: employee })).toBeNull();
    expect((await listWrittenReports(reportService(4), { viewer: employee })).reports).toEqual([]);
    expect(await loadWrittenReport(reportService(7), { id: "report", viewer: { ...employee, userId: "writer" } }))
      .toMatchObject({ id: "report", submittedBy: "writer" });
  });
});

// Exercise the actual per-person page guard before any metrics data is read.
describe("per-person team report location boundary", () => {
  it.each([["gm", "mine", true], ["gm", "other", false], ["moo", "mine", true], ["moo", "other", true]] as const)(
    "%s reading %s: allowed=%s", async (role, location, allowed) => {
      const source = readFileSync("app/(authed)/reports/trends/team/[personId]/page.tsx", "utf8");
      const ast = ts.createSourceFile("page.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const declarations = ast.statements.filter(node => ts.isFunctionDeclaration(node) && ["PersonDetailPage", "renderPage"].includes(node.name?.text ?? ""));
      const js = ts.transpile(declarations.map(node => node.getText(ast).replace("export default ", "")).join("\n"), { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React });
      const loadPersonDetail = vi.fn(async () => { throw new Error("authorized metrics read"); });
      const deps = {
        requireSessionFromHeaders: async () => ({ role, level: role === "gm" ? 7 : 8, locations: ["mine"], user: { id: "manager", language: "en" } }),
        TEAM_VIEW_LEVEL: 6, REPORT_ALL_LOCATIONS_LEVEL: 8, canReadReportLocation, resolveTrendRange, reportRangeParams,
        redirect: () => { throw new Error("redirect"); },
        parseGranularity: () => "day", operationalNow: () => ({ date: "2026-10-07" }),
        parseReportRange: () => ({ range: "last7", from: "2026-10-01", to: "2026-10-07", compare: false, previous: { from: "2026-09-24", to: "2026-09-30" } }),
        getServiceRoleClient: () => ({}), loadPersonDetail,
        loadPersonReportLocations: async () => ["mine", "other"],
        React, ReportPageNav: () => null, ReportShopTabs: () => null, TrendControls: () => null,
      };
      const page = new Function(...Object.keys(deps), `${js}; return PersonDetailPage;`)(...Object.values(deps));
      await expect(page({ params: Promise.resolve({ personId: "employee" }), searchParams: Promise.resolve({ location }) }))
        .rejects.toThrow(allowed ? "authorized metrics read" : "redirect");
      expect(loadPersonDetail).toHaveBeenCalledTimes(allowed ? 1 : 0);
    });
});
