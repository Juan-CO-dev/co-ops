import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import {
  applyRoleChange, CREW_TYPES, primaryOf, reconcileLineFloors, reconcilePriorityPairs,
  structureProblem, type ScheduleStructure,
} from "@/lib/scheduling/structure-shared";
import { PSTREET_ROLES, pStreetSeed } from "./fixtures/schedule/structure-floors";

const id = (role: string) => Object.keys(PSTREET_ROLES).find((key) => PSTREET_ROLES[key] === role)!;
function mapped() {
  const s = pStreetSeed();
  for (const [key, role] of Object.entries(PSTREET_ROLES)) s.positions[key] = applyRoleChange(s.positions[key]!, role);
  return s;
}
function effective(draft: ScheduleStructure) {
  const s = structuredClone(draft);
  reconcilePriorityPairs(s); reconcileLineFloors(s);
  return s;
}

describe("effective priority reconciliation", () => {
  it("pairs the confirmed map in seed order with zero secondary floors, without changing the draft", async () => {
    const draft = mapped();
    const s = effective(draft);
    expect(s.priority).toEqual([
      { pair: [id("prep_dish"), id("prep")], primary: id("prep_dish") },
      { pair: [id("register"), id("expo")], primary: id("register") },
      { pair: [id("walk_online"), id("walk")], primary: id("walk_online") },
    ]);
    for (const type of CREW_TYPES) {
      expect(s.crews[type].lineMinHeads[id("expo")]).toBe(0);
      expect(s.crews[type].lineMinHeads[id("walk")]).toBe(0);
      expect(s.crews[type].lineMinHeads[id("prep")]).toBeUndefined();
      expect(draft.crews[type].lineMinHeads[id("expo")]).toBe(1);
    }
    expect(draft.priority).toEqual([]);
    expect(structureProblem(s)).toBeNull();
    expect(effective(s)).toEqual(s);
    // Execute the real SQL validator and its pure helpers in memory, without env or a remote DB.
    const sql = readFileSync("supabase/migrations/0274_schedule_settings.sql", "utf8");
    const db = new PGlite();
    try {
      await db.exec(sql.slice(sql.indexOf("create function public.schedule_json_num"), sql.indexOf("create table public.schedule_shop_settings")));
      const crewSql = readFileSync("supabase/migrations/0283_schedule_crew_structure.sql", "utf8");
      const start = crewSql.indexOf("create or replace function public.valid_schedule_structure(");
      await db.exec(crewSql.slice(start, crewSql.indexOf("end $$;", start) + 7));
      const result = await db.query<{ valid: boolean }>("select public.valid_schedule_structure($1::jsonb) as valid", [JSON.stringify(s)]);
      expect(result.rows).toEqual([{ valid: true }]);
    } finally { await db.close(); }
  });
  it("keeps a swapped primary and reversed pair order, including after a temporary role edit", () => {
    const draft = effective(mapped());
    const pair = draft.priority.find((p) => p.primary === id("register"))!;
    pair.primary = id("expo"); pair.pair.reverse();
    expect(effective(draft).priority).toEqual(draft.priority);
    draft.positions[id("expo")]!.role = "line_other";
    expect(effective(draft).priority).toHaveLength(2);
    draft.positions[id("expo")]!.role = "expo";
    expect(primaryOf(effective(draft), id("register"))).toBe(id("expo"));
  });
  it("drops missing positions and does not infer a pair from duplicate register mappings", () => {
    const s = effective(mapped());
    delete s.positions[id("expo")];
    expect(effective(s).priority).toHaveLength(2);
    const duplicate = mapped();
    duplicate.positions[id("line_other")]!.role = "register";
    expect(primaryOf(effective(duplicate), id("expo"))).toBeNull();
    expect(structureProblem(effective(duplicate))).toBeNull();
  });
  it("keeps an existing valid pair even when another position gains its role", () => {
    const s = effective(mapped());
    s.positions[id("line_other")]!.role = "register";
    expect(effective(s).priority).toEqual(s.priority);
  });
  it("is a no-op on the seed built with roles", () => {
    const s = pStreetSeed(PSTREET_ROLES);
    const original = structuredClone(s);
    reconcilePriorityPairs(s);
    expect(s).toEqual(original);
  });
});
