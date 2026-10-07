import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { MIDSHIFT_BASE_LEVEL } from "@/lib/midshift-shared";
import { navDestinationsFor, chipHref } from "@/lib/nav-links";

const hrefs = (level: number) => navDestinationsFor(level).map((d) => d.href).sort();
const everyone = ["/maintenance", "/training", "/recipes", "/profile", "/settings", "/my-feedback"];
const kh = ["/mid-shift", "/assignments", "/reports"];
const lead = ["/catering", "/written-reports"];
const manager = ["/reports/trends", "/lto", "/admin"];

describe("role navigation", () => {
  it.each([2, 3, 4, 5, 6, 7, 9])("shows exactly the approved destinations at level %s", (level) => {
    expect(hrefs(level)).toEqual([...everyone, ...(level >= 4 ? kh : []), ...(level >= 5 ? lead : []), ...(level >= 6 ? manager : [])].sort());
  });
  it("never advertises a placeholder or the ordering task in navigation", () => {
    for (const level of [2, 3, 4, 5, 6, 7, 9, 10]) {
      for (const hidden of ["/announcements", "/tips", "/ai", "/rollups", "/deep-cleaning", "/feedback", "/comms", "/ordering"]) expect(hrefs(level)).not.toContain(hidden);
    }
  });
  it("satisfies the destination server floors, including Catering's level-5 page", () => {
    // Floors confirmed against destination pages/layouts and their server loaders.
    const pageFloors: Record<string, number> = {
      "/maintenance": 0, "/training": 0, "/recipes": 0, "/profile": 0, "/settings": 0, "/my-feedback": 0,
      "/mid-shift": 4, "/assignments": 4, "/reports": 0,
      "/catering": 5, "/written-reports": 0, "/reports/trends": 0, "/lto": 0, "/admin": 6,
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
    expect(catering).toMatch(/if \(level < CATERING_HUB_MIN\)/);
    expect(admin).toMatch(/if \(auth\.level < ADMIN_MIN_LEVEL\)/);
    expect(source("app/(authed)/mid-shift/page.tsx")).toMatch(/if \(auth\.level < MIDSHIFT_BASE_LEVEL\)/);
    const declaredNumber = (contents: string, pattern: RegExp) => {
      const value = contents.match(pattern)?.[1];
      expect(value, `guard missing: ${pattern}`).toBeDefined();
      return Number(value);
    };
    const actualFloors: Record<string, number> = {
      "/catering": declaredNumber(catering, /const CATERING_HUB_MIN = (\d+)/),
      "/admin": declaredNumber(admin, /const ADMIN_MIN_LEVEL = (\d+)/),
      "/assignments": declaredNumber(assignments, /if \(auth\.level < (\d+)\) redirect/),
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

describe("chipHref", () => {
  it("carries the selected shop to the assignments board", () => {
    expect(chipHref("/assignments", true, "shop-1")).toBe("/assignments?location=shop-1");
    expect(chipHref("/profile", false, "shop-1")).toBe("/profile");
    expect(chipHref("/reports", true, null)).toBe("/reports");
  });
});
