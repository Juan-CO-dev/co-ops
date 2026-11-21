/**
 * Nav PR 5, group 13 (plan r4, 6.4): the social media manager. Decided by the REAL role first; for this viewer the engine
 * reads ONLY SmmFacts (own checklist tasks, own station). Failures are explicit ("unavailable" + a parameterless note),
 * never an empty list. Given shop facts by mistake, the output carries nothing from them, and a proxy records zero reads
 * of any shop field (a read of the `kind` discriminator is allowed).
 */
import { describe, expect, it } from "vitest";
import { CHECKLIST_TASKS, lensFor, planDay, smmPlan, type ShopFacts, type SmmPlan } from "@/lib/day-plan-shared";
import { ROLES, type RoleCode } from "@/lib/roles";
import { hm, PLAN_DATE } from "./fixtures/day-plan/build";
import { busiestFacts, FORBIDDEN_STRINGS, SMM, SMM_FAILED_STATION, SMM_FAILED_TASKS, SMM_OK } from "./fixtures/day-plan/busiest";

const SMM_KEYS = ["day.reason.own.assigned", "day.fail.assignments", "day.fail.own_station", "day.state.not_started", "day.state.in_progress", "day.state.done"];
const smm = (facts: Parameters<typeof planDay>[0]["facts"], t = "13:45") => {
  const p = planDay({ planDate: PLAN_DATE, nowMin: hm(t), viewer: SMM, facts });
  if (p.kind !== "smm") throw new Error("smm plan expected");
  return p;
};
const keysIn = (p: SmmPlan) => JSON.stringify(p).match(/day\.[a-z_.]+/g) ?? [];

describe("the lens is decided by the real role", () => {
  it("lensFor: smm for the social media manager, shop for every other role", () => {
    for (const role of Object.keys(ROLES) as RoleCode[]) expect(lensFor(role), role).toBe(role === "social_media_mgr" ? "smm" : "shop");
  });
});

describe("the real path (r3, D3)", () => {
  it("SMM_OK: exactly Opening and Mid-day prep, in the fixed day order, each 'Assigned to you'; cash and ordering absent", () => {
    const p = smm(SMM_OK);
    expect(p.tasks).toEqual([
      { task: "opening_report", destId: "opening", state: "done", reason: { key: "day.reason.own.assigned", params: {} } },
      { task: "mid_day_prep", destId: "mid-day", state: "in_progress", reason: { key: "day.reason.own.assigned", params: {} } },
    ]);
    expect(p.station).toEqual({ name: "Expo Station", nameEs: "Estación Expo" });
    expect(p.notes).toEqual([]);
    expect(p.closingDestId).toBe("closing");
    expect(Object.keys(p).sort()).toEqual(["closingDestId", "kind", "notes", "planDate", "station", "tasks"]);
  });

  it("planDay routes the role to smmPlan; only the three checklist tasks can appear", () => {
    expect(smm(SMM_OK)).toEqual(smmPlan(PLAN_DATE, SMM, SMM_OK));
    expect([...CHECKLIST_TASKS]).toEqual(["opening_report", "am_prep", "mid_day_prep"]);
    const tasks = smmPlan(PLAN_DATE, SMM, SMM_OK).tasks;
    expect(tasks !== "unavailable" && tasks.every((t) => (CHECKLIST_TASKS as readonly string[]).includes(t.task))).toBe(true);
  });

  it("a failed own-task read: tasks 'unavailable' and the note day.fail.assignments (never an empty list)", () => {
    const p = smm(SMM_FAILED_TASKS);
    expect(p.tasks).toBe("unavailable");
    expect(p.notes).toEqual(["day.fail.assignments"]);
    expect(p.station).toEqual({ name: "Expo Station", nameEs: "Estación Expo" });
  });

  it("a failed own-station read: station 'unavailable' and the note day.fail.own_station; neither note has params", () => {
    const p = smm(SMM_FAILED_STATION);
    expect(p.station).toBe("unavailable");
    expect(p.notes).toEqual(["day.fail.own_station"]);
    expect(p.notes.every((n) => typeof n === "string")).toBe(true);
  });

  it("uses only SMM_KEYS and carries no other person's data", () => {
    for (const facts of [SMM_OK, SMM_FAILED_TASKS, SMM_FAILED_STATION]) {
      const p = smm(facts);
      for (const k of keysIn(p)) expect(SMM_KEYS, k).toContain(k);
      for (const s of FORBIDDEN_STRINGS) expect(JSON.stringify(p), s).not.toContain(s);
    }
  });
});

describe("the wrong-facts path: the busiest SHOP facts handed to the social media manager", () => {
  it("the output contains none of the forbidden strings, no number beyond the date, and only SMM_KEYS", () => {
    for (const t of ["07:00", "13:45", "20:30"]) {
      const p = smm(busiestFacts(hm(t)), t);
      const text = JSON.stringify(p);
      for (const s of FORBIDDEN_STRINGS) expect(text, `${t} ${s}`).not.toContain(s);
      expect(text.replace(PLAN_DATE, "")).not.toMatch(/\d/);
      for (const k of keysIn(p)) expect(SMM_KEYS, k).toContain(k);
      expect(p).toMatchObject({ tasks: "unavailable", station: "unavailable" });
    }
  });

  it("a proxy over ShopFacts records a read of `kind` and zero reads of any shop field", () => {
    const reads: string[] = [];
    const facts = new Proxy(busiestFacts(hm("13:45")), {
      get(target, prop, receiver) {
        reads.push(String(prop));
        return Reflect.get(target, prop, receiver);
      },
    }) as ShopFacts;
    smm(facts);
    expect(reads.filter((r) => r !== "kind")).toEqual([]);
  });
});
