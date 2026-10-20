/**
 * Migration 0278 (the guarded person-settings writers; Astra BC-007, Juan 2026-10-20 "GMs own their shop") — AUTHORED,
 * NOT APPLIED. Pins: the house header and gate line; the executable PGlite proof (scripts/sql-harness-0278.mjs: the
 * subject rule in SQL, the expected head and the merge under the per-person lock, interleaved writes); 0274's writer
 * re-emitted with ONLY the subject check added; service_role-only grants; the lib's builders name the SQL arguments.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { mergePersonPositionsCall, savePersonSettingsCall, SCHEDULE_RPC } from "@/lib/scheduling/rpc-args-shared";

const src = readFileSync("supabase/migrations/0278_schedule_person_settings_guarded.sql", "utf8");
const src0274 = readFileSync("supabase/migrations/0274_schedule_settings.sql", "utf8");
const body = (sql: string, start: string) => { const i = sql.indexOf(start); const j = sql.indexOf("end $$;", i); return sql.slice(i, j + 7); };
const lines = (s: string) => s.split("\n").map((l) => l.trim()).filter(Boolean);

describe("0278_schedule_person_settings_guarded", () => {
  it("house header and gate line (file only, not applied)", () => {
    const [first, gate] = src.split("\n");
    expect(first).toBe("-- Migration 0278_schedule_person_settings_guarded");
    expect(gate).toBe("-- AUTHORED 2026-10-20. NOT YET APPLIED — apply via MCP after review (sim first, prod on Juan's word, AFTER 0274).");
  });

  it("the executable proof runs green (PGlite: stub grants, the REAL helpers + 0270 + 0274, then 0278)", () => {
    const out = execFileSync(process.execPath, ["scripts/sql-harness-0278.mjs"], { encoding: "utf8", timeout: 240_000 });
    expect(out).not.toContain("FAIL ");
    for (const s of ["S2 merge: a GM never sets their OWN settings", "S3 a stale p_expected (an older row) → person_settings_moved",
      "S4 a primary change keeps every other field of the latest row", "S5 A's picker change merges onto B's row: both changes stand", "PASS 0278:"]) expect(out).toContain(s);
  }, 260_000);

  it("0274's writer is re-emitted with ONLY the subject check (and the level it needs) added", () => {
    const old = lines(body(src0274, "create function public.record_schedule_person_settings("));
    const now = lines(body(src, "create or replace function public.record_schedule_person_settings("));
    const added = now.filter((l) => !old.includes(l));
    expect(added).toEqual([
      "create or replace function public.record_schedule_person_settings(p_actor uuid, p_location uuid, p_user uuid, p_work_type text, p_also_allowed text[],",
      "declare v_role text; v_old public.schedule_person_settings%rowtype; v_had boolean; v_id uuid; v_pos uuid; v_level integer;",
      "v_level := public.schedule_actor_require(p_actor, p_location, 6);",
      "perform public.schedule_person_subject_check(p_actor, v_level, p_user);",
    ]);
    const removed = old.filter((l) => !now.includes(l));
    expect(removed).toEqual([
      "create function public.record_schedule_person_settings(p_actor uuid, p_location uuid, p_user uuid, p_work_type text, p_also_allowed text[],",
      "declare v_role text; v_old public.schedule_person_settings%rowtype; v_had boolean; v_id uuid; v_pos uuid;",
      "perform public.schedule_actor_require(p_actor, p_location, 6);",
    ]);
  });

  it("every 0278 function: revoked from public / anon / authenticated, executable by service_role only", () => {
    for (const sig of ["schedule_person_subject_check(uuid, integer, uuid)",
      "record_schedule_person_settings(uuid, uuid, uuid, text, text[], text, uuid[], numeric, numeric, boolean, numeric, boolean)",
      "save_schedule_person_settings(uuid, uuid, uuid, uuid, text, text[], text, uuid[], numeric, numeric, boolean, numeric, boolean)",
      "merge_schedule_person_positions(uuid, uuid, uuid, jsonb)"]) {
      expect(src).toContain(`revoke all on function public.${sig} from public, anon, authenticated;`);
      expect(src).toContain(`grant execute on function public.${sig} to service_role;`);
    }
    expect(src).not.toMatch(/grant execute[^;]*to (anon|authenticated|public)/i);
    expect(src).not.toMatch(/create table|alter table/i);
  });

  it("the lib's builders name exactly the SQL arguments", () => {
    const save = savePersonSettingsCall({ actorId: "a", locationId: "l", userId: "u", expectedId: null, workType: null, alsoAllowed: [], leaderSetting: null, coverPositions: [],
      softMinH: null, softMaxH: null, fullTime: false, fullTimeMinH: null, rosterInclude: null });
    expect(save.fn).toBe(SCHEDULE_RPC.savePersonSettings);
    const sig = /create function public\.save_schedule_person_settings\(([\s\S]*?)\)\s*returns/.exec(src)![1]!;
    expect(Object.keys(save.args)).toEqual([...sig.matchAll(/(p_\w+)/g)].map((m) => m[1]));
    const merge = mergePersonPositionsCall({ actorId: "a", locationId: "l", userId: "u", changes: {} });
    expect(Object.keys(merge.args)).toEqual(["p_actor", "p_location", "p_user", "p_changes"]);
  });
});
