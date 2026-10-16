/**
 * Scheduling Phase 1 — CC's chunk F rulings (2026-10-16), the code half.
 *
 * (a) The PM criteria editor stays at /admin/pm-criteria, and its admin-hub card is ROLE-aware: a GM (whose page
 *     then binds their own shops) and MoO+ see it; the social media manager never does — by trusted ROLE, not by
 *     level alone, so a level that says 7 beside a role that is not a GM's does not open it.
 * (b) The extra 0271 guards: accepted, nothing to do. (c) The switch order is documented in the go-live sequence.
 */
import { describe, expect, it } from "vitest";
import { adminSectionsFor, ADMIN_SECTIONS } from "@/lib/admin/sections";
import { canEditPmCriteria, PM_CRITERIA_EDITOR_ROLES } from "@/lib/people/access-shared";
import { ROLES, type RoleCode } from "@/lib/roles";

const sees = (level: number, role: RoleCode) => adminSectionsFor(level, role).some((s) => s.id === "pm-criteria");

describe("ruling (a): the PM criteria hub card is role-aware", () => {
  it("the card points at /admin/pm-criteria", () => {
    expect(ADMIN_SECTIONS.find((s) => s.id === "pm-criteria")?.href).toBe("/admin/pm-criteria");
  });

  it("a GM sees it (the page then binds the GM to their own shops)", () => {
    expect(sees(ROLES.gm.level, "gm")).toBe(true);
  });

  it("MoO, owner and CGS see it (every shop)", () => {
    expect(sees(ROLES.moo.level, "moo")).toBe(true);
    expect(sees(ROLES.owner.level, "owner")).toBe(true);
    expect(sees(ROLES.cgs.level, "cgs")).toBe(true);
  });

  it("the social media manager never sees it — by role, even beside a level that would pass", () => {
    expect(sees(ROLES.social_media_mgr.level, "social_media_mgr")).toBe(false);
    expect(sees(7, "social_media_mgr")).toBe(false);
    expect(sees(8, "social_media_mgr")).toBe(false);
  });

  it("level 6 operational managers and everyone below do not see it (the editor is GM own shop / MoO+)", () => {
    for (const role of ["agm", "prep_mgr", "catering_mgr", "shift_lead", "key_holder", "trainer", "employee"] as const) {
      expect(sees(ROLES[role].level, role)).toBe(false);
    }
  });

  it("the card's rule matches canEditPmCriteria's actor half: exactly the roles that can hold that power", () => {
    const shown = (Object.keys(ROLES) as RoleCode[]).filter((r) => sees(ROLES[r].level, r)).sort();
    expect(shown).toEqual(["cgs", "gm", "moo", "owner"]);
    const shop = "a0000000-0000-4000-8000-00000000000a";
    for (const r of Object.keys(ROLES) as RoleCode[]) {
      const actor = { userId: "u", role: r, level: ROLES[r].level, locations: [shop] };
      expect(canEditPmCriteria(actor, shop), r).toBe(PM_CRITERIA_EDITOR_ROLES.includes(r));
    }
  });
});
