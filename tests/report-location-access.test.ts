import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { canReadReportLocation, lockLocationContext } from "@/lib/locations";
import { loadWrittenReport } from "@/lib/written-reports";
import type { RoleCode } from "@/lib/roles";

describe("report read scope is independent of task/write scope", () => {
  it.each<RoleCode>(["key_holder", "trainer", "shift_lead", "agm", "catering_mgr", "prep_mgr", "social_media_mgr"])("%s reads only their shops", (role) => {
    const actor = { role, locations: ["mine"] };
    expect(canReadReportLocation(actor, "mine")).toBe(true);
    expect(canReadReportLocation(actor, "other")).toBe(false);
  });
  it.each<RoleCode>(["gm", "moo"])("%s may read another shop without operational permission", (role) => {
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
      const query = {
        select: () => query,
        eq: () => query,
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
  it("GM reads another shop while AGM remains location-bound", async () => {
    const args = { id: "report", viewer: { userId: "reader", level: 7, locations: ["mine"] } };
    expect(await loadWrittenReport(reportService(5), args)).toMatchObject({ id: "report", canEdit: false });
    expect(await loadWrittenReport(reportService(5), { ...args, viewer: { ...args.viewer, level: 6 } })).toBeNull();
  });
  it("the all-shop grant never bypasses a report's visibility floor", async () => {
    expect(await loadWrittenReport(reportService(9), { id: "report", viewer: { userId: "reader", level: 7, locations: [] } })).toBeNull();
  });
});
