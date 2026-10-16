/**
 * Scheduling Phase 1, Task 13 — THE DELIBERATE SMM REFUSAL at the surfaces (R7, F2).
 *
 * `TEAM_VIEW_LEVEL = 6` admitted the social media manager (level 6) to team scoring. Access now goes
 * through ONE rule, `canViewPeople` (lib/people/access-shared.ts): the operational level-6 managers
 * (AGM, prep, catering) keep it, the SMM is refused by ROLE.
 *   - the trends landing's `canSeeTeam`: true for the AGM path, false for the SMM (no team read);
 *   - the team pages: an SMM is redirected to /dashboard before any read;
 *   - the export's team family: refused for an SMM before any database work.
 */
import React from "react";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), service: vi.fn(), team: vi.fn(), detail: vi.fn(), personLocations: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireSessionFromHeaders: mocks.auth }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: mocks.service }));
vi.mock("next/navigation", () => ({ usePathname: () => "/reports/trends", redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));
vi.mock("@/lib/operational-task-access", () => ({ canDoOperationalTask: async () => false }));
vi.mock("@/lib/team-metrics", async (original) => ({
  ...await original<typeof import("@/lib/team-metrics")>(),
  loadTeamOperatingHealth: mocks.team, loadPersonDetail: mocks.detail, loadPersonReportLocations: mocks.personLocations,
}));
vi.mock("@/lib/reports-trends", async (original) => ({
  ...await original<typeof import("@/lib/reports-trends")>(),
  loadTrendSeries: async () => ({ current: [], previous: null, cashVisible: false, totals: Object.fromEntries(["par", "temps", "cash", "completion"].map((key) => [key, { current: 0, delta: null }])) }),
}));
vi.mock("@/lib/yield-stats", async (original) => ({ ...await original<typeof import("@/lib/yield-stats")>(), loadYieldVariance: async () => null }));

const { default: Trends } = await import("@/app/(authed)/reports/trends/page");
const { default: Team } = await import("@/app/(authed)/reports/trends/team/page");
const { default: Person } = await import("@/app/(authed)/reports/trends/team/[personId]/page");
const { assertFamilyFloor, ExportError } = await import("@/lib/report-export");

const SHOP = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const session = (role: string, level = 6) => ({ role, level, locations: [SHOP], user: { id: `${role}-1`, language: "en" } });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.team.mockResolvedValue(null);
  mocks.detail.mockResolvedValue(null);
  mocks.personLocations.mockResolvedValue([SHOP]);
  const query = { select: () => query, eq: () => query, order: () => query, in: () => query, maybeSingle: async () => ({ data: null, error: null }),
    then: (resolve: (value: unknown) => unknown) => resolve({ data: [{ id: SHOP, name: "Shop A", code: "A" }], error: null }) };
  mocks.service.mockReturnValue({ from: () => query });
});

describe("the trends landing: canSeeTeam is canViewPeople for the selected shop", () => {
  it.each(["agm", "prep_mgr", "catering_mgr"])("%s (level 6) reads the team", async (role) => {
    mocks.auth.mockResolvedValue(session(role));
    await Trends({ searchParams: Promise.resolve({ location: SHOP }) } as never);
    expect(mocks.team).toHaveBeenCalledTimes(1);
  });

  it("the social media manager (level 6) does not — no team read at all", async () => {
    mocks.auth.mockResolvedValue(session("social_media_mgr"));
    await Trends({ searchParams: Promise.resolve({ location: SHOP }) } as never);
    expect(mocks.team).not.toHaveBeenCalled();
  });
});

describe("the team pages: an SMM is redirected to /dashboard before any read", () => {
  it("the team roster page", async () => {
    mocks.auth.mockResolvedValue(session("social_media_mgr"));
    await expect(Team({ searchParams: Promise.resolve({ location: SHOP }) } as never)).rejects.toThrow("redirect:/dashboard");
    expect(mocks.team).not.toHaveBeenCalled();
    mocks.auth.mockResolvedValue(session("agm"));
    await expect(Team({ searchParams: Promise.resolve({ location: SHOP }) } as never)).resolves.toBeTruthy();
    expect(mocks.team).toHaveBeenCalledTimes(1);
  });

  it("the person page", async () => {
    mocks.auth.mockResolvedValue(session("social_media_mgr"));
    await expect(Person({ params: Promise.resolve({ personId: "p1" }), searchParams: Promise.resolve({ location: SHOP }) } as never)).rejects.toThrow("redirect:/dashboard");
    expect(mocks.personLocations).not.toHaveBeenCalled();
    expect(mocks.detail).not.toHaveBeenCalled();
    mocks.auth.mockResolvedValue(session("agm"));
    await expect(Person({ params: Promise.resolve({ personId: "p1" }), searchParams: Promise.resolve({ location: SHOP }) } as never)).resolves.toBeTruthy();
    expect(mocks.detail).toHaveBeenCalledTimes(1);
  });

  it("a level-forged SMM (level 9) is still redirected", async () => {
    mocks.auth.mockResolvedValue(session("social_media_mgr", 9));
    await expect(Team({ searchParams: Promise.resolve({ location: SHOP }) } as never)).rejects.toThrow("redirect:/dashboard");
  });
});

describe("the reports hub", () => {
  it("offers the Team link only where canViewPeople allows it (never a dead end for the SMM)", () => {
    const src = readFileSync("app/(authed)/reports/page.tsx", "utf8");
    expect(src).toContain("{canViewPeople(peopleActorFromAuth(auth), shop.id) && <Link className={linkClass} href={`/reports/trends/team?");
    expect(src).not.toMatch(/auth\.level >= 6 && <Link[^>]*trends\/team/);
  });
});

describe("the export's team family", () => {
  it("is refused for an SMM before any database work; the AGM path passes the floor", () => {
    for (const role of ["agm", "prep_mgr", "catering_mgr"]) expect(() => assertFamilyFloor(session(role) as never, "team")).not.toThrow();
    let err: unknown = null;
    try { assertFamilyFloor(session("social_media_mgr") as never, "team") } catch (e) { err = e; }
    expect(err).toBeInstanceOf(ExportError);
    expect(err).toMatchObject({ status: 403, code: "role_insufficient" });
    expect(() => assertFamilyFloor(session("social_media_mgr") as never, "trends_ops")).not.toThrow();
  });

  it("the team case binds the shop through canViewPeople, never a level-only check", () => {
    const src = readFileSync("lib/report-export.ts", "utf8");
    const at = src.indexOf('case "team": {'); const team = src.slice(at, src.indexOf('case "catering": {', at));
    expect(team).toContain("canViewPeople(");
    expect(team).not.toContain("trendLocationAllowed(");
  });
});

void React;
