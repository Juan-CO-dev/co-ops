/**
 * Nav PR 5, group 18 (plan r4, 6.1-6.3; spec 3.3.6 and 10): items follow the surfaces the viewer holds AT THIS SHOP.
 * The catering manager at a member shop gets the AGM list (the catering row as the block); at a non-member shop
 * (`tasks`, `catering`, `schedule`) the catering block row, Opening, Mid-day prep, AM prep list and the closing checklist,
 * no `ops` item, "mine" and names from a `checklist_tasks` fact, no Assign. With the task-day reader absent
 * (`assignments: not_shown`) the three rows read "not shown", and "Nobody yet" appears nowhere. MoO: everything at both
 * shops.
 */
import { describe, expect, it } from "vitest";
import { planDay, type DayPlan, type ShopFacts } from "@/lib/day-plan-shared";
import { AGM, assignment, CATERING_MEMBER, CATERING_NON_MEMBER, hm, item, MOO, ok, PLAN_DATE } from "./fixtures/day-plan/build";
import { capitolHill } from "./fixtures/day-plan/capitol-hill";
import { pStreet } from "./fixtures/day-plan/p-street";

const plan = (v: typeof AGM, t: string, f: ShopFacts) => planDay({ planDate: PLAN_DATE, nowMin: hm(t), viewer: v, facts: f }) as DayPlan;
const ids = (p: DayPlan) => p.items.map((i) => i.id).sort();
const OPS_ITEMS = ["cash", "pm_report", "ordering", "receiving", "counts"];

describe("surfaces at this shop", () => {
  it("the catering manager at a member shop: the AGM list, with the catering row as the block", () => {
    for (const t of ["07:00", "13:45", "20:30"]) {
      expect(ids(plan(CATERING_MEMBER, t, pStreet(hm(t))))).toEqual(ids(plan(AGM, t, pStreet(hm(t)))));
      expect(item(plan(CATERING_MEMBER, t, pStreet(hm(t))), "catering_today").placement).toBe("block");
      expect(item(plan(AGM, t, pStreet(hm(t))), "catering_today").placement).toBe("list");
    }
  });

  it("at a non-member shop: the catering block, Opening, Mid-day prep, AM prep list, closing; no ops item; names from checklist_tasks; no Assign", () => {
    const reader = (t: string): ShopFacts => ({
      ...capitolHill(hm(t)),
      assignments: ok({ forDate: PLAN_DATE, scope: "checklist_tasks", rows: [
        assignment("r1", "opening_report", "u-mia", "Mia"), assignment("r2", "mid_day_prep", "u-cat-x", "Cat"),
      ] }),
    });
    for (const t of ["07:00", "13:45", "20:30"]) {
      const p = plan(CATERING_NON_MEMBER, t, reader(t));
      expect(ids(p)).toEqual(["am_prep", "catering_today", "closing", "mid_day_prep", "opening"]);
      for (const id of OPS_ITEMS) expect(p.items.map((i) => i.id)).not.toContain(id);
      expect(item(p, "catering_today").placement).toBe("block");
      expect(item(p, "opening").holder).toEqual({ kind: "named", firstName: "Mia" });
      expect(item(p, "mid_day_prep")).toMatchObject({ mine: true, holder: { kind: "mine" } });
      expect(item(p, "am_prep").holder).toEqual({ kind: "nobody" });
      for (const i of p.items) expect(i.actions, i.id).not.toContain("assign");
    }
  });

  it("with assignments not_shown: the three rows read not_shown, and 'Nobody yet' appears nowhere", () => {
    for (const t of ["07:00", "13:45", "20:30"]) {
      const p = plan(CATERING_NON_MEMBER, t, { ...capitolHill(hm(t)), assignments: { kind: "not_shown" }, stations: { kind: "not_shown" } });
      for (const id of ["opening", "mid_day_prep", "am_prep"] as const) expect(item(p, id).holder, `${t} ${id}`).toEqual({ kind: "not_shown" });
      expect(JSON.stringify(p)).not.toContain("nobody");
      expect(p.notes.map((n) => n.reason.key)).toContain("day.note.stations_not_shown");
    }
  });

  it("MoO: everything, at both shops", () => {
    const all = ["am_prep", "cash", "catering_today", "closing", "counts", "mid_day_prep", "opening", "ordering", "pm_report", "receiving"];
    expect(ids(plan(MOO, "13:45", pStreet(hm("13:45"))))).toEqual(all);
    expect(ids(plan(MOO, "13:45", capitolHill(hm("13:45"))))).toEqual(all);
  });
});
