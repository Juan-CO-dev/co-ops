/**
 * Nav PR 5, group 14 (plan r4, 2.1 and spec 3.3.2 "Checklist reads are instance first"), engine side only: a checklist
 * fact carries the day's instance status on ANY template version and deliberately no template id, so the engine cannot
 * look anything up by an "effective" template. Days whose instance sits on a replaced or retired version produce the same
 * plan as their current-version twins; the late-close alert fires from yesterday's "open" on a retired version. (The
 * instance-first reads themselves are PR 6.)
 */
import { describe, expect, expectTypeOf, it } from "vitest";
import { planDay, type ChecklistDay, type DayPlan, type MidDayDay, type ShopFacts } from "@/lib/day-plan-shared";
import { ANA, checklist, hm, ok, PLAN_DATE } from "./fixtures/day-plan/build";
import { pStreet } from "./fixtures/day-plan/p-street";

/** What a loader bug could smuggle in: the version the instance was found on. The engine must not care. */
const onVersion = <T extends object>(v: T, templateId: string, templateActive: boolean): T => ({ ...v, templateId, templateActive }) as T;
const plan = (t: string, f: ShopFacts) => planDay({ planDate: PLAN_DATE, nowMin: hm(t), viewer: ANA, facts: f }) as DayPlan;
const tagDay = (f: ShopFacts, field: "opening" | "closing" | "amPrep" | "yesterdayClosing", templateId: string, active: boolean): ShopFacts => {
  const fact = f[field];
  return fact.kind === "ok" ? { ...f, [field]: ok(onVersion(fact.value, templateId, active)) } : f;
};
const tagMidDay = (f: ShopFacts, templateId: string, active: boolean): ShopFacts =>
  f.midDay.kind === "ok" ? { ...f, midDay: ok({ ...f.midDay.value, instances: f.midDay.value.instances.map((i) => onVersion(i, templateId, active)) } as MidDayDay) } : f;

describe("instance first, engine side", () => {
  it("ChecklistDay has no template field", () => {
    expectTypeOf<keyof ChecklistDay>().toEqualTypeOf<"forDate" | "status" | "phase1At" | "finishedAt" | "finishedByName" | "sectionsLeft" | "finishedById">();
  });

  it.each([
    ["replaced mid-day (the opening instance on the version that was current this morning)", (f: ShopFacts) => tagDay(f, "opening", "tpl-open-v1", false)],
    ["retired by apply-now (the closing instance on the retired version)", (f: ShopFacts) => tagDay(f, "closing", "tpl-close-v3", false)],
    ["AM prep and mid-day prep on a retired version", (f: ShopFacts) => tagMidDay(tagDay(f, "amPrep", "tpl-am-v2", false), "tpl-mid-v2", false)],
    ["yesterday's closing on a retired version", (f: ShopFacts) => tagDay(f, "yesterdayClosing", "tpl-close-v2", false)],
  ])("%s: the same plan as the current-version twin", (_l, retag) => {
    for (const t of ["07:00", "13:45", "20:30", "21:45"]) {
      const current = pStreet(hm(t));
      expect(plan(t, retag(current)), t).toEqual(plan(t, current));
    }
  });

  it("the late-close alert fires from yesterday's status 'open' on a retired version", () => {
    const f = { ...pStreet(hm("07:00")), yesterdayClosing: ok(onVersion(checklist("2026-11-17", { status: "open" }), "tpl-close-v2", false)) };
    expect(plan("07:00", f).alerts).toEqual([{ kind: "late_close", date: "2026-11-17", shopCode: "P" }]);
  });
});
