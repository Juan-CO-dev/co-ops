import { describe, expect, it } from "vitest";

import {
  SEVENSHIFTS_API_VERSION,
  SEVENSHIFTS_ENDPOINTS,
  SEVENSHIFTS_RESOURCES,
  LIST_PAGE_LIMIT,
  type SyncWindow,
} from "@/lib/sevenshifts/endpoints-shared";

const WINDOW: SyncWindow = { modifiedSince: "2026-10-12", from: "2026-07-16", to: "2026-10-15" };

describe("the endpoint table", () => {
  it("pins the API version in one constant", () => {
    expect(SEVENSHIFTS_API_VERSION).toBe("2026-01-01");
  });

  it("has exactly the twelve resources", () => {
    expect([...SEVENSHIFTS_RESOURCES]).toEqual([
      "whoami", "locations", "departments", "roles", "users", "assignments", "wages",
      "availabilities", "time_off", "shifts", "time_punches", "labor_settings",
    ]);
  });

  it("every path starts with /v2/ and carries no token, email or query string", () => {
    for (const r of SEVENSHIFTS_RESOURCES) {
      const path = SEVENSHIFTS_ENDPOINTS[r].path("1234", { userId: "42" });
      expect(path.startsWith("/v2/")).toBe(true);
      expect(path).not.toMatch(/token|bearer|@|\?/i);
      const qs = SEVENSHIFTS_ENDPOINTS[r].params(WINDOW).toString();
      expect(qs).not.toMatch(/token|bearer|@/i);
    }
  });

  it("builds the documented company-scoped paths", () => {
    const p = (r: (typeof SEVENSHIFTS_RESOURCES)[number]) => SEVENSHIFTS_ENDPOINTS[r].path("1234", { userId: "42" });
    expect(p("whoami")).toBe("/v2/whoami");
    expect(p("locations")).toBe("/v2/company/1234/locations");
    expect(p("departments")).toBe("/v2/company/1234/departments");
    expect(p("roles")).toBe("/v2/company/1234/roles");
    expect(p("users")).toBe("/v2/company/1234/users");
    expect(p("assignments")).toBe("/v2/company/1234/users/42/assignments");
    expect(p("wages")).toBe("/v2/company/1234/users/42/wages");
    expect(p("availabilities")).toBe("/v2/company/1234/availabilities");
    expect(p("time_off")).toBe("/v2/company/1234/time_off");
    expect(p("shifts")).toBe("/v2/company/1234/shifts");
    expect(p("time_punches")).toBe("/v2/company/1234/time_punches");
    expect(p("labor_settings")).toBe("/v2/company/1234/labor_settings");
  });

  it("refuses a company or user id that is not 1–18 digits (no path injection)", () => {
    expect(() => SEVENSHIFTS_ENDPOINTS.users.path("12/../x")).toThrow("bad_id");
    expect(() => SEVENSHIFTS_ENDPOINTS.locations.path("")).toThrow("bad_id");
    expect(() => SEVENSHIFTS_ENDPOINTS.assignments.path("1234")).toThrow("bad_id");
    expect(() => SEVENSHIFTS_ENDPOINTS.wages.path("1234", { userId: "4 2" })).toThrow("bad_id");
  });

  it("paginated resources ask for a page limit; singletons send no paging params", () => {
    for (const r of SEVENSHIFTS_RESOURCES) {
      const params = SEVENSHIFTS_ENDPOINTS[r].params(WINDOW);
      if (SEVENSHIFTS_ENDPOINTS[r].shape === "paginated") expect(params.get("limit")).toBe(String(LIST_PAGE_LIMIT));
      else expect(params.has("limit")).toBe(false);
    }
    expect(LIST_PAGE_LIMIT).toBeGreaterThanOrEqual(1);
    expect(LIST_PAGE_LIMIT).toBeLessThanOrEqual(500);
  });

  it("windows: shifts and punches by range + modified_since, deleted rows included, drafts not", () => {
    const shifts = SEVENSHIFTS_ENDPOINTS.shifts.params(WINDOW);
    expect(shifts.get("start[gte]")).toBe("2026-07-16");
    expect(shifts.get("start[lte]")).toBe("2026-10-15");
    expect(shifts.get("modified_since")).toBe("2026-10-12");
    expect(shifts.get("include_deleted")).toBe("true");
    expect(shifts.get("include_draft")).toBe("false");
    const punches = SEVENSHIFTS_ENDPOINTS.time_punches.params(WINDOW);
    expect(punches.get("clocked_in[gte]")).toBe("2026-07-16");
    expect(punches.get("clocked_in[lte]")).toBe("2026-10-15");
    expect(punches.get("modified_since")).toBe("2026-10-12");
    expect(SEVENSHIFTS_ENDPOINTS.users.params(WINDOW).get("modified_since")).toBe("2026-10-12");
    expect(SEVENSHIFTS_ENDPOINTS.availabilities.params(WINDOW).get("week_gte")).toBe("2026-07-16");
  });

  it("a first run (no watermark) sends no modified_since", () => {
    const first: SyncWindow = { modifiedSince: null, from: "2026-07-16", to: "2026-10-15" };
    expect(SEVENSHIFTS_ENDPOINTS.shifts.params(first).has("modified_since")).toBe(false);
    expect(SEVENSHIFTS_ENDPOINTS.users.params(first).has("modified_since")).toBe(false);
  });

  it("refuses a window date that is not YYYY-MM-DD", () => {
    expect(() => SEVENSHIFTS_ENDPOINTS.shifts.params({ modifiedSince: "yesterday", from: "2026-07-16", to: "2026-10-15" })).toThrow("bad_window");
    expect(() => SEVENSHIFTS_ENDPOINTS.shifts.params({ modifiedSince: null, from: "2026-7-16", to: "2026-10-15" })).toThrow("bad_window");
  });
});
