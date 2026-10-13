import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { MIDSHIFT_BASE_LEVEL } from "@/lib/midshift-shared";
import { navDestinationsFor, chipHref } from "@/lib/nav-links";
import { MAINTENANCE_LINK_LEVEL, PULSE_V2_BASE_LEVEL, canOpenMaintenance, pulsePageAccess } from "@/lib/pulse/scope-shared";
import { matchPages } from "@/lib/unified-search";

const hrefs = (level: number) => navDestinationsFor(level).map((d) => d.href).sort();
const everyone = ["/training", "/profile", "/settings", "/my-feedback", "/assignments"];
const kh = ["/mid-shift", "/reports/trends"];
const lead = ["/catering"];
const manager = ["/lto", "/admin", "/admin/recipes"];

describe("role navigation", () => {
  it("reports begins at trainee level 2", () => { expect(hrefs(1)).not.toContain("/reports"); expect(hrefs(2)).toContain("/reports"); });
  it.each([2, 3, 4, 5, 6, 7, 9])("shows exactly the approved destinations at level %s", (level) => {
    expect(hrefs(level)).toEqual([...everyone, ...(level >= 2 ? ["/reports", "/reports/written"] : []), ...(level >= 3 ? ["/maintenance"] : []), ...(level >= 4 ? kh : []), ...(level >= 5 ? lead : []), ...(level >= 6 ? manager : [])].sort());
  });
  it("never advertises a placeholder or the ordering task in navigation", () => {
    for (const level of [2, 3, 4, 5, 6, 7, 9, 10]) {
      for (const hidden of ["/recipes", "/announcements", "/tips", "/ai", "/rollups", "/deep-cleaning", "/feedback", "/comms", "/ordering"]) expect(hrefs(level)).not.toContain(hidden);
    }
  });
  it("satisfies the destination server floors, including Catering's level-5 page", () => {
    // Floors confirmed against destination pages/layouts and their server loaders.
    const pageFloors: Record<string, number> = {
      "/maintenance": 3, "/training": 0, "/admin/recipes": 6, "/profile": 0, "/settings": 0, "/my-feedback": 0,
      "/mid-shift": 4, "/assignments": 0, "/reports": 2,
      "/catering": 5, "/reports/written": 2, "/reports/trends": 4, "/lto": 0, "/admin": 6,
    };
    for (const level of [2, 3, 4, 5, 6, 7, 9]) for (const href of hrefs(level)) {
      expect(pageFloors[href]).toBeDefined();
      expect(level).toBeGreaterThanOrEqual(pageFloors[href]!);
    }
  });
  it("ties advertised floors to the actual destination guards", () => {
    const source = (path: string) => readFileSync(path, "utf8");
    const catering = source("app/(authed)/catering/page.tsx");
    const admin = source("app/admin/layout.tsx");
    const assignments = source("app/(authed)/assignments/page.tsx");
    expect(assignments).not.toMatch(/auth\.level < .*redirect/);
    expect(catering).toMatch(/if \(level < CATERING_HUB_MIN\)/);
    expect(admin).toMatch(/if \(auth\.level < ADMIN_MIN_LEVEL\)/);
    expect(source("app/(authed)/mid-shift/page.tsx")).toMatch(/if \(auth\.level < MIDSHIFT_BASE_LEVEL\)/);
    const declaredNumber = (contents: string, pattern: RegExp) => {
      const value = contents.match(pattern)?.[1];
      expect(value, `guard missing: ${pattern}`).toBeDefined();
      return Number(value);
    };
    const actualFloors: Record<string, number> = {
      "/maintenance": declaredNumber(source("lib/maintenance.ts"), /const MAINTENANCE_BASE_LEVEL = (\d+)/),
      "/catering": declaredNumber(catering, /const CATERING_HUB_MIN = (\d+)/),
      "/admin": declaredNumber(admin, /const ADMIN_MIN_LEVEL = (\d+)/),
      "/assignments": 0,
      "/mid-shift": MIDSHIFT_BASE_LEVEL,
    };
    for (const [href, floor] of Object.entries(actualFloors)) {
      for (const level of [2, 3, 4, 5, 6, 7, 9]) {
        if (hrefs(level).includes(href)) expect(level, `${href} shown below server floor`).toBeGreaterThanOrEqual(floor);
      }
    }
  });
  it("keeps mid-shift first and admin last", () => {
    const destinations = navDestinationsFor(9);
    expect(destinations[0]?.href).toBe("/mid-shift");
    expect(destinations.at(-1)?.href).toBe("/admin");
  });
});

describe("Mid-shift Pulse v2 in navigation (crew get the pulse, Juan 2026-10-12)", () => {
  const v2 = (level: number) => navDestinationsFor(level, { pulseV2: true }).map((d) => d.href);
  it("shows Mid-shift to trainee and up while v2 is on, first in the row", () => {
    expect(v2(1)).not.toContain("/mid-shift");
    for (const level of [2, 3, 4, 7, 9]) expect(v2(level)[0]).toBe("/mid-shift");
  });
  it("keeps key holder and up while v2 is off (the v1 page denies crew)", () => {
    expect(hrefs(3)).not.toContain("/mid-shift");
    expect(hrefs(4)).toContain("/mid-shift");
  });
  it("advertises exactly the page's own floor in each mode", () => {
    const floor = (pulseV2: boolean) => navDestinationsFor(10, { pulseV2 }).find((d) => d.href === "/mid-shift")?.minLevel;
    expect(floor(true)).toBe(PULSE_V2_BASE_LEVEL);
    expect(floor(false)).toBe(MIDSHIFT_BASE_LEVEL);
    expect(pulsePageAccess({ flagOn: true, level: PULSE_V2_BASE_LEVEL })).toBe("v2");
    expect(pulsePageAccess({ flagOn: true, level: PULSE_V2_BASE_LEVEL - 1 })).toBe("denied");
  });
  it("search finds the pulse for crew only while v2 is on", () => {
    const t = (key: string) => (key === "nav.mid_shift" ? "Mid-shift Pulse" : key);
    expect(matchPages(3, "pulse", t, { pulseV2: true }).map((p) => p.href)).toEqual(["/mid-shift"]);
    expect(matchPages(3, "pulse", t)).toEqual([]);
  });
  it("never hands a trainee a maintenance link the maintenance page refuses", () => {
    const source = (path: string) => readFileSync(path, "utf8");
    expect(MAINTENANCE_LINK_LEVEL).toBe(Number(source("lib/maintenance.ts").match(/const MAINTENANCE_BASE_LEVEL = (\d+)/)?.[1]));
    expect(canOpenMaintenance(PULSE_V2_BASE_LEVEL)).toBe(false);
    expect(canOpenMaintenance(MAINTENANCE_LINK_LEVEL)).toBe(true);
    const sections = source("lib/pulse/sections.ts");
    expect(sections).toMatch(/const fridgeHref = canOpenMaintenance\(ctx\.auth\.level\) \? `\/maintenance\?location=\$\{loc\}` : `\/mid-shift\/food_safety\?location=\$\{loc\}`/);
    for (const line of sections.split("\n").filter((l) => /fridge_(out_of_range|unchecked)/.test(l))) expect(line).not.toContain("href: `/maintenance");
    expect(source("components/pulse/sections/FoodSafetySection.tsx")).toMatch(/mode === "detail" && canOpenMaintenance\(viewerLevel\) && <Link/);
    expect(source("components/pulse/SectionBody.tsx")).toMatch(/<FoodSafetySection[^>]*viewerLevel=\{viewerLevel\}/);
  });
  it("every caller passes the v2 switch, and the page lets v2 viewers in before the v1 gate", () => {
    const source = (path: string) => readFileSync(path, "utf8");
    expect(source("components/DashboardNav.tsx")).toMatch(/navDestinationsFor\(actorLevel, \{[^}]*pulseV2: pulseV2Enabled\(\)/);
    expect(source("app/(authed)/reports/operations/page.tsx")).toMatch(/matchPages\([^;]*\{ pulseV2: pulseV2Enabled\(\) \}\)/);
    const page = source("app/(authed)/mid-shift/page.tsx");
    expect(page.indexOf("if (pulseV2Enabled())")).toBeGreaterThan(-1);
    expect(page.indexOf("if (pulseV2Enabled())")).toBeLessThan(page.indexOf("if (auth.level < MIDSHIFT_BASE_LEVEL)"));
  });
});

describe("chipHref", () => {
  it("carries the selected shop to the assignments board", () => {
    expect(chipHref("/assignments", true, "shop-1")).toBe("/assignments?location=shop-1");
    expect(chipHref("/profile", false, "shop-1")).toBe("/profile");
    expect(chipHref("/reports", true, null)).toBe("/reports");
  });
});
