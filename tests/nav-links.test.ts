/**
 * Unit spine — lib/nav-links.ts (pure; the level-gated destination registry that
 * powers BOTH the dashboard nav chips and unified search's Pages results).
 *
 * Pins the bug this test was born from: the nav.ordering chip rendered at every
 * level while /ordering redirects below KH (PAR_PASS_MIN = 4), so sub-4 users
 * tapped a chip that bounced them straight back to the dashboard — and unified
 * search advertised the same dead route. Because navDestinationsFor is the single
 * source for both surfaces, one filter fixes both; these tests hold that.
 */
import { describe, it, expect } from "vitest";

import { navDestinationsFor, NAV_LINKS, chipHref } from "@/lib/nav-links";

const hrefs = (level: number) => navDestinationsFor(level).map((d) => d.href);

describe("navDestinationsFor — minLevel gating", () => {
  it("hides /ordering below key-holder (level 4)", () => {
    for (const level of [1, 2, 3]) {
      expect(hrefs(level)).not.toContain("/ordering");
    }
  });

  it("shows /ordering from key-holder up", () => {
    for (const level of [4, 5, 6, 8, 10]) {
      expect(hrefs(level)).toContain("/ordering");
    }
  });

  it("leaves ungated destinations visible at every level", () => {
    expect(hrefs(1)).toContain("/reports");
    expect(hrefs(1)).toContain("/profile");
  });

  it("keeps the existing mid-shift (>=4) and admin (>=6) floors", () => {
    expect(hrefs(3)).not.toContain("/mid-shift");
    expect(hrefs(4)).toContain("/mid-shift");
    expect(hrefs(5)).not.toContain("/admin");
    expect(hrefs(6)).toContain("/admin");
  });

  it("preserves display order: mid-shift first, admin last", () => {
    const out = hrefs(10);
    expect(out[0]).toBe("/mid-shift");
    expect(out[out.length - 1]).toBe("/admin");
  });

  it("never surfaces a destination the viewer's level fails", () => {
    for (const level of [1, 3, 4, 6, 10]) {
      for (const d of navDestinationsFor(level)) {
        expect(level).toBeGreaterThanOrEqual(d.minLevel ?? 0);
      }
    }
  });
});

describe("NAV_LINKS registry", () => {
  it("declares /ordering at the mirrored PAR_PASS_MIN floor of 4", () => {
    const ordering = NAV_LINKS.find((l) => l.href === "/ordering");
    expect(ordering?.minLevel).toBe(4);
  });
});

describe("chipHref", () => {
  it("appends the active location to scoped destinations", () => {
    expect(chipHref("/ordering", true, "loc-1")).toBe("/ordering?location=loc-1");
  });

  it("leaves unscoped destinations and null locations alone", () => {
    expect(chipHref("/profile", false, "loc-1")).toBe("/profile");
    expect(chipHref("/ordering", true, null)).toBe("/ordering");
  });
});
