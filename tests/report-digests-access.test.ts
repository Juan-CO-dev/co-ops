/**
 * Digests round 3, PR 1a: the DATA gate (lib/report-digests-access-shared.ts). Fail closed — absent / null
 * access, a null shop and a malformed day are all "no" — and every capability DELEGATES to the app's own
 * predicate (for `sales_detail`: the Sales page gate as `canOpen` mirrors it), never a second opinion.
 */
import { describe, expect, it } from "vitest";
import { digestAccessFor, digestCan } from "@/lib/report-digests-access-shared";
import { canOpen, NO_ACCESS_VIEWER, type LinkViewer } from "@/lib/report-digests-links";
import { ROLES, type RoleCode } from "@/lib/roles";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const DAY = "2026-10-07";
const v = (role: RoleCode | string, locations: string[] = [A]): LinkViewer =>
  ({ role, level: role in ROLES ? ROLES[role as RoleCode].level : -1, locations });

describe("fail closed", () => {
  it("absent and null access deny every capability", () => {
    expect(digestCan(undefined, "sales_detail", { locationId: A, day: DAY })).toBe(false);
    expect(digestCan(null, "sales_detail", { locationId: A, day: DAY })).toBe(false);
    expect(digestAccessFor(undefined)).toBeNull();
    expect(digestAccessFor(null)).toBeNull();
  });

  it("a null shop (no shop set) and a malformed day deny, even for the owner", () => {
    const owner = digestAccessFor(v("owner", []));
    expect(digestCan(owner, "sales_detail", { locationId: A, day: DAY })).toBe(true);
    expect(digestCan(owner, "sales_detail", { locationId: null, day: DAY })).toBe(false);
    for (const day of ["", "yesterday", "2026-1-07", "2026-10-07T00:00:00Z", "07/10/2026"]) {
      expect(digestCan(owner, "sales_detail", { locationId: A, day }), day).toBe(false);
    }
  });

  it("F8: an impossible calendar date has the right shape and is still no day at all (the report screens' validator)", () => {
    const owner = digestAccessFor(v("owner", []));
    for (const day of ["2026-02-31", "2026-02-29", "2026-04-31", "2026-13-01", "2026-00-10", "2026-10-00", "2026-10-32"]) {
      expect(digestCan(owner, "sales_detail", { locationId: A, day }), day).toBe(false);
      expect(digestCan(owner, "sales_detail", { locationId: "all", day }), day).toBe(false);
    }
    // Real dates, a leap day included, still pass.
    for (const day of ["2028-02-29", "2026-12-31", "2026-01-01"]) expect(digestCan(owner, "sales_detail", { locationId: A, day }), day).toBe(true);
  });

  it("the asymmetry is deliberate: a LINK with no viewer is unscoped (true), DATA with no access is no (false)", () => {
    expect(canOpen(undefined, { to: "sales", location: A, day: DAY })).toBe(true);
    expect(digestCan(digestAccessFor(undefined), "sales_detail", { locationId: A, day: DAY })).toBe(false);
    expect(digestCan(undefined, "sales_detail", { locationId: A, day: DAY })).toBe(false);
  });

  it("an unresolvable recipient (NO_ACCESS_VIEWER) can do nothing", () => {
    const none = digestAccessFor(NO_ACCESS_VIEWER);
    for (const locationId of [A, B, "all"]) expect(digestCan(none, "sales_detail", { locationId, day: DAY })).toBe(false);
  });
});

describe("the sales_detail matrix (roles from lib/roles.ts) delegates to the Sales page gate", () => {
  const cases: Array<[string, LinkViewer, string, boolean]> = [
    ["owner, own shop", v("owner", []), A, true],
    ["owner, another shop", v("owner", []), B, true],
    ["owner, all", v("owner", []), "all", true],
    ["cgs, any shop", v("cgs", []), B, true],
    ["cgs, all", v("cgs", []), "all", true],
    ["moo (no membership), any shop", v("moo", []), B, true],
    ["moo, all", v("moo", []), "all", true],
    ["gm, own shop", v("gm"), A, true],
    ["gm, another shop", v("gm"), B, false],
    ["gm, all", v("gm"), "all", false],
    ["agm, own shop", v("agm"), A, false],
    ["catering_mgr, own shop", v("catering_mgr"), A, false],
    ["prep_mgr, own shop", v("prep_mgr"), A, false],
    ["social_media_mgr, own shop", v("social_media_mgr"), A, false],
    ["shift lead (level 5), own shop", v("shift_lead"), A, false],
    ["an unknown role string", { role: "regional_wizard", level: 9, locations: [A] }, A, false],
    ["NO_ACCESS_VIEWER", NO_ACCESS_VIEWER, A, false],
  ];
  it.each(cases)("%s → %s", (_name, viewer, locationId, expected) => {
    const got = digestCan(digestAccessFor(viewer), "sales_detail", { locationId, day: DAY });
    expect(got).toBe(expected);
    // It must delegate, not re-decide: identical to the Sales link gate for the same viewer, shop and day.
    expect(got).toBe(canOpen(viewer, { to: "sales", location: locationId, day: DAY }));
  });

  it("the levels used above are the ones lib/roles.ts holds (owner 9, cgs 10, moo 8, gm 7, level-6 roles, shift lead 5)", () => {
    expect([ROLES.owner.level, ROLES.cgs.level, ROLES.moo.level, ROLES.gm.level, ROLES.agm.level, ROLES.shift_lead.level]).toEqual([9, 10, 8, 7, 6, 5]);
  });
});
