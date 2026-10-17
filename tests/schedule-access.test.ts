/**
 * Scheduling Phase 2, Task 2 — the scheduling permissions, pure, decided before any I/O
 * (plan "Permissions"). Table-driven over every role × {own shop, other shop, no shop} × act.
 */
import { describe, expect, it } from "vitest";
import { ROLES, type RoleCode } from "@/lib/roles";
import { canSeeShopLaborTotals, type PeopleActor } from "@/lib/people/access-shared";
import {
  SCHEDULE_ACTS, canApproveSchedule, canEditSchedule, canEditStructure, canManageShopSwitch, canSeeScheduleMoney,
  canViewReconciliation, canViewSchedule, scheduleActRefusal, stepUpFor, type ScheduleAct, type ScheduleShopAccess,
} from "@/lib/scheduling/access-shared";

const OWN = "0a000000-0000-4000-8000-000000000001";
const OTHER = "0a000000-0000-4000-8000-000000000002";
const READ: ScheduleShopAccess = { agmAccess: "read" };
const EDIT: ScheduleShopAccess = { agmAccess: "edit" };

const actor = (role: RoleCode): PeopleActor => ({ userId: `u-${role}`, role, level: ROLES[role].level, locations: [OWN] });
const ALL_ROLES = Object.keys(ROLES) as RoleCode[];
const MOO_PLUS: RoleCode[] = ["moo", "owner", "cgs"];
const WRITE_ACTS: ScheduleAct[] = ["generate", "edit", "regenerate", "budget", "presence", "day_type", "person_settings"];

/** What the plan's table says, per (role, shop, act, agm setting). */
function expected(role: RoleCode, shop: "own" | "other" | "none", act: ScheduleAct, access: ScheduleShopAccess): string | null {
  if (role === "social_media_mgr") return "schedule_role_refused";
  const level = ROLES[role].level;
  const mooPlus = MOO_PLUS.includes(role);
  if (!mooPlus && role !== "gm" && role !== "agm") return "schedule_forbidden";
  if (level < 6) return "schedule_forbidden";
  if (shop === "none") return "shop_not_allowed";
  if (!mooPlus && shop === "other") return "shop_not_allowed";
  if (mooPlus) return null;
  if (act === "shop_switch" || act === "wage_estimates" || act === "tunables") return "schedule_forbidden";
  if (role === "gm") return null;
  // AGM at their own shop: the board read-only by default (R1); `edit` opens building and editing, never
  // approve, the structure, money, the switch.
  if (act === "view") return null;
  if (act === "reconciliation" || act === "approve" || act === "structure") return "schedule_forbidden";
  return access.agmAccess === "edit" && WRITE_ACTS.includes(act) ? null : "schedule_forbidden";
}

describe("scheduleActRefusal: every role × shop × act × AGM setting", () => {
  for (const role of ALL_ROLES) {
    it(`${role}`, () => {
      const a = actor(role);
      for (const [shop, loc] of [["own", OWN], ["other", OTHER], ["none", ""], ["none", "all"]] as const) {
        for (const act of SCHEDULE_ACTS) {
          for (const access of [READ, EDIT]) {
            expect(scheduleActRefusal(a, loc, act, access), `${role} ${shop} ${act} ${access.agmAccess}`).toBe(expected(role, shop, act, access));
          }
        }
      }
    });
  }
});

describe("the named helpers agree with the table", () => {
  it("canViewSchedule: GM own, MoO+ any, AGM own; Op-6 catering / prep and everyone below 6 never; SMM never", () => {
    expect(canViewSchedule(actor("gm"), OWN)).toBe(true);
    expect(canViewSchedule(actor("gm"), OTHER)).toBe(false);
    expect(canViewSchedule(actor("moo"), OTHER)).toBe(true);
    expect(canViewSchedule(actor("cgs"), OTHER)).toBe(true);
    expect(canViewSchedule(actor("agm"), OWN)).toBe(true);
    expect(canViewSchedule(actor("agm"), OTHER)).toBe(false);
    for (const r of ["catering_mgr", "prep_mgr", "social_media_mgr", "shift_lead", "key_holder", "employee"] as RoleCode[]) {
      expect(canViewSchedule(actor(r), OWN), r).toBe(false);
    }
  });

  it("money (= canSeeShopLaborTotals): GM own, MoO+ any — the AGM never, even with edit (J1)", () => {
    for (const r of ALL_ROLES) {
      for (const loc of [OWN, OTHER]) expect(canSeeScheduleMoney(actor(r), loc), `${r} ${loc}`).toBe(canSeeShopLaborTotals(actor(r), loc));
    }
    expect(canSeeScheduleMoney(actor("agm"), OWN)).toBe(false);
    expect(canSeeScheduleMoney(actor("gm"), OWN)).toBe(true);
  });

  it("canEditSchedule: the AGM edits their own shop only with agm_access = 'edit', never another shop", () => {
    expect(canEditSchedule(actor("agm"), OWN, READ)).toBe(false);
    expect(canEditSchedule(actor("agm"), OWN, EDIT)).toBe(true);
    expect(canEditSchedule(actor("agm"), OTHER, EDIT)).toBe(false);
    expect(canEditSchedule(actor("gm"), OWN, READ)).toBe(true);
    expect(canEditSchedule(actor("moo"), OTHER, READ)).toBe(true);
  });

  it("approve and the structure: GM own, MoO+ any; the switch and wage estimates MoO+ only; reconciliation GM own, MoO+", () => {
    expect(canApproveSchedule(actor("agm"), OWN)).toBe(false);
    expect(canApproveSchedule(actor("gm"), OWN)).toBe(true);
    expect(canEditStructure(actor("gm"), OWN)).toBe(true);
    expect(canEditStructure(actor("gm"), OTHER)).toBe(false);
    expect(canEditStructure(actor("agm"), OWN)).toBe(false);
    expect(canManageShopSwitch(actor("gm"))).toBe(false);
    expect(canManageShopSwitch(actor("moo"))).toBe(true);
    expect(canManageShopSwitch(actor("social_media_mgr"))).toBe(false);
    expect(canViewReconciliation(actor("gm"), OWN)).toBe(true);
    expect(canViewReconciliation(actor("agm"), OWN)).toBe(false);
    expect(canViewReconciliation(actor("owner"), OTHER)).toBe(true);
  });

  it("a level-8 social media manager does not exist, but a forged one is still refused by ROLE", () => {
    const forged: PeopleActor = { userId: "x", role: "social_media_mgr", level: 9, locations: [OWN] };
    for (const act of SCHEDULE_ACTS) expect(scheduleActRefusal(forged, OWN, act, EDIT)).toBe("schedule_role_refused");
    expect(canSeeScheduleMoney(forged, OWN)).toBe(false);
  });
});

describe("stepUpFor: the tier per act (Tier B verified only at the route)", () => {
  it("operational acts take none; regenerate takes B only when an edited week was confirmed; approve B; settings E", () => {
    for (const act of ["view", "generate", "edit", "budget", "presence", "day_type", "person_settings", "reconciliation"] as ScheduleAct[]) {
      expect(stepUpFor(act, { confirmedEditedWeeks: 0 }), act).toBeNull();
    }
    expect(stepUpFor("regenerate", { confirmedEditedWeeks: 0 })).toBeNull();
    expect(stepUpFor("regenerate", { confirmedEditedWeeks: 2 })).toBe("B");
    expect(stepUpFor("approve", { confirmedEditedWeeks: 0 })).toBe("B");
    for (const act of ["structure", "shop_switch", "wage_estimates", "tunables"] as ScheduleAct[]) {
      expect(stepUpFor(act, { confirmedEditedWeeks: 0 }), act).toBe("E");
    }
  });
});
