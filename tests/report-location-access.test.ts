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
      const query = {
        select: () => query,
        eq: () => query,
        in: () => query, lte: () => query, order: () => query, limit: () => query,
        is: () => { nullLocationOnly = true; return query; },
        then: async (resolve: (value: unknown) => unknown) => {
          const row = (await query.maybeSingle()).data;
          return resolve({ error: null, data: table === "users" || nullLocationOnly ? [] : [row] });
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
    expect(await listWrittenReports(reportService(5), { viewer })).toEqual([]);
    const moo = { ...viewer, level: 8 };
    expect(await loadWrittenReport(reportService(5), { id: "report", viewer: moo })).toMatchObject({ id: "report" });
    expect(await listWrittenReports(reportService(5), { viewer: moo })).toMatchObject([{ id: "report" }]);
  });
  it("MoO reads another shop while GM remains location-bound", async () => {
    const args = { id: "report", viewer: { userId: "reader", level: 8, locations: ["mine"] } };
    expect(await loadWrittenReport(reportService(5), args)).toMatchObject({ id: "report", canEdit: false });
    expect(await loadWrittenReport(reportService(5), { ...args, viewer: { ...args.viewer, level: 7 } })).toBeNull();
  });
  it("the all-shop grant never bypasses a report's visibility floor", async () => {
    expect(await loadWrittenReport(reportService(9), { id: "report", viewer: { userId: "reader", level: 7, locations: [] } })).toBeNull();
  });
});

// Exercise the actual per-person page guard before any metrics data is read.
describe("per-person team report location boundary", () => {
  it.each([["gm", "mine", true], ["gm", "other", false], ["moo", "mine", true], ["moo", "other", true]] as const)(
    "%s reading %s: allowed=%s", async (role, location, allowed) => {
      const source = readFileSync("app/(authed)/reports/trends/team/[personId]/page.tsx", "utf8");
      const ast = ts.createSourceFile("page.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const declaration = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "PersonDetailPage")!;
      const js = ts.transpile(declaration.getText(ast).replace("export default ", ""), { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React });
      const loadPersonDetail = vi.fn(async () => { throw new Error("authorized metrics read"); });
      const deps = {
        requireSessionFromHeaders: async () => ({ role, level: role === "gm" ? 7 : 8, locations: ["mine"], user: { id: "manager", language: "en" } }),
        TEAM_VIEW_LEVEL: 6, canReadReportLocation,
        redirect: () => { throw new Error("redirect"); },
        parseGranularity: () => "day", operationalNow: () => ({ date: "2026-10-07" }),
        getServiceRoleClient: () => ({}), loadPersonDetail,
      };
      const page = new Function(...Object.keys(deps), `${js}; return PersonDetailPage;`)(...Object.values(deps));
      await expect(page({ params: Promise.resolve({ personId: "employee" }), searchParams: Promise.resolve({ location }) }))
        .rejects.toThrow(allowed ? "authorized metrics read" : "redirect");
      expect(loadPersonDetail).toHaveBeenCalledTimes(allowed ? 1 : 0);
    });
});
