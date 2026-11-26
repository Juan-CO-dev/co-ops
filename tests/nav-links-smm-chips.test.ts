/**
 * Nav PR 4 (plan r2, section 6; PR 3 lead decision 5): the Dashboard's chip row drops the report chips for a role
 * the report family refuses. S1 refuses every page under app/(authed)/reports/** to the social media manager
 * (lib/reports-access-shared.ts), so its Reports, Trends and Written reports chips bounced to /dashboard?denied=reports.
 * The filter reads S1's own rule (`reportsRoleAllowed`); no second role list. Without `role`, the output is today's.
 */
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { navDestinationsFor } from "@/lib/nav-links";
import { reportsRoleAllowed } from "@/lib/reports-access-shared";
import { ROLES, getRoleLevel, type RoleCode } from "@/lib/roles";

vi.mock("@/lib/vault-flag", () => ({ vaultEnabled: () => false }));
vi.mock("@/lib/pulse/flag", () => ({ pulseV2Enabled: () => false }));

const ALL_ROLES = Object.keys(ROLES) as RoleCode[];
const OPTS: ({ vault?: boolean; pulseV2?: boolean } | undefined)[] = [
  undefined, {}, { vault: true }, { vault: false }, { pulseV2: true }, { pulseV2: false }, { vault: true, pulseV2: true },
];
const REPORT_CHIPS = ["/reports", "/reports/trends", "/reports/written"];
const isReport = (href: string) => href === "/reports" || href.startsWith("/reports/");

describe("the social media manager's chips", () => {
  it.each(OPTS.map((o) => [JSON.stringify(o) ?? "omitted", o] as const))("options %s: no report chip, and still My performance, Training, Settings, Team directory", (_n, o) => {
    const hrefs = navDestinationsFor(6, { ...o, role: "social_media_mgr" }).map((l) => l.href);
    for (const r of REPORT_CHIPS) expect(hrefs).not.toContain(r);
    for (const keep of ["/my-feedback", "/training", "/settings", "/profile"]) expect(hrefs).toContain(keep);
  });

  it("the same level without the role keeps today's chips (byte-identical output)", () => {
    for (const o of OPTS) {
      const hrefs = navDestinationsFor(6, o).map((l) => l.href);
      for (const r of REPORT_CHIPS) expect(hrefs).toContain(r);
      expect(navDestinationsFor(6, o === undefined ? undefined : { ...o })).toEqual(navDestinationsFor(6, o));
    }
  });
});

describe("the role changes nothing else", () => {
  it("for every role at its own level and every option set: with the role equals without it, minus the report chips exactly when S1 refuses the role", () => {
    for (const role of ALL_ROLES) for (const o of OPTS) {
      const level = getRoleLevel(role);
      const without = navDestinationsFor(level, o);
      const withRole = navDestinationsFor(level, { ...o, role });
      expect(withRole, `${role} ${JSON.stringify(o)}`).toEqual(reportsRoleAllowed(role) ? without : without.filter((l) => !isReport(l.href)));
    }
  });

  it("the S1 rule drives it: report chips dropped <=> !reportsRoleAllowed(role)", () => {
    for (const role of ALL_ROLES) {
      const hrefs = navDestinationsFor(10, { role }).map((l) => l.href);
      expect(hrefs.some(isReport), role).toBe(reportsRoleAllowed(role));
    }
  });

  it("the filter imports reportsRoleAllowed from lib/reports-access-shared.ts and names no role", () => {
    const src = readFileSync("lib/nav-links.ts", "utf8");
    expect(src).toContain('import { reportsRoleAllowed } from "@/lib/reports-access-shared";');
    expect(src).not.toMatch(/social_media_mgr/);
  });
});

describe("\"All pages\" (nav PR 9: the top bar's Go to)", () => {
  it("renders one button and no chips (no links) for any role; it opens the bar's Go to", async () => {
    const { DashboardNav } = await import("@/components/DashboardNav");
    const html = renderToStaticMarkup(createElement(DashboardNav, { label: "All pages" }));
    expect(html).toMatch(/^<button[^>]*data-dashboard-all-pages=""[^>]*>All pages<\/button>$/);
    expect(html).not.toContain("href=");
    expect(readFileSync("components/DashboardNav.tsx", "utf8")).toContain("useGoTo()");
  });

  it("Go to never lists a report page for the social media manager, and lists all three for an AGM at the same level", async () => {
    const { goToEntries } = await import("@/lib/nav/go-to");
    const { allEntries } = await import("@/lib/nav/go-to-shared");
    const hrefs = (role: RoleCode) => allEntries(goToEntries({ role, level: 6, language: "en" }, {})).map((e) => e.href);
    expect(hrefs("social_media_mgr").filter(isReport)).toEqual([]);
    for (const r of REPORT_CHIPS) expect(hrefs("agm")).toContain(r);
  });

  it("the dashboard passes the session's real role to the shortcuts", () => {
    const page = readFileSync("app/(authed)/dashboard/page.tsx", "utf8");
    expect(page).toContain("actorRole={auth.role}");
    expect(page).not.toMatch(/actorRole=\{[^}]*works/i);
  });
});
