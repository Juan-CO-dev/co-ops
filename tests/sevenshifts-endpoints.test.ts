import { describe, expect, it } from "vitest";

import {
  SEVENSHIFTS_API_VERSION,
  SEVENSHIFTS_ENDPOINTS,
  SEVENSHIFTS_RESOURCES,
  LIST_PAGE_LIMIT,
  requestPasses,
  windowInstants,
  type SyncWindow,
} from "@/lib/sevenshifts/endpoints-shared";

const WINDOW: SyncWindow = { modifiedSince: "2026-10-12T18:30:00.000Z", from: "2026-07-16", to: "2026-10-15" };

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
      for (const qs of requestPasses(r, WINDOW, "1234")) expect(qs.toString()).not.toMatch(/token|bearer|@/i);
    }
  });

  it("builds the documented paths", () => {
    const p = (r: (typeof SEVENSHIFTS_RESOURCES)[number]) => SEVENSHIFTS_ENDPOINTS[r].path("1234", { userId: "42" });
    expect(p("whoami")).toBe("/v2/whoami");
    expect(p("locations")).toBe("/v2/company/1234/locations");
    expect(p("departments")).toBe("/v2/company/1234/departments");
    expect(p("roles")).toBe("/v2/company/1234/roles");
    expect(p("users")).toBe("/v2/company/1234/users");
    expect(p("assignments")).toBe("/v2/company/1234/users/42/assignments");
    expect(p("wages")).toBe("/v2/company/1234/users/42/wages");
    expect(p("availabilities")).toBe("/v2/company/1234/availabilities");
    expect(p("time_off")).toBe("/v2/time_off");
    expect(p("shifts")).toBe("/v2/company/1234/shifts");
    expect(p("time_punches")).toBe("/v2/company/1234/time_punches");
    expect(p("labor_settings")).toBe("/v2/company/1234/labor_settings");
  });

  it("refuses a company or user id that is not 1–18 digits (no path or query injection)", () => {
    expect(() => SEVENSHIFTS_ENDPOINTS.users.path("12/../x")).toThrow("bad_id");
    expect(() => SEVENSHIFTS_ENDPOINTS.locations.path("")).toThrow("bad_id");
    expect(() => SEVENSHIFTS_ENDPOINTS.assignments.path("1234")).toThrow("bad_id");
    expect(() => SEVENSHIFTS_ENDPOINTS.wages.path("1234", { userId: "4 2" })).toThrow("bad_id");
    expect(() => SEVENSHIFTS_ENDPOINTS.time_off.path("12&x=1")).toThrow("bad_id");
    expect(() => SEVENSHIFTS_ENDPOINTS.time_off.params(WINDOW, "12&x=1")).toThrow("bad_id");
  });

  it("paginated resources ask for a page limit; singletons send no paging params", () => {
    for (const r of SEVENSHIFTS_RESOURCES) {
      const params = SEVENSHIFTS_ENDPOINTS[r].params(WINDOW, "1234");
      if (SEVENSHIFTS_ENDPOINTS[r].shape === "paginated") expect(params.get("limit")).toBe(String(LIST_PAGE_LIMIT));
      else expect(params.has("limit")).toBe(false);
    }
    expect(LIST_PAGE_LIMIT).toBeGreaterThanOrEqual(1);
    expect(LIST_PAGE_LIMIT).toBeLessThanOrEqual(500);
  });

  it("windows: shifts and punches by instant range + instant modified_since, deleted shifts included, drafts not", () => {
    const shifts = SEVENSHIFTS_ENDPOINTS.shifts.params(WINDOW, "1234");
    expect(shifts.get("start[gte]")).toBe("2026-07-16T04:00:00Z");
    expect(shifts.get("start[lte]")).toBe("2026-10-16T03:59:59Z");
    expect(shifts.get("modified_since")).toBe("2026-10-12T18:30:00Z");
    expect(shifts.get("include_deleted")).toBe("true");
    expect(shifts.get("include_draft")).toBe("false");
    expect(shifts.get("consider_tz_in_ranges")).toBe("true"); // chunk B review #1: true honours the explicit UTC offset
    const punches = SEVENSHIFTS_ENDPOINTS.time_punches.params(WINDOW, "1234");
    expect(punches.get("clocked_in[gte]")).toBe("2026-07-16T04:00:00Z");
    expect(punches.get("clocked_in[lte]")).toBe("2026-10-16T03:59:59Z");
    expect(punches.get("modified_since")).toBe("2026-10-12T18:30:00Z");
    // Users take a DATE: the ET date of the watermark instant.
    expect(SEVENSHIFTS_ENDPOINTS.users.params(WINDOW, "1234").get("modified_since")).toBe("2026-10-12");
    expect(SEVENSHIFTS_ENDPOINTS.users.params({ ...WINDOW, modifiedSince: "2026-10-13T02:00:00Z" }, "1234").get("modified_since")).toBe("2026-10-12");
    expect(SEVENSHIFTS_ENDPOINTS.availabilities.params(WINDOW, "1234").get("week_gte")).toBe("2026-07-16");
  });

  it("a first run (no watermark) sends no modified_since", () => {
    const first: SyncWindow = { modifiedSince: null, from: "2026-07-16", to: "2026-10-15" };
    expect(SEVENSHIFTS_ENDPOINTS.shifts.params(first, "1234").has("modified_since")).toBe(false);
    expect(SEVENSHIFTS_ENDPOINTS.users.params(first, "1234").has("modified_since")).toBe(false);
  });

  it("refuses a malformed window (date not YYYY-MM-DD, zoneless watermark, from after to)", () => {
    const bad = (w: SyncWindow) => () => SEVENSHIFTS_ENDPOINTS.shifts.params(w, "1234");
    expect(bad({ modifiedSince: "yesterday", from: "2026-07-16", to: "2026-10-15" })).toThrow("bad_window");
    expect(bad({ modifiedSince: "2026-10-12", from: "2026-07-16", to: "2026-10-15" })).toThrow("bad_window");
    expect(bad({ modifiedSince: "2026-10-12T10:00:00", from: "2026-07-16", to: "2026-10-15" })).toThrow("bad_window");
    expect(bad({ modifiedSince: null, from: "2026-7-16", to: "2026-10-15" })).toThrow("bad_window");
    expect(bad({ modifiedSince: null, from: "2026-10-16", to: "2026-10-15" })).toThrow("bad_window");
  });
});

describe("chunk A review (Astra) — fixes pinned against the docs re-read 2026-10-15", () => {
  it("#1 time off: GET /v2/time_off with company_id as a REQUIRED query parameter, to_date_gte, and no modified_since", () => {
    const [qs] = requestPasses("time_off", WINDOW, "1234");
    expect(`${SEVENSHIFTS_ENDPOINTS.time_off.path("1234")}?${qs!.toString()}`)
      .toBe("/v2/time_off?limit=200&company_id=1234&to_date_gte=2026-07-16");
  });

  it("#2 deleted punches: two request passes, deleted=false then deleted=true, each with the same window", () => {
    const passes = requestPasses("time_punches", WINDOW, "1234");
    expect(passes.map((p) => p.get("deleted"))).toEqual(["false", "true"]);
    for (const p of passes) {
      expect(p.get("clocked_in[gte]")).toBe("2026-07-16T04:00:00Z");
      expect(p.get("modified_since")).toBe("2026-10-12T18:30:00Z");
    }
    for (const r of SEVENSHIFTS_RESOURCES) if (!["time_punches", "users", "availabilities"].includes(r)) expect(requestPasses(r, WINDOW, "1234")).toHaveLength(1);
  });

  it("#4 ET business dates become DST-correct instants: the final day is covered to its last second", () => {
    // EDT (UTC−4) on both ends.
    expect(windowInstants({ modifiedSince: null, from: "2026-10-15", to: "2026-10-15" }))
      .toEqual({ gte: "2026-10-15T04:00:00Z", lte: "2026-10-16T03:59:59Z" });
    // EST (UTC−5) on both ends.
    expect(windowInstants({ modifiedSince: null, from: "2026-12-01", to: "2026-12-01" }))
      .toEqual({ gte: "2026-12-01T05:00:00Z", lte: "2026-12-02T04:59:59Z" });
    // Across fall-back (2026-11-01): starts in EDT, ends in EST.
    expect(windowInstants({ modifiedSince: null, from: "2026-10-31", to: "2026-11-02" }))
      .toEqual({ gte: "2026-10-31T04:00:00Z", lte: "2026-11-03T04:59:59Z" });
    // Across spring-forward (2026-03-08): starts in EST, ends in EDT.
    expect(windowInstants({ modifiedSince: null, from: "2026-03-07", to: "2026-03-09" }))
      .toEqual({ gte: "2026-03-07T05:00:00Z", lte: "2026-03-10T03:59:59Z" });
    // A shift starting 11:30 PM ET on the fall-back day is inside the upper bound.
    const lte = windowInstants({ modifiedSince: null, from: "2026-11-01", to: "2026-11-01" }).lte;
    expect(Date.parse("2026-11-02T04:30:00Z")).toBeLessThanOrEqual(Date.parse(lte));
  });
});

describe("chunk B review (Astra) — the endpoint table", () => {
  it("#1 shifts send consider_tz_in_ranges=true: 7shifts honours the explicit UTC offset of start[gte|lte]", () => {
    for (const p of requestPasses("shifts", WINDOW, "1234")) expect(p.get("consider_tz_in_ranges")).toBe("true");
  });

  it("#3 availability is TWO disjoint passes: weekly records bounded by week_gte, repeating records with NO week floor", () => {
    const passes = requestPasses("availabilities", WINDOW, "1234");
    expect(passes.map((p) => [p.get("repeating"), p.get("week_gte")])).toEqual([["false", "2026-07-16"], ["true", null]]);
    for (const p of passes) expect(p.get("limit")).toBe(String(LIST_PAGE_LIMIT));
  });

  it("users: explicit active and inactive passes (no reliance on the status default), modified_since stays a DATE", () => {
    const passes = requestPasses("users", WINDOW, "1234");
    expect(passes.map((p) => p.get("status"))).toEqual(["active", "inactive"]);
    for (const p of passes) expect(p.get("modified_since")).toBe("2026-10-12");
  });

  it("a pass may REMOVE a base parameter (null), and only the declared keys change", () => {
    const [weekly, repeating] = requestPasses("availabilities", WINDOW, "1234");
    expect([...repeating!.keys()].sort()).toEqual(["limit", "repeating"]);
    expect([...weekly!.keys()].sort()).toEqual(["limit", "repeating", "week_gte"]);
  });
});
