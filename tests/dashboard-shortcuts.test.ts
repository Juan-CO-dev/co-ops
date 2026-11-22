/**
 * Nav PR 7 (plan r2 T9, T10 helper half; spec 3.6, 10; ruling Q8): the Dashboard's shortcuts and surfaces.
 *
 * Each role gets ITS OWN spec 3.6 list, each entry kept only when its real gate admits the viewer (canSee), the viewer
 * holds its surface at the shop, and (for the social media manager) it shows no business numbers. No backfill.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { amPrepEditFor, dashboardSurfaces, dayViewerFor, MEMBER_SURFACES, SHORTCUTS, shortcutHref, shortcutsFor } from "@/lib/dashboard-day-shared";
import type { Surface } from "@/lib/day-plan-shared";
import { byId, DESTINATIONS } from "@/lib/nav/destinations";
import type { Switches } from "@/lib/nav/types";
import { ROLES, type RoleCode } from "@/lib/roles";
import { CATERING_NON_MEMBER, checklist, hm, ok, PLAN_DATE } from "./fixtures/day-plan/build";
import { SMM_OK } from "./fixtures/day-plan/busiest";
import { pStreet } from "./fixtures/day-plan/p-street";

const OFF: Switches = {};
const ON: Switches = { pulseV2: true, vault: true, businessReport: true, demandSignals: true, customerProfiles: true, marketingScorecard: true };
const ids = (role: RoleCode, switches: Switches, surfaces: ReadonlySet<Surface> = MEMBER_SURFACES) =>
  shortcutsFor({ role, level: ROLES[role].level, surfaces, switches }).map((d) => d.id);

const TRAINEE = ["training", "my-feedback", "assignments", "profile"];
const EXPECTED_OFF: Record<RoleCode, string[]> = {
  prospect: TRAINEE, hired_not_yet_worked: TRAINEE, trainee: TRAINEE,
  employee: ["assignments", "production", "maintenance", "training", "my-feedback"],
  key_holder: ["mid-shift", "assignments", "production", "maintenance", "reports"],
  trainer: ["mid-shift", "assignments", "production", "maintenance", "reports"],
  shift_lead: ["mid-shift", "assignments", "catering-workspace", "reports", "maintenance"],
  agm: ["mid-shift", "schedule", "assignments", "reports", "recipes", "admin"],
  prep_mgr: ["production", "pars", "recipes", "catering-prep-demand", "mid-shift", "admin"],
  // Schedule drops for the catering manager: its gate admits level 7+ and the AGM only (spec 10).
  catering_mgr: ["catering-workspace", "catering-inbox", "catering-prep-demand", "assignments", "admin"],
  gm: ["mid-shift", "schedule", "vendor-mail", "reports", "catering-workspace", "admin"],
  // The business report and the marketing scorecard exist only behind their switches.
  moo: ["mid-shift", "schedule", "vendor-mail", "catering-workspace", "admin"],
  owner: ["sales", "mid-shift", "catering-insights", "admin"],
  cgs: ["sales", "mid-shift", "catering-insights", "admin"],
  social_media_mgr: ["training", "my-feedback"],
};
const EXPECTED_ON: Record<RoleCode, string[]> = {
  ...EXPECTED_OFF,
  moo: ["mid-shift", "business", "schedule", "vendor-mail", "catering-workspace", "admin"],
  owner: ["business", "sales", "mid-shift", "catering-insights", "marketing", "admin"],
  cgs: ["business", "sales", "mid-shift", "catering-insights", "marketing", "admin"],
};

describe("shortcuts per role (spec 3.6)", () => {
  it("every role has a list, and every id is a real destination", () => {
    expect(Object.keys(SHORTCUTS).sort()).toEqual(Object.keys(ROLES).sort());
    for (const list of Object.values(SHORTCUTS)) for (const id of list) expect(() => byId(id), id).not.toThrow();
  });
  it.each(Object.keys(ROLES) as RoleCode[])("%s with every switch off", (role) => {
    expect(ids(role, OFF)).toEqual(EXPECTED_OFF[role]);
  });
  it.each(Object.keys(ROLES) as RoleCode[])("%s with every switch on", (role) => {
    expect(ids(role, ON)).toEqual(EXPECTED_ON[role]);
  });
  it("is a subset of the role's own list: never a backfill", () => {
    for (const role of Object.keys(ROLES) as RoleCode[]) for (const sw of [OFF, ON]) {
      for (const id of ids(role, sw)) expect(SHORTCUTS[role], `${role}:${id}`).toContain(id);
    }
  });
  it("the level 0-1 roles get the trainee list, filtered by the real gates (Q8)", () => {
    for (const role of ["prospect", "hired_not_yet_worked"] as const) expect(ids(role, OFF)).toEqual(ids("trainee", OFF));
  });
  it("Mid-shift drops below level 4 while Pulse v2 is off", () => {
    expect(shortcutsFor({ role: "key_holder", level: 3, surfaces: MEMBER_SURFACES, switches: OFF }).map((d) => d.id)).not.toContain("mid-shift");
    expect(shortcutsFor({ role: "key_holder", level: 3, surfaces: MEMBER_SURFACES, switches: { pulseV2: true } }).map((d) => d.id)).toContain("mid-shift");
  });
  it("the social media manager: exactly two, never a numbers destination under any switch combination", () => {
    const names = ["pulseV2", "vault", "businessReport", "demandSignals", "customerProfiles", "marketingScorecard"] as const;
    for (let mask = 0; mask < 1 << names.length; mask++) {
      const sw = Object.fromEntries(names.map((n, i) => [n, (mask & (1 << i)) !== 0])) as Switches;
      const list = shortcutsFor({ role: "social_media_mgr", level: 6, surfaces: MEMBER_SURFACES, switches: sw });
      expect(list.map((d) => d.id)).toEqual(["training", "my-feedback"]);
      expect(list.some((d) => d.numbers)).toBe(false);
    }
  });
  it("a surface the viewer lacks drops its shortcut (CATERING_NON_MEMBER drops Assignments)", () => {
    expect(ids("catering_mgr", OFF, CATERING_NON_MEMBER.surfaces)).toEqual(["catering-workspace", "catering-inbox", "catering-prep-demand", "admin"]);
    expect(ids("key_holder", OFF, new Set())).toEqual([]);
  });
});

describe("shortcut links", () => {
  const href = (id: string) => shortcutHref(byId(id), "shop-1");
  it("carry the shop in the route's own parameter, exactly for shop-taking routes that declare one", () => {
    expect(href("mid-shift")).toBe("/mid-shift?location=shop-1");
    expect(href("assignments")).toBe("/assignments?location=shop-1");
    expect(href("schedule")).toBe("/schedule?loc=shop-1");
    expect(href("reports")).toBe("/reports?location=shop-1");
    expect(href("vendor-mail")).toBe("/operations/vendor-mail?location=shop-1");
    expect(href("catering-prep-demand")).toBe("/admin/catering/prep-demand?location=shop-1");
  });
  it("leave shop-less routes and bare chips bare (/admin/recipes' ?location= is a readiness scope)", () => {
    for (const id of ["recipes", "my-feedback", "training", "profile", "admin", "catering-workspace", "catering-inbox"]) expect(href(id), id).toBe(byId(id).route);
  });
  it("no shop selected: every link is bare", () => {
    for (const d of DESTINATIONS) expect(shortcutHref(d, null)).toBe(d.route);
  });
});

describe("surfaces (interim, spec 10) and the viewer", () => {
  it("a member holds the five member surfaces; a non-member below 9 none; level 9+ all five anywhere", () => {
    expect([...MEMBER_SURFACES].sort()).toEqual(["catering", "ops", "report_read", "schedule", "tasks"]);
    expect(dashboardSurfaces({ role: "key_holder", locations: ["a"] }, "a")).toBe(MEMBER_SURFACES);
    expect(dashboardSurfaces({ role: "moo", locations: ["a"] }, "b").size).toBe(0);
    expect(dashboardSurfaces({ role: "gm", locations: [] }, "b").size).toBe(0);
    expect(dashboardSurfaces({ role: "owner", locations: [] }, "b")).toBe(MEMBER_SURFACES);
    expect(dashboardSurfaces({ role: "cgs", locations: ["a"] }, "b")).toBe(MEMBER_SURFACES);
  });
  it("the viewer carries the real role, level, surfaces and the request's switches, nothing else", () => {
    const v = dayViewerFor({ user: { id: "u1" }, role: "agm", level: 6, locations: ["a"] }, "a", ON);
    expect(Object.keys(v).sort()).toEqual(["level", "role", "surfaces", "switches", "userId"]);
    expect(v).toMatchObject({ userId: "u1", role: "agm", level: 6, switches: ON });
    expect(v.surfaces).toBe(MEMBER_SURFACES);
  });
});

describe("the navigation switches (lib/nav-switches.ts)", () => {
  it("reads each switch the way its owner does", () => {
    const src = readFileSync("lib/nav-switches.ts", "utf8");
    expect(src).toContain("pulseV2: pulseV2Enabled()");
    expect(src).toContain("vault: vaultEnabled()");
    expect(src).toContain("businessReport: businessReportEnabled(process.env)");
    expect(src).toContain("demandSignals: demandSignalsEnabled(process.env.DEMAND_SIGNALS)");
    expect(src).toContain('marketingScorecard: process.env.MARKETING_SCORECARD === "1"');
    // The customer profiles switch is customerProfilesEnabled()'s rule, inlined (the twin is pinned here).
    expect(src).toContain('customerProfiles: process.env.CUSTOMER_PROFILES === "1"');
    expect(readFileSync("lib/customers/customers.ts", "utf8")).toContain('return env.CUSTOMER_PROFILES === "1";');
    expect(readFileSync("lib/marketing/write.ts", "utf8")).toContain('process.env.MARKETING_SCORECARD !== "1"');
  });
});

describe("the AM prep submitter's Edit (Q2 carve-out, C.46 A2; T20 helper)", () => {
  const facts = (p: Parameters<typeof checklist>[1]) => ({ ...pStreet(hm("20:30")), amPrep: ok(checklist(PLAN_DATE, p)) });
  const input = (p: Parameters<typeof checklist>[1]) => ({ planDate: PLAN_DATE, facts: facts(p) });
  it("only the finisher of today's finished AM prep gets the link, to the page whose own gate decides", () => {
    expect(amPrepEditFor(input({ status: "confirmed", finishedById: "u-ana" }), "u-ana", "shop-p")).toBe("/operations/am-prep?location=shop-p&edit=true");
    expect(amPrepEditFor(input({ status: "confirmed", finishedById: "u-ana" }), "u-gm", "shop-p")).toBeUndefined();
    expect(amPrepEditFor(input({ status: "open", finishedById: "u-ana" }), "u-ana", "shop-p")).toBeUndefined();
    expect(amPrepEditFor(input({ status: null }), "u-ana", "shop-p")).toBeUndefined();
    expect(amPrepEditFor(input({ status: "confirmed" }), "u-ana", "shop-p")).toBeUndefined();
    expect(amPrepEditFor({ planDate: PLAN_DATE, facts: { ...facts({}), amPrep: { kind: "failed" } } }, "u-ana", "shop-p")).toBeUndefined();
    expect(amPrepEditFor({ planDate: "2026-11-19", facts: facts({ status: "confirmed", finishedById: "u-ana" }) }, "u-ana", "shop-p")).toBeUndefined();
    expect(amPrepEditFor({ planDate: PLAN_DATE, facts: SMM_OK }, "u-smm", "shop-p")).toBeUndefined();
  });
});
